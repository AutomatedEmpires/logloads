import "server-only"

/**
 * ── Whether LogLoads may write media at all ───────────────────────────────────
 *
 * WHAT THIS GUARDS. Driver credential documents — a CDL image, an insurance
 * certificate, truck and trailer photos. Those are a person's identity papers.
 * The failure mode this module exists to make impossible is not "media breaks";
 * it is media that WORKS, reporting success at every step, while writing a
 * driver's licence into a Cloudinary account that belongs to a different product.
 * Nothing in the request path would notice, and nothing in the response would say
 * so.
 *
 * WHY THE OLD GATE WAS NOT ENOUGH. It required an operator to attest tenancy by
 * setting `LOGLOADS_CLOUDINARY_TENANCY=dedicated` and to supply three complete
 * credentials — and then trusted whatever cloud name it found. An attestation is
 * a claim about the world; it cannot be wrong in a way the runtime can see. So a
 * cloud name pasted from another product's dashboard passed the gate as readily
 * as a correct one, and `integrations.media=true` meant only that somebody said
 * so. This module now CHECKS what it used to merely record.
 *
 * THE TWO ADDED CHECKS.
 *
 * 1. AN EXPECTED CLOUD NAME, declared separately, that the configured cloud must
 *    equal. Two independent values must agree, so a single mistyped or
 *    copy-pasted credential block cannot activate media by itself. Its ABSENCE
 *    keeps media off: "no expectation recorded" must never degrade into "trust
 *    whatever cloud is configured", which is exactly the hole it closes.
 *
 * 2. A DENY-LIST of cloud names known to belong to something other than
 *    LogLoads, checked FIRST and unconditionally. Belt and braces on purpose:
 *    check 1 can be satisfied by setting both values to the same wrong account,
 *    and an operator who does that has made a mistake the deny-list can still
 *    catch by name. This is the one refusal that survives every other variable
 *    being confidently set.
 *
 * NO DEDICATED LOGLOADS CLOUDINARY ACCOUNT EXISTS. Cloudinary therefore stays
 * fail-closed. Production media uses a private bucket in LogLoads' own Supabase
 * project and must independently match the expected project reference below.
 *
 * WHY IT NEVER THROWS. `/api/health` and three driver pages call this on every
 * render. A throw would take those down over a media misconfiguration and remove
 * the endpoint an operator uses to observe the problem. Refusal is returned, not
 * raised — but it is returned with its reason attached, so the refusal is loud in
 * the only place that can do anything about it.
 */

export const DEDICATED_CLOUDINARY_TENANCY = "dedicated"

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

/**
 * The only `CLOUDINARY_*` names permitted to exist. Every other one is ambient
 * SDK configuration — a URL, proxy, OAuth token, private CDN or delivery host —
 * that the pinned SDK reloads on reset and that could redirect writes away from
 * the tenant we just checked.
 *
 * `LOGLOADS_CLOUDINARY_EXPECTED_CLOUD` deliberately does NOT carry the
 * `CLOUDINARY_` prefix. It is our own assertion about the provider, not a value
 * the provider's SDK may read; naming it `CLOUDINARY_EXPECTED_CLOUD` would make
 * the ambient scan below treat the safety check itself as contamination and
 * disable media whenever it was set.
 */
const CLOUDINARY_ENVIRONMENT_ALLOWLIST = new Set([
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
])

/**
 * Cloudinary accounts proven to belong to something other than LogLoads, mapped
 * to their real owner so a refusal can name the actual problem instead of saying
 * "denied".
 *
 * `dwiwyt9vi` is Explore & Earn's account. That is not a guess: the 2026-07-17
 * asset census found 1020 of 1020 stored assets were Explore & Earn's, and the
 * value is sitting in `apps/web/.env.local` today under a comment calling it
 * "sandbox creds" — which is how a driver's licence would have ended up there.
 *
 * A Map rather than an object literal, so a lookup can never reach
 * `Object.prototype`. A cloud legitimately named `constructor` or `toString`
 * would otherwise be refused as foreign, with a nonsense owner in the message.
 */
const FOREIGN_CLOUDINARY_TENANTS: ReadonlyMap<string, string> = new Map([
  ["dwiwyt9vi", "Explore & Earn"]
])

/**
 * The denied cloud names, derived from the map above rather than restated, so
 * documentation and tests cannot list a different set from the one enforced.
 */
export const DENIED_CLOUDINARY_CLOUD_NAMES: readonly string[] = [
  ...FOREIGN_CLOUDINARY_TENANTS.keys()
]

export interface DedicatedCloudinaryConfiguration {
  apiKey: string
  apiSecret: string
  cloudName: string
}

export interface DedicatedSupabaseMediaConfiguration {
  anonKey: string
  bucket: string
  serviceRoleKey: string
  url: string
}

/**
 * Why media is off. Named cases rather than one opaque failure: an operator
 * reading "the cloud you configured belongs to Explore & Earn" fixes the right
 * thing, and an operator reading "media unavailable" reaches for the credentials
 * they already set correctly.
 */
export type MediaConfigurationRefusalReason =
  | "ambient_sdk_configuration"
  | "expected_cloud_absent"
  | "expected_cloud_mismatch"
  | "foreign_tenant_denied"
  | "incomplete_credentials"
  | "tenancy_not_attested"

export interface MediaConfigurationRefused {
  active: false
  /** Operator-facing, safe to log: names cloud names, never keys or secrets. */
  message: string
  reason: MediaConfigurationRefusalReason
}

export interface MediaConfigurationActive {
  active: true
  configuration: DedicatedCloudinaryConfiguration
}

export type MediaConfigurationDecision = MediaConfigurationActive | MediaConfigurationRefused

function trimmedValue(value: string | undefined): string | null {
  const trimmed = value?.trim()

  return trimmed ? trimmed : null
}

function refuse(
  reason: MediaConfigurationRefusalReason,
  message: string
): MediaConfigurationRefused {
  return { active: false, message, reason }
}

/**
 * The owner of a foreign account, or null.
 *
 * Case-folded on lookup while the expected-name comparison stays exact. The
 * asymmetry is deliberate: be strict about what activates media and permissive
 * about what refuses it, so `DWIWYT9VI` cannot slip past the deny-list on
 * capitalisation alone.
 */
function foreignTenantOwner(cloudName: string | null): string | null {
  if (cloudName === null) {
    return null
  }

  return FOREIGN_CLOUDINARY_TENANTS.get(cloudName.toLowerCase()) ?? null
}

/**
 * Decides whether media may be used, and says why when it may not.
 *
 * Check order is load-bearing. The deny-list runs FIRST, before the tenancy
 * marker, before the credentials, before anything: the founder's requirement is
 * that configuring another product's account fails closed with an unmistakable
 * message *even when every other variable claims the setup is correct*. Putting
 * it behind the tenancy marker would mean today's real state — Explore & Earn's
 * cloud name present in the environment with no marker set — was reported as a
 * missing attestation, which is true but not the thing an operator needs to hear.
 *
 * It also checks the EXPECTED name against the deny-list, not just the
 * configured one. An operator who sets both to `dwiwyt9vi` has satisfied the
 * two-value agreement rule with a wrong answer, and that is precisely the case
 * the second layer exists for.
 */
export function mediaConfigurationDecision(
  environment: RuntimeEnvironment
): MediaConfigurationDecision {
  const configuredCloud = trimmedValue(environment.CLOUDINARY_CLOUD_NAME)
  const expectedCloud = trimmedValue(environment.LOGLOADS_CLOUDINARY_EXPECTED_CLOUD)

  for (const [label, cloudName] of [
    ["CLOUDINARY_CLOUD_NAME", configuredCloud],
    ["LOGLOADS_CLOUDINARY_EXPECTED_CLOUD", expectedCloud]
  ] as const) {
    const owner = foreignTenantOwner(cloudName)

    if (owner !== null) {
      return refuse(
        "foreign_tenant_denied",
        `Refusing to activate media: ${label} is set to the Cloudinary account "${cloudName}", ` +
          `which belongs to ${owner}, not LogLoads. Driver licence, insurance and equipment ` +
          "documents must never be written into another product's account. Provision a Cloudinary " +
          "account owned by LogLoads alone and use its cloud name."
      )
    }
  }

  if (environment.LOGLOADS_CLOUDINARY_TENANCY !== DEDICATED_CLOUDINARY_TENANCY) {
    return refuse(
      "tenancy_not_attested",
      "Media is inactive: LOGLOADS_CLOUDINARY_TENANCY must be exactly " +
        `"${DEDICATED_CLOUDINARY_TENANCY}". No credential document can be stored until an ` +
        "accountable operator attests that the configured account is LogLoads' own."
    )
  }

  const ambientName = Object.entries(environment).find(
    ([name, value]) =>
      name.startsWith("CLOUDINARY_") &&
      !CLOUDINARY_ENVIRONMENT_ALLOWLIST.has(name) &&
      trimmedValue(value) !== null
  )?.[0]

  if (ambientName !== undefined) {
    return refuse(
      "ambient_sdk_configuration",
      `Media is inactive: ${ambientName} is set. Ambient Cloudinary SDK configuration can ` +
        "redirect writes to another tenant, proxy or delivery host after this gate has passed, " +
        "so only CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET may exist."
    )
  }

  if (expectedCloud === null) {
    return refuse(
      "expected_cloud_absent",
      "Media is inactive: LOGLOADS_CLOUDINARY_EXPECTED_CLOUD is not set. The cloud name LogLoads " +
        "expects to write to must be declared independently of the credentials, so a single " +
        "mispasted block cannot activate media on its own. An absent expectation is never " +
        "treated as permission to trust whatever cloud is configured."
    )
  }

  const apiKey = trimmedValue(environment.CLOUDINARY_API_KEY)
  const apiSecret = trimmedValue(environment.CLOUDINARY_API_SECRET)

  if (!configuredCloud || !apiKey || !apiSecret) {
    return refuse(
      "incomplete_credentials",
      "Media is inactive: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET " +
        "must all be present and nonblank."
    )
  }

  // Exact, after trimming. Two values that differ by case or by a stray
  // character are two different claims about which account this is, and the
  // whole point of the second value is that it must agree.
  if (configuredCloud !== expectedCloud) {
    return refuse(
      "expected_cloud_mismatch",
      `Refusing to activate media: CLOUDINARY_CLOUD_NAME is "${configuredCloud}" but LogLoads ` +
        `expects "${expectedCloud}". One of the two is wrong; until they agree, no credential ` +
        "document is written anywhere."
    )
  }

  return { active: true, configuration: { apiKey, apiSecret, cloudName: configuredCloud } }
}

/**
 * The complete configuration, or null. The narrow form every provider call site
 * already uses; `mediaConfigurationDecision` is for anything that wants to tell
 * an operator what to fix.
 */
export function dedicatedCloudinaryConfiguration(
  environment: RuntimeEnvironment
): DedicatedCloudinaryConfiguration | null {
  const decision = mediaConfigurationDecision(environment)

  return decision.active ? decision.configuration : null
}

export function dedicatedSupabaseMediaConfiguration(
  environment: RuntimeEnvironment
): DedicatedSupabaseMediaConfiguration | null {
  if (environment.LOGLOADS_MEDIA_STORAGE?.trim().toLowerCase() !== "supabase") {
    return null
  }

  const url = trimmedValue(environment.SUPABASE_URL)
  const serviceRoleKey = trimmedValue(environment.SUPABASE_SERVICE_ROLE_KEY)
  const anonKey =
    trimmedValue(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY) ??
    trimmedValue(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const bucket = trimmedValue(environment.LOGLOADS_MEDIA_BUCKET)
  const expectedProjectRef = trimmedValue(environment.LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF)

  if (!url || !serviceRoleKey || !anonKey || !bucket || !expectedProjectRef) {
    return null
  }

  if (!/^[a-z0-9][a-z0-9_-]{2,62}$/.test(bucket)) {
    return null
  }

  try {
    const parsed = new URL(url)
    const configuredProjectRef = parsed.hostname.split(".")[0]

    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".supabase.co") ||
      configuredProjectRef !== expectedProjectRef
    ) {
      return null
    }
  } catch {
    return null
  }

  return {
    anonKey,
    bucket,
    serviceRoleKey,
    url: url.replace(/\/$/, "")
  }
}

export function isDedicatedMediaConfigured(environment: RuntimeEnvironment): boolean {
  if (environment.LOGLOADS_MEDIA_STORAGE?.trim().toLowerCase() === "supabase") {
    return dedicatedSupabaseMediaConfiguration(environment) !== null
  }

  return mediaConfigurationDecision(environment).active
}
