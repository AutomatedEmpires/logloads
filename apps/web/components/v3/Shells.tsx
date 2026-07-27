"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import { Badge, Icon, type IconKey } from "@logloads/ui"

import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/cockpit-actions"
import {
  acceptInvitationAction,
  declineInvitationAction,
  signOutAction,
  switchOrganizationAction
} from "@/lib/session-actions"
import { BrandMark } from "./Brand"

export interface ShellNotification {
  id: string
  title: string
  body: string
  createdAt: string
  read: boolean
  relatedEntityType: string | null
  relatedEntityId: string | null
}

export interface ShellAccount {
  userName: string
  organizationName: string
  verificationStatus: string
  activeOrganizationId: string | null
  memberships: Array<{ id: string; name: string; role: string }>
  /** Workspace invitations waiting on THIS signed-in person's email. */
  pendingInvitations: Array<{ id: string; organizationName: string; roleLabel: string }>
  notifications: ShellNotification[]
  unreadCount: number
}

interface ShellProps {
  role: "driver" | "fleet" | "host" | "admin"
  title: string
  kicker: string
  contentOwnsHeading?: boolean
  orgName?: string
  account?: ShellAccount
  children: ReactNode
}

interface NavItem {
  href: string
  icon: IconKey
  label: string
}

export interface EmptyStateProps {
  actionHref?: string
  actionLabel?: string
  body: string
  title: string
}

export const publicNav: Array<[string, string]> = [
  ["Loads", "/loads"],
  ["Drivers", "/for-haulers"],
  ["Dispatch", "/for-fleets"],
  ["Hosts", "/for-landings"],
  ["Pricing", "/pricing"]
]

const navByRole: Record<ShellProps["role"], NavItem[]> = {
  admin: [
    { href: "/admin", icon: "nav.admin", label: "Command" },
    { href: "/admin/organizations", icon: "nav.fleet", label: "Organizations" },
    { href: "/admin/verification", icon: "status.verified", label: "Verification" },
    { href: "/admin/reports", icon: "status.warning", label: "Reports" },
    { href: "/admin/billing", icon: "load.pay", label: "Billing" }
  ],
  driver: [
    { href: "/driver/map", icon: "nav.map", label: "Map" },
    { href: "/driver/loads", icon: "nav.loads", label: "Loads" },
    { href: "/driver/schedule", icon: "load.schedule", label: "Schedule" },
    { href: "/driver/profile", icon: "nav.profile", label: "Profile" }
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

const desktopMoreByRole: Record<ShellProps["role"], NavItem[]> = {
  admin: [
    { href: "/admin/opportunities", icon: "nav.loads", label: "Opportunities" },
    { href: "/admin/reliability", icon: "status.verified", label: "Reliability" },
    { href: "/admin/disputes", icon: "ops.notice", label: "Cancellations" },
    { href: "/admin/notices", icon: "ops.notice", label: "Notices" },
    { href: "/admin/audit", icon: "ops.audit", label: "History" }
  ],
  driver: [
    { href: "/driver/messages", icon: "nav.messages", label: "Messages" },
    { href: "/driver/equipment", icon: "load.equipment", label: "Equipment" },
    { href: "/driver/assistant", icon: "action.search", label: "Assistant" },
    { href: "/driver/network", icon: "map.network", label: "Network" }
  ],
  fleet: [
    { href: "/fleet/drivers", icon: "nav.fleet", label: "Drivers" },
    { href: "/fleet/availability", icon: "load.schedule", label: "Availability" },
    { href: "/fleet/opportunities", icon: "nav.loads", label: "Opportunities" },
    { href: "/fleet/performance", icon: "status.verified", label: "Performance" },
    { href: "/fleet/assistant", icon: "action.search", label: "Assistant" },
    { href: "/fleet/network", icon: "map.network", label: "Network" },
    { href: "/fleet/billing", icon: "load.pay", label: "Billing" },
    { href: "/fleet/settings", icon: "truck.service", label: "Workspace" }
  ],
  host: [
    { href: "/host/landings", icon: "map.landing", label: "Landings" },
    { href: "/host/schedule", icon: "load.schedule", label: "Schedule" },
    { href: "/host/reliability", icon: "status.verified", label: "Reliability" },
    { href: "/host/assistant", icon: "action.search", label: "Assistant" },
    { href: "/host/analytics", icon: "ops.queue", label: "Analytics" },
    { href: "/host/billing", icon: "load.pay", label: "Billing" },
    { href: "/host/settings", icon: "truck.service", label: "Workspace" }
  ]
}

export function EmptyState({ actionHref, actionLabel, body, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon aria-hidden className="empty-state__icon" name="status.open" size={26} />
      <div className="empty-state__copy">
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {actionHref && actionLabel ? <Link className="action-link action-link--secondary" href={actionHref}>{actionLabel}</Link> : null}
    </div>
  )
}

// `value` is ReactNode so a metric can carry a live element — LocalTime, for
// one — instead of a pre-formatted string. Widening only: every existing
// string/number call site still type-checks.
export function Metric({ label, value }: { label: string; value: ReactNode }) {
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
  const pathname = usePathname()
  const headerRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false)
        triggerRef.current?.focus()
      }
    }
    const closeOnOutside = (event: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener("keydown", closeOnEscape)
    document.addEventListener("pointerdown", closeOnOutside)
    return () => {
      document.removeEventListener("keydown", closeOnEscape)
      document.removeEventListener("pointerdown", closeOnOutside)
    }
  }, [menuOpen])

  const isCurrent = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`))

  return (
    <header className="public-header" ref={headerRef}>
      <Link className="brand" href="/" aria-label="LogLoads home" onClick={() => setMenuOpen(false)}>
        <BrandMark priority size={44} />
        <span>LogLoads</span>
      </Link>
      <nav aria-label="Main navigation" className="public-header__nav">
        {publicNav.map(([label, href]) => <Link aria-current={isCurrent(href) ? "page" : undefined} href={href} key={href}>{label}</Link>)}
      </nav>
      <div className="public-actions">
        <Link href="/sign-in">Sign in</Link>
        <Link className="action-link" href="/sign-up">Get started</Link>
        <button
          aria-controls="public-mobile-menu"
          aria-expanded={menuOpen}
          className={menuOpen ? "public-menu-toggle is-open" : "public-menu-toggle"}
          onClick={() => setMenuOpen((current) => !current)}
          ref={triggerRef}
          type="button"
        >
          <span aria-hidden className="public-menu-toggle__bars"><i /><i /><i /></span>
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>
      </div>
      {menuOpen ? (
        <nav aria-label="Menu" className="public-mobile-menu" id="public-mobile-menu">
          {publicNav.map(([label, href]) => (
            <Link aria-current={isCurrent(href) ? "page" : undefined} href={href} key={href} onClick={() => setMenuOpen(false)}>{label}</Link>
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
      ["Contact", "/contact"],
      ["Facebook", "https://www.facebook.com/logloads"],
      ["Instagram", "https://www.instagram.com/logloads"]
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
            <BrandMark size={72} />
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
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PublicHeader />
      <div className="site-content" id="main-content" tabIndex={-1}>{children}</div>
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

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()

  if (Number.isNaN(then)) {
    return ""
  }

  const seconds = Math.round((Date.now() - then) / 1000)

  if (seconds < 60) {
    return "just now"
  }

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.round(hours / 24)
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString()
}

/**
 * Resolves a notification to a cockpit destination. Targets are role-scoped
 * because the same event (an assignment, a load) is viewed at different routes
 * per role. Unknown types stay unlinked rather than dead-linking.
 */
function notificationHref(role: ShellProps["role"], type: string | null, id: string | null): string | null {
  switch (type) {
    case "load":
    case "load_posting":
      return role === "driver"
        ? (id ? `/driver/loads/${id}` : "/driver/loads")
        : role === "host" ? "/host/opportunities" : "/fleet/opportunities"
    case "assignment":
      return role === "driver" ? "/driver/schedule" : role === "host" ? "/host/live-board" : "/fleet/dispatch"
    case "direct_offer":
      return role === "host" ? "/host/carriers" : "/fleet/opportunities"
    case "message_thread": {
      const messagesPath = role === "driver"
        ? "/driver/messages"
        : role === "host"
          ? "/host/messages"
          : "/fleet/messages"

      return id ? `${messagesPath}?thread=${encodeURIComponent(id)}` : messagesPath
    }
    case "support_request":
      return role === "admin"
        ? (id ? `/admin/reports#support-request-${id}` : "/admin/reports")
        : (id ? `/support#support-request-${id}` : "/support")
    default:
      return null
  }
}

function NotificationBell({ notifications, role, unreadCount }: {
  notifications: ShellNotification[]
  role: ShellProps["role"]
  unreadCount: number
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [visibleNotifications, setVisibleNotifications] = useState(notifications)
  const [visibleUnreadCount, setVisibleUnreadCount] = useState(unreadCount)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setVisibleNotifications(notifications)
    setVisibleUnreadCount(unreadCount)
  }, [notifications, unreadCount])

  useEffect(() => {
    if (!open) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const closeOnOutside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("keydown", closeOnEscape)
    document.addEventListener("pointerdown", closeOnOutside)
    return () => {
      document.removeEventListener("keydown", closeOnEscape)
      document.removeEventListener("pointerdown", closeOnOutside)
    }
  }, [open])

  function markOne(notificationId: string): void {
    startTransition(async () => {
      const result = await markNotificationReadAction({ notificationId })

      if (result.ok) {
        setVisibleNotifications((current) =>
          current.map((notification) =>
            notification.id === notificationId ? { ...notification, read: true } : notification
          )
        )
        setVisibleUnreadCount((current) => Math.max(0, current - 1))
      }
    })
  }

  function markAll(): void {
    startTransition(async () => {
      const result = await markAllNotificationsReadAction()

      if (result.ok) {
        setVisibleNotifications((current) =>
          current.map((notification) => ({ ...notification, read: true }))
        )
        setVisibleUnreadCount(0)
      }
    })
  }

  return (
    <div className="notif-bell" ref={containerRef}>
      <button
        aria-controls="notifications-panel"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={visibleUnreadCount > 0 ? `Notifications, ${visibleUnreadCount} unread` : "Notifications"}
        className="notif-bell__trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <Icon aria-hidden name="ops.notice" size={20} />
        {visibleUnreadCount > 0 ? <span className="notif-bell__count">{visibleUnreadCount > 9 ? "9+" : visibleUnreadCount}</span> : null}
      </button>
      {open ? (
        <div aria-label="Notifications" className="notif-bell__menu" id="notifications-panel" role="dialog">
          <div className="notif-bell__head">
            <strong>Notifications</strong>
            <button
              className="notif-bell__markall"
              disabled={visibleUnreadCount === 0 || isPending}
              onClick={markAll}
              type="button"
            >
              Mark all read
            </button>
          </div>
          {visibleNotifications.length === 0 ? (
            <p className="notif-bell__empty">You&rsquo;re all caught up.</p>
          ) : (
            <ul className="notif-bell__list">
              {visibleNotifications.map((notification) => {
                const href = notificationHref(role, notification.relatedEntityType, notification.relatedEntityId)
                const body = (
                  <>
                    <span className={`notif-dot${notification.read ? " is-read" : ""}`} aria-hidden />
                    <span className="notif-item__body">
                      <span className="notif-item__title">{notification.title}</span>
                      <span className="notif-item__text">{notification.body}</span>
                      <span className="notif-item__time">{relativeTime(notification.createdAt)}</span>
                    </span>
                  </>
                )

                return (
                  <li className={notification.read ? "is-read" : undefined} key={notification.id}>
                    {href ? (
                      <Link
                        className="notif-item"
                        href={href}
                        onClick={() => {
                          setOpen(false)
                          if (!notification.read) {
                            markOne(notification.id)
                          }
                        }}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        className="notif-item"
                        disabled={notification.read || isPending}
                        onClick={() => markOne(notification.id)}
                        type="button"
                      >
                        {body}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

function AccountMenu({ account, pathname }: { account: ShellAccount; pathname: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [invitationError, setInvitationError] = useState<string | null>(null)
  const [respondingInvitation, setRespondingInvitation] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const respondToInvitation = async (invitationId: string, accept: boolean) => {
    setInvitationError(null)
    setRespondingInvitation(`${accept ? "accept" : "decline"}:${invitationId}`)

    const result = accept
      ? await acceptInvitationAction(invitationId)
      : await declineInvitationAction(invitationId)

    setRespondingInvitation(null)

    if (!result.ok) {
      setInvitationError(result.error ?? "The invitation response did not go through. Try again.")
      return
    }

    setOpen(false)

    if (accept) {
      // The action response carries the active-workspace cookie. A hard
      // navigation guarantees the next render starts after the browser commits
      // that cookie; a same-tree refresh can race it and briefly reopen the old
      // workspace under a newly accepted membership.
      window.location.assign("/workspace")
      return
    }

    router.refresh()
  }

  useEffect(() => {
    if (!open) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const closeOnOutside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("keydown", closeOnEscape)
    document.addEventListener("pointerdown", closeOnOutside)
    return () => {
      document.removeEventListener("keydown", closeOnEscape)
      document.removeEventListener("pointerdown", closeOnOutside)
    }
  }, [open])

  return (
    <div className="account-switcher" ref={containerRef}>
      <button
        aria-controls="account-switcher-panel"
        aria-expanded={open}
        aria-label="Account and product feedback"
        className="account-switcher__trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <Icon aria-hidden className="account-switcher__profile-icon" name="nav.profile" size={20} />
        <span className="account-switcher__label">{account.organizationName}</span>
        <Badge tone={verificationTone(account.verificationStatus)}>{verificationLabel(account.verificationStatus)}</Badge>
      </button>
      {open ? (
        <div className="account-switcher__menu" id="account-switcher-panel">
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
          {account.pendingInvitations.length > 0 ? (
            <div className="account-switcher__orgs" role="group" aria-label="Workspace invitations">
              <span>Invitations</span>
              {account.pendingInvitations.map((invitation) => (
                <div className="account-switcher__invite" key={invitation.id}>
                  <p>
                    <strong>{invitation.organizationName}</strong>
                    <em> as {invitation.roleLabel}</em>
                  </p>
                  <button
                    disabled={respondingInvitation !== null}
                    onClick={() => void respondToInvitation(invitation.id, true)}
                    type="button"
                  >
                    {respondingInvitation === `accept:${invitation.id}` ? "Accepting…" : "Accept"}
                  </button>
                  <button
                    disabled={respondingInvitation !== null}
                    onClick={() => void respondToInvitation(invitation.id, false)}
                    type="button"
                  >
                    {respondingInvitation === `decline:${invitation.id}` ? "Declining…" : "Decline"}
                  </button>
                </div>
              ))}
              {invitationError ? (
                <p className="action-error" role="alert">
                  {invitationError}
                </p>
              ) : null}
            </div>
          ) : null}
          <Link
            className="account-switcher__support"
            href={{ pathname: "/support", query: { from: pathname } }}
            onClick={() => setOpen(false)}
          >
            <Icon aria-hidden name="ops.notice" size={18} />
            <span>Report a problem or request a feature</span>
          </Link>
          <button className="account-switcher__signout" onClick={() => void signOutAction()} type="button">
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

function MobileTools({ isCurrent, items }: { isCurrent: (href: string) => boolean; items: NavItem[] }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const closeOnOutside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("keydown", closeOnEscape)
    document.addEventListener("pointerdown", closeOnOutside)
    return () => {
      document.removeEventListener("keydown", closeOnEscape)
      document.removeEventListener("pointerdown", closeOnOutside)
    }
  }, [open])

  return (
    <div className="mobile-tools" ref={containerRef}>
      <button
        aria-controls="mobile-tools-panel"
        aria-expanded={open}
        aria-label={open ? "Close more tools" : "Open more tools"}
        className="mobile-tools__trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <Icon aria-hidden name="truck.service" size={20} />
        <span>Tools</span>
      </button>
      {open ? (
        <div className="mobile-tools__panel" id="mobile-tools-panel">
          <div className="mobile-tools__head">
            <div><span>More tools</span><strong>Everything in this workspace</strong></div>
            <button onClick={() => { setOpen(false); triggerRef.current?.focus() }} type="button">Close</button>
          </div>
          <nav aria-label="More tools">
            {items.map((item) => (
              <Link aria-current={isCurrent(item.href) ? "page" : undefined} href={item.href} key={item.href} onClick={() => setOpen(false)}>
                <Icon aria-hidden name={item.icon} size={20} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  )
}

export function AppShell({ account, children, contentOwnsHeading = false, kicker, orgName, role, title }: ShellProps) {
  const pathname = usePathname()
  const primaryNav = navByRole[role]
  const toolsNav = desktopMoreByRole[role]
  const currentHref = [...primaryNav, ...toolsNav]
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href
  const isCurrent = (href: string) => currentHref === href

  return (
    <div className={`app-shell app-shell--${role}`}>
      <a className="skip-link" href="#app-content">Skip to main content</a>
      <aside className="app-sidebar">
        <Link className="brand" href="/">
          <BrandMark priority size={44} />
          <span>LogLoads</span>
        </Link>
        <nav aria-label={`${role} primary navigation`}>
          <span className="app-sidebar__label">Workspace</span>
          {primaryNav.map((item) => (
            <Link aria-current={isCurrent(item.href) ? "page" : undefined} href={item.href} key={item.href}>
              <Icon aria-hidden name={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label={`${role} tools`}>
          <span className="app-sidebar__label">More tools</span>
          {toolsNav.map((item) => (
            <Link aria-current={isCurrent(item.href) ? "page" : undefined} href={item.href} key={item.href}>
              <Icon aria-hidden name={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <main className="app-main" id="app-content" tabIndex={-1}>
        <header className="app-topbar">
          <div>
            <p className="eyebrow">{kicker}</p>
            {contentOwnsHeading ? <p className="app-topbar__title">{title}</p> : <h1>{title}</h1>}
          </div>
          {account ? (
            <div className="app-topbar__account">
              <MobileTools isCurrent={isCurrent} items={toolsNav} />
              <NotificationBell notifications={account.notifications} role={role} unreadCount={account.unreadCount} />
              <AccountMenu account={account} pathname={pathname} />
            </div>
          ) : (
            <div className="app-topbar__account">
              <MobileTools isCurrent={isCurrent} items={toolsNav} />
              <div className="account-switcher"><span>{orgName ?? "Platform"}</span></div>
            </div>
          )}
        </header>
        {children}
      </main>
      <nav className="mobile-app-nav" aria-label={`${role} mobile navigation`}>
        {primaryNav.map((item) => (
          <Link aria-current={isCurrent(item.href) ? "page" : undefined} href={item.href} key={item.href}>
            <Icon aria-hidden name={item.icon} size={20} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
