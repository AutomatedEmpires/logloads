import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = new URL("..", import.meta.url).pathname

const ignoredDirs = new Set([
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
