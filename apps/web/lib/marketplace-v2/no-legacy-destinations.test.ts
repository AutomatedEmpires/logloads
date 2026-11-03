import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * Marketplace V2 must never send a user into a retired cockpit (#124, acceptance criterion 4). Every V2
 * source file is parsed with the TypeScript compiler and every string it contains (plain strings, template
 * literal parts and JSX attribute values) is checked. Comments and visible JSX text are not strings, so a
 * note that mentions a legacy route cannot trip the check, while a destination built in a constant, a prop,
 * an `href`, `redirect()`, `router.push()` or a form `action` is still caught.
 */

const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url))

/** V2 routes, V2 components and the V2 server code that builds their redirects. */
const V2_SOURCE_ROOTS = ["app/v2", "components/v2", "lib/marketplace-v2"]

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/

/** Test files hold fixtures (including this one), not destinations a user can reach. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/**
 * `/workspace` only redirects into a cockpit. `/host`, `/fleet` and `/driver` are the cockpits. A match must
 * start the string or follow a separator such as `=`, `?`, `&`, a quote or a space, so `next=/fleet/x`
 * counts while `@/lib/host-data` or `/v2/hauler/fleet` do not.
 */
const LEGACY_DESTINATION = /(?:^|[^\w./-])\/(?:workspace|host|fleet|driver)(?=$|[/?#])/

/**
 * Session helpers that redirect to a cockpit home or to the legacy onboarding flow (which ends in a cockpit).
 * V2 resolves its actor through `lib/marketplace-v2/viewer.ts` instead.
 */
const LEGACY_ROUTING_IMPORTS = new Set([
  "firstRunDestination",
  "homePathFor",
  "homePathForIntent",
  "homePathForMembership",
  "requireAuthenticatedActor",
  "requireCockpitActor"
])

/** Legacy UI renders legacy navigation (cockpit tabs, "Open workspace"). */
const LEGACY_COMPONENT_MODULE = /(?:^|\/)components\/v3(?:\/|$)/

/**
 * Deliberate exceptions, each with a reason a reviewer can check. Empty on purpose: add an entry only for a
 * string that names a legacy route without sending anyone there.
 */
const ALLOWED: ReadonlyArray<{ file: string; value: string; reason: string }> = []

interface Finding {
  location: string
  value: string
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) return sourceFiles(path)
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : []
  })
}

function scriptKind(fileName: string): ts.ScriptKind {
  return /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

/** Legacy destinations and legacy routing imports found in one source text. */
function scanSource(fileName: string, text: string): { destinations: Finding[]; imports: Finding[] } {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName))
  const destinations: Finding[] = []
  const imports: Finding[] = []
  const at = (node: ts.Node) => `${fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : ""

      if (LEGACY_COMPONENT_MODULE.test(specifier)) {
        imports.push({ location: at(node), value: specifier })
      }

      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause
      const elements = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) ? bindings.elements : []

      for (const element of elements) {
        const imported = (element.propertyName ?? element.name).text

        if (LEGACY_ROUTING_IMPORTS.has(imported)) {
          imports.push({ location: at(element), value: imported })
        }
      }

      // A module specifier names a file, not a destination.
      return
    }

    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (LEGACY_DESTINATION.test(node.text)) {
        destinations.push({ location: at(node), value: node.text })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(source)
  return { destinations, imports }
}

function scanV2Tree() {
  const files = V2_SOURCE_ROOTS.flatMap((root) => sourceFiles(join(WEB_ROOT, root)))
  const relativeName = (path: string) => relative(WEB_ROOT, path).split(sep).join("/")
  const results = files.map((path) => ({ file: relativeName(path), ...scanSource(relativeName(path), readFileSync(path, "utf8")) }))

  return {
    destinations: results.flatMap((result) =>
      result.destinations.filter((finding) => !ALLOWED.some((entry) => entry.file === result.file && entry.value === finding.value))),
    files: results.map((result) => result.file),
    imports: results.flatMap((result) => result.imports)
  }
}

const format = (findings: Finding[]) => findings.map((finding) => `${finding.location}  ${finding.value}`)

describe("Marketplace V2 never links to a legacy cockpit", () => {
  const scan = scanV2Tree()

  it("scans the V2 routes, components and server code", () => {
    expect(scan.files).toEqual(expect.arrayContaining([
      "app/v2/layout.tsx",
      "app/v2/work/[jobId]/page.tsx",
      "app/v2/inquiries/page.tsx",
      "app/v2/landing/inquiries/page.tsx",
      "app/v2/landing/jobs/page.tsx",
      "app/v2/landing/jobs/new/page.tsx",
      "components/v2/JobCard.tsx",
      "lib/marketplace-v2/actions.ts",
      "lib/marketplace-v2/viewer.ts"
    ]))
    expect(scan.files.some((file) => TEST_FILE.test(file))).toBe(false)
  })

  it("has no href, redirect, push or form action to /workspace, /host, /fleet or /driver", () => {
    expect(format(scan.destinations)).toEqual([])
  })

  it("does not use legacy cockpit routing helpers or legacy UI components", () => {
    expect(format(scan.imports)).toEqual([])
  })

  it("keeps every allowlist entry justified and still needed", () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.trim().length).toBeGreaterThan(20)
      expect(readFileSync(join(WEB_ROOT, entry.file), "utf8")).toContain(entry.value)
    }
  })
})

describe("the V2 legacy-destination scanner", () => {
  const fixture = [
    "import Link from \"next/link\"",
    "import { redirect, useRouter } from \"next/navigation\"",
    "import { AppShell } from \"@/components/v3/Shells\"",
    "import { getSessionActor, requireAuthenticatedActor as guard } from \"@/lib/session\"",
    "import { hostData } from \"@/lib/host-data\"",
    "// Choose workspace used to link to /workspace and \"/fleet/trucks\".",
    "/* <Link href=\"/host/command\"> */",
    "const EQUIPMENT_HREF = \"/fleet/trucks\"",
    "export function Example({ id }: { id: string }) {",
    "  const router = useRouter()",
    "  router.push(\"/workspace\")",
    "  redirect(`/host/command?job=${id}`)",
    "  const back = `/sign-in?next=/driver/map`",
    "  return (",
    "    <>",
    "      <Link href=\"/v2/work\">Find work</Link>",
    "      <Link href={`/v2/hauler/fleet/${id}`}>Trucks</Link>",
    "      <a href='/driver'>Old</a>",
    "      <form action=\"/fleet?tab=trips\" />",
    "      <p>Legacy screens lived under /host/ and /fleet/.</p>",
    "    </>",
    "  )",
    "}"
  ].join("\n")
  const result = scanSource("fixture.tsx", fixture)

  it("flags legacy destinations in constants, hrefs, redirects, pushes, form actions and query values", () => {
    expect(result.destinations.map((finding) => finding.value)).toEqual([
      "/fleet/trucks",
      "/workspace",
      "/host/command?job=",
      "/sign-in?next=/driver/map",
      "/driver",
      "/fleet?tab=trips"
    ])
  })

  it("ignores comments, visible text, V2 paths and module names", () => {
    const lines = result.destinations.map((finding) => Number(finding.location.split(":").at(-1)))

    expect(lines).not.toContain(6)
    expect(lines).not.toContain(7)
    expect(lines).not.toContain(20)
  })

  it("flags legacy routing helpers and legacy UI imports, including renamed ones", () => {
    expect(result.imports.map((finding) => finding.value)).toEqual(["@/components/v3/Shells", "requireAuthenticatedActor"])
  })
})
