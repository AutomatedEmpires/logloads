import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ChoiceCard } from "./ChoiceCard"
import { openingTag, textOf } from "./test-helpers"

describe("ChoiceCard (DS-03)", () => {
  const html = renderToStaticMarkup(
    <fieldset>
      <legend>Who is hauling</legend>
      <ChoiceCard checked={false} description="I own and run my own truck or trucks." name="btype" onChange={() => undefined} title="Just me" value="me" />
      <ChoiceCard checked description="Several trucks, or office staff who help find work." name="btype" onChange={() => undefined} title="A hauling company" value="company" />
    </fieldset>
  )

  it("puts a native radio inside each card label", () => {
    expect(html.match(/<label [^>]*><input [^>]*type="radio"/g)).toHaveLength(2)
    expect(openingTag(html, /value="me"/)).toContain('name="btype"')
    expect(openingTag(html, /value="me"/)).not.toMatch(/\schecked[\s=>]/)
    expect(openingTag(html, /value="company"/)).toMatch(/\schecked=""/)
  })

  it("names each radio by its title and describes it by its description", () => {
    const input = openingTag(html, /value="company"/)
    const titleId = input.match(/aria-labelledby="([^"]+)"/)?.[1]
    const descriptionId = input.match(/aria-describedby="([^"]+)"/)?.[1]

    expect(titleId).toBeTruthy()
    expect(descriptionId).toBeTruthy()
    expect(html).toContain(`id="${titleId}">A hauling company</span>`)
    expect(html).toContain(`id="${descriptionId}">Several trucks, or office staff who help find work.</span>`)
  })

  it("renders only the given text", () => {
    expect(textOf(html)).toBe("Who is hauling Just me I own and run my own truck or trucks. A hauling company Several trucks, or office staff who help find work.")
  })
})
