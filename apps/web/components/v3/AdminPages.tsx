"use client"

import type { NetworkView } from "@/lib/network"
import { DecisionList } from "./Common"
import { AppShell, Metric } from "./Shells"

export interface AdminSummary {
  activeReports: number
  billingExceptions: number
  openLoads: number
  organizations: number
  suspiciousReviews: number
  trips: number
  verificationRecords: number
}

export interface AdminNetworkProps { network?: NetworkView }

export function AdminDashboard({ summary }: { summary: AdminSummary }) {
  return <AppShell role="admin" title="Admin" kicker="Platform intervention"><section className="command-grid"><Metric label="Organizations" value={summary.organizations} /><Metric label="Verification records" value={summary.verificationRecords} /><Metric label="Open loads" value={summary.openLoads} /><Metric label="Critical reports" value={summary.activeReports} /></section><section className="decision-grid"><DecisionList title="Verification" items={[{ title: "Carrier information reviewed", body: `${summary.verificationRecords} records are available for review`, tone: "info" }]} /><DecisionList title="Moderation" items={[{ title: "Marketplace behavior", body: `${summary.suspiciousReviews} suspicious records queued`, tone: "warning" }]} /><DecisionList title="Billing" items={[{ title: "Plan exceptions", body: `${summary.billingExceptions} accounts need billing review`, tone: "info" }]} /></section></AppShell>
}

export function AdminSectionPage({ summary, title }: { summary: AdminSummary; title: string }) {
  return <AppShell role="admin" title={title} kicker="Platform review"><section className="decision-grid"><DecisionList title="Queue" items={[{ title, body: `${summary.organizations} organizations and ${summary.verificationRecords} verification records in the platform sample.`, tone: "info" }]} /><DecisionList title="Review posture" items={[{ title: "Human review required", body: "Reports and unusual marketplace behavior are reviewed before enforcement.", tone: "warning" }]} /></section></AppShell>
}
