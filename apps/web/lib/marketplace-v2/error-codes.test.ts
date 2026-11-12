import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  isV2ErrorCode,
  isV2Reference,
  V2_ERROR_CODES,
  V2_GENERIC_ERROR,
  v2ErrorBoundaryMessage,
  v2ErrorCopy,
  v2ErrorMessage,
  v2ErrorNotice,
  v2ErrorQuery,
  withV2Reference
} from "./error-codes"

/**
 * #279 (design audit 1, C2): a V2 page shows only fixed copy for `?error=`, never text from the URL. These cases pin
 * the catalogue, the reading of a query, and, for every V2 page, that it reads `?error=` only through `v2ErrorNotice`.
 */

const PHISHING = "Your account is locked. Call 541-555-0100 to keep your listings."
const MARKUP = `<img src=x onerror="alert(1)">`
const GENERIC = v2ErrorCopy(V2_GENERIC_ERROR)

describe("the catalogue", () => {
  it("has plain copy for every code: full sentences, no placeholders, nothing from a store", () => {
    expect(V2_ERROR_CODES.length).toBeGreaterThan(40)

    for (const code of V2_ERROR_CODES) {
      const copy = v2ErrorCopy(code)
      expect(code, code).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(copy, code).toMatch(/^[A-Z].*[.!]$/)
      expect(copy, code).not.toMatch(/[{}<>%$]|undefined|null|TODO|lorem/i)
      expect(copy.length, code).toBeLessThanOrEqual(200)
    }
  })

  it("knows only its own codes", () => {
    expect(isV2ErrorCode("job_closed")).toBe(true)
    for (const value of ["", "JOB_CLOSED", "toString", "__proto__", "constructor", PHISHING, 1, null, undefined]) {
      expect(isV2ErrorCode(value), String(value)).toBe(false)
    }
  })

  it("gives the generic copy for anything that is not a code", () => {
    expect(v2ErrorCopy("job_closed")).toBe("This job is no longer accepting interest. Nothing was sent.")
    expect(v2ErrorCopy(PHISHING)).toBe(GENERIC)
    expect(v2ErrorCopy("hasOwnProperty")).toBe(GENERIC)
    expect(GENERIC).toBe("Something went wrong on our side. Try again in a moment.")
  })
})

describe("references", () => {
  it("accepts only the logged format: 12 lowercase hex digits", () => {
    expect(isV2Reference("0123456789ab")).toBe(true)
    for (const value of ["0123456789AB", "0123456789a", "0123456789abc", "call-5550100", " 0123456789ab", PHISHING, 123456789012]) {
      expect(isV2Reference(value), String(value)).toBe(false)
    }
  })

  it("names a reference after the copy, and drops anything else", () => {
    expect(v2ErrorMessage("unexpected", "0123456789ab")).toBe(`${GENERIC} Reference: 0123456789ab.`)
    expect(v2ErrorMessage("unexpected", "541-555-0100")).toBe(GENERIC)
    expect(withV2Reference("Your trucks could not be loaded.", "0123456789ab")).toBe("Your trucks could not be loaded. Reference: 0123456789ab.")
    expect(withV2Reference("Your trucks could not be loaded.", null)).toBe("Your trucks could not be loaded.")
  })

  it("shows a Next.js digest on the error boundary, never anything else", () => {
    expect(v2ErrorBoundaryMessage("1234567890")).toBe(`${GENERIC} Reference: 1234567890.`)
    expect(v2ErrorBoundaryMessage(undefined)).toBe(GENERIC)
    expect(v2ErrorBoundaryMessage(PHISHING)).toBe(GENERIC)
    expect(v2ErrorBoundaryMessage(MARKUP)).toBe(GENERIC)
  })
})

describe("a page's query (C2 regression: injected text is never shown)", () => {
  it("is no notice without ?error=", () => {
    expect(v2ErrorNotice({})).toBeNull()
    expect(v2ErrorNotice({ error: "" })).toBeNull()
    expect(v2ErrorNotice({ sent: "1" })).toBeNull()
  })

  it("shows a known code's copy", () => {
    expect(v2ErrorNotice({ error: "inquiry_not_found" })).toEqual({
      code: "inquiry_not_found",
      message: "Inquiry not found. It may have been removed, or it may belong to another business."
    })
  })

  it.each([
    ["free text", { error: PHISHING }],
    ["markup", { error: MARKUP }],
    ["a code with text after it", { error: `job_closed ${PHISHING}` }],
    ["an encoded code", { error: "job%5Fclosed" }],
    ["text in the reference", { error: PHISHING, ref: PHISHING }]
  ])("shows the generic copy, and none of the URL's text, for %s", (_label, query) => {
    const notice = v2ErrorNotice(query)

    expect(notice).toEqual({ code: V2_GENERIC_ERROR, message: GENERIC })
    expect(notice?.message).not.toContain("541")
    expect(notice?.message).not.toContain("<img")
  })

  it("reads the first of a repeated value, and only as a code", () => {
    expect(v2ErrorNotice({ error: ["job_closed", PHISHING] })?.code).toBe("job_closed")
    expect(v2ErrorNotice({ error: [PHISHING, "job_closed"] })).toEqual({ code: V2_GENERIC_ERROR, message: GENERIC })
  })

  it("adds a well-formed reference", () => {
    expect(v2ErrorNotice({ error: "unexpected", ref: "0123456789ab" })?.message).toBe(`${GENERIC} Reference: 0123456789ab.`)
  })
})

describe("an action's redirect query", () => {
  it("carries the code, and the request id only when the failure was logged", () => {
    expect(v2ErrorQuery({ code: "job_closed", requestId: null })).toEqual({ error: "job_closed" })
    expect(v2ErrorQuery({ code: "unexpected", requestId: "0123456789ab" })).toEqual({ error: "unexpected", ref: "0123456789ab" })
    expect(v2ErrorQuery({ code: "unexpected", requestId: PHISHING })).toEqual({ error: "unexpected" })
  })
})

describe("every V2 page reads ?error= only through v2ErrorNotice", () => {
  const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url))
  const V2_APP = join(WEB_ROOT, "app", "v2")

  function pages(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? pages(path) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
    })
  }

  it("finds the V2 routes", () => {
    expect(pages(V2_APP).length).toBeGreaterThan(15)
  })

  it.each(pages(V2_APP).map((path) => [relative(WEB_ROOT, path).split(sep).join("/"), path]))("%s", (_name, path) => {
    const source = readFileSync(path, "utf8")

    // A page that renders a URL parameter as words is the phishing vector C2 closed: no `query.error`, `params.error`,
    // `query.message` or `searchParams.get("error")` outside the helpers that turn codes into fixed copy.
    expect(source).not.toMatch(/\b(?:query|params|search|searchParams)\s*(?:\.\s*|\[\s*["'])(?:error|message)\b/)
    expect(source).not.toMatch(/\.get\(\s*["'](?:error|message)["']\s*\)/)
  })
})
