"use client"

import Link from "next/link"
import { useRef, useState, useTransition, type FormEvent } from "react"
import { Icon } from "@logloads/ui"

import { askAssistantAction } from "@/lib/assistant-actions"
import { AppShell, SectionHeader, type ShellAccount } from "./Shells"

type AssistantRole = "driver" | "fleet" | "host" | "admin"

interface Exchange {
  id: string
  question: string
  answer: string
  citations: Array<{ label: string; href: string }>
  error: boolean
  resolved: boolean
}

const TITLE_BY_ROLE: Record<AssistantRole, { title: string; kicker: string }> = {
  admin: { title: "Assistant", kicker: "Ask operations" },
  driver: { title: "Assistant", kicker: "Ask operations" },
  fleet: { title: "Assistant", kicker: "Ask operations" },
  host: { title: "Assistant", kicker: "Ask operations" }
}

export function AssistantPage({
  account,
  role,
  intro,
  suggestions
}: {
  account: ShellAccount
  role: AssistantRole
  intro: string
  suggestions: string[]
}) {
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [draft, setDraft] = useState("")
  const [pending, startTransition] = useTransition()
  const counter = useRef(0)
  const chrome = TITLE_BY_ROLE[role]

  const ask = (raw: string) => {
    const question = raw.trim()

    if (!question || pending) {
      return
    }

    setDraft("")
    const id = `x${(counter.current += 1)}`
    setExchanges((prev) => [...prev, { answer: "", citations: [], error: false, id, question, resolved: false }])

    startTransition(async () => {
      try {
        const result = await askAssistantAction({ question, role })

        setExchanges((prev) =>
          prev.map((exchange) =>
            exchange.id === id
              ? {
                  ...exchange,
                  answer: result.ok ? result.answer ?? "" : result.error ?? "Something went wrong. Try again.",
                  citations: result.citations ?? [],
                  error: !result.ok,
                  resolved: true
                }
              : exchange
          )
        )
      } catch {
        // A transport-level rejection (offline, mid-deploy) still resolves the
        // bubble instead of leaving it stuck on "Thinking…".
        setExchanges((prev) =>
          prev.map((exchange) =>
            exchange.id === id
              ? { ...exchange, answer: "I couldn't reach the assistant just now. Check your connection and try again.", error: true, resolved: true }
              : exchange
          )
        )
      }
    })
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    ask(draft)
  }

  return (
    <AppShell account={account} kicker={chrome.kicker} role={role} title={chrome.title}>
      <section className="app-section assistant-panel">
        <div className="assistant-intro">
          <span className="assistant-avatar" aria-hidden>
            <Icon name="action.search" size={20} />
          </span>
          <p>{intro}</p>
        </div>

        {exchanges.length === 0 ? (
          <div className="assistant-suggestions">
            <SectionHeader eyebrow="Starters" title="Ask me anything about your operation" />
            <div className="assistant-chips">
              {suggestions.map((suggestion) => (
                <button className="assistant-chip" key={suggestion} onClick={() => ask(suggestion)} type="button">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="assistant-stream">
            {exchanges.map((exchange) => (
              <li className="assistant-exchange" key={exchange.id}>
                <p className="assistant-msg assistant-msg--you">{exchange.question}</p>
                <div className={`assistant-msg assistant-msg--bot${exchange.error ? " is-error" : ""}`}>
                  {exchange.resolved ? (
                    <p className="assistant-answer">{exchange.answer}</p>
                  ) : (
                    <span className="assistant-typing">Thinking…</span>
                  )}
                  {exchange.citations.length > 0 ? (
                    <div className="assistant-cites">
                      {exchange.citations.map((citation, index) => (
                        <Link className="assistant-cite" href={citation.href} key={`${citation.href}-${citation.label}-${index}`}>
                          {citation.label}
                          <Icon aria-hidden name="map.route" size={13} />
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}

        <form className="assistant-composer" onSubmit={submit}>
          <input
            aria-label="Ask the assistant"
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Ask about your loads, trips, or alerts…"
            value={draft}
          />
          <button className="advance-button" disabled={pending || draft.trim().length === 0} type="submit">
            <Icon aria-hidden name="action.request" size={18} />
            Ask
          </button>
        </form>
        <p className="assistant-note">Answers come from what&apos;s live in your workspace. Double-check before acting on anything time-sensitive.</p>
      </section>
    </AppShell>
  )
}
