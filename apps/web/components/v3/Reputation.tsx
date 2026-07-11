"use client"

import { useState, useTransition } from "react"
import { Badge, Icon } from "@logloads/ui"
import { reputationTone, reviewTagLabel, type ReviewTag } from "@logloads/contracts"

import { submitTripReviewAction } from "@/lib/cockpit-actions"
import type { OrgReputationView } from "@/lib/network"

export function ReputationChip({ reputation }: { reputation: OrgReputationView }) {
  if (!reputation) {
    return null
  }

  return (
    <span className="reputation-chip">
      <Badge tone={reputationTone(reputation.band)}>★ {reputation.label}</Badge>
    </span>
  )
}

type Direction = "host_rates_hauler" | "hauler_rates_host"

const TAGS_BY_DIRECTION: Record<Direction, ReviewTag[]> = {
  host_rates_hauler: ["on_time", "professional", "accurate_load", "safe", "good_communication", "late", "inaccurate_load"],
  hauler_rates_host: ["clear_instructions", "easy_access", "good_communication", "on_time", "access_issues", "poor_communication", "unsafe_access"]
}

export function TripReviewForm({
  tripId,
  direction,
  counterpartyName
}: {
  tripId: string
  direction: Direction
  counterpartyName: string
}) {
  const [stars, setStars] = useState(0)
  const [tags, setTags] = useState<Set<ReviewTag>>(new Set())
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  const toggleTag = (tag: ReviewTag) => {
    setTags((current) => {
      const next = new Set(current)
      if (next.has(tag)) {
        next.delete(tag)
      } else if (next.size < 6) {
        next.add(tag)
      }
      return next
    })
  }

  const submit = () => {
    if (stars < 1) {
      setError("Pick a star rating first.")
      return
    }

    setError(null)
    startTransition(async () => {
      try {
        const result = await submitTripReviewAction({
          direction,
          note: note.trim() || null,
          stars,
          tags: [...tags],
          tripId
        })

        if (!result.ok) {
          setError(result.error ?? "That couldn't be submitted. Try again.")
        } else {
          setDone(true)
        }
      } catch {
        setError("That couldn't be submitted. Check your connection and try again.")
      }
    })
  }

  if (done) {
    return (
      <p className="review-done">
        <Icon aria-hidden name="status.verified" size={16} /> Thanks — your review of {counterpartyName} is in.
      </p>
    )
  }

  return (
    <div className="review-form">
      <p className="review-form__prompt">How was working with {counterpartyName}?</p>
      <div aria-label="Star rating" className="review-stars" role="radiogroup">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            aria-checked={stars === value}
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
            className={value <= stars ? "review-star is-on" : "review-star"}
            key={value}
            onClick={() => setStars(value)}
            role="radio"
            type="button"
          >
            {value <= stars ? "★" : "☆"}
          </button>
        ))}
      </div>
      <div className="review-tags">
        {TAGS_BY_DIRECTION[direction].map((tag) => (
          <button
            aria-pressed={tags.has(tag)}
            className={tags.has(tag) ? "review-tag is-on" : "review-tag"}
            key={tag}
            onClick={() => toggleTag(tag)}
            type="button"
          >
            {reviewTagLabel(tag)}
          </button>
        ))}
      </div>
      <textarea
        aria-label="Review note"
        className="review-note"
        maxLength={1000}
        onChange={(event) => setNote(event.currentTarget.value)}
        placeholder="Add a note (optional)"
        rows={2}
        value={note}
      />
      <div className="review-form__actions">
        <button className="advance-button" disabled={pending} onClick={submit} type="button">
          {pending ? "Sending…" : "Submit review"}
        </button>
      </div>
      {error ? <p className="action-error">{error}</p> : null}
    </div>
  )
}
