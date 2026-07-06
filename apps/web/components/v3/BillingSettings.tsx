"use client"

import type { NetworkView } from "@/lib/network"
import { userPlanFeatures } from "@/lib/v3-shared"
import { AppShell } from "./Shells"

interface NetworkProps { network: NetworkView }

export function BillingPage({ network, role }: NetworkProps & { role: "fleet" | "host" }) {
  return <AppShell role={role} title="Billing" kicker="Plan features" orgName={network.activeOrganization.name}><section className="pricing-grid pricing-grid--app">{network.entitlements.map((entitlement) => <article key={entitlement.id}><span>{entitlement.status}</span><h2>{entitlement.product === "fleet_operations" ? "Fleet Operations" : "Host Operations"}</h2><strong>{entitlement.limitLabel}</strong><ul>{userPlanFeatures(entitlement.product).map((feature) => <li key={feature}>{feature}</li>)}</ul></article>)}</section></AppShell>
}

export function SettingsPage({ network, role }: NetworkProps & { role: "fleet" | "host" }) {
  return <AppShell role={role} title="Settings" kicker="Organization" orgName={network.activeOrganization.name}><section className="settings-grid">{['Team access', 'Notifications', 'Operating regions', 'Verification', 'Templates'].map((item) => <article key={item}><h2>{item}</h2><p>Configured for {network.activeOrganization.name}.</p></article>)}</section></AppShell>
}
