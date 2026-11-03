import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Button } from "../primitives/Button"
import { openingTag, textOf } from "../primitives/test-helpers"
import { CompanyProfileHeader } from "./CompanyProfileHeader"
import { EquipmentCapacity, MAX_CAPACITY_MARKS } from "./EquipmentCapacity"
import { OperatingRegion } from "./OperatingRegion"

const marks = (html: string) => html.match(/data-on/g)?.length ?? 0

describe("EquipmentCapacity: unknown capacity is never zero", () => {
  it("shows a known count of the units listed", () => {
    const html = renderToStaticMarkup(<EquipmentCapacity available={2} state="known" units={3} />)

    expect(textOf(html)).toBe("2 of 3 available")
    expect(marks(html)).toBe(2)
  })

  it.each([
    ["unknown state", { available: 0, state: "unknown" as const }],
    ["unknown state, no count", { available: null, state: "unknown" as const }],
    ["known state, no count", { available: null, state: "known" as const }]
  ])("%s says not recently confirmed, never 0 available", (_, props) => {
    const html = renderToStaticMarkup(<EquipmentCapacity {...props} units={3} />)

    expect(textOf(html)).toBe("3 units · availability not recently confirmed")
    expect(textOf(html)).not.toMatch(/\b0 (of \d+ )?available/)
    expect(openingTag(html, /data-state=/)).toContain('data-state="unknown"')
    expect(marks(html)).toBe(0)
  })

  it("never claims more available than listed, and caps the drawn marks", () => {
    expect(textOf(renderToStaticMarkup(<EquipmentCapacity available={9} state="known" units={4} />))).toBe("4 of 4 available")

    const fleet = renderToStaticMarkup(<EquipmentCapacity available={30} state="known" units={40} />)
    expect(textOf(fleet)).toBe("30 of 40 available")
    expect(fleet.match(/<span class="[^"]*mark[^"]*"/g)?.length).toBe(MAX_CAPACITY_MARKS)
  })

  it("keeps the marks out of the accessibility tree", () => {
    expect(openingTag(renderToStaticMarkup(<EquipmentCapacity available={1} state="known" units={2} />), /aria-hidden/)).toContain('aria-hidden="true"')
  })
})

describe("OperatingRegion", () => {
  it("lists home base, areas and range", () => {
    expect(textOf(renderToStaticMarkup(<OperatingRegion areas={["Lane", "Linn"]} homeBase="Riverton, OR" radiusMiles={120} />))).toBe(
      "Home base: Riverton, OR Lane, Linn Up to 120 miles"
    )
  })

  it("says the range is not stated instead of drawing one", () => {
    const html = renderToStaticMarkup(<OperatingRegion areas={[]} homeBase="Riverton, OR" radiusMiles={null} />)

    expect(textOf(html)).toBe("Home base: Riverton, OR Travel distance not stated")
    expect(html).not.toContain("data-known")
  })
})

describe("CompanyProfileHeader", () => {
  const business = { homeRegion: "Riverton, OR", initials: "EH", kind: "Hauling company", name: "Example Hauling LLC", since: 2011 }

  it("shows initials, the scoped verification, up to four figures and the page's actions", () => {
    const html = renderToStaticMarkup(
      <CompanyProfileHeader
        actionNote="Invitations are not available yet"
        actions={<Button label="Save" variant="secondary" />}
        breadcrumbs={[{ href: "/v2/landing", label: "Find trucks" }, { label: "Hauling businesses" }]}
        business={business}
        figures={[
          { label: "trucks listed", value: "4" },
          { label: "available", value: "2" },
          { label: "around Riverton", value: "120 mi" },
          { label: "products", value: "3" },
          { label: "ignored fifth figure", value: "9" }
        ]}
        verification={{ reviewedOn: "2026-10-05", scope: "business_identity" }}
      />
    )
    const text = textOf(html)

    expect(openingTag(html, /^<h1/)).toBeTruthy()
    expect(text).toContain("EH Example Hauling LLC Hauling company Riverton, OR Hauling since 2011 Business identity verified · Oct 2026")
    expect(text).toContain("Save Invitations are not available yet")
    expect(html.match(/<dt/g)).toHaveLength(4)
    expect(text).not.toContain("ignored fifth figure")
    expect(html).not.toContain("<img")
  })

  it("shows a real logo as decoration and no mark without a verification record", () => {
    const html = renderToStaticMarkup(
      <CompanyProfileHeader actions={null} business={{ ...business, logoUrl: "/logo.png" }} figures={[]} verification={null} />
    )

    expect(openingTag(html, /^<img/)).toContain('alt=""')
    expect(textOf(html)).not.toContain("verified")
    expect(html).not.toContain("<dl")
  })
})
