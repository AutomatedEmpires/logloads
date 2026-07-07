"use client"

import Link from "next/link"
import { useState, type ReactNode } from "react"
import { Badge, Icon, type IconKey } from "@logloads/ui"

import { signOutAction, switchOrganizationAction } from "@/lib/session-actions"

export interface ShellAccount {
  userName: string
  organizationName: string
  verificationStatus: string
  activeOrganizationId: string | null
  memberships: Array<{ id: string; name: string; role: string }>
}

interface ShellProps {
  role: "driver" | "fleet" | "host" | "admin"
  title: string
  kicker: string
  orgName?: string
  account?: ShellAccount
  children: ReactNode
}

export interface EmptyStateProps {
  actionHref?: string
  actionLabel?: string
  body: string
  title: string
}

export const publicNav: Array<[string, string]> = [
  ["Loads", "/loads"],
  ["How it works", "/how-it-works"],
  ["Haulers", "/for-haulers"],
  ["Fleets", "/for-fleets"],
  ["Hosts", "/for-landings"],
  ["Pricing", "/pricing"],
  ["Trust", "/trust"]
]

const navByRole: Record<ShellProps["role"], Array<{ href: string; icon: IconKey; label: string }>> = {
  admin: [
    { href: "/admin", icon: "nav.admin", label: "Command" },
    { href: "/admin/organizations", icon: "nav.fleet", label: "Organizations" },
    { href: "/admin/verification", icon: "status.verified", label: "Verification" },
    { href: "/admin/reports", icon: "status.warning", label: "Reports" },
    { href: "/admin/billing", icon: "load.pay", label: "Billing" }
  ],
  driver: [
    { href: "/driver/today", icon: "status.open", label: "Today" },
    { href: "/driver/loads", icon: "nav.loads", label: "Loads" },
    { href: "/driver/trips", icon: "nav.trips", label: "Trips" },
    { href: "/driver/messages", icon: "nav.messages", label: "Messages" },
    { href: "/driver/profile", icon: "nav.admin", label: "Me" }
  ],
  fleet: [
    { href: "/fleet/command", icon: "ops.queue", label: "Command" },
    { href: "/fleet/dispatch", icon: "nav.fleet", label: "Dispatch" },
    { href: "/fleet/trips", icon: "nav.trips", label: "Trips" },
    { href: "/fleet/messages", icon: "nav.messages", label: "Messages" },
    { href: "/fleet/trucks", icon: "truck.log", label: "Trucks" }
  ],
  host: [
    { href: "/host/command", icon: "ops.queue", label: "Command" },
    { href: "/host/opportunities", icon: "nav.loads", label: "Work" },
    { href: "/host/live-board", icon: "map.network", label: "Live" },
    { href: "/host/messages", icon: "nav.messages", label: "Messages" },
    { href: "/host/carriers", icon: "nav.fleet", label: "Carriers" }
  ]
}

const desktopMoreByRole: Record<ShellProps["role"], Array<{ href: string; icon: IconKey; label: string }>> = {
  admin: [
    { href: "/admin/opportunities", icon: "nav.loads", label: "Opportunities" },
    { href: "/admin/disputes", icon: "ops.notice", label: "Disputes" },
    { href: "/admin/notices", icon: "ops.notice", label: "Notices" },
    { href: "/admin/audit", icon: "ops.audit", label: "History" }
  ],
  driver: [
    { href: "/driver/map", icon: "nav.map", label: "Map" },
    { href: "/driver/equipment", icon: "load.equipment", label: "Equipment" },
    { href: "/driver/network", icon: "map.network", label: "Network" }
  ],
  fleet: [
    { href: "/fleet/drivers", icon: "nav.fleet", label: "Drivers" },
    { href: "/fleet/availability", icon: "load.schedule", label: "Availability" },
    { href: "/fleet/opportunities", icon: "nav.loads", label: "Opportunities" },
    { href: "/fleet/network", icon: "map.network", label: "Network" },
    { href: "/fleet/billing", icon: "load.pay", label: "Billing" },
    { href: "/fleet/settings", icon: "truck.service", label: "Settings" }
  ],
  host: [
    { href: "/host/landings", icon: "map.landing", label: "Landings" },
    { href: "/host/schedule", icon: "load.schedule", label: "Schedule" },
    { href: "/host/analytics", icon: "ops.queue", label: "Analytics" },
    { href: "/host/billing", icon: "load.pay", label: "Billing" },
    { href: "/host/settings", icon: "truck.service", label: "Settings" }
  ]
}

export function EmptyState({ actionHref, actionLabel, body, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
      {actionHref && actionLabel ? <Link className="action-link action-link--secondary" href={actionHref}>{actionLabel}</Link> : null}
    </div>
  )
}

export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-tile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

export function SectionHeader({ action, eyebrow, title }: { action?: ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  )
}

export function PageIntro({ body, eyebrow, title }: { body: string; eyebrow: string; title: string }) {
  return (
    <section className="page-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  )
}

function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="public-header">
      <Link className="brand" href="/" aria-label="LogLoads home" onClick={() => setMenuOpen(false)}>
        <span className="brand-mark">LL</span>
        <span>LogLoads</span>
      </Link>
      <nav aria-label="Main navigation" className="public-header__nav">
        {publicNav.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
      </nav>
      <div className="public-actions">
        <Link href="/sign-in">Sign in</Link>
        <Link className="action-link" href="/sign-up">Get started</Link>
        <button
          aria-controls="public-mobile-menu"
          aria-expanded={menuOpen}
          className={menuOpen ? "public-menu-toggle is-open" : "public-menu-toggle"}
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden className="public-menu-toggle__bars"><i /><i /><i /></span>
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>
      </div>
      {menuOpen ? (
        <nav aria-label="Menu" className="public-mobile-menu" id="public-mobile-menu">
          {publicNav.map(([label, href]) => (
            <Link href={href} key={href} onClick={() => setMenuOpen(false)}>{label}</Link>
          ))}
          <div className="public-mobile-menu__actions">
            <Link className="action-link action-link--secondary" href="/sign-in" onClick={() => setMenuOpen(false)}>Sign in</Link>
            <Link className="action-link" href="/sign-up" onClick={() => setMenuOpen(false)}>Get started</Link>
          </div>
        </nav>
      ) : null}
    </header>
  )
}

const footerColumns: Array<{ heading: string; links: Array<[string, string]> }> = [
  {
    heading: "Product",
    links: [
      ["Loads", "/loads"],
      ["How it works", "/how-it-works"],
      ["Pricing", "/pricing"],
      ["Trust", "/trust"]
    ]
  },
  {
    heading: "Who it serves",
    links: [
      ["Haulers", "/for-haulers"],
      ["Fleets", "/for-fleets"],
      ["Hosts", "/for-landings"]
    ]
  },
  {
    heading: "Company",
    links: [
      ["About", "/about"],
      ["Contact", "/contact"]
    ]
  },
  {
    heading: "Legal",
    links: [
      ["Terms", "/terms"],
      ["Privacy", "/privacy"],
      ["Marketplace Rules", "/marketplace-rules"],
      ["Acceptable Use", "/acceptable-use"]
    ]
  }
]

function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer__grid">
        <div className="public-footer__brand">
          <Link className="brand" href="/">
            <span className="brand-mark">LL</span>
            <span>LogLoads</span>
          </Link>
          <p>Timber needs trucks. Trucks need work. LogLoads connects the operation from landing to mill.</p>
        </div>
        {footerColumns.map((column) => (
          <nav aria-label={column.heading} className="public-footer__column" key={column.heading}>
            <span>{column.heading}</span>
            {column.links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
          </nav>
        ))}
      </div>
      <div className="public-footer__legal">
        <p>LogLoads is coordination software. It does not broker freight and does not move freight payment.</p>
        <p>&copy; 2026 LogLoads</p>
      </div>
    </footer>
  )
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <PublicHeader />
      {children}
      <PublicFooter />
    </div>
  )
}

function verificationTone(status: string): "success" | "warning" | "critical" | "info" {
  if (status === "verified") {
    return "success"
  }

  if (status === "rejected" || status === "suspended") {
    return "critical"
  }

  return "warning"
}

function verificationLabel(status: string): string {
  if (status === "verified") {
    return "Verified"
  }

  if (status === "rejected") {
    return "Not approved"
  }

  if (status === "suspended") {
    return "Suspended"
  }

  return "Review pending"
}

function AccountMenu({ account }: { account: ShellAccount }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="account-switcher">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="account-switcher__trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{account.organizationName}</span>
        <Badge tone={verificationTone(account.verificationStatus)}>{verificationLabel(account.verificationStatus)}</Badge>
      </button>
      {open ? (
        <div className="account-switcher__menu" role="menu">
          <p className="account-switcher__user">{account.userName}</p>
          {account.memberships.length > 1 ? (
            <div className="account-switcher__orgs">
              <span>Switch workspace</span>
              {account.memberships.map((membership) => (
                <button
                  className={membership.id === account.activeOrganizationId ? "is-active" : undefined}
                  key={membership.id}
                  onClick={() => {
                    setOpen(false)
                    void switchOrganizationAction(membership.id)
                  }}
                  type="button"
                >
                  {membership.name}
                  <em>{membership.role.replaceAll("_", " ")}</em>
                </button>
              ))}
            </div>
          ) : null}
          <button className="account-switcher__signout" onClick={() => void signOutAction()} type="button">
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function AppShell({ account, children, kicker, orgName, role, title }: ShellProps) {
  const nav = [...navByRole[role], ...desktopMoreByRole[role]]

  return (
    <div className={`app-shell app-shell--${role}`}>
      <aside className="app-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">LL</span>
          <span>LogLoads</span>
        </Link>
        <nav aria-label={`${role} navigation`}>
          {nav.map((item) => (
            <Link href={item.href} key={item.href}>
              <Icon aria-hidden name={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div>
            <p className="eyebrow">{kicker}</p>
            <h1>{title}</h1>
          </div>
          {account ? (
            <AccountMenu account={account} />
          ) : (
            <div className="account-switcher">
              <span>{orgName ?? "Platform"}</span>
            </div>
          )}
        </header>
        {children}
      </div>
      <nav className="mobile-app-nav" aria-label={`${role} mobile navigation`}>
        {navByRole[role].map((item) => (
          <Link href={item.href} key={item.href}>
            <Icon aria-hidden name={item.icon} size={20} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
