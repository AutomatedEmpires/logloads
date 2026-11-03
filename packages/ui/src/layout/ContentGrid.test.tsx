import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ContentGrid } from "./ContentGrid"
import type { ContentGridProps } from "./types"

function grid(props: Omit<ContentGridProps, "main">) {
  return renderToStaticMarkup(<ContentGrid main={<p>Main</p>} {...props} />)
}

function rootAttributes(html: string) {
  const tag = /^<div [^>]*>/.exec(html)?.[0] ?? ""
  return {
    detail: /data-detail="([^"]+)"/.exec(tag)?.[1],
    layout: /data-layout="([^"]+)"/.exec(tag)?.[1]
  }
}

describe("ContentGrid", () => {
  it.each([
    ["single", undefined],
    ["main-aside", undefined],
    ["split", undefined]
  ] as const)("sets data-layout=%s with no detail state", (layout, detail) => {
    expect(rootAttributes(grid({ aside: <p>Aside</p>, layout }))).toEqual({ detail, layout })
  })

  it("reports the list-detail panel as closed or open", () => {
    expect(rootAttributes(grid({ layout: "list-detail" }))).toEqual({ detail: "closed", layout: "list-detail" })
    expect(rootAttributes(grid({ detailOpen: true, layout: "list-detail" }))).toEqual({ detail: "open", layout: "list-detail" })
  })

  it("places a list-detail aside directly in the grid and wraps other asides in a column", () => {
    const listDetail = grid({ aside: <aside>Panel</aside>, detailOpen: true, layout: "list-detail" })
    const mainAside = grid({ aside: <p>Aside</p>, layout: "main-aside" })

    expect(listDetail).toMatch(/^<div [^>]*><div [^>]*><p>Main<\/p><\/div><aside>Panel<\/aside><\/div>$/)
    expect(mainAside).toMatch(/^<div [^>]*><div [^>]*><p>Main<\/p><\/div><div [^>]*><p>Aside<\/p><\/div><\/div>$/)
  })

  it("renders only the main column without an aside", () => {
    expect(grid({ layout: "single" })).toMatch(/^<div [^>]*><div [^>]*><p>Main<\/p><\/div><\/div>$/)
  })
})
