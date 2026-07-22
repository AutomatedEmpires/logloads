"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Badge, Icon } from "@logloads/ui"

import type {
  AdminActivityHistory,
  AdminBillingSnapshot,
  AdminDisputeRow,
  AdminNoticeRow,
  AdminOpportunityRow,
  AdminOrganizationRow,
  AdminOverview,
  AdminReportsData,
  AdminVerificationItem
} from "@/lib/admin-data"
import { toneForNotice } from "./Common"
import { AdminReportDecision, OrganizationDecision, ResolveNoticeButton, VerificationDecision } from "./AdminActions"
import { AppShell, EmptyState, Metric, SectionHeader, type ShellAccount } from "./Shells"

const KICKER = "Platform operations"

function reviewTone(status: string): "success" | "warning" | "critical" | "info" {
  if (status === "verified") {
    return "success"
  }

  if (status === "pending") {
    return "warning"
  }

  if (status === "rejected" || status === "suspended") {
    return "critical"
  }

  return "info"
}

function reviewLabel(status: string): string {
  if (status === "verified") {
    return "Verified"
  }

  if (status === "pending") {
    return "Review pending"
  }

  if (status === "rejected") {
    return "Not approved"
  }

  if (status === "suspended") {
    return "Suspended"
  }

  return status.replaceAll("_", " ")
}

function loadStatusTone(status: string): "success" | "warning" | "critical" | "info" | "neutral" {
  if (status === "open") {
    return "success"
  }

  if (status === "cancelled") {
    return "critical"
  }

  if (status === "scheduled" || status === "filled" || status === "in_transit") {
    return "info"
  }

  return "neutral"
}

// --- Command dashboard ---------------------------------------------------------

export function AdminDashboard({ account, overview }: { account: ShellAccount; overview: AdminOverview }) {
  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Admin">
      <section className="app-section admin-queues" aria-label="Intervention queues">
        {overview.queues.map((queue) => (
          <Link className={`admin-queue admin-queue--${queue.tone}`} href={queue.href} key={queue.href}>
            <span className="admin-queue__count">{queue.count}</span>
            <strong>{queue.label}</strong>
            <p>{queue.description}</p>
            <span className="admin-queue__go">Open queue</span>
          </Link>
        ))}
      </section>
      <section className="app-section">
        <SectionHeader eyebrow="Platform" title="Current footprint" />
        <div className="command-grid">
          {overview.stats.map((stat) => (
            <Metric key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      </section>
      <section className="app-section admin-panel">
        <SectionHeader
          action={
            <Link className="action-link action-link--secondary" href="/admin/audit">
              Open activity history
            </Link>
          }
          eyebrow="Latest"
          title="Recent activity"
        />
        {overview.recentActivity.length === 0 ? (
          <EmptyState
            body="Every action taken across the platform is recorded and shows up here as it happens."
            title="No activity recorded yet."
          />
        ) : (
          <ul className="admin-activity-strip">
            {overview.recentActivity.map((event) => (
              <li key={event.id}>
                <strong>{event.actionLabel}</strong>
                <span>{event.entityLabel}</span>
                <em>{event.whenLabel}</em>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}

// --- Verification queue ----------------------------------------------------------

export function AdminVerificationPage({ account, items }: { account: ShellAccount; items: AdminVerificationItem[] }) {
  const pendingCount = items.filter((item) => item.status === "pending").length

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Verification">
      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={pendingCount === 1 ? "1 decision waiting" : `${pendingCount} decisions waiting`}
          title="Review queue"
        />
        {items.length === 0 ? (
          <EmptyState
            body="When someone submits identity, organization, equipment, or landing evidence, it lands in this queue for a human decision."
            title="No verification requests yet."
          />
        ) : (
          <div className="admin-rows">
            {items.map((item) => (
              <article className="admin-row" key={item.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{item.subjectLabel}</strong>
                    <Badge tone={reviewTone(item.status)}>{reviewLabel(item.status)}</Badge>
                  </div>
                  <p className="admin-row__meta">
                    {item.typeLabel} · {item.subjectTypeLabel} · {item.sourceLabel}
                  </p>
                  <p className="admin-row__body">{item.evidenceSummary}</p>
                  <span className="admin-row__when">Submitted {item.submittedLabel}</span>
                </div>
                {item.status === "pending" ? <VerificationDecision recordId={item.id} /> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}

// --- Organization registry ---------------------------------------------------------

export function AdminOrganizationsPage({
  account,
  organizations
}: {
  account: ShellAccount
  organizations: AdminOrganizationRow[]
}) {
  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Organizations">
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${organizations.length} registered`} title="Registry" />
        {organizations.length === 0 ? (
          <EmptyState
            body="Organizations appear here as soon as they finish onboarding, with their review status and operating footprint."
            title="No organizations registered yet."
          />
        ) : (
          <div className="admin-rows">
            {organizations.map((organization) => (
              <article className="admin-row" key={organization.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{organization.name}</strong>
                    <Badge tone="neutral">{organization.typeLabel}</Badge>
                    <Badge tone={reviewTone(organization.verificationStatus)}>
                      {reviewLabel(organization.verificationStatus)}
                    </Badge>
                  </div>
                  <p className="admin-row__meta">
                    {organization.region} · {organization.memberCount}{" "}
                    {organization.memberCount === 1 ? "member" : "members"} · {organization.activeLoads} active{" "}
                    {organization.activeLoads === 1 ? "load" : "loads"}
                  </p>
                </div>
                <OrganizationDecision
                  organizationId={organization.id}
                  verificationStatus={organization.verificationStatus}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}

// --- Operational notices --------------------------------------------------------------

export function AdminNoticesPage({ account, notices }: { account: ShellAccount; notices: AdminNoticeRow[] }) {
  const activeCount = notices.filter((notice) => notice.active).length

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Notices">
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${activeCount} in effect`} title="Operational notices" />
        {notices.length === 0 ? (
          <EmptyState
            body="Notices published by organizations — road closures, delays, weather calls — appear here with severity and expiry."
            title="No operational notices."
          />
        ) : (
          <div className="admin-rows">
            {notices.map((notice) => (
              <article className="admin-row" key={notice.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{notice.title}</strong>
                    <Badge tone={toneForNotice(notice.severity)}>
                      {notice.severity === "critical" ? "Critical" : notice.severity === "watch" ? "Watch" : "Info"}
                    </Badge>
                    {!notice.active ? <Badge tone="neutral">Resolved</Badge> : null}
                  </div>
                  <p className="admin-row__meta">{notice.organizationName}</p>
                  <p className="admin-row__body">{notice.body}</p>
                  <span className="admin-row__when">
                    Effective {notice.effectiveLabel} · {notice.active ? `Expires ${notice.expiresLabel}` : `Ended ${notice.expiresLabel}`}
                  </span>
                </div>
                {notice.active ? <ResolveNoticeButton noticeId={notice.id} /> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}

// --- Reports ------------------------------------------------------------------------

function supportLabel(value: string): string {
  const human = value.replaceAll("_", " ")

  return human.charAt(0).toUpperCase() + human.slice(1)
}

function supportStatusTone(status: string): "success" | "warning" | "info" {
  if (status === "resolved") return "success"
  if (status === "open" || status === "in_review") return "warning"

  return "info"
}

export function AdminReportsPage({ account, reports }: { account: ShellAccount; reports: AdminReportsData }) {
  const [statusFilter, setStatusFilter] = useState<"attention" | "all" | "terminal">("attention")
  const [kindFilter, setKindFilter] = useState<"all" | "problem" | "feature_request">("all")
  const filteredRequests = useMemo(
    () => reports.requests.filter((request) => {
      const statusMatches = statusFilter === "all"
        || (statusFilter === "attention" && (request.status === "open" || request.status === "in_review"))
        || (statusFilter === "terminal" && (request.status === "resolved" || request.status === "closed"))
      const kindMatches = kindFilter === "all" || request.kind === kindFilter

      return statusMatches && kindMatches
    }),
    [kindFilter, reports.requests, statusFilter]
  )

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Reports">
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${reports.requests.length} recorded`} title="User requests" />
        <div className="filter-bar admin-filter-bar" aria-label="Filter user requests">
          <label>
            <span className="sr-only">Request status</span>
            <select
              className="admin-select"
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              value={statusFilter}
            >
              <option value="attention">Needs attention</option>
              <option value="all">All statuses</option>
              <option value="terminal">Resolved and closed</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Request kind</span>
            <select
              className="admin-select"
              onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}
              value={kindFilter}
            >
              <option value="all">Problems and features</option>
              <option value="problem">Problems</option>
              <option value="feature_request">Feature requests</option>
            </select>
          </label>
        </div>
        {filteredRequests.length === 0 ? (
          <EmptyState
            body="New product problems and feature requests will appear here for a platform response."
            title={reports.requests.length === 0 ? "No user requests yet." : "No requests match these filters."}
          />
        ) : (
          <div className="admin-rows">
            {filteredRequests.map((request) => (
              <article className="admin-row admin-support-row" id={`support-request-${request.id}`} key={request.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <h3>{request.title}</h3>
                    <Badge tone={supportStatusTone(request.status)}>{supportLabel(request.status)}</Badge>
                  </div>
                  <div className="admin-support-row__badges">
                    <Badge tone="info">{request.kind === "problem" ? "Problem" : "Feature request"}</Badge>
                    <Badge tone="info">{supportLabel(request.impact)}</Badge>
                  </div>
                  <p className="admin-row__meta">
                    {request.reporterName} · {request.organizationName}
                  </p>
                  <p className="admin-row__body admin-support-row__details">{request.details}</p>
                  <p className="admin-row__meta">
                    {request.pagePath ? `Page ${request.pagePath}` : "No page context"}
                    {request.appCommitSha ? ` · Build ${request.appCommitSha.slice(0, 12)}` : ""}
                  </p>
                  <span className="admin-row__when">
                    Submitted {request.createdLabel} · Updated {request.updatedLabel}
                  </span>
                  {request.resolutionNote ? (
                    <div className="admin-support-row__resolution">
                      <strong>{request.resolutionCode ? supportLabel(request.resolutionCode) : "Outcome"}</strong>
                      <p>{request.resolutionNote}</p>
                      {request.closedLabel ? <span>Recorded {request.closedLabel}</span> : null}
                    </div>
                  ) : null}
                </div>
                <AdminReportDecision
                  expectedUpdatedAt={request.updatedAt}
                  requestId={request.id}
                  status={request.status}
                />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${reports.systemFlags.length} recorded`} title="System flags" />
        <p className="admin-panel__intro">Blocked or flagged operating events remain read-only system history; they do not share the user-request lifecycle.</p>
        {reports.systemFlags.length === 0 ? (
          <EmptyState body="Blocked or flagged operating events will appear here." title="No system flags." />
        ) : (
          <div className="admin-rows">
            {reports.systemFlags.map((report) => (
              <article className="admin-row" key={report.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <h3>{report.actionLabel}</h3>
                    <Badge tone="critical">System flag</Badge>
                  </div>
                  <p className="admin-row__meta">{report.entityLabel} · {report.actorName}</p>
                  {report.detail ? <p className="admin-row__body">{report.detail}</p> : null}
                  <span className="admin-row__when">{report.whenLabel}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}

// --- Disputes -----------------------------------------------------------------------

export function AdminDisputesPage({ account, disputes }: { account: ShellAccount; disputes: AdminDisputeRow[] }) {
  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Cancellations">
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${disputes.length} recorded`} title="Cancelled assignments" />
        {disputes.length === 0 ? (
          <EmptyState
            body="When an assignment is cancelled, it appears here with its recorded reason so a reviewer can follow up."
            title="No cancelled assignments."
          />
        ) : (
          <div className="admin-rows">
            {disputes.map((dispute) => (
              <article className="admin-row" key={dispute.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{dispute.loadTitle}</strong>
                    <Badge tone="warning">Cancelled</Badge>
                  </div>
                  <p className="admin-row__meta">
                    {dispute.organizationName} · Driver: {dispute.driverName}
                  </p>
                  <p className="admin-row__body">{dispute.reason}</p>
                  <span className="admin-row__when">Cancelled {dispute.cancelledLabel}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}

// --- Activity history -----------------------------------------------------------------

export function AdminActivityPage({ account, history }: { account: ShellAccount; history: AdminActivityHistory }) {
  const [entityType, setEntityType] = useState("all")
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return history.events.filter(
      (event) =>
        (entityType === "all" || event.entityType === entityType) &&
        (needle === "" ||
          `${event.actionLabel} ${event.actorName} ${event.entityLabel}`.toLowerCase().includes(needle))
    )
  }, [entityType, history.events, query])

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Activity history">
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${history.totalCount} entries`} title="Recorded platform activity" />
        {history.events.length === 0 ? (
          <EmptyState
            body="Supported reviews, assignments, cancellations, and other operating events appear here with the recorded actor and time."
            title="No activity yet."
          />
        ) : (
          <>
            <div className="filter-bar admin-filter-bar">
              <div className="search-field-v3">
                <Icon aria-hidden name="action.search" size={18} />
                <input
                  aria-label="Search activity"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search actions or people"
                  value={query}
                />
              </div>
              <select
                aria-label="Filter by record type"
                className="admin-select"
                onChange={(event) => setEntityType(event.target.value)}
                value={entityType}
              >
                <option value="all">All record types</option>
                {history.entityTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            {filtered.length === 0 ? (
              <EmptyState
                body="Try a different search term or switch the record type back to all."
                title="Nothing matches these filters."
              />
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Record</th>
                      <th scope="col">Who</th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((event) => (
                      <tr key={event.id}>
                        <td>{event.actionLabel}</td>
                        <td>{event.entityLabel}</td>
                        <td>{event.actorName}</td>
                        <td>{event.whenLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {history.totalCount > history.events.length ? (
              <p className="admin-table-note">
                Showing the latest {history.events.length} of {history.totalCount} entries.
              </p>
            ) : null}
          </>
        )}
      </section>
    </AppShell>
  )
}

// --- Billing exceptions -----------------------------------------------------------------

export function AdminBillingPage({ account, billing }: { account: ShellAccount; billing: AdminBillingSnapshot }) {
  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Billing">
      <section className="app-section">
        <SectionHeader eyebrow="Plans" title="Plan status across the platform" />
        <div className="command-grid admin-plan-mix">
          {billing.planMix.map((entry) => (
            <Metric key={entry.label} label={entry.label} value={entry.count} />
          ))}
        </div>
      </section>
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${billing.exceptions.length} to follow up`} title="Exceptions" />
        {billing.exceptions.length === 0 ? (
          <EmptyState
            body="Organizations with a past-due or cancelled plan appear here so someone can follow up before access lapses."
            title="No billing exceptions."
          />
        ) : (
          <div className="admin-rows">
            {billing.exceptions.map((exception) => (
              <article className="admin-row" key={exception.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{exception.organizationName}</strong>
                    <Badge tone={exception.status === "cancelled" ? "critical" : "warning"}>
                      {exception.statusLabel}
                    </Badge>
                  </div>
                  <p className="admin-row__meta">
                    {exception.planLabel} plan · Current period ends {exception.periodEndsLabel}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}

// --- Load posting moderation view ---------------------------------------------------------

export function AdminOpportunitiesPage({ account, loads }: { account: ShellAccount; loads: AdminOpportunityRow[] }) {
  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Opportunities">
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${loads.length} postings`} title="Every load posting on the platform" />
        {loads.length === 0 ? (
          <EmptyState
            body="Every load posting published anywhere on the platform appears here with its status and visibility, for moderation context."
            title="No load postings yet."
          />
        ) : (
          <div className="admin-rows">
            {loads.map((load) => (
              <article className="admin-row" key={load.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{load.title}</strong>
                    <Badge tone={loadStatusTone(load.status)}>{load.statusLabel}</Badge>
                    <Badge tone="info">{load.visibilityLabel}</Badge>
                  </div>
                  <p className="admin-row__meta">
                    {load.organizationName} · {load.lane}
                  </p>
                  <span className="admin-row__when">
                    {load.allocationLabel} · {load.truckloadsPerDay}{" "}
                    {load.truckloadsPerDay === 1 ? "truck" : "trucks"}/day · Posted {load.createdLabel}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  )
}
