#!/usr/bin/env node
// Deterministic documentation checks for LogLoads (#110). No dependencies, no network, no AI.
// Run `pnpm docs:check` (it is also part of `pnpm guardrails`), or `node tools/check-docs.mjs [--root <dir>]`.
//
// Rules 1-7 are the issue's specification and follow its reference implementation. Rules 8-10 extend it to every
// backticked repository path, every `pnpm` command in code, and every environment variable in the project's own
// namespaces.
//
// | Rule id           | Checks                                                                   | Applies to          |
// |-------------------|--------------------------------------------------------------------------|---------------------|
// | 1 `link`/`anchor` | Relative Markdown links resolve, case-sensitively, and so do `#anchors`  | All files (a)       |
// | 2 `removed-ref`   | A backticked `docs/…md` path exists, unless it is said to be at the tag  | Root + active (b)   |
// | 3 `metadata`      | A `**Status:**` line in the first 15 lines                               | Active docs         |
// | 4 `obsolete-pricing` | Retired commercial terms only with historical/prohibitive context    | Active docs         |
// | 5 `stale-claim`   | Known stale status claims are absent                                     | Active docs         |
// | 6 `vocabulary`    | Deprecated status labels are absent                                      | Active docs         |
// | 7 `authority`     | `docs/README.md` links the five authority documents                      | Index               |
// | 8 `repo-path`     | Any other backticked repository path exists                              | Root + active (b)   |
// | 9 `pnpm-script`   | `pnpm <x>` in code is a pnpm command, a script or a dependency binary    | Root + active       |
// | 10 `env-name`     | A project-namespace env variable in code is in the env contract          | Root + active       |
//
// (a) Verbatim files keep links that broke when they moved; their link findings are not failures.
// (b) `docs/archive/README.md` lists removed paths by design and is exempt.
// Exempt from content rules: `DECISIONS.md` (append-only), `product/LOGLOADS_*_v1.0.md` (verbatim specs) and
// `docs/archive/*` (verbatim evidence). In `SUBSCRIPTION_BILLING_V1.md` only the superseded notice above the
// first `---` line is active. Fenced code is ignored by rules 1-8 and read by rules 9-10.
//
// Deliberate differences from the reference implementation: paths must exist with the exact case (CI runs on a
// case-sensitive file system), fences are found line by line, and rule 2's archive context must name the archive tag
// (the reference's /tag/ and /recover/ also matched "percentage", "stage", "HTML tag" and "recovery").
import { readdirSync, readFileSync, realpathSync } from "node:fs"
import { join, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(scriptPath, "..", "..")

const ROOT_DOCS = ["README.md", "AGENTS.md", "CLAUDE.md"]

// Reviewed findings that are accepted for now. An entry `{ file, rule, match, reason }` matches the findings of that
// rule in that file whose message contains `match` (line numbers move, so they are not part of the key). All four
// fields must be non-empty and `rule` must be a rule id, so an entry can never match every finding. Each allowlisted
// finding is still printed as a warning. Keep every entry tied to an issue or owner. An entry that no longer matches
// anything is reported as a warning, not a failure, so the PR that fixes the underlying doc can merge before or after
// the PR that removes the entry.
export const DOCS_ALLOWLIST = []
const RULE_IDS = new Set([
  "link", "anchor", "removed-ref", "metadata", "obsolete-pricing", "stale-claim", "vocabulary", "authority",
  "repo-path", "pnpm-script", "env-name"
])

// Environment variables that docs may name although `ops/production-env-contract.json` does not list them. Each one
// is read by a platform, SDK or build plugin rather than declared by LogLoads code. Prefer adding a variable to the
// contract; list it here only with the reason it is outside the contract.
export const ENV_OUTSIDE_CONTRACT = {
  VERCEL_ENV:
    "Vercel system variable. apps/web reads it (marketplace-v2/flag.ts, rate-limit-config.ts, demo-mode.ts) but the " +
    "contract does not list it yet; add it to ops/production-env-contract.json, then drop it from here.",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "Read by the Clerk SDK, not by LogLoads code (docs/ACTIVATION_CLERK.md).",
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: "Read by the Clerk SDK, not by LogLoads code (docs/ACTIVATION_CLERK.md).",
  SENTRY_AUTH_TOKEN: "Optional build-time token for the Sentry source-map upload plugin; never read at runtime."
}

// Backticked paths are checked when they start with one of these top-level directories.
const REPO_PATH_ROOTS = ["apps", "packages", "tools", "supabase", "ops", "docs", ".github", "architecture"]
// Generated or git-ignored path segments (see .gitignore): docs may name them although a clean checkout lacks them.
const GENERATED_SEGMENTS = new Set([
  ".artifacts",
  ".branches",
  ".data",
  ".next",
  ".temp",
  ".turbo",
  ".vercel",
  "backups",
  "blob-report",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
])

// Rule 10 covers only the project's own environment namespaces. Generic names (`NODE_*`, `GITHUB_*`, `VERCEL_*`,
// `NEXT_TELEMETRY_DISABLED`, `CI`) belong to Node, GitHub, Vercel or Next.js and are not checked. The contract's
// forbidden prefixes (the retired Cloudinary ones) are added at load time, so naming them needs removal context.
const ENV_PROJECT_PREFIXES = [
  "ANTHROPIC_",
  "CLERK_",
  "CREDENTIAL_REVIEW_",
  "CRON_",
  "LOGLOADS_",
  "NEXT_PUBLIC_",
  "POSTHOG_",
  "RESEND_",
  "SENTRY_",
  "STRIPE_",
  "SUPABASE_"
]
// Well-known variables of external tools inside those namespaces. They configure a CLI, not LogLoads, so they need
// not be in the contract (it may still list them). Keep the list short and say which tool reads each one.
export const ENV_EXTERNAL_TOOL_NAMES = {
  SUPABASE_ACCESS_TOKEN: "Personal access token for the Supabase CLI (`supabase link`, `supabase db push`)."
}

// pnpm 10's own commands and aliases, plus the npm commands it passes through. `test`/`t`/`tst` and `start` are
// absent on purpose: they run a script, so the script must exist.
const PNPM_BUILTINS = new Set([
  "access", "add", "adduser", "approve-builds", "audit", "bin", "bugs", "c", "cache", "cat-file", "cat-index",
  "config", "create", "dedupe", "deploy", "deprecate", "dist-tag", "dlx", "docs", "doctor", "edit", "env", "exec",
  "fetch", "find-hash", "get", "help", "i", "ignored-builds", "import", "info", "init", "install", "install-test", "it",
  "la", "licenses", "link", "list", "ll", "ln", "login", "logout", "ls", "m", "multi", "outdated", "owner", "pack",
  "patch", "patch-commit", "patch-remove", "ping", "pkg", "prefix", "profile", "prune", "publish", "rb", "rebuild",
  "recursive", "remove", "repo", "restart", "rm", "root", "s", "sbom", "se", "search", "self-update", "server", "set",
  "set-script", "setup", "show", "star", "stars", "store", "team", "token", "un", "uni", "uninstall", "unlink",
  "unpublish", "unstar", "up", "update", "upgrade", "v", "version", "view", "whoami", "why", "xmas"
])
const PNPM_OPTIONS_WITH_VALUE = new Set(["--filter", "-F", "--filter-prod", "-C", "--dir", "--reporter", "--loglevel"])

// `pnpm <name>` that is neither a script nor a pnpm command runs a binary of the package's dependencies. An unscoped
// package's binary usually has the package's name; these declare others. The map keeps the result independent of
// whether `node_modules` is installed. Add a dependency here when a doc runs one of its binaries through `pnpm`.
const KNOWN_BINS = {
  "@changesets/cli": ["changeset"],
  "@playwright/test": ["playwright"],
  typescript: ["tsc", "tsserver"]
}

// Rule 4-6 vocabulary, from the reference implementation in #110.
const HISTORICAL_CONTEXT =
  /histor|supersed|legacy|retired|never|\bno\b|not |n't|disabled|dark|ban|preserv|still (describe|advertise)|wrong|recover|archiv|prohibit|frozen|old |former|reclassif|was true|until 2026-11-01/i
const OBSOLETE_COMMERCIAL =
  /\b5\s?%|five percent|\$1,500|Dispatch Pro|Network (Pilot|25|50|100)\b|per[- ]completed[- ]load|sole current (commercial )?collection gate|`?percentage_v1`? is (the )?(current|only|newest)/i
const STALE_CLAIMS = [
  /never (been )?executed/i,
  /not (yet )?executed against PostgreSQL/i,
  /uncommitted at this revision/i,
  /statically checked only/i
]
const DEPRECATED_LABEL = /\bCURRENT\b(?= *[:)(]| \(code)|\(CURRENT\b|\bOWED\b/
const REQUIRED_AUTHORITY = [
  "DECISIONS.md",
  "product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md",
  "product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md",
  "product/TRANSITION_PLAN.md",
  "AGENT_WORKFLOW.md"
]

// A missing path is fine when the same or an adjacent line says it is at the archive tag (rule 2, from #110): the tag's
// name, "archive tag", or "no longer in the tree". A bare "tag" or "recover" is not enough ("HTML tag", "recovery").
const ARCHIVE_CONTEXT = /archive\/docs-history-|\barchive tag\b|no longer in the tree/i
// ...and, for other repository paths and env names, when the same line says it is gone.
const REMOVAL_CONTEXT = /\b(removed|retired|deleted|renamed|no longer)\b/i

const ENV_NAME = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+"

const isVerbatim = (file) =>
  (file.startsWith("docs/archive/") && file !== "docs/archive/README.md") ||
  file === "docs/DECISIONS.md" ||
  /^docs\/product\/LOGLOADS_.*_v\d/.test(file)
const isActiveDoc = (file) => file.startsWith("docs/") && !isVerbatim(file)

function readText(root, file) {
  return readFileSync(join(root, file), "utf8").replaceAll("\r\n", "\n")
}

function readJson(root, file) {
  try {
    return JSON.parse(readText(root, file))
  } catch {
    return null
  }
}

// Case-sensitive existence, so a link that only resolves on Windows or macOS fails everywhere.
function createExists(root) {
  const listings = new Map()
  const list = (dir) => {
    if (!listings.has(dir)) {
      let names = null
      try {
        names = new Set(readdirSync(join(root, dir)))
      } catch {
        names = null
      }
      listings.set(dir, names)
    }
    return listings.get(dir)
  }

  return (relativePath) => {
    const parts = relativePath.split("/").filter((part) => part && part !== ".")
    let dir = ""
    for (const part of parts) {
      if (!list(dir)?.has(part)) return false
      dir = dir ? `${dir}/${part}` : part
    }
    return true
  }
}

function walkMarkdown(root, dir) {
  let entries
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) return walkMarkdown(root, path)
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : []
    })
}

// Splits a Markdown file into prose lines (fenced code blanked) and the code a reader would copy: inline code spans
// on prose lines and the lines inside fences. Line numbers stay aligned with the source.
function parseMarkdown(raw) {
  const lines = raw.split("\n")
  const prose = []
  const fenced = []
  let fence = null
  lines.forEach((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      else fenced.push({ index, text: line })
      prose.push("")
      return
    }
    if (marker) {
      fence = marker[1]
      prose.push("")
      return
    }
    prose.push(line)
  })

  const spans = []
  const withoutCode = prose.map((line, index) =>
    line.replace(/(`+)(.+?)\1(?!`)/g, (match, ticks, content) => {
      spans.push({ index, text: content.trim() })
      return ticks + " ".repeat(content.length) + ticks
    })
  )
  return { lines, prose, withoutCode, spans, fenced }
}

// GitHub-style heading anchors: the rendered text, lowercased, punctuation removed, spaces turned into hyphens, and
// "-1", "-2"... appended to repeats. Explicit `id`/`name` attributes count too.
function headingText(markdown) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(`+)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?=[^\w*]|$)/g, "$1$2")
}

export function slugify(text) {
  return headingText(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-")
}

function collectAnchors(parsed) {
  const anchors = new Set()
  const counts = new Map()
  const add = (slug) => {
    let unique = slug
    let count = counts.get(slug) ?? 0
    while (anchors.has(unique)) {
      count += 1
      unique = `${slug}-${count}`
    }
    counts.set(slug, count)
    anchors.add(unique)
  }

  const { prose } = parsed
  prose.forEach((line, index) => {
    const atx = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line)
    if (atx) add(slugify(atx[1]))
    else if (
      line.trim() &&
      /^\s{0,3}(=+|-+)\s*$/.test(prose[index + 1] ?? "") &&
      !/^\s*([#>|<*+-]|\d+[.)]\s)/.test(line)
    )
      add(slugify(line))
    for (const match of line.matchAll(/<[a-z][\w-]*\b[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) anchors.add(match[1])
  })
  return anchors
}

function loadWorkspace(root) {
  const packages = []
  const add = (dir) => {
    const manifest = readJson(root, dir ? `${dir}/package.json` : "package.json")
    if (!manifest) return
    const bins = new Set()
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies }
    for (const dependency of Object.keys(dependencies)) {
      if (!dependency.startsWith("@")) bins.add(dependency)
      for (const bin of KNOWN_BINS[dependency] ?? []) bins.add(bin)
    }
    packages.push({ dir, name: manifest.name ?? "", scripts: new Set(Object.keys(manifest.scripts ?? {})), bins })
  }
  add("")
  let patterns = []
  try {
    patterns = [...readText(root, "pnpm-workspace.yaml").matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)].map((m) => m[1])
  } catch {
    patterns = []
  }
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2)
      let names = []
      try {
        names = readdirSync(join(root, base), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      } catch {
        names = []
      }
      for (const name of names) add(`${base}/${name}`)
    } else if (!/[*!]/.test(pattern)) {
      add(pattern.replace(/\/$/, ""))
    }
  }
  return packages
}

function loadEnvContract(root) {
  const contract = readJson(root, "ops/production-env-contract.json")
  const known = new Set([...Object.keys(ENV_OUTSIDE_CONTRACT), ...Object.keys(ENV_EXTERNAL_TOOL_NAMES)])
  const prefixes = new Set(ENV_PROJECT_PREFIXES)
  if (!contract) return { known, prefixes, loaded: false }

  for (const variable of contract.variables ?? []) {
    if (typeof variable?.name !== "string") continue
    known.add(variable.name)
  }
  // Names the contract records as listed-but-unused, and the historical gates it keeps disabled.
  for (const note of contract.unused_in_code_remove_or_ignore ?? [])
    for (const match of String(note).matchAll(new RegExp(`\\b${ENV_NAME}\\b`, "g"))) known.add(match[0])
  for (const name of Object.keys(contract.commercial_authority?.historical_gates ?? {})) known.add(name)
  // Retired prefixes (Cloudinary) stay in the namespace, so naming them needs removal context.
  for (const prefix of contract.private_media_storage?.forbidden_environment_prefixes ?? [])
    if (/^[A-Z][A-Z0-9_]*_$/.test(String(prefix))) prefixes.add(String(prefix))
  return { known, prefixes, loaded: true }
}

// Shell words after each `pnpm`, with surrounding quotes removed (`--filter "@logloads/web"`, `--filter='./apps/web'`).
const unquote = (word) => word.replace(/^(["'])(.*)\1$/, "$2").replace(/=(["'])(.*)\1$/, "=$2")

function pnpmInvocations(code) {
  return [...code.matchAll(/(?<![\w@/.-])pnpm(?=\s)([^;&|`)\n]*)/g)].map((match) =>
    match[1].trim().split(/\s+/).filter(Boolean).map(unquote)
  )
}

// Returns a problem message for `pnpm …` tokens, or null when the command is fine or cannot be judged.
function checkPnpmInvocation(tokens, workspace) {
  const filters = []
  let dir = null
  let recursive = false
  let index = 0
  const skipOptions = () => {
    while (index < tokens.length && tokens[index].startsWith("-")) {
      const token = tokens[index]
      if (token === "--filter" || token === "-F" || token === "--filter-prod") filters.push(tokens[index + 1] ?? "")
      else if (token.startsWith("--filter=")) filters.push(token.slice("--filter=".length))
      else if (token === "-C" || token === "--dir") dir = tokens[index + 1] ?? ""
      else if (token === "-r" || token === "--recursive") recursive = true
      index += PNPM_OPTIONS_WITH_VALUE.has(token) ? 2 : 1
    }
  }

  skipOptions()
  let command = tokens[index]
  if (!command) return null
  const viaRun = command === "run" || command === "run-script"
  if (viaRun) {
    index += 1
    skipOptions()
    command = tokens[index]
    if (!command) return null
  } else if (PNPM_BUILTINS.has(command)) {
    return null
  }

  const script = command.replace(/[.,;'"]+$/, "")
  if (!/^[a-z][\w:.-]*$/i.test(script)) return null

  const root = workspace.find((pkg) => pkg.dir === "")
  let targets
  let label
  if (recursive || filters.some((filter) => /[*.^![\]{}]/.test(filter.replace(/^\.\//, "")))) {
    targets = workspace
    label = "any workspace package"
  } else if (filters.length > 0) {
    targets = []
    for (const filter of filters) {
      const path = filter.replace(/^\.\//, "").replace(/\/$/, "")
      const match = workspace.find((pkg) => pkg.dir !== "" && (pkg.name === filter || pkg.dir === path))
      if (!match) return `\`pnpm --filter ${filter}\` names no workspace package`
      targets.push(match)
    }
    label = filters.join(", ")
  } else if (dir !== null) {
    const path = dir.replace(/^\.\//, "").replace(/\/$/, "")
    const match = workspace.find((pkg) => pkg.dir === path)
    if (!match) return `\`pnpm -C ${dir}\` names no workspace package`
    targets = [match]
    label = path
  } else {
    targets = root ? [root] : []
    label = "the root package.json"
  }

  if (targets.some((pkg) => pkg.scripts.has(script))) return null
  // Without `run`, pnpm falls back to a binary of the package's dependencies (`pnpm tsc`, `pnpm changeset`). The root's
  // binaries count for every package, because pnpm also puts the workspace root's node_modules/.bin on the PATH.
  if (!viaRun && [...targets, root].some((pkg) => pkg?.bins.has(script))) return null
  const binary = viaRun ? "" : ", and no dependency binary of that name"
  return `\`pnpm ${tokens.join(" ")}\`: no script "${script}" in ${label}${binary}`
}

function envNamesIn(code, wholeSpan) {
  const names = []
  if (wholeSpan) {
    const whole = new RegExp(`^(${ENV_NAME})(?:=\\S*)?$`).exec(code)
    if (whole) return [whole[1]]
  }
  const patterns = [
    new RegExp(`(?<![\\w$.])(${ENV_NAME})=`, "g"),
    new RegExp(`\\$\\{?(${ENV_NAME})\\b`, "g"),
    new RegExp(`(?:process\\.env|import\\.meta\\.env|environment)\\.(${ENV_NAME})\\b`, "g"),
    new RegExp(`env\\[\\s*["'](${ENV_NAME})["']\\s*\\]`, "g")
  ]
  for (const pattern of patterns) for (const match of code.matchAll(pattern)) names.push(match[1])
  return names
}

// Inline link destinations `](target "title")`. As in CommonMark, a destination may contain balanced parentheses, so
// a Next.js route group such as `app/(marketing)/page.tsx` stays whole; `<…>` destinations may contain anything but
// `>`. A `](` that is not closed by `)` is not a link.
function inlineLinkTargets(line) {
  const targets = []
  let from = 0
  for (;;) {
    const start = line.indexOf("](", from)
    if (start === -1) return targets
    let cursor = start + 2
    while (line[cursor] === " " || line[cursor] === "\t") cursor += 1
    let target
    if (line[cursor] === "<") {
      const end = line.indexOf(">", cursor + 1)
      if (end === -1) {
        from = start + 2
        continue
      }
      target = line.slice(cursor + 1, end)
      cursor = end + 1
    } else {
      const begin = cursor
      let depth = 0
      for (; cursor < line.length; cursor += 1) {
        const char = line[cursor]
        if (char === "\\") cursor += 1
        else if (/\s/.test(char)) break
        else if (char === "(") depth += 1
        else if (char === ")") {
          if (depth === 0) break
          depth -= 1
        }
      }
      target = line.slice(begin, cursor).replace(/\\(.)/g, "$1")
    }
    const close = /^\s*(?:(?:"[^"]*"|'[^']*'|\([^)]*\))\s*)?\)/.exec(line.slice(cursor))
    if (close && target) targets.push(target)
    from = close ? cursor + close[0].length : start + 2
  }
}

// SUBSCRIPTION_BILLING_V1.md: only the superseded notice above the first `---` line is active content.
function activeLineCount(file, lines) {
  if (file === "docs/SUBSCRIPTION_BILLING_V1.md") {
    const cut = lines.findIndex((line) => /^---\s*$/.test(line))
    return cut === -1 ? lines.length : cut
  }
  return lines.length
}

function normalizeRepoPath(span) {
  const path = span.replace(/(?::\d+(?:[-:]\d+)*|#L\d+(?:-L?\d+)?)$/, "").replace(/\/$/, "")
  const top = path.split("/")[0]
  if (!REPO_PATH_ROOTS.includes(top) || !path.includes("/")) return null
  if (!/^[\w@.\-/[\]()]+$/.test(path) || path.includes("..")) return null
  const segments = path.split("/")
  if (segments.some((segment) => GENERATED_SEGMENTS.has(segment) || (segment.startsWith(".env") && segment !== ".env.example")))
    return null
  return path
}

export function checkDocs({ root = repoRoot, allowlist = DOCS_ALLOWLIST } = {}) {
  const exists = createExists(root)
  const findings = []
  const fail = (file, line, rule, message) => findings.push({ file, line, rule, message })

  const files = [...ROOT_DOCS.filter((file) => exists(file)), ...walkMarkdown(root, "docs")]
  const parsedFiles = new Map()
  const parsed = (file) => {
    if (!parsedFiles.has(file)) parsedFiles.set(file, parseMarkdown(readText(root, file)))
    return parsedFiles.get(file)
  }
  const anchorCache = new Map()
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, collectAnchors(parsed(file)))
    return anchorCache.get(file)
  }
  const workspace = loadWorkspace(root)
  const env = loadEnvContract(root)

  for (const file of files) {
    const doc = parsed(file)
    const verbatim = isVerbatim(file)

    // 1. Relative links (inline, reference definitions and HTML href/src) and their anchors resolve.
    doc.withoutCode.forEach((line, index) => {
      const targets = [
        ...inlineLinkTargets(line),
        ...[...line.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/g)].map((m) => m[1]),
        ...[...line.matchAll(/<[a-z][^>]*\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
      ]
      for (const target of targets) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue
        const hash = target.indexOf("#")
        let pathPart = (hash === -1 ? target : target.slice(0, hash)).split("?")[0]
        const fragment = hash === -1 ? "" : target.slice(hash + 1)
        try {
          pathPart = decodeURIComponent(pathPart)
        } catch {
          // Keep the raw text; it will simply fail to resolve.
        }

        let resolved = file
        if (pathPart) {
          resolved = pathPart.startsWith("/")
            ? posix.normalize(pathPart.slice(1))
            : posix.normalize(posix.join(posix.dirname(file), pathPart))
          if (resolved === ".." || resolved.startsWith("../") || !exists(resolved)) {
            if (!verbatim) fail(file, index + 1, "link", `broken relative link → ${target}`)
            continue
          }
        }
        if (!fragment || !resolved.endsWith(".md")) continue
        let anchor = fragment
        try {
          anchor = decodeURIComponent(fragment)
        } catch {
          // Compare the raw fragment.
        }
        if (!verbatim && !anchorsOf(resolved).has(anchor) && !anchorsOf(resolved).has(anchor.toLowerCase()))
          fail(file, index + 1, "anchor", `no heading or id "#${anchor}" in ${resolved} → ${target}`)
      }
    })

    if (verbatim) continue
    const active = activeLineCount(file, doc.lines)
    const spans = doc.spans.filter((span) => span.index < active)
    const fenced = doc.fenced.filter((line) => line.index < active)
    const near = (index) => [doc.prose[index - 1] ?? "", doc.prose[index], doc.prose[index + 1] ?? ""].join(" ")

    // 2 and 8. Backticked repository paths exist (docs/…md: rule 2; anything else: rule 8).
    if (file !== "docs/archive/README.md") {
      for (const span of spans) {
        const path = normalizeRepoPath(span.text)
        if (!path || exists(path)) continue
        if (ARCHIVE_CONTEXT.test(near(span.index))) continue
        if (path.startsWith("docs/") && path.endsWith(".md")) {
          fail(file, span.index + 1, "removed-ref", `references missing file ${path}`)
        } else if (!REMOVAL_CONTEXT.test(doc.prose[span.index])) {
          fail(file, span.index + 1, "repo-path", `references missing path ${path}`)
        }
      }
    }

    // 9. `pnpm <script>` in inline or fenced code names a real script.
    for (const code of [...spans, ...fenced])
      for (const tokens of pnpmInvocations(code.text)) {
        const problem = checkPnpmInvocation(tokens, workspace)
        if (problem) fail(file, code.index + 1, "pnpm-script", problem)
      }

    // 10. Production-namespace environment variables named in code are in the env contract.
    if (env.loaded)
      for (const code of [...spans.map((span) => ({ ...span, whole: true })), ...fenced])
        for (const name of envNamesIn(code.text, code.whole)) {
          if (![...env.prefixes].some((prefix) => name.startsWith(prefix)) || env.known.has(name)) continue
          if (REMOVAL_CONTEXT.test(doc.lines[code.index])) continue
          fail(file, code.index + 1, "env-name", `${name} is not in ops/production-env-contract.json`)
        }

    if (!isActiveDoc(file)) continue
    const body = doc.prose.slice(0, active)

    // 3. Metadata: a Status line near the top.
    if (!body.slice(0, 15).some((line) => /\*\*Status:\*\*/.test(line)) && file !== "docs/SUBSCRIPTION_BILLING_V1.md")
      fail(file, 1, "metadata", "missing a **Status:** line in the first 15 lines")

    body.forEach((line, index) => {
      const context = (body[index - 1] ?? "") + " " + line + " " + (body[index + 1] ?? "")
      // 4. Obsolete commercial claims need historical/prohibitive context.
      if (OBSOLETE_COMMERCIAL.test(line) && !HISTORICAL_CONTEXT.test(context))
        fail(file, index + 1, "obsolete-pricing", line.trim().slice(0, 120))
      // 5. Known stale status claims.
      for (const pattern of STALE_CLAIMS)
        if (pattern.test(line)) fail(file, index + 1, "stale-claim", line.trim().slice(0, 120))
      if (/\bSECURITY VERIFIED\b/.test(line) && !/no blanket/i.test(line))
        fail(file, index + 1, "stale-claim", line.trim().slice(0, 120))
      // 6. Deprecated status vocabulary.
      if (DEPRECATED_LABEL.test(line))
        fail(file, index + 1, "vocabulary", "use APPROVED/IMPLEMENTED/VERIFIED/TARGET/HISTORICAL/UNVERIFIED")
    })
  }

  // 7. The docs index links every authority document.
  const index = exists("docs/README.md") ? readText(root, "docs/README.md") : ""
  for (const required of REQUIRED_AUTHORITY)
    if (!index.includes(`](./${required})`)) fail("docs/README.md", 1, "authority", `does not link ${required}`)

  // Report in file order, then line order.
  const order = new Map(files.map((file, position) => [file, position]))
  findings.sort((a, b) => (order.get(a.file) ?? files.length) - (order.get(b.file) ?? files.length) || a.line - b.line)

  // An invalid allowlist entry is itself an error and suppresses nothing.
  const errors = []
  const entries = []
  allowlist.forEach((item, position) => {
    const filled = (key) => typeof item?.[key] === "string" && item[key].trim() !== ""
    if (["file", "rule", "match", "reason"].every(filled) && RULE_IDS.has(item.rule)) entries.push(item)
    else
      errors.push({
        file: "tools/check-docs.mjs",
        line: 1,
        rule: "allowlist",
        message: `DOCS_ALLOWLIST entry ${position} needs a non-empty file, match and reason and a known rule id`
      })
  })

  const used = new Set()
  const allowed = []
  for (const finding of findings) {
    const entry = entries.find(
      (item) => item.file === finding.file && item.rule === finding.rule && finding.message.includes(item.match)
    )
    if (!entry) errors.push(finding)
    else {
      used.add(entry)
      allowed.push({ ...finding, reason: entry.reason })
    }
  }
  const unusedAllowlist = entries.filter((entry) => !used.has(entry))
  return { files, errors, allowed, unusedAllowlist }
}

export const formatFinding = ({ file, line, rule, message }) => `${file}:${line} [${rule}] ${message}`

function main(argv) {
  const rootFlag = argv.indexOf("--root")
  const root = rootFlag === -1 ? repoRoot : resolve(argv[rootFlag + 1] ?? ".")
  const { files, errors, allowed, unusedAllowlist } = checkDocs({ root })

  for (const item of allowed) console.warn(`check-docs: allowlisted: ${formatFinding(item)} (${item.reason})`)
  for (const item of unusedAllowlist)
    console.warn(`check-docs: warning: allowlist entry no longer matches (${item.file} [${item.rule}] ${item.match}); remove it`)
  if (errors.length > 0) {
    console.error(errors.map(formatFinding).join("\n"))
    console.error(`\ncheck-docs: ${errors.length} problem(s) in ${files.length} files`)
    console.error(
      "Fix the document. A missing env name belongs in ops/production-env-contract.json (or, with a reason, in " +
        "ENV_OUTSIDE_CONTRACT); an accepted finding needs a reviewed DOCS_ALLOWLIST entry in tools/check-docs.mjs."
    )
    return 1
  }
  const note = allowed.length > 0 ? `; ${allowed.length} allowlisted finding(s)` : ""
  console.log(`check-docs: ok (${files.length} files${note})`)
  return 0
}

// Compare real paths. Through a Windows junction or a symlinked directory, argv[1] keeps the link path while
// import.meta.url is the real path, and a plain comparison would skip main() and exit 0 without checking anything.
const realPath = (path) => {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}
if (process.argv[1] && realPath(process.argv[1]) === realPath(scriptPath)) {
  process.exitCode = main(process.argv.slice(2))
}
