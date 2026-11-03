import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Button } from "./Button"
import { Dialog } from "./Dialog"
import { openingTag, textOf } from "./test-helpers"

// Server markup only. showModal(), Escape and focus return need a browser; see the DS-03 PR evidence.
describe("Dialog (DS-03)", () => {
  it("renders a closed native dialog that carries ll-theme and no content", () => {
    const html = renderToStaticMarkup(
      <Dialog onClose={() => undefined} open={false} title="Interest in Oak saw logs">
        <p>Body</p>
      </Dialog>
    )

    const dialog = openingTag(html, /^<dialog/)
    expect(dialog).toMatch(/class="ll-theme \S+/)
    expect(dialog).not.toMatch(/\sopen[\s=>]/)
    expect(textOf(html)).toBe("")
  })

  it("names the open dialog by its title and renders body, footer and a Close button", () => {
    const html = renderToStaticMarkup(
      <Dialog footer={<Button label="Send interest" />} onClose={() => undefined} open size="wide" title="Interest in Oak saw logs">
        <p>Free and nonbinding.</p>
      </Dialog>
    )

    const dialog = openingTag(html, /^<dialog/)
    const labelledBy = dialog.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(openingTag(html, /^<h2/)).toContain(`id="${labelledBy}"`)
    expect(dialog).toContain('data-size="wide"')
    // The open attribute is never rendered: showModal() opens it on the client, which a server-rendered `open` would skip.
    expect(dialog).not.toMatch(/\sopen[\s=>]/)
    expect(textOf(html)).toBe("Interest in Oak saw logs Close Free and nonbinding. Send interest")
  })

  it("defaults to the default size", () => {
    const html = renderToStaticMarkup(
      <Dialog onClose={() => undefined} open title="Job details">
        <p>Body</p>
      </Dialog>
    )

    expect(openingTag(html, /^<dialog/)).toContain('data-size="default"')
  })
})
