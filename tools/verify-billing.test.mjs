import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"

import { hostFeeAgreementId } from "../packages/contracts/src/billing-model.ts"

const verifier = new URL("./verify-billing.mjs", import.meta.url)

async function withCanonicalState(state, run) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(
      JSON.stringify([
        {
          schema_version: 2,
          state,
          updated_at: "2026-10-14T00:00:00.000Z",
          version: 1
        }
      ])
    )
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()

  if (!address || typeof address === "string") {
    server.close()
    throw new Error("The synthetic verifier server did not bind a TCP port")
  }

  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    server.close()
    await once(server, "close")
  }
}

async function runVerifier(environment) {
  const child = spawn(process.execPath, [verifier.pathname], {
    env: {
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
      ...environment
    },
    stdio: ["ignore", "pipe", "pipe"]
  })
  let stdout = ""
  let stderr = ""

  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  const [code] = await once(child, "close")

  return { code, stderr, stdout }
}

test("redacts a duplicated provider invoice id while naming internal claims", async () => {
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const firstInvoiceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const secondInvoiceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const providerInvoiceId = "in_provider_should_never_print"
  const state = {
    assignments: [],
    hostInvoices: [firstInvoiceId, secondInvoiceId].map((id) => ({
      feeEventIds: [],
      id,
      organizationId,
      periodEnd: "2026-07-01T00:00:00.000Z",
      periodStart: "2026-06-01T00:00:00.000Z",
      status: "void",
      stripeInvoiceId: providerInvoiceId,
      subtotalCents: 0
    })),
    hostFeeAgreements: [],
    loadPostings: [],
    organizations: [{ displayName: "Synthetic Host", id: organizationId }],
    platformFeeEvents: [],
    tripsV2: []
  }

  await withCanonicalState(state, async (url) => {
    const result = await runVerifier({ SUPABASE_URL: url })

    assert.equal(result.code, 1)
    assert.match(result.stderr, /One provider invoice is linked to 2 host invoices/)
    assert.match(result.stderr, new RegExp(firstInvoiceId))
    assert.match(result.stderr, new RegExp(secondInvoiceId))
    assert.doesNotMatch(result.stderr, new RegExp(providerInvoiceId))
    assert.doesNotMatch(result.stdout, new RegExp(providerInvoiceId))
  })
})

test("reports two fee agreements for one host, and passes a clean single agreement", async () => {
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const agreement = {
    acceptedAt: "2026-10-14T12:00:00.000Z",
    acceptedByUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    feeBps: 200,
    id: hostFeeAgreementId(organizationId),
    organizationId,
    termsVersion: "2026-10-14"
  }
  const state = (hostFeeAgreements) => ({
    assignments: [],
    hostFeeAgreements,
    hostInvoices: [],
    loadPostings: [],
    organizations: [{ displayName: "Synthetic Host", id: organizationId }],
    platformFeeEvents: [],
    tripsV2: []
  })

  await withCanonicalState(state([agreement, agreement]), async (url) => {
    const result = await runVerifier({ SUPABASE_URL: url })

    assert.equal(result.code, 1)
    assert.match(result.stderr, /has 2 fee agreements/)
  })

  // Negative control: the same agreement once reconciles.
  await withCanonicalState(state([agreement]), async (url) => {
    const result = await runVerifier({ SUPABASE_URL: url })

    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /Fee agreements: 1; on the current terms=1/)
    assert.match(result.stdout, /^OK: /m)
  })
})

test("turns a provider fetch rejection into a fixed URL-free refusal", async () => {
  const privateUrl = "http://127.0.0.1:0/private-provider-path"
  const result = await runVerifier({ SUPABASE_URL: privateUrl })

  assert.equal(result.code, 1)
  assert.equal(
    result.stderr.trim(),
    "Canonical billing read failed before a response."
  )
  assert.doesNotMatch(result.stderr, /private-provider-path/)
  assert.doesNotMatch(result.stderr, /127\.0\.0\.1/)
})
