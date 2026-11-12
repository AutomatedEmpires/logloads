import React, { isValidElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #279 (design audit 1, C1): the V2 error boundary. An uncaught failure stays inside the V2 shell and shows plain words,
 * Try again and Find work, and the request id, never the error's own message.
 */

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { ErrorState } from "@logloads/ui/primitives"

import MarketplaceV2Error from "@/app/v2/error"

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
