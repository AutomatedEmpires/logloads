"use client"

import Link from "next/link"

import { BrandMark } from "@/components/v3/Brand"

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="error-state">
      <div className="error-state__panel">
        <BrandMark priority size={72} />
        <p className="eyebrow">LogLoads</p>
        <h1>Something went wrong.</h1>
        <p>We couldn&rsquo;t load this screen. Try it again, and if the problem continues, return to your workspace and report the issue.</p>
        <div className="error-state__actions">
          <button className="action-link" onClick={reset} type="button">Try again</button>
          <Link className="action-link action-link--secondary" href="/">Go home</Link>
        </div>
      </div>
    </main>
  )
}
