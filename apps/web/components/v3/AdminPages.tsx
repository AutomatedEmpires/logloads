"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
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
import { markNotificationReadAction } from "@/lib/cockpit-actions"
import { AdminBillingActions } from "./AdminBillingActions"
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

export function getAdminVerificationBuckets(items: AdminVerificationItem[]) {
  return {
    history: items.filter((item) => item.status !== "pending"),
    pending: items.filter((item) => item.status === "pending")
  }
}

export function getAdminNoticeBuckets(notices: AdminNoticeRow[]) {
  return {
    current: notices.filter((notice) => notice.state !== "ended"),
    history: notices.filter((notice) => notice.state === "ended")
  }
}

const CURRENT_OPPORTUNITY_STATUSES = new Set(["open", "scheduled", "filled", "in_transit"])

export function getAdminOpportunityBuckets(loads: AdminOpportunityRow[]) {
  return {
    current: loads.filter((load) => CURRENT_OPPORTUNITY_STATUSES.has(load.status)),
    history: loads.filter((load) => !CURRENT_OPPORTUNITY_STATUSES.has(load.status))
  }
}

function VerificationRows({ items }: { items: AdminVerificationItem[] }) {
  return (
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
          {item.status === "pending" ? (
            <VerificationDecision decisionContext={item.decisionContext} recordId={item.id} />
          ) : null}
        </article>
      ))}
    </div>
  )
}

function NoticeRows({ notices }: { notices: AdminNoticeRow[] }) {
  return (
    <div className="admin-rows">
      {notices.map((notice) => (
        <article className="admin-row" key={notice.id}>
          <div className="admin-row__main">
            <div className="admin-row__head">
              <strong>{notice.title}</strong>
              <Badge tone={toneForNotice(notice.severity)}>
                {notice.severity === "critical" ? "Critical" : notice.severity === "watch" ? "Watch" : "Info"}
              </Badge>
              <Badge tone={notice.state === "active" ? "success" : notice.state === "scheduled" ? "info" : "neutral"}>
                {notice.stateLabel}
              </Badge>
            </div>
            <p className="admin-row__meta">{notice.organizationName}</p>
            <p className="admin-row__body">{notice.body}</p>
            <span className="admin-row__when">
              {notice.state === "scheduled" ? "Starts" : "Effective"} {notice.effectiveLabel} · {notice.expiresLabel === "No expiry set" ? notice.expiresLabel : `Ends ${notice.expiresLabel}`}
            </span>
          </div>
          {notice.state === "active" ? <ResolveNoticeButton noticeId={notice.id} /> : null}
        </article>
      ))}
    </div>
  )
}

function OpportunityRows({ loads }: { loads: AdminOpportunityRow[] }) {
  return (
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
              {load.allocationLabel} · {load.truckloadsPerDay} {load.truckloadsPerDay === 1 ? "truck" : "trucks"}/day · Posted {load.createdLabel}
            </span>
          </div>
        </article>
      ))}
    </div>
  )
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
  const { history, pending } = getAdminVerificationBuckets(items)

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Verification">
      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={pending.length === 1 ? "1 decision waiting" : `${pending.length} decisions waiting`}
          title="Decisions that need a reviewer"
        />
        {pending.length === 0 ? (
          <EmptyState
            body="New identity, organization, equipment, or landing evidence appears here only while a human decision is still required."
            title="No verification decisions waiting."
          />
        ) : (
          <VerificationRows items={pending} />
        )}
      </section>
      {history.length > 0 ? (
        <details className="app-section admin-history">
          <summary>
            <span>
              <strong>Decision history</strong>
              <small>{history.length} reviewed {history.length === 1 ? "record" : "records"}</small>
            </span>
            <span className="admin-history__toggle" aria-hidden />
          </summary>
          <div className="admin-history__body">
            <VerificationRows items={history} />
          </div>
        </details>
      ) : null}
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
  const pendingCount = organizations.filter((organization) => organization.verificationStatus === "pending").length
  const verifiedCount = organizations.filter((organization) => organization.verificationStatus === "verified").length
  const restrictedCount = organizations.filter((organization) =>
    organization.verificationStatus === "rejected" || organization.verificationStatus === "suspended"
  ).length

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Organizations">
      <section className="app-section">
        <SectionHeader eyebrow="Operating registry" title="Review posture" />
        <div className="command-grid admin-registry-summary">
          <Metric label="Pending review" value={pendingCount} />
          <Metric label="Verified" value={verifiedCount} />
          <Metric label="Restricted" value={restrictedCount} />
        </div>
      </section>
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${organizations.length} registered`} title="Organization registry" />
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
                  activeLoads={organization.activeLoads}
                  organizationName={organization.name}
                  organizationId={organization.id}
                  suspensionBlockers={organization.suspensionBlockers}
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
  const { current, history } = getAdminNoticeBuckets(notices)
  const activeCount = current.filter((notice) => notice.state === "active").length
  const scheduledCount = current.filter((notice) => notice.state === "scheduled").length

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Notices">
      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${activeCount} in effect · ${scheduledCount} scheduled`}
          title="Current field notices"
        />
        {current.length === 0 ? (
          <EmptyState
            body="Active road closures, delays, weather calls, and notices scheduled to begin later appear here."
            title="No current or scheduled notices."
          />
        ) : (
          <NoticeRows notices={current} />
        )}
      </section>
      {history.length > 0 ? (
        <details className="app-section admin-history">
          <summary>
            <span>
              <strong>Ended notice history</strong>
              <small>{history.length} ended {history.length === 1 ? "notice" : "notices"}</small>
            </span>
            <span className="admin-history__toggle" aria-hidden />
          </summary>
          <div className="admin-history__body">
            <NoticeRows notices={history} />
          </div>
        </details>
      ) : null}
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

function MarkInquiryReadButton({ inquiryId, title }: { inquiryId: string; title: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function markRead(): void {
    setError(null)
    startTransition(async () => {
      const result = await markNotificationReadAction({ notificationId: inquiryId })

      if (!result.ok) {
        setError(result.error ?? "This inquiry could not be marked read.")
        return
      }

      router.refresh()
    })
  }

  return (
    <div className="admin-decision">
      <button
        aria-label={`Mark ${title} read`}
        className="admin-btn"
        disabled={pending}
        onClick={markRead}
        type="button"
      >
        {pending ? "Marking read…" : "Mark read"}
      </button>
      {error ? <p className="admin-decision__error" role="alert">{error}</p> : null}
    </div>
  )
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
    <AppShell account={account} kicker={KICKER} role="admin" title="Feedback">
      <section className="app-section admin-panel" id="contact-inquiries">
        <SectionHeader
          eyebrow={`${reports.inquiries.filter((inquiry) => !inquiry.read).length} unread · ${reports.inquiries.length} total`}
          title="Contact inquiries"
        />
        <p className="admin-panel__intro">
          This is the durable, admin-only record written by the public contact form. Email delivery is separate and is not inferred here.
        </p>
        {reports.inquiries.length === 0 ? (
          <EmptyState
            body="Messages sent through the public contact form will remain available here even after they leave the notification menu."
            title="No contact inquiries yet."
          />
        ) : (
          <div className="admin-rows">
            {reports.inquiries.map((inquiry) => (
              <article
                className="admin-row admin-inquiry-row"
                id={`contact-inquiry-${inquiry.id}`}
                key={inquiry.id}
              >
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <h3>{inquiry.title}</h3>
                    <Badge tone={inquiry.read ? "neutral" : "warning"}>
                      {inquiry.read ? "Read in inbox" : "Unread"}
                    </Badge>
                  </div>
                  <p className="admin-row__body admin-inquiry-row__body">{inquiry.body}</p>
                  <span className="admin-row__when">Received {inquiry.createdLabel}</span>
                </div>
                {!inquiry.read ? <MarkInquiryReadButton inquiryId={inquiry.id} title={inquiry.title} /> : null}
              </article>
            ))}
          </div>
        )}
      </section>

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
  const completionCount = disputes.filter((dispute) => dispute.kind.startsWith("completion_")).length
  const paymentCount = disputes.length - completionCount

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Completion & payment">
      <section className="app-section">
        <SectionHeader eyebrow="Open operating handoffs" title="What still needs agreement" />
        <div className="command-grid admin-exception-summary">
          <Metric label="Completion decisions" value={completionCount} />
          <Metric label="Direct payment receipts" value={paymentCount} />
        </div>
        <p className="admin-panel__intro">
          These are unresolved records, not historical cancellations. LogLoads records completion and each party&apos;s payment marker; it never holds or moves driver funds.
          The assigned host and driver resolve them from their authorized trip workspaces.
        </p>
      </section>
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${disputes.length} open`} title="Exceptions requiring follow-up" />
        {disputes.length === 0 ? (
          <EmptyState
            body="Every completed trip has a settled completion decision and no outstanding direct-payment receipt mismatch in the local record. This does not verify a bank transfer."
            title="No completion or payment exceptions."
          />
        ) : (
          <div className="admin-rows">
            {disputes.map((dispute) => (
              <article className={`admin-row admin-exception-row admin-exception-row--${dispute.tone}`} key={dispute.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{dispute.loadTitle}</strong>
                    <Badge tone={dispute.tone}>{dispute.statusLabel}</Badge>
                  </div>
                  <p className="admin-row__meta">
                    {dispute.organizationName} · Driver: {dispute.driverName}
                  </p>
                  <p className="admin-row__body">{dispute.detail}</p>
                  <span className="admin-row__when">Last changed {dispute.whenLabel}</span>
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

// --- Subscription and legacy billing operations -------------------------------------------

function subscriptionStatusTone(
  status: AdminBillingSnapshot["subscriptions"][number]["status"]
): "success" | "warning" | "critical" | "info" {
  if (status === "active") {
    return "success"
  }

  if (status === "past_due" || status === "cancelled" || status === "expired") {
    return "critical"
  }

  if (status === "pending" || status === "incomplete" || status === "non_renewing") {
    return "warning"
  }

  return "info"
}

function paymentStateTone(
  state: AdminBillingSnapshot["subscriptions"][number]["paymentState"]
): "success" | "warning" | "critical" | "info" {
  if (state === "current") {
    return "success"
  }

  if (state === "failed" || state === "past_due" || state === "uncollectible") {
    return "critical"
  }

  if (state === "requires_payment_method") {
    return "warning"
  }

  return "info"
}

function billingRecordTone(
  status: string
): "success" | "warning" | "critical" | "info" | "neutral" {
  if (status === "active" || status === "paid" || status === "reconciled") {
    return "success"
  }

  if (
    status === "failed" ||
    status === "past_due" ||
    status === "uncollectible"
  ) {
    return "critical"
  }

  if (
    status === "configured_dark" ||
    status === "incomplete" ||
    status === "invoicing" ||
    status === "non_renewing" ||
    status === "open" ||
    status === "reversed" ||
    status === "suspended"
  ) {
    return "warning"
  }

  if (status === "recorded" || status === "invoiced") {
    return "info"
  }

  return "neutral"
}

function shortReference(value: string): string {
  return value.slice(-8)
}

export function AdminSubscriptionRecord({
  subscription
}: {
  subscription: AdminBillingSnapshot["subscriptions"][number]
}) {
  return (
    <article className="admin-row">
      <div className="admin-row__main">
        <div className="admin-row__head">
          <strong>{subscription.organizationName}</strong>
          <Badge tone={subscriptionStatusTone(subscription.status)}>{subscription.statusLabel}</Badge>
          <Badge tone="info">{subscription.planLabel}</Badge>
          {subscription.salesAssisted ? <Badge tone="neutral">Sales-assisted</Badge> : null}
        </div>
        <p className="admin-row__meta">
          {subscription.billingModelLabel} · {subscription.baseMonthlyLabel} ·{" "}
          {subscription.providerReferenceLabel}
        </p>
        {subscription.usage ? (
          subscription.usage.usedUnits === null ? (
            <p className="admin-row__body">
              {subscription.usage.includedUnits} completed Network loads included.{" "}
              {subscription.usage.periodLabel}.
              {subscription.usage.overageRateLabel
                ? ` Overage is ${subscription.usage.overageRateLabel}.`
                : ""}
            </p>
          ) : (
            <p className="admin-row__body">
              Allowance: {subscription.usage.usedUnits} used of {subscription.usage.includedUnits} ·{" "}
              {subscription.usage.remainingUnits} remaining · {subscription.usage.overageUnits} overage ·{" "}
              {subscription.usage.overageAmountLabel} stored overage
            </p>
          )
        ) : (
          <p className="admin-row__body">
            No canonical Network allowance is recorded. Private-fleet work is never counted as
            Network usage.
          </p>
        )}
        {subscription.usage && subscription.usage.usedUnits !== null ? (
          <p className="admin-row__meta">
            Usage period: {subscription.usage.periodLabel} · {subscription.usage.stateLabel}
            {subscription.usage.overageRateLabel ? ` · ${subscription.usage.overageRateLabel}` : ""}
          </p>
        ) : null}
        <p className="admin-row__meta">
          <Badge tone={paymentStateTone(subscription.paymentState)}>
            Payment: {subscription.paymentStateLabel}
          </Badge>{" "}
          · {subscription.graceLabel} · Next billing boundary: {subscription.nextBillingLabel}
        </p>
        <p className="admin-row__meta">
          {subscription.renewalLabel} · Commitment: {subscription.commitmentLabel}
        </p>
        <p className="admin-row__body">
          Frozen plan v{subscription.planSnapshot.definitionVersion}:{" "}
          {subscription.planSnapshot.allowanceLabel} ·{" "}
          {subscription.planSnapshot.overageRateLabel} ·{" "}
          {subscription.planSnapshot.commitmentTermsLabel}
        </p>
        <p className="admin-row__meta">
          {subscription.planSnapshot.dispatchCapabilitiesLabel} · Definition effective{" "}
          {subscription.planSnapshot.definitionEffectiveLabel} ·{" "}
          {subscription.planSnapshot.catalogReferenceLabel}
        </p>
        <p className="admin-row__meta">
          Terms {subscription.planSnapshot.acceptedTermsVersion} accepted{" "}
          {subscription.planSnapshot.acceptedAtLabel}
        </p>
        {subscription.enterpriseAgreement ? (
          <>
            <p className="admin-row__body">
              Defined integrations:{" "}
              {subscription.enterpriseAgreement.definedIntegrations.length > 0
                ? subscription.enterpriseAgreement.definedIntegrations.join(" · ")
                : "None accepted"}
            </p>
            <p className="admin-row__meta">
              Service and support obligations:{" "}
              {subscription.enterpriseAgreement.serviceSupportObligations}
            </p>
          </>
        ) : null}
        {subscription.pendingEnterpriseAgreement ? (
          <>
            <p className="admin-row__body">
              Scheduled Enterprise agreement:{" "}
              {subscription.pendingEnterpriseAgreement.commitmentMonths}-month
              commitment · Defined integrations:{" "}
              {subscription.pendingEnterpriseAgreement.definedIntegrations.length > 0
                ? subscription.pendingEnterpriseAgreement.definedIntegrations.join(" · ")
                : "None accepted"}
            </p>
            <p className="admin-row__meta">
              Scheduled service and support obligations:{" "}
              {subscription.pendingEnterpriseAgreement.serviceSupportObligations}
            </p>
          </>
        ) : null}
        <span className="admin-row__when">Scheduled plan: {subscription.pendingPlanLabel}</span>
      </div>
    </article>
  )
}

export function AdminBillingPage({ account, billing }: { account: ShellAccount; billing: AdminBillingSnapshot }) {
  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Billing">
      <section className="app-section">
        <SectionHeader eyebrow="Percentage v1" title="Current host billing position" />
        <div className="command-grid admin-plan-mix">
          <Metric label="Current percentage organizations" value={billing.platformFeeLedger.currentOrganizationCount} />
          <Metric label="Current percentage assignments" value={billing.platformFeeLedger.currentAssignmentCount} />
          <Metric label="Non-void fee events" value={billing.platformFeeLedger.currentFeeEventCount} />
          <Metric label="Accrued, not invoiced" value={billing.platformFeeLedger.currentAccruedFeeLabel} />
          <Metric label="Host invoices" value={billing.platformFeeLedger.currentInvoiceCount} />
          <Metric label="Outstanding" value={billing.platformFeeLedger.currentOutstandingInvoiceLabel} />
        </div>
        <p className="admin-panel__intro">
          Current host revenue is the 5% platform fee added on top of stated
          driver pay for completed loads. Posting is free; there is no subscription,
          monthly minimum, tier, allowance, or overage. Legacy percentage rows remain
          in the same immutable ledger and retain their frozen discriminator.
        </p>
      </section>

      <section className="app-section admin-panel" id="current-fee-exceptions">
        <SectionHeader
          action={
            <Link className="action-link action-link--secondary" href="/admin/disputes">
              Review completion &amp; payment
            </Link>
          }
          eyebrow={`${billing.platformFeeLedger.currentExceptionCount} current ${billing.platformFeeLedger.currentExceptionCount === 1 ? "exception" : "exceptions"}`}
          title="Percentage fee attention"
        />
        <p className="admin-panel__intro">
          This queue covers only current percentage-v1 fee and invoice disagreements. Normal monthly-arrears accrual and open invoices are not treated as failures, and no live Stripe state is inferred.
        </p>
        {billing.platformFeeLedger.currentExceptions.length === 0 ? (
          <EmptyState
            body="Current percentage fee events and their local invoice references are internally consistent. Provider state was not checked."
            title="No current fee exceptions."
          />
        ) : (
          <div className="admin-rows">
            {billing.platformFeeLedger.currentExceptions.map((exception) => (
              <article className={`admin-row admin-exception-row admin-exception-row--${exception.severity}`} key={exception.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{exception.title}</strong>
                    <Badge tone={exception.severity}>
                      {exception.severity === "critical" ? "Critical" : "Warning"}
                    </Badge>
                  </div>
                  <p className="admin-row__meta">{exception.organizationName}</p>
                  <p className="admin-row__body">{exception.detail}</p>
                  <span className="admin-row__when">Local record updated {exception.updatedLabel}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel admin-legacy-panel">
        <SectionHeader
          action={
            <Link
              className="action-link action-link--secondary"
              href="/api/admin/billing/export"
              prefetch={false}
            >
              Export canonical CSV
            </Link>
          }
          eyebrow="Preserved legacy subscription state"
          title="Historical subscription operations"
        />
        <div className="command-grid admin-plan-mix">
          <Metric
            label="Modeled recognized base revenue"
            value={billing.operations.paidBaseRevenueLabel}
          />
          <Metric
            label="Provider-paid overage revenue"
            value={billing.operations.paidOverageRevenueLabel}
          />
          <Metric
            label="Modeled total subscription revenue"
            value={billing.operations.totalSubscriptionRevenueLabel}
          />
          <Metric
            label="Revenue per completed Network load"
            value={billing.operations.revenuePerCompletedNetworkLoadLabel}
          />
          <Metric
            label="Completed Network units"
            value={billing.operations.completedNetworkUnitCount}
          />
          <Metric
            label="Allowance utilization"
            value={billing.operations.allowanceUtilizationLabel}
          />
          <Metric
            label="Overage frequency"
            value={billing.operations.overageFrequencyLabel}
          />
          <Metric
            label="Billing failure rate"
            value={billing.operations.billingFailureRateLabel}
          />
          <Metric
            label="Committed private movements"
            value={billing.operations.privateMovementCount}
          />
          <Metric
            label="Committed Network movements"
            value={billing.operations.networkMovementCount}
          />
        </div>
        <p className="admin-panel__intro">
          Modeled recognized base revenue sums the stored amount due on USD base invoices marked
          paid. Modeled total subscription revenue adds provider-confirmed cash paid on overage
          invoices plus exact provider settlement deltas for later adjustments. This is an
          operating model, not GAAP
          revenue, MRR, cash balance, or live Stripe reconciliation; taxes are not separately
          modeled, and adjustments that have not been frozen onto a paid invoice are not netted into
          it. Revenue per completed Network load divides that total by{" "}
          {billing.operations.completedNetworkUnitCount} non-reversed canonical commercial Network{" "}
          {billing.operations.completedNetworkUnitCount === 1 ? "unit" : "units"}. Usage and
          revenue use all stored commercial history, with no cohort or calendar-window
          normalization. Usage and allowance ratios cover all stored commercial periods. Movement
          counts deduplicate frozen assignment classifications by physical movement. Internal
          billing tests and percentage fees are excluded throughout. These are
          historical subscription metrics, not the current host commercial model.
        </p>
      </section>

      <AdminBillingActions
        periodSummaryOptions={billing.periodSummaries.map((summary) => ({
          id: summary.id,
          label: `${summary.organizationName} · ${summary.planLabel} · ${summary.periodLabel}`
        }))}
        subscriptionOptions={billing.subscriptions.map((subscription) => ({
          id: subscription.id,
          label: `${subscription.organizationName} · ${subscription.planLabel}`
        }))}
        usageOptions={billing.usageLedger.map((usage) => ({
          id: usage.id,
          label: `${usage.organizationName} · ${usage.planLabel} · ${usage.completedLabel}`
        }))}
      />

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${billing.reconciliationWarnings.length} local ${
            billing.reconciliationWarnings.length === 1 ? "warning" : "warnings"
          }`}
          title="Historical subscription reconciliation"
        />
        <p className="admin-panel__intro">
          These checks compare canonical records and the provider references stored on them. They do
          not call Stripe and do not claim that local state matches live provider state.
        </p>
        {billing.reconciliationWarnings.length === 0 ? (
          <EmptyState
            body="All inspected local account, subscription, usage, summary, adjustment, invoice, and provider-reference links are internally complete. Live provider state was not checked."
            title="No local reconciliation warnings."
          />
        ) : (
          <div className="admin-rows">
            {billing.reconciliationWarnings.map((warning) => (
              <article className="admin-row" key={warning.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{warning.title}</strong>
                    <Badge
                      tone={
                        warning.severity === "critical"
                          ? "critical"
                          : "warning"
                      }
                    >
                      {warning.severity}
                    </Badge>
                  </div>
                  <p className="admin-row__meta">{warning.organizationName}</p>
                  <p className="admin-row__body">{warning.detail}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${billing.attention.length} to follow up`}
          title="Historical subscription failures"
        />
        {billing.attention.length === 0 ? (
          <EmptyState
            body="A locally recorded failed payment, past-due subscription, missing payment method, or dunning grace state will appear here. Provider health is not inferred."
            title="No subscription billing failures recorded."
          />
        ) : (
          <div className="admin-rows">
            {billing.attention.map((subscription) => (
              <AdminSubscriptionRecord key={subscription.id} subscription={subscription} />
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${billing.commercialSubscriptionCount} commercial ${
            billing.commercialSubscriptionCount === 1 ? "subscription" : "subscriptions"
          }`}
          title="Historical plan mix"
        />
        {billing.planMix.length === 0 ? (
          <EmptyState
            body="The plan catalog does not prove enrollment. Plan mix begins only when an organization has an accepted canonical subscription record."
            title="No commercial subscriptions recorded."
          />
        ) : (
          <div className="admin-rows">
            {billing.planMix.map((entry) => (
              <article className="admin-row" key={entry.code}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{entry.label}</strong>
                    <Badge tone="info">{entry.visibilityLabel}</Badge>
                    {entry.salesAssisted ? <Badge tone="neutral">Sales-assisted</Badge> : null}
                  </div>
                  <p className="admin-row__meta">
                    {entry.totalCount} total · {entry.activeCount} active
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${billing.accounts.length} ${
            billing.accounts.length === 1 ? "account" : "accounts"
          }`}
          title="All organization billing authority"
        />
        {billing.accounts.length === 0 ? (
          <EmptyState
            body="Billing accounts establish which commercial model is authoritative for newly accepted work. No account is inferred from the plan catalog."
            title="No organization billing accounts recorded."
          />
        ) : (
          <div className="admin-rows">
            {billing.accounts.map((billingAccount) => (
              <article className="admin-row" key={billingAccount.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{billingAccount.organizationName}</strong>
                    <Badge
                      tone={billingRecordTone(
                        billingAccount.activationState
                      )}
                    >
                      {billingAccount.activationStateLabel}
                    </Badge>
                  </div>
                  <p className="admin-row__body">
                    {billingAccount.billingModelLabel} ·{" "}
                    {billingAccount.subscriptionLabel}
                  </p>
                  <span className="admin-row__when">
                    Effective {billingAccount.effectiveLabel}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader eyebrow="Preserved legacy records" title="Historical organization subscriptions" />
        {billing.subscriptions.length === 0 ? (
          <EmptyState
            body="No organization has an accepted subscription-v1 agreement. Configured plan definitions and provider products are not shown as customers."
            title="No subscriptions to review."
          />
        ) : (
          <div className="admin-rows">
            {billing.subscriptions.map((subscription) => (
              <AdminSubscriptionRecord key={subscription.id} subscription={subscription} />
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${billing.usageLedger.length} ${
            billing.usageLedger.length === 1 ? "event" : "events"
          }`}
          title="Historical subscription usage ledger"
        />
        {billing.usageLedger.length === 0 ? (
          <EmptyState
            body="A completed, host-confirmed Network movement creates one canonical usage row. Private-fleet movements and internal billing tests never appear here."
            title="No commercial Network usage recorded."
          />
        ) : (
          <div className="admin-rows">
            {billing.usageLedger.map((usage) => (
              <article className="admin-row" key={usage.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{usage.organizationName}</strong>
                    <Badge tone={billingRecordTone(usage.status)}>
                      {usage.statusLabel}
                    </Badge>
                    <Badge tone="info">{usage.planLabel}</Badge>
                  </div>
                  <p className="admin-row__body">{usage.summaryLabel}</p>
                  <p className="admin-row__meta">
                    {usage.invoiceLabel} · {usage.reversalLabel}
                  </p>
                  <span className="admin-row__when">
                    Completed {usage.completedLabel} · Movement{" "}
                    {shortReference(usage.loadMovementId)} · Assignment{" "}
                    {shortReference(usage.assignmentId)} · Load{" "}
                    {shortReference(usage.loadPostingId)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${billing.periodSummaries.length} ${
            billing.periodSummaries.length === 1 ? "period" : "periods"
          }`}
          title="Historical allowance period summaries"
        />
        {billing.periodSummaries.length === 0 ? (
          <EmptyState
            body="Stored allowance periods show the frozen plan, included units, actual usage, overage arithmetic, invoice references, and audited adjustments."
            title="No commercial allowance periods recorded."
          />
        ) : (
          <div className="admin-rows">
            {billing.periodSummaries.map((summary) => (
              <article className="admin-row" key={summary.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{summary.organizationName}</strong>
                    <Badge tone={billingRecordTone(summary.status)}>
                      {summary.statusLabel}
                    </Badge>
                    <Badge tone="info">{summary.planLabel}</Badge>
                  </div>
                  <p className="admin-row__body">
                    {summary.calculationLabel} · {summary.overageAmountLabel} at{" "}
                    {summary.overageRateLabel}
                  </p>
                  <p className="admin-row__meta">
                    {summary.usageEventCount} usage{" "}
                    {summary.usageEventCount === 1 ? "reference" : "references"} ·{" "}
                    {summary.invoiceCount} invoice{" "}
                    {summary.invoiceCount === 1 ? "reference" : "references"}
                  </p>
                  <p className="admin-row__meta">
                    {summary.adjustmentCount} audited{" "}
                    {summary.adjustmentCount === 1 ? "adjustment" : "adjustments"} · Unit delta{" "}
                    {summary.adjustmentUnitLabel} · Amount delta{" "}
                    {summary.adjustmentAmountLabel}
                  </p>
                  <span className="admin-row__when">{summary.periodLabel}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${billing.invoices.length} ${
            billing.invoices.length === 1 ? "invoice" : "invoices"
          }`}
          title="Historical Network overage invoices"
        />
        {billing.invoices.length === 0 ? (
          <EmptyState
            body="Only canonical commercial overage invoice rows appear here. A provider reference is reported as stored evidence, never as proof of live provider state."
            title="No commercial overage invoices recorded."
          />
        ) : (
          <div className="admin-rows">
            {billing.invoices.map((invoice) => (
              <article className="admin-row" key={invoice.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>
                      {invoice.organizationName} · Overage invoice{" "}
                      {invoice.sequence}
                    </strong>
                    <Badge tone={billingRecordTone(invoice.status)}>
                      {invoice.statusLabel}
                    </Badge>
                    <Badge tone="info">{invoice.planLabel}</Badge>
                  </div>
                  <p className="admin-row__body">
                    {invoice.calculationLabel} · {invoice.usageEventCount} usage{" "}
                    {invoice.usageEventCount === 1 ? "reference" : "references"}
                  </p>
                  <p className="admin-row__meta">
                    {invoice.providerReferenceLabel} · Issued{" "}
                    {invoice.issuedLabel} · Paid {invoice.paidLabel}
                  </p>
                  <p className="admin-row__meta">
                    {invoice.providerSettlementLabel}
                  </p>
                  <span className="admin-row__when">{invoice.periodLabel}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader
          eyebrow={`${billing.adjustments.length} ${
            billing.adjustments.length === 1 ? "adjustment" : "adjustments"
          }`}
          title="Historical adjustments and reversals"
        />
        {billing.adjustments.length === 0 ? (
          <EmptyState
            body="Usage reversals, service credits, and manual debits remain append-only here with their actor, reason, unit effect, money effect, and local links."
            title="No commercial billing adjustments recorded."
          />
        ) : (
          <div className="admin-rows">
            {billing.adjustments.map((adjustment) => (
              <article className="admin-row" key={adjustment.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{adjustment.organizationName}</strong>
                    <Badge tone="warning">{adjustment.typeLabel}</Badge>
                  </div>
                  <p className="admin-row__body">{adjustment.reason}</p>
                  <p className="admin-row__meta">
                    Unit delta {adjustment.unitDeltaLabel} · Amount delta{" "}
                    {adjustment.amountDeltaLabel} · {adjustment.usageLabel}
                  </p>
                  <p className="admin-row__meta">
                    {adjustment.summaryLabel} · {adjustment.invoiceLabel}
                  </p>
                  <p className="admin-row__meta">
                    {adjustment.providerSettlementLabel} ·{" "}
                    {adjustment.providerReferenceLabel} · Revenue delta{" "}
                    {adjustment.providerRevenueDeltaLabel}
                  </p>
                  <span className="admin-row__when">
                    {adjustment.actorLabel} · {adjustment.createdLabel}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-section admin-panel">
        <SectionHeader eyebrow="Canonical fee ledger" title="Percentage billing detail" />
        <p className="admin-panel__intro">
          Current percentage_v1 and preserved legacy percentage obligations share
          this immutable fee and invoice ledger. They are never counted as historical
          subscription MRR, ARR, plan enrollment, or completed-load usage.
        </p>
        <div className="command-grid admin-plan-mix">
          <Metric label="Current organizations" value={billing.platformFeeLedger.currentOrganizationCount} />
          <Metric label="Legacy organizations" value={billing.platformFeeLedger.legacyOrganizationCount} />
          <Metric label="Current assignments" value={billing.platformFeeLedger.currentAssignmentCount} />
          <Metric label="Legacy assignments" value={billing.platformFeeLedger.legacyAssignmentCount} />
          <Metric label="Legacy non-void fees" value={billing.platformFeeLedger.legacyFeeEventCount} />
          <Metric label="Legacy invoices" value={billing.platformFeeLedger.legacyInvoiceCount} />
          <Metric label="Legacy outstanding" value={billing.platformFeeLedger.legacyOutstandingInvoiceLabel} />
          <Metric label="Previous entitlements" value={billing.platformFeeLedger.entitlementCount} />
        </div>

        <SectionHeader
          eyebrow={`${billing.platformFeeLedger.entitlementExceptions.length} to follow up`}
          title="Previous entitlement exceptions"
        />
        {billing.platformFeeLedger.entitlementExceptions.length === 0 ? (
          <EmptyState
            body="Past-due or cancelled records from the previous entitlement system remain visible here without being treated as subscription-v1 revenue."
            title="No previous entitlement exceptions."
          />
        ) : (
          <div className="admin-rows">
            {billing.platformFeeLedger.entitlementExceptions.map((exception) => (
              <article className="admin-row" key={exception.id}>
                <div className="admin-row__main">
                  <div className="admin-row__head">
                    <strong>{exception.organizationName}</strong>
                    <Badge tone={exception.status === "cancelled" ? "critical" : "warning"}>
                      {exception.statusLabel}
                    </Badge>
                  </div>
                  <p className="admin-row__meta">
                    {exception.planLabel} · Period ends {exception.periodEndsLabel}
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
  const { current, history } = getAdminOpportunityBuckets(loads)

  return (
    <AppShell account={account} kicker={KICKER} role="admin" title="Work registry">
      <section className="app-section admin-panel">
        <SectionHeader eyebrow={`${current.length} current · ${history.length} historical`} title="Current load postings" />
        <p className="admin-panel__intro">
          Platform-wide posting context for moderation. Exact private route and access details remain assignment-gated in the operating cockpits.
        </p>
        {current.length === 0 ? (
          <EmptyState
            body="Open, scheduled, filled, and in-transit postings appear here. Draft and terminal records remain in history below."
            title="No current load postings."
          />
        ) : (
          <OpportunityRows loads={current} />
        )}
      </section>
      {history.length > 0 ? (
        <details className="app-section admin-history">
          <summary>
            <span>
              <strong>Draft and terminal posting history</strong>
              <small>{history.length} preserved {history.length === 1 ? "record" : "records"}</small>
            </span>
            <span className="admin-history__toggle" aria-hidden />
          </summary>
          <div className="admin-history__body">
            <OpportunityRows loads={history} />
          </div>
        </details>
      ) : null}
    </AppShell>
  )
}
