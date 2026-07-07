import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = new URL("..", import.meta.url).pathname

const ignoredDirs = new Set([
  ".data",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
])

const ignoredFiles = new Set(["pnpm-lock.yaml"])
const textExtensions = new Set([
  ".css",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml"
])

const checks = [
  {
    message: "Use @logloads/contracts; @logloads/core is retired.",
    pattern: /@logloads\/core|packages\/core/g
  },
  {
    message: "Use @logloads/ui <Icon>; LogLoads icons are Phosphor through the semantic registry.",
    pattern: /from\s+["'](?:lucide-react|@heroicons\/[^"']+|react-icons(?:\/[^"']+)?|@fortawesome\/[^"']+|@mui\/icons-material(?:\/[^"']+)?)["']/g
  },
  {
    message: "Feature code must not hand-roll inline SVG icons.",
    pattern: /<svg[\s>]/g,
    include: (file) => file.startsWith("apps/web/") || file.startsWith("packages/ui/")
  },
  {
    message: "Stripe Connect/freight money movement is outside LogLoads positioning.",
    pattern: /Stripe Connect|stripe\.accounts|connect_account|transfer_data|application_fee_amount/g,
    include: (file) => file.startsWith("apps/") || file.startsWith("packages/") || file.startsWith("supabase/")
  },
  {
    message: "Private operational routes must not be marked public.",
    pattern: /private_operational_route["'\s:]+public|visibility["'\s:]+public_operational_route/g
  },
  {
    message: "LogLoads local web runtime must use port 3002, not 3000.",
    pattern: /(?:127\.0\.0\.1|localhost):3000|\b-p\s+3000\b|PORT=3000/g,
    include: (file) => file.startsWith("apps/web/") || file === "package.json"
  },
  {
    message: "Internal architecture vocabulary is banned from product copy (say what it does for the user).",
    pattern: /operating graph|compatibility engine|purpose-limited|audit trail|network trucks/gi,
    include: (file) => file.startsWith("apps/web/") && !file.startsWith("apps/web/tests/")
  },
  {
    message: "Raw entitlement vocabulary must not render; use plan/feature language in the UI.",
    pattern: /[">]\s*Entitlements?\b/g,
    include: (file) => file.startsWith("apps/web/") && file.endsWith(".tsx")
  },
  {
    message: "Numeric match scores are banned; show fit labels with reasons.",
    pattern: /\b\d{1,3}\s*\/\s*100\b/g,
    include: (file) => file.startsWith("apps/web/") && (file.endsWith(".tsx") || file.endsWith(".ts"))
  },
  {
    message: "Cockpit identity comes from the session; hardcoded or client-supplied actors are banned in apps/web.",
    pattern: /V3_ACTORS|DEFAULT_ACTOR_USER_ID|DEFAULT_ORGANIZATION_ID|devActorUserId|LOGLOADS_ENABLE_DEMO_ACTORS|22222222-2222-4222-8222/g,
    include: (file) => file.startsWith("apps/web/") && !file.startsWith("apps/web/tests/")
  }
]

function extensionOf(path) {
  const index = path.lastIndexOf(".")
  return index === -1 ? "" : path.slice(index)
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stats = statSync(path)

    if (stats.isDirectory()) {
      if (!ignoredDirs.has(entry)) {
        walk(path, files)
      }
      continue
    }

    const rel = relative(repoRoot, path).replaceAll("\\", "/")
    if (
      rel !== "tools/check-guardrails.mjs" &&
      !ignoredFiles.has(entry) &&
      textExtensions.has(extensionOf(entry)) &&
      !rel.endsWith(".tsbuildinfo")
    ) {
      files.push(rel)
    }
  }

  return files
}

const failures = []
for (const file of walk(repoRoot)) {
  const source = readFileSync(join(repoRoot, file), "utf8")

  for (const check of checks) {
    if (check.include && !check.include(file)) {
      continue
    }

    const matches = [...source.matchAll(check.pattern)]
    for (const match of matches) {
      const line = source.slice(0, match.index).split("\n").length
      failures.push(`${file}:${line} ${check.message}`)
    }
  }
}

if (failures.length > 0) {
  console.error("LogLoads guardrails failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("LogLoads guardrails passed.")
