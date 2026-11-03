import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PageActions } from "./PageActions"
import { PageContainer } from "./PageContainer"
import { PageHeader } from "./PageHeader"
import { Section } from "./Section"

describe("Section", () => {
  it.each(["surface", "open", "flush"] as const)("renders the %s variant", (variant) => {
    const html = renderToStaticMarkup(<Section title="Your jobs" variant={variant}><p>Body</p></Section>)

    expect(html).toMatch(new RegExp(`^<section aria-label="Your jobs"[^>]* data-variant="${variant}"`))
  })

  it("defaults to the surface variant with an h2 heading", () => {
    const html = renderToStaticMarkup(<Section title="Equipment"><p>Body</p></Section>)

    expect(html).toContain('data-variant="surface"')
    expect(html).toMatch(/<h2 [^>]*>Equipment<\/h2>/)
  })

  it("uses an h3 when asked and renders description and actions in the head", () => {
    const html = renderToStaticMarkup(
      <Section actions={<button type="button">Edit</button>} description="Shown to landings." headingLevel={3} title="Profile">
        <p>Body</p>
      </Section>
    )

    expect(html).toMatch(/<h3 [^>]*>Profile<\/h3><div [^>]*>Shown to landings\.<\/div><\/div><button type="button">Edit<\/button>/)
  })

  it("is an unnamed container without a title", () => {
    const html = renderToStaticMarkup(<Section variant="open"><p>Body</p></Section>)

    expect(html).not.toContain("aria-label")
    expect(html).not.toMatch(/<h[23]/)
    expect(html).toMatch(/^<section [^>]*><p>Body<\/p><\/section>$/)
  })
})

describe("PageHeader, PageActions and PageContainer", () => {
  it("renders the title as the page's h1 with breadcrumbs, meta, actions, slot and tabs", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        actions={<PageActions><button type="button">Post a job</button></PageActions>}
        breadcrumbs={[{ href: "/v2/landing/jobs", label: "Jobs" }, { label: "New job" }]}
        description="Real jobs from landing operators."
        meta={<span>Active</span>}
        tabs={<nav aria-label="Job tabs" />}
        title="Find hauling work"
      >
        <form role="search" />
      </PageHeader>
    )

    expect(html).toMatch(/^<header [^>]*data-tabs=""/)
    expect(html).toMatch(/<nav aria-label="Breadcrumb"><ol [^>]*><li><a href="\/v2\/landing\/jobs">Jobs<\/a><\/li><li><span aria-current="page">New job<\/span><\/li><\/ol><\/nav>/)
    expect(html).toMatch(/<h1 [^>]*>Find hauling work<\/h1>/)
    expect(html).toContain("<span>Active</span>")
    expect(html).toContain('<button type="button">Post a job</button>')
    expect(html).toContain('<form role="search"></form>')
    expect(html).toContain('<nav aria-label="Job tabs"></nav>')
  })

  it("omits empty header parts", () => {
    const html = renderToStaticMarkup(<PageHeader title="Inbox" />)

    expect(html).not.toContain("data-tabs")
    expect(html).not.toContain("Breadcrumb")
    expect(html).toMatch(/^<header [^>]*><div [^>]*><div [^>]*><h1 [^>]*>Inbox<\/h1><\/div><\/div><\/header>$/)
  })

  it("marks the narrow page container", () => {
    expect(renderToStaticMarkup(<PageContainer width="narrow">x</PageContainer>)).toContain('data-width="narrow"')
    expect(renderToStaticMarkup(<PageContainer>x</PageContainer>)).not.toContain("data-width")
  })
})
