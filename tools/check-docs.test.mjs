import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import { checkDocs, slugify } from "./check-docs.mjs"

const script = fileURLToPath(new URL("./check-docs.mjs", import.meta.url))

// A minimal repository that passes every rule. Each test writes it to a fresh temporary directory, changes one file
// and asserts which rule fires.
const GUIDE = `# Guide

> **Status:** APPROVED. Fixture for tools/check-docs.test.mjs.

## Setup & first run

Read [the workflow rules](./AGENT_WORKFLOW.md#branch--pr-rules), [the plan](product/TRANSITION_PLAN.md) and
[setup](#setup--first-run). Sessions live in \`apps/web/lib/session.ts\`; builds write \`apps/web/.next\`.
The old handoff \`docs/HANDOFF.md\` is no longer in the tree; recover it from tag \`archive/docs-history-20261102\`.
\`apps/web/app/v2/v2.css\` was retired in favour of CSS Modules.

Run \`pnpm guardrails\`, \`pnpm install --frozen-lockfile\` or \`pnpm --filter @fixture/web dev\`, with
\`LOGLOADS_MARKETPLACE_V2=enabled\`. \`VERCEL_ENV\` is set by the platform.

\`\`\`bash
LOGLOADS_MARKETPLACE_V2=enabled DS_E2E_PORT=4100 pnpm --filter @fixture/web dev
pnpm exec vitest run
\`\`\`

The retired 5% fee is historical. Inline code like \`[x](./missing.md)\` is not a link.
`

const BASE = {
  "package.json": JSON.stringify({
    name: "fixture",
    scripts: { guardrails: "node x", "docs:check": "node y" },
    devDependencies: { "@changesets/cli": "2.0.0", "@playwright/test": "1.0.0", eslint: "8.0.0", typescript: "5.0.0" }
  }),
  "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n',
  "apps/web/package.json": JSON.stringify({
    name: "@fixture/web",
    scripts: { dev: "next dev" },
    dependencies: { next: "15.0.0" }
  }),
  "apps/web/lib/session.ts": "export {}\n",
  "apps/web/app/(marketing)/page.tsx": "export {}\n",
  "ops/production-env-contract.json": JSON.stringify({
    variables: [{ name: "LOGLOADS_MARKETPLACE_V2" }, { name: "NEXT_PUBLIC_APP_URL" }],
    unused_in_code_remove_or_ignore: ["NEXT_PUBLIC_MAP_PROVIDER / NOTIFICATION_PROVIDER (listed in .env.example; unused)"],
    commercial_authority: { historical_gates: { LOGLOADS_SUBSCRIPTION_COLLECTION: "disabled" } },
    private_media_storage: { forbidden_environment_prefixes: ["CLOUDINARY_"] }
  }),
  "README.md": "# Fixture\n\nStart at [the docs index](./docs/README.md), then run `pnpm docs:check`.\n",
  "docs/README.md": [
    "# Docs",
    "",
    "> **Status:** Index.",
    "",
    "1. [Decisions](./DECISIONS.md)",
    "2. [Blueprint](./product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md)",
    "3. [UX spec](./product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md)",
    "4. [Plan](./product/TRANSITION_PLAN.md)",
    "5. [Workflow](./AGENT_WORKFLOW.md) and [the guide](./GUIDE.md)",
    ""
  ].join("\n"),
  "docs/DECISIONS.md": "# Decisions\n\nAppend-only.\n",
  "docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md": "# Blueprint\n",
  "docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md": "# UX spec\n",
  "docs/product/TRANSITION_PLAN.md": "# Plan\n\n**Status:** TARGET.\n",
  "docs/AGENT_WORKFLOW.md": "# Workflow\n\n**Status:** APPROVED.\n\n## Branch & PR rules\n\nSquash only.\n",
  "docs/GUIDE.md": GUIDE,
  "docs/archive/README.md": "# Archive\n\n**Status:** HISTORICAL.\n\nRemoved: `docs/HANDOFF.md`.\n"
}

const roots = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-docs-"))
  roots.push(root)
  for (const [file, content] of Object.entries({ ...BASE, ...overrides })) {
    if (content === null) continue
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  return root
}

const run = (overrides, options = {}) => checkDocs({ root: fixture(overrides), allowlist: [], ...options })
const rules = (overrides) => run(overrides).errors.map((finding) => finding.rule)
const guide = (extra) => ({ "docs/GUIDE.md": `${GUIDE}\n${extra}\n` })

test("the fixture repository passes every rule", () => {
  const result = run()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.files, [
    "README.md",
    "docs/AGENT_WORKFLOW.md",
    "docs/DECISIONS.md",
    "docs/GUIDE.md",
    "docs/README.md",
    "docs/archive/README.md",
    "docs/product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md",
    "docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md",
    "docs/product/TRANSITION_PLAN.md"
  ])
})

test("rule 1: a broken relative link fails, including a case mismatch and a root doc", () => {
  assert.deepEqual(rules(guide("See [the plan](./product/NOPE.md).")), ["link"])
  assert.deepEqual(rules(guide("See [rules](./agent_workflow.md).")), ["link"])
  assert.deepEqual(rules(guide("See [outside](../../elsewhere.md).")), ["link"])
  assert.deepEqual(rules(guide("[ref]: ./missing.md")), ["link"])
  assert.deepEqual(rules({ "README.md": "# Fixture\n\n[Docs](./docs/MISSING.md)\n" }), ["link"])
  const [finding] = run(guide("See [the plan](./product/NOPE.md).")).errors
  assert.equal(finding.file, "docs/GUIDE.md")
  assert.equal(finding.line, GUIDE.split("\n").length + 1)
})

test("rule 1: links in fenced code are ignored and verbatim archives are exempt from failure", () => {
  assert.deepEqual(rules(guide("```md\n[x](./missing.md)\n```")), [])
  assert.deepEqual(rules({ "docs/archive/old/NOTE.md": "# Old\n\n[gone](./gone.md)\n" }), [])
  assert.deepEqual(rules({ "docs/DECISIONS.md": "# Decisions\n\n[gone](./gone.md)\n" }), [])
})

test("rule 1: a link destination keeps balanced parentheses (Next.js route groups), titles and <…>", () => {
  assert.deepEqual(rules(guide("See [the page](../apps/web/app/(marketing)/page.tsx).")), [])
  assert.deepEqual(
    rules(guide('See [workflow](./AGENT_WORKFLOW.md "Workflow") and [plan](<./product/TRANSITION_PLAN.md>).')),
    []
  )
  const [finding] = run(guide("See [the page](../apps/web/app/(marketing)/nope.tsx).")).errors
  assert.equal(finding.message, "broken relative link → ../apps/web/app/(marketing)/nope.tsx")
  assert.deepEqual(rules(guide("A stray ](not a link and (an aside).")), [])
})

test("rule 1: an anchor must name a heading or id in the target file", () => {
  assert.deepEqual(rules(guide("See [rules](./AGENT_WORKFLOW.md#branch-rules).")), ["anchor"])
  assert.deepEqual(rules(guide("See [here](#no-such-heading).")), ["anchor"])
  assert.deepEqual(rules(guide("## Setup & first run\n\nSee [the second](#setup--first-run-1).")), [])
  assert.deepEqual(rules(guide('<a id="pinned"></a>\n\nSee [pinned](#pinned).')), [])
  assert.deepEqual(rules(guide("See [line](../apps/web/lib/session.ts#L1).")), [])
})

test("rule 2: a backticked docs path must exist unless it is said to be at the archive tag", () => {
  assert.deepEqual(rules(guide("Read `docs/HANDOFF-2026-07-27.md` first.")), ["removed-ref"])
  assert.deepEqual(rules(guide("Read `docs/HANDOFF-2026-07-27.md` at tag `archive/docs-history-20261102`.")), [])
  assert.deepEqual(rules(guide("The percentage stage of `docs/HANDOFF-2026-07-27.md`.")), ["removed-ref"])
  assert.deepEqual(rules(guide("Each HTML tag is described in `docs/GONE.md`.")), ["removed-ref"])
  assert.deepEqual(rules(guide("Recovery steps live in `docs/GONE.md`.")), ["removed-ref"])
  assert.deepEqual(rules(guide("`docs/GONE.md` is kept at the archive tag.")), [])
  assert.deepEqual(rules({ "README.md": "# Fixture\n\nRead `docs/HANDOFF.md`.\n" }), ["removed-ref"])
  // The archive index lists removed paths by design (see BASE).
  assert.deepEqual(rules({ "docs/archive/README.md": "# Archive\n\n**Status:** HISTORICAL.\n\n`docs/GONE.md`\n" }), [])
})

test("rule 3: an active doc needs a Status line in its first 15 lines", () => {
  assert.deepEqual(rules({ "docs/NEW.md": "# New\n\nNo metadata here.\n" }), ["metadata"])
  assert.deepEqual(rules({ "docs/NEW.md": `# New\n${"\n".repeat(15)}**Status:** TARGET.\n` }), ["metadata"])
  assert.deepEqual(rules({ "docs/archive/NEW.md": "# Archived\n" }), [])
})

test("rule 4: obsolete commercial terms need historical or prohibitive context", () => {
  assert.deepEqual(rules(guide("\nHosts pay 5% of driver pay on top.\n")), ["obsolete-pricing"])
  assert.deepEqual(rules(guide("\nUpgrade to Dispatch Pro for $1,500.\n")), ["obsolete-pricing"])
  assert.deepEqual(rules(guide("\nThe superseded 5% model is preserved for old obligations.\n")), [])
  assert.deepEqual(rules({ "docs/DECISIONS.md": "# Decisions\n\nHosts pay 5% of driver pay.\n" }), [])
})

test("rule 4: only the superseded notice of SUBSCRIPTION_BILLING_V1 is active", () => {
  const notice = "> **SUPERSEDED.** Historical contract.\n\n---\n\n"
  assert.deepEqual(rules({ "docs/SUBSCRIPTION_BILLING_V1.md": `${notice}Hosts pay 5% of driver pay.\n` }), [])
  assert.deepEqual(rules({ "docs/SUBSCRIPTION_BILLING_V1.md": `${notice}Read \`docs/GONE.md\`.\n` }), [])
  assert.deepEqual(
    rules({ "docs/SUBSCRIPTION_BILLING_V1.md": "> Notice.\n>\n> Upgrade to Dispatch Pro today.\n\n---\n" }),
    ["obsolete-pricing"]
  )
})

test("rule 5: known stale status claims fail", () => {
  assert.deepEqual(rules(guide("The schema was never executed.")), ["stale-claim"])
  assert.deepEqual(rules(guide("Statically checked only.")), ["stale-claim"])
  assert.deepEqual(rules(guide("Result: SECURITY VERIFIED.")), ["stale-claim"])
  assert.deepEqual(rules(guide("There is no blanket SECURITY VERIFIED claim.")), [])
})

test("rule 6: deprecated status labels fail", () => {
  assert.deepEqual(rules(guide("CURRENT: the pilot ledger.")), ["vocabulary"])
  assert.deepEqual(rules(guide("Two invoices are OWED.")), ["vocabulary"])
  assert.deepEqual(rules(guide("The current pilot ledger.")), [])
})

test("rule 7: the docs index must link every authority document", () => {
  const index = BASE["docs/README.md"].replace("4. [Plan](./product/TRANSITION_PLAN.md)\n", "")
  const result = run({ "docs/README.md": index })
  assert.deepEqual(
    result.errors.map((finding) => [finding.file, finding.rule, finding.message]),
    [["docs/README.md", "authority", "does not link product/TRANSITION_PLAN.md"]]
  )
})

test("rule 8: a backticked repository path must exist unless the line says it is gone", () => {
  assert.deepEqual(rules(guide("Formatting lives in `apps/web/components/v2/format.ts`.")), ["repo-path"])
  assert.deepEqual(rules(guide("Styles: `apps/web/app/v2/v2.css`.")), ["repo-path"])
  assert.deepEqual(rules(guide("See `apps/web/lib/session.ts:12` and `apps/web/lib/`.")), [])
  assert.deepEqual(rules(guide("`apps/web/components/v2/format.ts` was removed in #179.")), [])
  assert.deepEqual(rules(guide("Local secrets: `apps/web/.env.local`, state in `apps/web/.data/state.json`.")), [])
  assert.deepEqual(rules(guide("Globs such as `docs/**` and `apps/web/app/<route>/page.tsx` are not paths.")), [])
})

test("rule 9: pnpm commands in code must name a script of the targeted package", () => {
  assert.deepEqual(rules(guide("Run `pnpm docs:lint`.")), ["pnpm-script"])
  assert.deepEqual(rules(guide("Run `pnpm --filter @fixture/web build`.")), ["pnpm-script"])
  assert.deepEqual(rules(guide("Run `pnpm --filter @fixture/missing dev`.")), ["pnpm-script"])
  assert.deepEqual(rules(guide("Run `pnpm dev` (the root has no dev script).")), ["pnpm-script"])
  assert.deepEqual(rules(guide("```bash\npnpm guardrails && pnpm run nope\n```")), ["pnpm-script"])
  assert.deepEqual(
    rules(guide("Run `pnpm run docs:check`, `pnpm --filter=./apps/web dev`, `pnpm -r dev` or `pnpm dlx x`.")),
    []
  )
  assert.deepEqual(rules(guide("pnpm nope in prose is not a command.")), [])
  const [finding] = run(guide("Run `pnpm docs:lint`.")).errors
  assert.match(finding.message, /no script "docs:lint" in the root package\.json/)
})

test("rule 10: production-namespace env names in code must be in the env contract", () => {
  assert.deepEqual(rules(guide("Set `LOGLOADS_NOT_REAL=1`.")), ["env-name"])
  assert.deepEqual(rules(guide("```bash\nNEXT_PUBLIC_NOT_REAL=x pnpm guardrails\n```")), ["env-name"])
  assert.deepEqual(rules(guide("Set `CLOUDINARY_CLOUD_NAME`.")), ["env-name"])
  assert.deepEqual(rules(guide("`CLOUDINARY_CLOUD_NAME` is retired.")), [])
  assert.deepEqual(rules(guide("`NEXT_PUBLIC_MAP_PROVIDER` and `LOGLOADS_SUBSCRIPTION_COLLECTION` are known.")), [])
  assert.deepEqual(rules(guide("Tooling: `DS_E2E_PORT=4100`, `SMOKE_BASE`, `INVITABLE_ROLES` are out of scope.")), [])
  const [finding] = run(guide("Set `LOGLOADS_NOT_REAL=1`.")).errors
  assert.equal(finding.message, "LOGLOADS_NOT_REAL is not in ops/production-env-contract.json")
})

test("rule 10: generic NODE_, GITHUB_, VERCEL_ and NEXT_ names are outside the project's namespaces", () => {
  const generic = "`NODE_OPTIONS=--max-old-space-size=4096`, `GITHUB_TOKEN`, `NEXT_TELEMETRY_DISABLED=1`, `VERCEL_URL`"
  assert.deepEqual(rules(guide(`Set ${generic}.`)), [])
  assert.deepEqual(rules(guide("```bash\nexport NODE_ENV=production GITHUB_SHA=abc\n```")), [])
  assert.deepEqual(rules(guide("The Supabase CLI reads `SUPABASE_ACCESS_TOKEN`.")), [])
  assert.deepEqual(rules(guide("Set `POSTHOG_NOT_REAL` and `SUPABASE_NOT_REAL`.")), ["env-name", "env-name"])
})

test("rule 9: pnpm commands and dependency binaries are accepted, and `pnpm run` needs a script", () => {
  const commands = "`pnpm approve-builds`, `pnpm tsc --noEmit`, `pnpm changeset`, `pnpm eslint .`, `pnpm playwright install`"
  assert.deepEqual(rules(guide(`Run ${commands}.`)), [])
  assert.deepEqual(rules(guide("Run `pnpm --filter @fixture/web next build` or `pnpm --filter @fixture/web tsc`.")), [])
  assert.deepEqual(rules(guide("Run `pnpm run tsc`.")), ["pnpm-script"])
  assert.deepEqual(rules(guide("Run `pnpm prettier --check .`.")), ["pnpm-script"])
  // A scoped package's own name is not a binary: `@playwright/test` does not make `pnpm test` valid.
  assert.deepEqual(rules(guide("Run `pnpm test`.")), ["pnpm-script"])
  const [finding] = run(guide("Run `pnpm prettier --check .`.")).errors
  assert.match(finding.message, /no script "prettier" in the root package\.json, and no dependency binary of that name/)
})

test("rule 9: a quoted --filter value names the same package", () => {
  const quoted = "`pnpm --filter \"@fixture/web\" dev`, `pnpm --filter='@fixture/web' dev`, `pnpm -F \"./apps/web\" dev`"
  assert.deepEqual(rules(guide(`Run ${quoted}.`)), [])
  const [finding] = run(guide('Run `pnpm --filter "@fixture/missing" dev`.')).errors
  assert.equal(finding.message, "`pnpm --filter @fixture/missing` names no workspace package")
})

test("a reviewed allowlist entry suppresses one finding and an unused entry is reported", () => {
  const allowlist = [
    { file: "docs/GUIDE.md", rule: "env-name", match: "LOGLOADS_NOT_REAL", reason: "fixture" },
    { file: "docs/GUIDE.md", rule: "link", match: "./never.md", reason: "fixture" }
  ]
  const result = run(guide("Set `LOGLOADS_NOT_REAL=1` and read `docs/GONE.md`."), { allowlist })
  assert.deepEqual(
    result.errors.map((finding) => finding.rule),
    ["removed-ref"]
  )
  assert.deepEqual(
    result.allowed.map((finding) => [finding.rule, finding.reason]),
    [["env-name", "fixture"]]
  )
  assert.deepEqual(result.unusedAllowlist, [allowlist[1]])
})

test("an allowlist entry cannot suppress a different finding of the same rule, and an empty entry is an error", () => {
  const entry = { file: "docs/GUIDE.md", rule: "env-name", match: "LOGLOADS_NOT_REAL", reason: "fixture" }
  const both = guide("Set `LOGLOADS_NOT_REAL=1` and `LOGLOADS_OTHER=1`.")
  const result = run(both, { allowlist: [entry] })
  assert.deepEqual(
    result.errors.map((finding) => finding.message),
    ["LOGLOADS_OTHER is not in ops/production-env-contract.json"]
  )
  for (const invalid of [{ ...entry, match: "" }, { ...entry, rule: "env" }, { ...entry, reason: " " }]) {
    const rejected = run(both, { allowlist: [invalid] })
    assert.deepEqual(
      rejected.errors.map((finding) => finding.rule),
      ["allowlist", "env-name", "env-name"]
    )
    assert.deepEqual(rejected.allowed, [])
  }
})

test("the CLI runs when invoked through a directory link (Windows junction or symlink)", () => {
  const base = mkdtempSync(join(tmpdir(), "check-docs-link-"))
  roots.push(base)
  mkdirSync(join(base, "real", "tools"), { recursive: true })
  copyFileSync(script, join(base, "real", "tools", "check-docs.mjs"))
  symlinkSync(join(base, "real"), join(base, "link"), "junction")
  const linked = join(base, "link", "tools", "check-docs.mjs")
  const result = spawnSync(process.execPath, [linked, "--root", fixture()], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^check-docs: ok \(9 files\)/)
})

test("the CLI exits 1 with file:line [rule] output on a problem and 0 when clean", () => {
  const clean = spawnSync(process.execPath, [script, "--root", fixture()], { encoding: "utf8" })
  assert.equal(clean.status, 0, clean.stderr)
  assert.match(clean.stdout, /^check-docs: ok \(9 files\)/)

  const broken = fixture(guide("\nHosts pay 5% of driver pay.\n\nSee [gone](./gone.md)."))
  const failed = spawnSync(process.execPath, [script, "--root", broken], { encoding: "utf8" })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /docs\/GUIDE\.md:\d+ \[obsolete-pricing\] Hosts pay 5% of driver pay\./)
  assert.match(failed.stderr, /docs\/GUIDE\.md:\d+ \[link\] broken relative link → \.\/gone\.md/)
  assert.match(failed.stderr, /check-docs: 2 problem\(s\) in 9 files/)
})

test("slugify follows GitHub heading anchors", () => {
  assert.equal(slugify("Branch & PR rules"), "branch--pr-rules")
  assert.equal(slugify("1. Runners (APPROVED)"), "1-runners-approved")
  assert.equal(slugify("`pnpm validate` — **required**"), "pnpm-validate--required")
  assert.equal(slugify("[Linked](./x.md) heading_name"), "linked-heading_name")
})
