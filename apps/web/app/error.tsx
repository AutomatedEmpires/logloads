"use client"

import Link from "next/link"

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="error-state">
      <div className="error-state__panel">
        <span className="brand-mark">LL</span>
        <p className="eyebrow">LogLoads</p>
        <h1>Something went wrong.</h1>
        <p>Your work is still here. This screen hit a problem while loading — try it again, and if it keeps happening, head back to your cockpit.</p>
        <div className="error-state__actions">
          <button className="action-link" onClick={reset} type="button">Try again</button>
          <Link className="action-link action-link--secondary" href="/">Go home</Link>
        </div>
      </div>
    </main>
  )
}
