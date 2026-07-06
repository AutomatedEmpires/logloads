"use client"

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-state"><h1>Something went wrong.</h1><p>Your work is still here. Try loading this screen again.</p><button onClick={reset} type="button">Try again</button></main>
}
