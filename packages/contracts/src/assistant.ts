/**
 * Operator assistant — a deterministic, grounded question-answering engine.
 *
 * It reasons ONLY over an `AssistantGrounding` snapshot derived from the viewer's
 * own network read model — never external data, never another org's data. Answers
 * are plain language with fit labels and reasons; the engine never has (and never
 * emits) a numeric match score. An optional LLM layer may rephrase the answer
 * downstream, but this module is pure, synchronous, and fully testable on its own.
 */

export type AssistantRole = "driver" | "fleet" | "host" | "admin"

export interface AssistantCitation {
  label: string
  href: string
}

export interface AssistantLoadFacts {
  loadId: string
  title: string
  lane: string
  statusLabel: string
  fitLabel: string
  requestable: boolean
  remaining: number
  scheduleLabel: string
  payLabel: string
  reasons: string[]
  blockers: string[]
  recommended: boolean
}

export interface AssistantTripFacts {
  loadTitle: string
  statusLabel: string
  driverName: string
}

export interface AssistantNoticeFacts {
  severity: "info" | "watch" | "critical"
  title: string
  body: string
}

export interface AssistantAvailabilityFacts {
  equipmentLabel: string
  statusLabel: string
  windowLabel: string
}

export interface AssistantRecommendationFacts {
  loadId: string
  title: string
  lane: string
  label: string
  reasons: string[]
  scheduleLabel: string
  payLabel: string
}

export interface AssistantGrounding {
  role: AssistantRole
  orgName: string
  viewerName: string
  hasTruck: boolean
  metrics: { openLoads: number; trucksAvailable: number; activeAssignments: number; criticalNotices: number }
  recommendations: AssistantRecommendationFacts[]
  loads: AssistantLoadFacts[]
  trips: AssistantTripFacts[]
  notices: AssistantNoticeFacts[]
  availability: AssistantAvailabilityFacts[]
  reputation: { label: string; avgRating: number | null; ratedCount: number } | null
}

export type AssistantIntent =
  | "help"
  | "recommendations"
  | "blocked"
  | "alerts"
  | "availability"
  | "trips"
  | "reputation"
  | "overview"

export interface AssistantAnswer {
  intent: AssistantIntent
  answer: string
  citations: AssistantCitation[]
}

interface RoleRoutes {
  loads: string
  trips: string
  equipment: string
  performance: string
  loadDetail: (loadId: string) => string
}

function routesFor(role: AssistantRole): RoleRoutes {
  switch (role) {
    case "driver":
      return { loads: "/driver/loads", trips: "/driver/schedule", equipment: "/driver/equipment", performance: "/driver/profile", loadDetail: (id) => `/driver/loads/${id}` }
    case "fleet":
      return { loads: "/fleet/opportunities", trips: "/fleet/trips", equipment: "/fleet/trucks", performance: "/fleet/performance", loadDetail: (id) => `/fleet/opportunities/${id}` }
    case "host":
      return { loads: "/host/opportunities", trips: "/host/live-board", equipment: "/host/landings", performance: "/host/reliability", loadDetail: () => "/host/opportunities" }
    default:
      return { loads: "/admin/opportunities", trips: "/admin", equipment: "/admin", performance: "/admin/reliability", loadDetail: () => "/admin/opportunities" }
  }
}

const INTENT_PATTERNS: Array<{ intent: AssistantIntent; test: RegExp }> = [
  { intent: "help", test: /\b(help|what can you|who are you|what do you do|how do you work)\b/ },
  { intent: "recommendations", test: /\b(recommend|what should i (haul|take|drive|do|run)|can i haul|haul (today|tonight|tomorrow|next|now)|best (load|work|match|option|run)|good fit|which load|find (me )?(work|a load|loads?)|top (pick|match))/ },
  { intent: "blocked", test: /\b(why (can'?t|cannot|can ?not|is|won'?t|are)|blocked|ineligible|not compatible|can'?t request|no slot|not showing|turned down|rejected|declined)/ },
  { intent: "alerts", test: /\b(alerts?|notices?|warnings?|hazards?|weather|closed|closure|problems?|issues?|urgent|critical|watch out)\b/ },
  { intent: "availability", test: /\b(availab|capacity|free trucks?|open trucks?|who can haul|drivers? (free|open|available)|open slots?|when can)/ },
  { intent: "trips", test: /\b(trips?|hauls\b|hauling|current|active|in progress|where am i|my loads?|delivery|on the road|status of my)/ },
  { intent: "reputation", test: /\b(reputation|ratings?|reviews?|stars?|how am i doing|my (score|standing)|trusted|on.?time|reliab)/ },
  { intent: "overview", test: /\b(overview|summary|snapshot|dashboard|how many|today|what'?s (going on|happening|new)|status)\b/ }
]

function classify(question: string): AssistantIntent {
  const normalized = question.toLowerCase()

  for (const { intent, test } of INTENT_PATTERNS) {
    if (test.test(normalized)) {
      return intent
    }
  }

  return "overview"
}

function loadCitation(routes: RoleRoutes, load: { loadId: string; title: string }): AssistantCitation {
  return { href: routes.loadDetail(load.loadId), label: load.title }
}

function answerRecommendations(g: AssistantGrounding, routes: RoleRoutes): AssistantAnswer {
  if (g.recommendations.length === 0) {
    if (!g.hasTruck) {
      return {
        answer: "I can't match work yet because there's no truck on file. Add your truck and trailer, then I'll rank the loads that fit it.",
        citations: [{ href: routes.equipment, label: "Add equipment" }],
        intent: "recommendations"
      }
    }

    return {
      answer: "No open loads fit your setup right now. Keep your availability current and I'll surface new matches here the moment they post.",
      citations: [{ href: routes.loads, label: "Browse all loads" }],
      intent: "recommendations"
    }
  }

  const top = g.recommendations.slice(0, 3)
  const lines = [`Best matches for ${g.orgName} right now:`]

  for (const rec of top) {
    const reason = rec.reasons[0] ? ` ${rec.reasons[0]}` : ""
    lines.push(`• ${rec.title} — ${rec.lane}. ${rec.label}. ${rec.scheduleLabel} · ${rec.payLabel}.${reason}`)
  }

  lines.push("Open one to request it, or ask me why a specific load fits.")

  return {
    answer: lines.join("\n"),
    citations: [...top.map((rec) => loadCitation(routes, rec)), { href: routes.loads, label: "All ranked loads" }],
    intent: "recommendations"
  }
}

function answerBlocked(g: AssistantGrounding, routes: RoleRoutes): AssistantAnswer {
  const blocked = g.loads.filter((load) => load.blockers.length > 0)

  if (blocked.length === 0) {
    const requestable = g.loads.filter((load) => load.requestable).length

    if (!g.hasTruck) {
      return {
        answer: "Nothing's rejecting you specifically — there's just no truck on file yet, so matching can't run. Add your equipment and I'll show what fits.",
        citations: [{ href: routes.equipment, label: "Add equipment" }],
        intent: "blocked"
      }
    }

    return {
      answer: requestable > 0
        ? `Nothing is blocking you right now — ${requestable} ${requestable === 1 ? "load is" : "loads are"} open for you to request.`
        : "Nothing is blocking you, but there are no open slots to request at the moment. Check back as new loads post.",
      citations: [{ href: routes.loads, label: "See loads" }],
      intent: "blocked"
    }
  }

  const focus = blocked.slice(0, 3)
  const lines = ["These loads don't fit yet — here's what's in the way:"]

  for (const load of focus) {
    lines.push(`• ${load.title} (${load.lane}): ${load.blockers[0]}`)
  }

  lines.push("Fix the equipment or access gap above and they'll open up.")

  return {
    answer: lines.join("\n"),
    citations: focus.map((load) => loadCitation(routes, load)),
    intent: "blocked"
  }
}

function answerTrips(g: AssistantGrounding, routes: RoleRoutes): AssistantAnswer {
  if (g.trips.length === 0) {
    return {
      answer: "No active hauls on record. Once a request is approved, the trip and its next step show up here.",
      citations: [{ href: routes.trips, label: "Trips" }],
      intent: "trips"
    }
  }

  const lines = ["Here's your current haul activity:"]

  for (const trip of g.trips.slice(0, 5)) {
    lines.push(`• ${trip.loadTitle} — ${trip.statusLabel}${trip.driverName ? ` (${trip.driverName})` : ""}`)
  }

  return {
    answer: lines.join("\n"),
    citations: [{ href: routes.trips, label: "Open trips" }],
    intent: "trips"
  }
}

function answerAlerts(g: AssistantGrounding, routes: RoleRoutes): AssistantAnswer {
  if (g.notices.length === 0) {
    return { answer: "No open alerts — you're all clear right now.", citations: [], intent: "alerts" }
  }

  const order = { critical: 0, watch: 1, info: 2 }
  const sorted = [...g.notices].sort((a, b) => order[a.severity] - order[b.severity])
  const lines = ["Here's what needs your attention:"]

  for (const notice of sorted.slice(0, 5)) {
    const tag = notice.severity === "critical" ? "Urgent" : notice.severity === "watch" ? "Watch" : "Note"
    lines.push(`• [${tag}] ${notice.title}: ${notice.body}`)
  }

  return { answer: lines.join("\n"), citations: [{ href: routes.loads, label: "Review loads" }], intent: "alerts" }
}

function answerAvailability(g: AssistantGrounding, routes: RoleRoutes): AssistantAnswer {
  // A host owns no trucks and can't see other operations' carrier capacity from
  // here — so never report the host's own (always-zero) trucks or tell them to
  // post availability. Point them at where committed capacity actually shows up.
  if (g.role === "host") {
    return {
      answer: "Carriers claim capacity as your loads post — I can't see other operations' trucks from here. Open your live board to see who's committed to your landings, and post more loads to draw capacity.",
      citations: [{ href: routes.trips, label: "Live board" }, { href: routes.loads, label: "Your loads" }],
      intent: "availability"
    }
  }

  const lead = g.role === "driver"
    ? `You have ${g.availability.length} availability ${g.availability.length === 1 ? "window" : "windows"} posted.`
    : `${g.metrics.trucksAvailable} ${g.metrics.trucksAvailable === 1 ? "truck is" : "trucks are"} available across ${g.orgName}.`

  if (g.availability.length === 0) {
    const tail = g.role === "driver"
      ? "Post when you can haul so hosts can plan around you."
      : "Post your trucks' availability so hosts can plan around your fleet."

    return {
      answer: `${lead} ${tail}`,
      citations: [{ href: routes.equipment, label: g.role === "driver" ? "Set availability" : "Fleet availability" }],
      intent: "availability"
    }
  }

  const lines = [lead]

  for (const window of g.availability.slice(0, 5)) {
    lines.push(`• ${window.equipmentLabel} — ${window.statusLabel}, ${window.windowLabel}`)
  }

  return { answer: lines.join("\n"), citations: [{ href: routes.equipment, label: "Availability" }], intent: "availability" }
}

function answerOverview(g: AssistantGrounding, routes: RoleRoutes): AssistantAnswer {
  const lines = [`Here's the snapshot for ${g.orgName}:`]
  lines.push(`• ${g.metrics.openLoads} open ${g.metrics.openLoads === 1 ? "load" : "loads"}`)

  if (g.role !== "driver") {
    lines.push(`• ${g.metrics.trucksAvailable} ${g.metrics.trucksAvailable === 1 ? "truck" : "trucks"} available`)
  }

  lines.push(`• ${g.metrics.activeAssignments} active ${g.metrics.activeAssignments === 1 ? "assignment" : "assignments"}`)

  if (g.metrics.criticalNotices > 0) {
    lines.push(`• ${g.metrics.criticalNotices} urgent ${g.metrics.criticalNotices === 1 ? "alert" : "alerts"} to review`)
  }

  if (g.recommendations.length > 0 && g.role !== "host") {
    lines.push(`Top match: ${g.recommendations[0]?.title} (${g.recommendations[0]?.lane}). Ask "what should I haul?" for the full ranking.`)
  }

  const citations: AssistantCitation[] = [{ href: routes.loads, label: "Loads" }, { href: routes.trips, label: "Trips" }]

  return { answer: lines.join("\n"), citations, intent: "overview" }
}

function answerReputation(g: AssistantGrounding, routes: RoleRoutes): AssistantAnswer {
  const label = g.role === "host" ? "Your landing rating" : "Your rating"

  if (!g.reputation) {
    return {
      answer: "You don't have reviews yet — they start rolling in after your first cross-company haul completes. Keep delivering and your track record builds itself.",
      citations: [{ href: routes.performance, label: "Reliability" }],
      intent: "reputation"
    }
  }

  return {
    answer: `${label}: ${g.reputation.label}. Open your reliability page for on-time and completion rates and the full breakdown.`,
    citations: [{ href: routes.performance, label: "Reliability" }],
    intent: "reputation"
  }
}

function answerHelp(g: AssistantGrounding): AssistantAnswer {
  const lines = [
    "I'm your operations assistant. I answer from what's live in your workspace right now — your loads, matches, trips, and alerts. Try asking:"
  ]

  for (const prompt of suggestedPrompts(g)) {
    lines.push(`• ${prompt}`)
  }

  return { answer: lines.join("\n"), citations: [], intent: "help" }
}

export function suggestedPrompts(g: AssistantGrounding): string[] {
  switch (g.role) {
    case "driver":
      return [
        "What should I haul next?",
        "Why can't I request a load?",
        "How's my reputation?",
        "Any alerts I should know about?"
      ]
    case "fleet":
      return [
        "What are the best loads for my trucks?",
        "How's our reputation?",
        "What's my current haul activity?",
        "Any critical alerts?"
      ]
    case "host":
      return [
        "How many loads are open?",
        "How's my landing rated?",
        "Any alerts on my loads?",
        "Give me a snapshot."
      ]
    default:
      return ["Give me a snapshot.", "Any urgent alerts?"]
  }
}

export function answerOperatorQuestion(grounding: AssistantGrounding, question: string): AssistantAnswer {
  const routes = routesFor(grounding.role)
  const trimmed = question.trim()

  if (trimmed.length === 0) {
    return answerHelp(grounding)
  }

  switch (classify(trimmed)) {
    case "help":
      return answerHelp(grounding)
    case "recommendations":
      return answerRecommendations(grounding, routes)
    case "blocked":
      return answerBlocked(grounding, routes)
    case "alerts":
      return answerAlerts(grounding, routes)
    case "availability":
      return answerAvailability(grounding, routes)
    case "trips":
      return answerTrips(grounding, routes)
    case "reputation":
      return answerReputation(grounding, routes)
    default:
      return answerOverview(grounding, routes)
  }
}
