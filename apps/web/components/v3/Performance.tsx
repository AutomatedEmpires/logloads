"use client"

import { Badge } from "@logloads/ui"

import type { PerformanceView } from "@/lib/reliability-data"
import { AppShell, EmptyState, SectionHeader, type ShellAccount } from "./Shells"

export function PerformancePage({
  account,
  role,
  view
}: {
  account: ShellAccount
  role: "fleet" | "host" | "admin"
  view: PerformanceView
}) {
  return (
    <AppShell account={account} kicker={view.eyebrow} role={role} title={view.title}>
      <section className="app-section">
        <div className="perf-stats">
          {view.stats.map((stat) => (
            <div className={`metric-tile perf-stat perf-stat--${stat.tone}`} key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="app-section">
        <SectionHeader eyebrow="Track record" title={view.rowsTitle} />
        {view.rows.length === 0 ? (
          <EmptyState body={view.emptyBody} title="Nothing to show yet." />
        ) : (
          <div className="perf-rows">
            {view.rows.map((row) => (
              <article className="perf-row" key={row.id}>
                <div className="perf-row__head">
                  <div className="perf-row__id">
                    <strong>{row.name}</strong>
                    <span className="perf-row__sub">{row.subtitle}</span>
                  </div>
                  <Badge tone={row.ratingTone}>★ {row.ratingLabel}</Badge>
                </div>
                <div className="perf-row__metrics">
                  {row.metrics.map((metric) => (
                    <span className="perf-metric" key={metric.label}>
                      <em>{metric.label}</em>
                      <Badge tone={metric.tone}>{metric.value}</Badge>
                    </span>
                  ))}
                </div>
                {row.tags.length > 0 ? (
                  <div className="perf-row__tags">
                    {row.tags.map((tag) => (
                      <span className="perf-tag" key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}
