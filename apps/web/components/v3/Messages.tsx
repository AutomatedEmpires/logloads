"use client"

import Link from "next/link"

import type { MessagesData } from "@/lib/messages-data"
import type { MessageDraftScope } from "@/lib/message-submission"
import type { NetworkView } from "@/lib/network"
import { formatDateTime } from "@/lib/v3-shared"
import { StartConversation, ThreadComposer } from "./MessageActions"
import { AppShell, EmptyState, type ShellAccount } from "./Shells"

type MessagesRole = "driver" | "fleet" | "host"

const NEW_MESSAGE_HINTS: Record<MessagesRole, string> = {
  driver: "People to message appear once you hold an active assignment. Request capacity on a load that fits to get connected.",
  fleet: "People to message appear once your drivers hold active assignments. Dispatch a truck to get connected.",
  host: "People to message appear once drivers commit to your posted work. Approve a capacity request to get connected."
}

const EMPTY_LIST_ACTION: Record<MessagesRole, { href: string; label: string }> = {
  driver: { href: "/driver/loads", label: "Find loads" },
  fleet: { href: "/fleet/dispatch", label: "Open dispatch" },
  host: { href: "/host/opportunities", label: "Post work" }
}

interface MessagesPageProps {
  network: NetworkView
  role: MessagesRole
  account?: ShellAccount
  data: MessagesData
}

export function MessagesPage({ account, data, network, role }: MessagesPageProps) {
  const basePath = `/${role}/messages`
  const threads = network.messages
  const selected = data.selectedThread
  const pane = selected || data.threadNotFound ? "thread" : "list"
  const totalUnread = Object.values(data.unreadByThread).reduce((sum, count) => sum + count, 0)
  const draftScope: MessageDraftScope = {
    cockpit: role,
    organizationId: network.activeOrganization.id,
    viewerUserId: data.viewerUserId
  }
  const draftScopeKey = JSON.stringify([
    draftScope.cockpit,
    draftScope.organizationId,
    draftScope.viewerUserId
  ])

  return (
    <AppShell account={account} kicker="Connected conversations" orgName={network.activeOrganization.name} role={role} title="Messages">
      <section className="messages-workspace" data-pane={pane}>
        <aside aria-label="Conversations" className="messages-list-pane">
          <header className="messages-list-pane__header">
            <div>
              <p className="eyebrow">Inbox</p>
              <strong>{threads.length === 1 ? "1 conversation" : `${threads.length} conversations`}</strong>
            </div>
            {totalUnread > 0 ? (
              <span aria-label={`${totalUnread} unread`} className="unread-pill">{totalUnread}</span>
            ) : null}
          </header>
          <StartConversation
            counterparties={data.counterparties}
            draftScope={draftScope}
            emptyHint={NEW_MESSAGE_HINTS[role]}
            key={draftScopeKey}
          />
          {threads.length === 0 ? (
            <EmptyState
              actionHref={data.counterparties.length === 0 ? EMPTY_LIST_ACTION[role].href : undefined}
              actionLabel={data.counterparties.length === 0 ? EMPTY_LIST_ACTION[role].label : undefined}
              body="Messages stay connected to loads, assignments, and trips."
              title="No conversations yet."
            />
          ) : (
            <ul className="messages-thread-list">
              {threads.map((thread) => {
                const unread = data.unreadByThread[thread.id] ?? 0

                return (
                  <li key={thread.id}>
                    <Link
                      aria-current={selected?.id === thread.id ? "true" : undefined}
                      className={`thread-item${selected?.id === thread.id ? " is-active" : ""}${unread > 0 ? " has-unread" : ""}`}
                      href={`${basePath}?thread=${thread.id}`}
                    >
                      <span className="thread-item__top">
                        <strong>{thread.subject}</strong>
                        {unread > 0 ? (
                          <span aria-label={`${unread} unread message${unread === 1 ? "" : "s"}`} className="unread-pill">{unread}</span>
                        ) : thread.lastMessageAt ? (
                          <time dateTime={thread.lastMessageAt}>{formatDateTime(thread.lastMessageAt)}</time>
                        ) : null}
                      </span>
                      <span className="thread-context">{thread.contextLabel}</span>
                      <span className="thread-item__preview">{thread.lastMessage}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
        <section aria-label="Conversation" className="messages-thread-pane">
          {data.threadNotFound ? (
            <EmptyState
              actionHref={basePath}
              actionLabel="Back to conversations"
              body="It may have been archived, or your account is no longer a participant."
              title="Conversation not found."
            />
          ) : selected ? (
            <ThreadView
              basePath={basePath}
              draftScope={draftScope}
              draftScopeKey={draftScopeKey}
              thread={selected}
              viewerUserId={data.viewerUserId}
            />
          ) : (
            <div className="messages-thread-placeholder">
              <p className="eyebrow">Conversation</p>
              <strong>{threads.length === 0 ? "Nothing to open yet." : "Pick a conversation."}</strong>
              <p>
                {threads.length === 0
                  ? "Start one from an active assignment with New message."
                  : "Every conversation stays tied to the load, assignment, or trip it is about."}
              </p>
            </div>
          )}
        </section>
      </section>
    </AppShell>
  )
}

function ThreadView({
  basePath,
  draftScope,
  draftScopeKey,
  thread,
  viewerUserId
}: {
  basePath: string
  draftScope: MessageDraftScope
  draftScopeKey: string
  thread: NonNullable<MessagesData["selectedThread"]>
  viewerUserId: string
}) {
  const others = thread.participants.filter((participant) => participant.userId !== viewerUserId)

  return (
    <>
      <header className="messages-thread-header">
        <Link className="messages-back" href={basePath}>
          Back to conversations
        </Link>
        <h2>{thread.subject}</h2>
        <div className="messages-thread-header__meta">
          <span className="thread-context">{thread.contextLabel}</span>
          {others.length > 0 ? <span className="messages-participants">With {others.map((participant) => participant.name).join(", ")}</span> : null}
        </div>
      </header>
      <ol className="messages-stream">
        {thread.messages.length === 0 ? (
          <li className="messages-stream__empty">No messages in this conversation yet. Send the first one below.</li>
        ) : (
          thread.messages.map((message) => {
            const own = message.authorUserId === viewerUserId

            return (
              <li className={own ? "msg msg--own" : "msg"} key={message.id}>
                {!own ? <span className="msg__author">{message.authorName}</span> : null}
                <p>{message.body}</p>
                <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
              </li>
            )
          })
        )}
      </ol>
      <ThreadComposer
        draftScope={draftScope}
        key={`${draftScopeKey}:${thread.id}`}
        threadId={thread.id}
      />
    </>
  )
}
