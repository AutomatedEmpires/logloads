import { randomBytes } from "node:crypto"

import postgres, { type Sql } from "postgres"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { emailSuppressionHash, type EmailSendMessage } from "@logloads/services"

import { MarketplaceAdapterConfigurationError } from "../port"
import type { ResendSendResult } from "./deliver"
import { runEmailWorker, type EmailWorkerSettings } from "./worker"
import { createPostgresNotificationWorker, type NotificationWorkerDb } from "./worker-db"

/**
 * The email worker against the real schema (#405), after stage 46 on the disposable database. A local skip is not a
 * pass. It runs in the adapter-contract job over a NOINHERIT login role that can become service_role and nothing else,
 * as a deployment would. Resend is a fake: nothing leaves the job.
 *
 * It proves at the worker layer what stage 47 proves in SQL: a new inquiry's email is claimed, composed with its
 * one-tap replies and stable unsubscribe link, sent once with the notice's idempotency key and recorded as sent; a
 * bounce puts the address on the suppression list, and the next email to that address is suppressed without a send.
 */

const DB_URL = process.env.LOGLOADS_DISPOSABLE_DB_URL ?? ""
const REQUIRED = process.env.LOGLOADS_ADAPTER_CONTRACT === "required"
const DISPOSABLE =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.LOGLOADS_DB_ENV === "ci-disposable" &&
  /^postgresql:\/\/postgres:[A-Za-z0-9_-]+@127\.0\.0\.1:5432\/logloads_test$/.test(DB_URL)

const ISSUER = "https://clerk.worker-contract.test"
const AUDIENCE = "logloads-worker-contract"
const ROLE = "logloads_email_worker_ci"
const LEDGER = "06,11,12,16,18,23,26,29,31,33,35,38,40,42,44,46"
const LANDING_EMAIL = "land@worker-contract.test"
const KEY = "worker-contract-suppression-key-0123456789"

if (REQUIRED && !DISPOSABLE) {
  describe("email worker contract", () => {
    it("runs only against the guarded disposable PostgreSQL 17 database", () => {
      throw new Error("LOGLOADS_ADAPTER_CONTRACT=required, but the guarded disposable CI database is not configured")
    })
  })
}

function roleUrl(password: string): string {
  return DB_URL.replace(/^postgresql:\/\/postgres:[A-Za-z0-9_-]+@/, `postgresql://${ROLE}:${password}@`)
}

const as = (sub: string) => `perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'iss', '${ISSUER}', 'sub', '${sub}', 'aud', '${AUDIENCE}',
    'exp', extract(epoch from now())::bigint + 3600)::text, true);
  set local role authenticated;`

/** One landing business whose owner wants inquiry email, one job, and two hauling businesses that have not sent yet. */
const FIXTURE = `
do $$
declare
  o_land uuid; l uuid; v_owner uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  v_owner := marketplace.sync_verified_identity('${ISSUER}', 'worker_land', 'Worker Landing Owner', '${LANDING_EMAIL}', true);
  perform marketplace.sync_verified_identity('${ISSUER}', 'worker_haul', 'Worker Hauler Owner', 'haul@worker-contract.test', true);
  perform marketplace.sync_verified_identity('${ISSUER}', 'worker_haul2', 'Worker Second Hauler', 'haul2@worker-contract.test', true);
  reset role;
  ${as("worker_land")}
  o_land := marketplace.create_organization('Worker Landing Co', 'nw405-landing', 'OR', false);
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform marketplace.open_subscription_cycle(o_land, 'regional', 'active', now() - interval '1 hour', now() + interval '29 days', 'cus_nw405', 'sub_nw405', false, 7, false);
  reset role;
  ${as("worker_land")}
  insert into marketplace.landings (org_id, name, status, public_area_label, public_point, state_code)
  values (o_land, 'Worker Landing', 'active', 'Near Burns, OR', marketplace.make_public_point(-119.05, 43.59), 'OR')
  returning id into l;
  insert into marketplace.landing_private_details (landing_id, org_id, exact_point, directions, gate_instructions, site_contact_name, site_contact_phone)
  values (l, o_land, extensions.st_setsrid(extensions.st_makepoint(-119.05, 43.59), 4326)::extensions.geography,
          'Worker road', 'Worker gate', 'Worker Foreman', '+15415550405');
  perform marketplace.publish_job_posting(l, 'NW405 Fir haul', array['log_truck'], 1, 'Fir sawlogs', 'Worker contract haul.', 'per_ton', 500, null,
    1, current_date + 10, 8, 3.0, 6, 30.0, 'Bend Mill, OR', 28, null, null, array['ppe'], true);
  reset role;
  insert into marketplace.notification_preferences (user_id, org_id, category, channel, enabled)
  values (v_owner, o_land, 'inquiry_reply', 'email', true)
  on conflict (user_id, org_id, category, channel) do update set enabled = true;
  ${as("worker_haul")}
  perform marketplace.create_organization('Worker River Hauling', 'nw405-haul', 'OR', true);
  reset role;
  ${as("worker_haul2")}
  perform marketplace.create_organization('Worker Second Hauling', 'nw405-haul2', 'OR', true);
  reset role;
end
$$;`

/** One hauling business sends interest on the job; only that inquiry's email is due afterwards. */
const sendInterest = (sub: string, slug: string) => `
do $$
declare e uuid;
begin
  ${as(sub)}
  select interest_id into e from marketplace.submit_expression_of_interest(
    (select id from marketplace.organizations where slug = '${slug}'),
    (select id from marketplace.job_postings where title = 'NW405 Fir haul'), 1);
  reset role;
  update marketplace.notification_outbox set available_at = now() + interval '1 day'
  where channel = 'email' and status = 'pending' and subject_id <> e;
end
$$;`

const CLEANUP = `
do $$
declare j uuid;
begin
  ${as("worker_land")}
  for j in select id from marketplace.job_postings where title = 'NW405 Fir haul' and status = 'active' loop
    perform marketplace.set_job_posting_status(j, 'paused');
  end loop;
  reset role;
end
$$;`

const SETTINGS: EmailWorkerSettings = {
  allowlist: [LANDING_EMAIL],
  apiKey: "test-key-not-used",
  from: "LogLoads <notifications@logloads.test>",
  legalName: "LogLoads",
  oneTapSecret: "worker-contract-one-tap-secret",
  origin: "https://logloads.test",
  postalAddress: "Test mailbox 100",
  suppressionKey: KEY
}

describe.skipIf(!DISPOSABLE)("email worker contract (disposable PostgreSQL 17)", () => {
  let admin: Sql
  let workerSql: Sql
  let store: NotificationWorkerDb
  const sent: Array<{ key: string; message: EmailSendMessage }> = []
  const send = async (message: EmailSendMessage, key: string): Promise<ResendSendResult> => {
    sent.push({ key, message })
    return { id: `re_contract_${sent.length}`, ok: true }
  }

  afterAll(async () => {
    await store?.close().catch(() => undefined)
    await workerSql?.end({ timeout: 5 }).catch(() => undefined)
    await admin?.unsafe(CLEANUP).catch(() => undefined)
    await admin?.unsafe("delete from marketplace.email_suppressions where address_hash = $1", [emailSuppressionHash(LANDING_EMAIL, KEY)]).catch(() => undefined)
    await admin?.unsafe(`drop role if exists ${ROLE}`).catch(() => undefined)
    await admin?.end({ timeout: 5 }).catch(() => undefined)
  })

  it("sets up the fixture and a login role that can become only service_role", async () => {
    admin = postgres(DB_URL, { max: 1, onnotice: () => undefined, prepare: false })
    const password = randomBytes(18).toString("hex")

    await admin.unsafe(
      "insert into marketplace.trusted_identity_issuers (issuer, label, expected_audience, enabled) values ($1, 'Worker contract', $2, true) on conflict (issuer) do nothing",
      [ISSUER, AUDIENCE]
    )
    await admin.unsafe(FIXTURE)
    await admin.unsafe(`drop role if exists ${ROLE}`)
    await admin.unsafe(`create role ${ROLE} login noinherit password '${password}'`)
    await admin.unsafe(`grant service_role to ${ROLE}`)

    workerSql = postgres(roleUrl(password), { max: 1, onnotice: () => undefined, prepare: false })
    store = createPostgresNotificationWorker({ sql: workerSql })

    const ledger = await admin.unsafe("select string_agg(version, ',' order by applied_at, version) as versions from marketplace.schema_migrations")
    expect(ledger[0]?.versions).toBe(LEDGER)
  }, 60_000)

  it("refuses a login role that is a superuser", async () => {
    await expect(createPostgresNotificationWorker({ sql: admin }).claim(1, 60)).rejects.toBeInstanceOf(MarketplaceAdapterConfigurationError)
  })

  it("sends the landing's new-inquiry email once, with its one-tap replies, and records it as sent", async () => {
    await admin.unsafe(sendInterest("worker_haul", "nw405-haul"))

    const result = await runEmailWorker({ send, settings: SETTINGS, store })

    expect(result).toMatchObject({ status: "ran" })
    const mine = sent.filter((row) => row.message.to === LANDING_EMAIL)

    expect(mine).toHaveLength(1)
    const [{ key, message }] = mine as [{ key: string; message: EmailSendMessage }]

    expect(message.subject).toBe("Worker River Hauling sent interest in your job on LogLoads")
    expect(message.text).toContain("sent interest in your job: NW405 Fir haul.")
    expect(message.text.match(/https:\/\/logloads\.test\/v2\/act\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)).toHaveLength(2)
    expect(message.text).toMatch(/Open the inquiry:\nhttps:\/\/logloads\.test\/v2\/landing\/inquiries\?inquiry=[0-9a-f-]{36}#conversation/)
    expect(message.listUnsubscribe).toMatch(/^<https:\/\/logloads\.test\/api\/v2\/notify\/unsubscribe\?token=[A-Za-z0-9_-]+\.[0-9a-f]{64}>$/)
    expect(message.text).not.toContain("5415550405")

    const [row] = await admin.unsafe(
      "select o.id::text as id, o.status, o.provider_message_id from marketplace.notification_outbox o join marketplace.expressions_of_interest e on e.id = o.subject_id join marketplace.organizations h on h.id = e.hauler_org_id where h.slug = 'nw405-haul' and o.channel = 'email'"
    )

    expect(row).toMatchObject({ provider_message_id: "re_contract_1", status: "sent" })
    expect(key).toBe(`logloads-notice/${row?.id}`)
  }, 60_000)

  it("records a bounce, puts the address on the list, and suppresses the next email without a send", async () => {
    const hash = emailSuppressionHash(LANDING_EMAIL, KEY)

    expect(await store.recordProviderEvent("re_contract_1", "bounced", null)).toBe(1)
    expect(await store.suppress(hash, "bounced")).toBe(true)
    expect(await store.suppress(hash, "bounced")).toBe(false)
    expect(await store.suppressedHashes([hash, "0".repeat(64)])).toEqual([hash])

    const before = sent.length

    await admin.unsafe(sendInterest("worker_haul2", "nw405-haul2"))
    await runEmailWorker({ send, settings: SETTINGS, store })

    expect(sent.slice(before).filter((row) => row.message.to === LANDING_EMAIL)).toEqual([])
    const [row] = await admin.unsafe(
      "select o.status, o.last_failure from marketplace.notification_outbox o join marketplace.expressions_of_interest e on e.id = o.subject_id join marketplace.organizations h on h.id = e.hauler_org_id where h.slug = 'nw405-haul2' and o.channel = 'email'"
    )

    expect(row).toMatchObject({ last_failure: "suppressed", status: "suppressed" })
    const [bounced] = await admin.unsafe("select status from marketplace.notification_outbox where provider_message_id = 're_contract_1'")

    expect(bounced?.status).toBe("bounced")
  }, 60_000)
})
