import { BrandMark } from "@/components/v3/Brand"

/**
 * The branded loading skeleton of the legacy signed-in workspaces. A route segment opts in with its own
 * `loading.tsx`; there is deliberately none at the app root (#174).
 *
 * A `loading.tsx` makes Next.js wrap the segment in a Suspense boundary: a dynamic page then arrives as this
 * skeleton plus a hidden segment that only React's inline script reveals, so a visitor without JavaScript sees the
 * skeleton and nothing else. That is accepted for the pilot workspaces (/host, /fleet, /driver, /admin), which the
 * no-JavaScript rule does not cover. It is not for the V2 pages (UX spec §7) or the public server-rendered pages,
 * which must show their content and work without JavaScript, so no loading boundary sits above them.
 */
export function RouteSkeleton() {
  return (
    <main aria-busy className="route-skeleton" role="status">
      <span className="sr-only">Loading</span>
      <div className="route-skeleton__brand">
        <BrandMark priority size={64} />
      </div>
      <div className="route-skeleton__bar route-skeleton__bar--title" />
      <div className="route-skeleton__row">
        <div className="route-skeleton__bar" />
        <div className="route-skeleton__bar" />
        <div className="route-skeleton__bar" />
      </div>
      <div className="route-skeleton__panel" />
      <div className="route-skeleton__panel route-skeleton__panel--short" />
    </main>
  )
}
