import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

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
    message: "Supabase Storage is the only active private-media provider. Cloudinary runtime imports, environment switches, provider branches, and dependencies are retired.",
    pattern: /(?:(?:process\.env|environment)\.(?:LOGLOADS_CLOUDINARY|CLOUDINARY)_[A-Z0-9_]+\b|(?:process\.env|environment)\[\s*["'](?:LOGLOADS_CLOUDINARY|CLOUDINARY)_[A-Z0-9_]+["']\s*\]|from\s+["']cloudinary["']|import\(\s*["']cloudinary["']\s*\)|require\(\s*["']cloudinary["']\s*\)|["']cloudinary["']\s*:|\bprovider\s*(?:===|!==|:)\s*["']cloudinary["'])/g,
    include: (file) => {
      const runtimeSource = file.startsWith("apps/") || file.startsWith("packages/")
      const testSource =
        file.includes("/__tests__/") ||
        /(?:^|\/)(?:fixtures|test-helpers)\.[cm]?[jt]sx?$/.test(file) ||
        /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)

      return (
        (runtimeSource && !testSource) ||
        file === "package.json" ||
        file === ".env.example" ||
        file === "ops/production-env-contract.json"
      )
    }
  },
  {
    message: "Cloudinary environment variables are retired from current deployment manifests.",
    pattern: /\b(?:LOGLOADS_CLOUDINARY|CLOUDINARY)_[A-Z0-9_]+\b/g,
    include: (file) =>
      file === ".env.example" ||
      file === "ops/production-env-contract.json"
  },
  {
    message: "Feature code must not hand-roll inline SVG icons.",
    pattern: /<svg[\s>]/g,
    include: (file) => file.startsWith("apps/web/") || file.startsWith("packages/ui/")
  },
  {
    // transfer_data and application_fee_amount are banned permanently, not as a
    // posture: they route driver pay through the platform balance (custody) or
    // silently deduct the platform cut from the driver ($500 posted, $475 paid
    // at the decided 5%).
    // Stripe's own tutorials default to both, so a plausible-looking custodial
    // integration would otherwise pass review. Connect itself stays out until a
    // counsel-gated direct-charges design. See AGENTS.md section 7.
    message: "Driver pay must never route through LogLoads. transfer_data/application_fee_amount are permanently banned (custody + fee deduction); Stripe Connect is counsel-gated. See AGENTS.md section 7.",
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
  },
  {
    message: "Platform-admin authority must use the exact persistent allowlist helper; a raw profile role is not authorization.",
    pattern: /(?:actor\.profile|currentUser|profile|user)\.role\s*(?:===|!==)\s*["']admin["']/g,
    include: (file) => {
      const runtimeSource =
        file.startsWith("apps/web/") &&
        (file.endsWith(".ts") || file.endsWith(".tsx"))
      const testSource =
        file.startsWith("apps/web/tests/") ||
        /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)

      return runtimeSource && !testSource && file !== "apps/web/lib/platform-admin.ts"
    }
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
