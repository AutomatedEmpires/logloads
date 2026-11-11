import React, { isValidElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #279 (design audit 1, C1): the V2 loading and error boundaries. A client navigation shows the design system's
 * skeleton inside the V2 shell; an uncaught failure shows plain words, Try again and Find work, and the request id,
 * never the error's own message.
 */

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { ErrorState } from "@logloads/ui/primitives"

import MarketplaceV2Error from "@/app/v2/error"
import MarketplaceV2Loading from "@/app/v2/loading"
import JobDetailLoading from "@/app/v2/work/[jobId]/loading"

const PERSONAL = "maya@northpine.example"
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim()

function elements(node: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found)
  } else if (isValidElement(node)) {
    found.push(node)
    for (const value of Object.values(node.props as Record<string, unknown>)) elements(value, found)
  }
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
  // The app compiles JSX with the classic runtime under Vitest, as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
})

describe("loading (C1)", () => {
  it("shows the design system's row skeleton, announced once, with no example data", () => {
    const html = renderToStaticMarkup(<MarketplaceV2Loading />)

    expect(html).toContain('data-ds-page="loading"')
    expect(html.match(/role="status"/g)).toHaveLength(1)
    expect(textOf(html)).toBe("Loading the page")
    expect(html).toMatch(/<div aria-hidden="true"[^>]*>/)
  })

  it("shows the job page's detail skeleton, and announces only the main column", () => {
    const html = renderToStaticMarkup(<JobDetailLoading />)

    expect(html).toContain('data-kind="detail"')
    expect(html).toContain('data-layout="main-aside"')
    expect(html.match(/role="status"/g)).toHaveLength(2)
    // The aside's status sits inside an aria-hidden placeholder, so assistive technology hears "Loading the job" once.
    expect(html).toMatch(/<div aria-hidden="true"[^>]*data-kind="rows"[^>]*>[\s\S]*Loading the interest form/)
    expect(textOf(html)).toContain("Loading the job")
  })
})

describe("the error boundary (C1, C3)", () => {
  function error(message: string, digest?: string): Error & { digest?: string } {
    return Object.assign(new Error(message), digest === undefined ? {} : { digest })
  }

  it("says plainly what happened, with Try again, Find work and the reference, inside the V2 page structure", () => {
    const html = renderToStaticMarkup(<MarketplaceV2Error error={error(`Key (email)=(${PERSONAL}) already exists`, "2187693415")} reset={() => undefined} />)
    const text = textOf(html)

    expect(html).toContain('data-ds-page="error"')
    expect(html).toMatch(/<h1[^>]*>Something went wrong<\/h1>/)
    expect(html).toMatch(/role="alert"/)
    expect(text).toContain("This page couldn't load")
    expect(text).toContain("Something went wrong on our side. Try again in a moment. Reference: 2187693415.")
    expect(html).toMatch(/<button[^>]*>[\s\S]*Try again/)
    expect(html).toMatch(/<a[^>]*href="\/v2\/work"[^>]*>[\s\S]*Go to Find work/)
    expect(html).not.toContain(PERSONAL)
    expect(html).not.toContain("already exists")
  })

  it("shows no reference without a digest, and never one that is not a digest", () => {
    expect(textOf(renderToStaticMarkup(<MarketplaceV2Error error={error("raw")} reset={() => undefined} />))).not.toContain("Reference")

    const forged = renderToStaticMarkup(<MarketplaceV2Error error={error("raw", `Call ${PERSONAL}`)} reset={() => undefined} />)
    expect(textOf(forged)).not.toContain("Reference")
    expect(forged).not.toContain(PERSONAL)
  })

  it("tries again with a fresh server render of the same page", () => {
    const reset = vi.fn()
    const tree = MarketplaceV2Error({ error: error("raw", "1"), reset })
    const retry = elements(tree).find((element) => element.type === ErrorState)?.props as { retry?: () => void } | undefined

    expect(retry?.retry).toBeTypeOf("function")
    retry?.retry?.()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(reset).toHaveBeenCalledOnce()
  })
})
