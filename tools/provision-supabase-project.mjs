#!/usr/bin/env node
// Owner-run: creates (or reuses) a LogLoads Supabase project through the Management API and writes its
// settings into a Doppler config. Dry run by default; never prints a value.
//
//   # Plan only (read-only preflight when SUPABASE_ACCESS_TOKEN is present):
//   node tools/provision-supabase-project.mjs --name logloads-staging --region us-east-1 --doppler-config stg
//   # Act:
//   node tools/provision-supabase-project.mjs --name logloads-staging --region us-east-1 --doppler-config stg --apply
//   # Production also needs --allow-production.
//
// SUPABASE_ACCESS_TOKEN (a Supabase personal access token) must come from the owner's shell or an unsynced
// Doppler config, never from stg/prd, which sync to Vercel. The Doppler CLI is found on PATH or via DOPPLER_CLI.
//
// Safety rules (tested in tools/provision-supabase-project.test.mjs):
// - the generated database password is saved to Doppler BEFORE the project is created, so it cannot be lost;
// - an existing project is reused only when its database password is already in Doppler;
// - a Doppler config that already points at a different Supabase project is never repointed;
// - values reach the Doppler CLI on stdin, never argv, and its output (which can echo values) is discarded;
// - every printed line is built from names and fixed text, then redacted again as defense in depth.
import { spawnSync as nodeSpawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const SUPABASE_API = "https://api.supabase.com/v1"
export const MEDIA_BUCKET = "logloads-private-media"
export const DB_PASSWORD = "SUPABASE_DB_PASSWORD"
/** Written into the app config from the project (overwritten on every run). */
export const PROJECT_APP_VALUES = [
  "SUPABASE_URL",
  "LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
]
/** Written into the tooling config (the app config unless --tooling-config is given). */
export const PROJECT_TOOLING_VALUES = ["DATABASE_URL", "SUPABASE_PROJECT_REF"]
/** Generated once; an existing value is never replaced. */
export const GENERATED_SECRETS = ["LOGLOADS_SESSION_SECRET", "LOGLOADS_RATE_LIMIT_HMAC_SECRET", "CRON_SECRET"]
const HEALTHY = "ACTIVE_HEALTHY"
const POLL_INTERVAL_MS = 10_000
const MAX_POLLS = 90

export function isProductionConfig(config) {
  return config === "prd" || config.startsWith("prd_")
}

/** Dark-by-default runtime configuration (docs/ENV_CONTRACT.md). Set only when the name is absent. */
export function baselineValues(config) {
  return {
    LOGLOADS_DISPATCH_SELF_SERVE: "disabled",
    LOGLOADS_FEE_COLLECTION: "disabled",
    LOGLOADS_INTERNAL_BILLING_SMOKE: "disabled",
    LOGLOADS_MEDIA_BUCKET: MEDIA_BUCKET,
    LOGLOADS_MEDIA_STORAGE: "supabase",
    LOGLOADS_PERCENTAGE_ENROLLMENT: "disabled",
    LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP: "disabled",
    LOGLOADS_RATE_LIMIT_KEY_PREFIX: `logloads:${config}`,
    LOGLOADS_STRIPE_EXPECTED_LIVEMODE: isProductionConfig(config) ? "live" : "test",
    LOGLOADS_SUBSCRIPTION_COLLECTION: "disabled"
  }
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/
const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{2,62}$/
const REGION = /^[a-z]{2}-[a-z]+-\d$/

export function parseProvisionArgs(argv) {
  const options = {
    allowProduction: false,
    apply: false,
    dopplerConfig: null,
    dopplerProject: "logloads",
    name: null,
    organization: null,
    region: "us-east-1",
    toolingConfig: null
  }
  const valued = {
    "--doppler-config": "dopplerConfig",
    "--doppler-project": "dopplerProject",
    "--name": "name",
    "--organization": "organization",
    "--region": "region",
    "--tooling-config": "toolingConfig"
  }

  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/s, 2)

    if (flag === "--apply") options.apply = true
    else if (flag === "--allow-production") options.allowProduction = true
    else if (flag === "--help" || flag === "-h") options.help = true
    else if (valued[flag]) {
      const value = inline ?? argv[++index]

      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`)
      options[valued[flag]] = value
    } else {
      throw new Error(`unknown argument ${argv[index]}`)
    }
  }

  if (options.help) return options
  if (!options.name || !PROJECT_NAME.test(options.name)) throw new Error("--name is required: lowercase letters, digits and hyphens, e.g. logloads-staging")
  if (!REGION.test(options.region)) throw new Error("--region must be a Supabase region code such as us-east-1")
  if (!options.dopplerConfig || !SLUG.test(options.dopplerConfig)) throw new Error("--doppler-config is required, e.g. stg")
  if (!SLUG.test(options.dopplerProject)) throw new Error("--doppler-project is not a valid Doppler project name")

  options.toolingConfig ??= options.dopplerConfig

  if (!SLUG.test(options.toolingConfig)) throw new Error("--tooling-config is not a valid Doppler config name")
  if ((isProductionConfig(options.dopplerConfig) || isProductionConfig(options.toolingConfig)) && !options.allowProduction) {
    throw new Error("refusing a production Doppler config without --allow-production")
  }

  return options
}

// ---------------------------------------------------------------------------------------------
// Redaction and output
// ---------------------------------------------------------------------------------------------

function createRedactor() {
  const secrets = new Set()

  return {
    add(value) {
      if (typeof value === "string" && value.length >= 6) {
        secrets.add(value)
        secrets.add(encodeURIComponent(value))
      }
    },
    redact(text) {
      let output = String(text)

      for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
        output = output.split(secret).join("<redacted>")
      }

      return output
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Doppler CLI (injected spawnSync)
// ---------------------------------------------------------------------------------------------

export function locateDoppler(spawnSync, env) {
  const candidate = env.DOPPLER_CLI?.trim() || "doppler"
  const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })

  if (probe.error || probe.status !== 0) {
    throw new Error(
      env.DOPPLER_CLI
        ? "DOPPLER_CLI does not point at a working Doppler CLI"
        : "the Doppler CLI is not on PATH; install it (https://docs.doppler.com/docs/install-cli) or set DOPPLER_CLI to its path"
    )
  }

  return candidate
}

function createDoppler({ spawnSync, bin, project, redactor }) {
  const run = (args, input) => {
    const result = spawnSync(bin, [...args, "--project", project], {
      encoding: "utf8",
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true
    })

    if (result.error || result.status !== 0) {
      const detail = redactor.redact(String(result.stderr ?? "").replace(/\s+/g, " ").trim()).slice(0, 200)
      throw new Error(`doppler ${args.slice(0, 2).join(" ")} failed${detail ? `: ${detail}` : ""}`)
    }

    return String(result.stdout ?? "")
  }

  return {
    get(config, name) {
      return run(["secrets", "get", name, "--plain", "--config", config]).replace(/\r?\n$/, "")
    },
    names(config) {
      const parsed = JSON.parse(run(["secrets", "--config", config, "--only-names", "--json"]))

      return new Set(Array.isArray(parsed) ? parsed : Object.keys(parsed))
    },
    set(config, name, value) {
      // `doppler secrets set NAME` reads the value from stdin, so it never appears in argv.
      // Its stdout (which can echo values) is captured and dropped.
      run(["secrets", "set", name, "--config", config, "--silent", "--no-interactive"], value)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Supabase Management API (injected fetch)
// ---------------------------------------------------------------------------------------------

function createSupabaseApi({ fetchImpl, token, redactor }) {
  return async function api(method, path, label, body) {
    let response

    try {
      response = await fetchImpl(`${SUPABASE_API}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method,
        signal: AbortSignal.timeout(60_000)
      })
    } catch {
      throw new Error(`${method} ${label} could not reach the Supabase Management API`)
    }

    const text = await response.text()

    if (!response.ok) {
      let message = ""

      try {
        message = String(JSON.parse(text)?.message ?? "")
      } catch {
        message = ""
      }

      throw new Error(`${method} ${label} failed (${response.status})${message ? `: ${redactor.redact(message).slice(0, 200)}` : ""}`)
    }

    return text ? JSON.parse(text) : null
  }
}

function pickOrganization(organizations, wanted) {
  if (!Array.isArray(organizations) || organizations.length === 0) {
    throw new Error("the access token sees no Supabase organization; create one in the dashboard first")
  }

  if (wanted) {
    const match = organizations.find((org) => [org.slug, org.id, org.name].includes(wanted))

    if (!match) throw new Error("--organization matches no organization this token can see")
    return match
  }

  if (organizations.length > 1) {
    throw new Error(`the token sees ${organizations.length} organizations; pass --organization <slug> (one of: ${organizations.map((org) => org.name).join(", ")})`)
  }

  return organizations[0]
}

function pickKeys(keys) {
  const list = Array.isArray(keys) ? keys : []
  const serviceRole = list.find((key) => key.name === "service_role")?.api_key
  const publishable = list.find((key) => key.type === "publishable")?.api_key ?? list.find((key) => key.name === "anon")?.api_key

  if (!serviceRole) {
    throw new Error(
      "the project has no legacy service_role key; the app sends its server key as Authorization: Bearer, so re-enable the legacy API keys (Project Settings > API Keys) and re-run"
    )
  }

  if (!publishable) throw new Error("the project has neither a publishable nor an anon key")

  return { publishable, serviceRole }
}

function sessionPooler(config) {
  const list = Array.isArray(config) ? config : [config].filter(Boolean)
  const pooler = list.find((entry) => entry.pool_mode === "session") ?? list[0]

  if (!pooler?.db_host || !pooler?.db_user || !pooler?.db_name) {
    throw new Error("the project's pooler configuration is incomplete")
  }

  return pooler
}

// ---------------------------------------------------------------------------------------------
// Plan and run
// ---------------------------------------------------------------------------------------------

function planLines(options) {
  const app = `${options.dopplerProject}/${options.dopplerConfig}`
  const tooling = `${options.dopplerProject}/${options.toolingConfig}`

  return [
    `  project: ${options.name} · region ${options.region} · app config ${app} · tooling config ${tooling}`,
    `  1. save ${DB_PASSWORD} (generated) to ${tooling} BEFORE the project is created`,
    `  2. create the project on the organization's plan (no instance size is requested), or reuse it when ${DB_PASSWORD} is already in ${tooling}; wait for ${HEALTHY}`,
    `  3. write from the project to ${app}: ${PROJECT_APP_VALUES.join(", ")}`,
    `     and to ${tooling}: ${PROJECT_TOOLING_VALUES.join(", ")} (session pooler, port 5432)`,
    `  4. generate if absent in ${app}: ${GENERATED_SECRETS.join(", ")}`,
    `  5. set if absent in ${app}: ${Object.keys(baselineValues(options.dopplerConfig)).join(", ")}`
  ]
}

function nextSteps(options) {
  const run = `doppler run --project ${options.dopplerProject} --config ${options.toolingConfig} --`

  return [
    "Next (docs/INTEGRATIONS.md §2):",
    `  ${run} node tools/supabase-post-provision.mjs migrations --apply`,
    `  ${run} node tools/supabase-post-provision.mjs bucket --apply`,
    `  ${run} node tools/supabase-post-provision.mjs check`,
    `  doppler run --project ${options.dopplerProject} --config ${options.dopplerConfig} -- pnpm integrations:check --target ${isProductionConfig(options.dopplerConfig) ? "production" : "staging"}`
  ]
}

/**
 * Runs the tool. Every dependency is injected so tests stay offline.
 * Returns the process exit code.
 */
export async function provisionSupabaseProject({
  argv,
  env = process.env,
  fetchImpl = fetch,
  spawnSync = nodeSpawnSync,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  random = (bytes) => randomBytes(bytes).toString("base64url"),
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`)
}) {
  const redactor = createRedactor()
  const log = (line) => stdout(redactor.redact(line))
  let options

  try {
    options = parseProvisionArgs(argv)
  } catch (error) {
    stderr(`provision-supabase-project: ${error.message}`)
    return 2
  }

  if (options.help) {
    stdout("Usage: node tools/provision-supabase-project.mjs --name <project> --doppler-config <config> [--region us-east-1] [--tooling-config <config>] [--organization <slug>] [--doppler-project logloads] [--apply] [--allow-production]")
    return 0
  }

  const token = env.SUPABASE_ACCESS_TOKEN?.trim() || null
  redactor.add(token)

  try {
    log(`Supabase provisioning ${options.apply ? "(apply)" : "plan (dry run: no provider or Doppler change)"}. Values are never printed.`)
    for (const line of planLines(options)) log(line)

    if (!token) {
      if (options.apply) throw new Error("SUPABASE_ACCESS_TOKEN is required with --apply (a Supabase personal access token; keep it out of stg and prd)")
      log("Preflight skipped: set SUPABASE_ACCESS_TOKEN for a read-only check of the organization, the project and Doppler.")
      log("Re-run with --apply to act.")
      return 0
    }

    const api = createSupabaseApi({ fetchImpl, redactor, token })
    const doppler = createDoppler({ bin: locateDoppler(spawnSync, env), project: options.dopplerProject, redactor, spawnSync })
    const organization = pickOrganization(await api("GET", "/organizations", "/organizations"), options.organization)
    const projects = await api("GET", "/projects", "/projects")
    const existing = (Array.isArray(projects) ? projects : []).find(
      (project) => project.name === options.name && (!project.organization_id || project.organization_id === organization.id)
    )
    const appNames = doppler.names(options.dopplerConfig)
    const toolingNames = options.toolingConfig === options.dopplerConfig ? appNames : doppler.names(options.toolingConfig)
    const hasPassword = toolingNames.has(DB_PASSWORD)

    log(`Organization: ${organization.name}.`)
    log(
      existing
        ? `Project ${options.name} exists (${existing.status ?? "status unknown"}): it ${hasPassword ? "will be reused" : `cannot be reused, because ${DB_PASSWORD} is not in ${options.dopplerProject}/${options.toolingConfig}`}.`
        : `Project ${options.name} does not exist: it will be created in ${options.region}.`
    )

    if (existing && !hasPassword) {
      throw new Error(`refusing to reuse ${options.name}: its database password is not in ${options.dopplerProject}/${options.toolingConfig}. Reset the password in the dashboard and store it there first, or choose another --name`)
    }

    if (existing && appNames.has("LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF")) {
      const configured = doppler.get(options.dopplerConfig, "LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF")
      if (configured && configured !== existing.id) {
        throw new Error(`${options.dopplerProject}/${options.dopplerConfig} already points at a different Supabase project; remove its Supabase values first if you mean to switch`)
      }
    } else if (!existing && appNames.has("LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF")) {
      throw new Error(`${options.dopplerProject}/${options.dopplerConfig} already points at a Supabase project that ${options.name} would replace; remove its Supabase values first if you mean to switch`)
    }

    // The tooling config (often a separate one) holds the password and connection string, so it is guarded too.
    if (toolingNames.has("SUPABASE_PROJECT_REF")) {
      const configured = doppler.get(options.toolingConfig, "SUPABASE_PROJECT_REF")
      if (!existing || (configured && configured !== existing.id)) {
        throw new Error(`${options.dopplerProject}/${options.toolingConfig} already points at a different Supabase project (SUPABASE_PROJECT_REF); remove its Supabase values first if you mean to switch`)
      }
    }

    const generatedMissing = GENERATED_SECRETS.filter((name) => !appNames.has(name))
    const baselineMissing = Object.keys(baselineValues(options.dopplerConfig)).filter((name) => !appNames.has(name))
    log(`Doppler ${options.dopplerProject}/${options.dopplerConfig}: would generate ${generatedMissing.join(", ") || "nothing"}; would set ${baselineMissing.join(", ") || "nothing"}.`)

    if (!options.apply) {
      log("Re-run with --apply to act.")
      return 0
    }

    // 1-2. Password first, then the project.
    let ref
    let password

    if (existing) {
      ref = existing.id
      password = doppler.get(options.toolingConfig, DB_PASSWORD)
      redactor.add(password)
      if (!password) throw new Error(`${DB_PASSWORD} in ${options.dopplerProject}/${options.toolingConfig} is empty`)
      log(`Reusing ${options.name}.`)
    } else {
      password = random(24)
      redactor.add(password)
      doppler.set(options.toolingConfig, DB_PASSWORD, password)
      log(`${options.dopplerProject}/${options.toolingConfig}: saved ${DB_PASSWORD} (value not shown). Creating ${options.name}…`)
      const created = await api("POST", "/projects", "/projects", {
        db_pass: password,
        name: options.name,
        organization_slug: organization.slug ?? organization.id,
        region_selection: { code: options.region, type: "specific" }
      })
      ref = created?.id ?? created?.ref
      if (!ref) throw new Error("the Management API did not return the new project's reference")
    }

    for (let poll = 0; ; poll += 1) {
      const project = await api("GET", `/projects/${encodeURIComponent(ref)}`, "/projects/{ref}")

      if (project?.status === HEALTHY) {
        log(`Status ${HEALTHY}.`)
        break
      }

      if (project?.status === "INACTIVE" || project?.status === "PAUSED") {
        throw new Error(`${options.name} is paused; restore it in the Supabase dashboard and re-run`)
      }

      if (poll >= MAX_POLLS) throw new Error(`${options.name} did not become ${HEALTHY} in time; re-run later (the password is already in Doppler)`)
      if (poll % 3 === 0) log(`Status ${project?.status ?? "unknown"}; waiting…`)
      await sleep(POLL_INTERVAL_MS)
    }

    // 3. Project values.
    const { publishable, serviceRole } = pickKeys(await api("GET", `/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`, "/projects/{ref}/api-keys"))
    redactor.add(serviceRole)
    redactor.add(publishable)
    const pooler = sessionPooler(await api("GET", `/projects/${encodeURIComponent(ref)}/config/database/pooler`, "/projects/{ref}/config/database/pooler"))
    // Session mode (Supavisor, port 5432, IPv4) for migrations and tooling; the transaction port 6543 breaks prepared statements.
    const databaseUrl = `postgresql://${pooler.db_user}:${encodeURIComponent(password)}@${pooler.db_host}:5432/${pooler.db_name}`
    redactor.add(databaseUrl)

    const appValues = {
      LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF: ref,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
      SUPABASE_SERVICE_ROLE_KEY: serviceRole,
      SUPABASE_URL: `https://${ref}.supabase.co`
    }
    const toolingValues = { DATABASE_URL: databaseUrl, SUPABASE_PROJECT_REF: ref }

    for (const [name, value] of Object.entries(appValues)) doppler.set(options.dopplerConfig, name, value)
    log(`${options.dopplerProject}/${options.dopplerConfig}: set ${Object.keys(appValues).join(", ")} (values not shown).`)
    for (const [name, value] of Object.entries(toolingValues)) doppler.set(options.toolingConfig, name, value)
    log(`${options.dopplerProject}/${options.toolingConfig}: set ${Object.keys(toolingValues).join(", ")} (values not shown).`)

    // 4-5. Generated secrets and baseline, only when absent.
    for (const name of generatedMissing) {
      const value = random(48)
      redactor.add(value)
      doppler.set(options.dopplerConfig, name, value)
    }

    const baseline = baselineValues(options.dopplerConfig)
    for (const name of baselineMissing) doppler.set(options.dopplerConfig, name, baseline[name])

    const kept = [...GENERATED_SECRETS, ...Object.keys(baseline)].filter((name) => appNames.has(name))
    log(`${options.dopplerProject}/${options.dopplerConfig}: generated ${generatedMissing.join(", ") || "nothing"}; set ${baselineMissing.join(", ") || "nothing"}; kept ${kept.join(", ") || "nothing"}.`)
    log(`Done: ${options.name}.`)
    for (const line of nextSteps(options)) log(line)
    return 0
  } catch (error) {
    stderr(`provision-supabase-project: ${redactor.redact(error.message)}`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  provisionSupabaseProject({ argv: process.argv.slice(2) }).then((code) => {
    process.exitCode = code
  })
}
