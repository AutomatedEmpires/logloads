import { MARKETPLACE_EQUIPMENT_TYPES } from "@logloads/contracts"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { openingTag, textOf } from "../primitives/test-helpers"
import { AvailabilityStatus } from "./AvailabilityStatus"
import { EquipmentRequirement } from "./EquipmentRequirement"
import { jobAvailabilityStatus } from "./format"
import { PayFigure } from "./PayFigure"
import { SponsoredIndicator } from "./SponsoredIndicator"
import { jobCard, NOW } from "./test-fixtures"
import { VerificationIndicator } from "./VerificationIndicator"

describe("PayFigure (V2-DEC-02)", () => {
  it("shows a per-load rate with its basis", () => {
    const html = renderToStaticMarkup(<PayFigure pay={{ amountCents: 52_500, note: null, unit: "per_load" }} />)

    expect(openingTag(html, /data-kind=/)).toContain('data-kind="rate"')
    expect(openingTag(html, /data-kind=/)).toContain('data-size="md"')
    expect(openingTag(html, /data-part="amount"/)).toBeTruthy()
    expect(textOf(html)).toBe("$525.00 per load")
  })

  it("shows Negotiable with the poster's note as the basis", () => {
    const html = renderToStaticMarkup(<PayFigure pay={{ amountCents: null, note: "depends on haul length", unit: "negotiable" }} size="lg" />)

    expect(openingTag(html, /data-kind=/)).toContain('data-kind="negotiable"')
    expect(html).toMatch(/data-part="amount"[^>]*>Negotiable</)
    expect(html).toMatch(/data-part="basis"[^>]*>depends on haul length</)
  })

  it("says pay is not stated rather than showing a figure", () => {
    const html = renderToStaticMarkup(<PayFigure pay={{ amountCents: null, note: null, unit: null }} size="sm" />)

    expect(openingTag(html, /data-kind=/)).toContain('data-kind="unstated"')
    expect(textOf(html)).toBe("Pay not stated")
    expect(html).not.toContain('data-part="basis"')
    expect(html).not.toMatch(/\$\d/)
  })
})

describe("VerificationIndicator (Gate 5, #150)", () => {
  it("names the verified scope and the review month", () => {
    const html = renderToStaticMarkup(<VerificationIndicator verification={{ reviewedOn: "2026-10-05", scope: "business_identity" }} />)

    expect(textOf(html)).toBe("Business identity verified · Oct 2026")
    expect(openingTag(html, /title=/)).toContain('title="Business identity reviewed by LogLoads on Oct 5, 2026."')
    expect(html).toContain('aria-hidden="true"')
  })

  it("names the scope without a date when no review date is on record", () => {
    expect(textOf(renderToStaticMarkup(<VerificationIndicator verification={{ reviewedOn: null, scope: "business_identity" }} />))).toBe(
      "Business identity verified"
    )
  })

  it("never shows a generic Verified", () => {
    const text = textOf(renderToStaticMarkup(<VerificationIndicator verification={{ reviewedOn: null, scope: "business_identity" }} />))

    expect(text).not.toMatch(/^Verified/)
    expect(text).not.toBe("Business verified")
  })

  it("renders nothing for null", () => {
    expect(renderToStaticMarkup(<VerificationIndicator verification={null} />)).toBe("")
  })
})

describe("AvailabilityStatus (V2-DEC-03)", () => {
  it("never says Confirmed without lastConfirmedAt", () => {
    for (const lastModifiedAt of [NOW, "2026-10-01T00:00:00.000Z"]) {
      const html = renderToStaticMarkup(<AvailabilityStatus {...jobAvailabilityStatus(jobCard({ lastConfirmedAt: null, lastModifiedAt }), NOW)} />)

      expect(openingTag(html, /data-state=/)).toContain('data-state="unconfirmed"')
      expect(textOf(html)).toMatch(/^Not confirmed by poster/)
      expect(textOf(html)).not.toMatch(/\b(Poster confirmed|Last confirmed|Confirmed)\b/)
    }
  })

  it("says confirmed only from the poster's confirmation", () => {
    const html = renderToStaticMarkup(<AvailabilityStatus {...jobAvailabilityStatus(jobCard({ lastConfirmedAt: NOW }), NOW)} />)

    expect(openingTag(html, /data-state=/)).toContain('data-state="confirmed"')
    expect(textOf(html)).toBe("Poster confirmed available today")
  })

  it("always carries words, never colour alone", () => {
    for (const state of ["confirmed", "aging", "stale", "unconfirmed", "unknown"] as const) {
      expect(textOf(renderToStaticMarkup(<AvailabilityStatus label="Label" state={state} />))).toBe("Label")
    }
  })
})

describe("EquipmentRequirement", () => {
  it("shows contract labels, never raw codes", () => {
    const codes = MARKETPLACE_EQUIPMENT_TYPES.map((type) => type.code)
    const html = renderToStaticMarkup(<EquipmentRequirement codes={codes} />)

    for (const type of MARKETPLACE_EQUIPMENT_TYPES) {
      expect(textOf(html)).toContain(type.label)
      expect(textOf(html)).not.toMatch(new RegExp(`\\b${type.code}\\b`))
    }
    expect(textOf(html)).not.toContain("_")
  })

  it("says when the poster stated no equipment", () => {
    expect(textOf(renderToStaticMarkup(<EquipmentRequirement codes={[]} />))).toBe("Equipment not stated")
  })

  it("adds the fit hint only when the page supplies one", () => {
    expect(textOf(renderToStaticMarkup(<EquipmentRequirement codes={["chip_truck"]} fit="fits" />))).toBe("Chip truck Fits your trucks")
    expect(textOf(renderToStaticMarkup(<EquipmentRequirement codes={["chip_truck"]} fit="not_in_setups" />))).toBe("Chip truck Not in your setups")
    expect(renderToStaticMarkup(<EquipmentRequirement codes={["chip_truck"]} />)).not.toContain("data-fit")
  })
})

describe("SponsoredIndicator", () => {
  it("uses the one wording", () => {
    expect(textOf(renderToStaticMarkup(<SponsoredIndicator />))).toBe("Sponsored")
  })
})
