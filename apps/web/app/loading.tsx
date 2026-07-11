export default function Loading() {
  return (
    <main aria-busy className="route-skeleton" role="status">
      <span className="sr-only">Loading</span>
      <div className="route-skeleton__brand">
        <span className="brand-mark">LL</span>
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
