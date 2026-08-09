import type { IconKey } from "@logloads/ui"

export const pilotRoleSlugs = ["host", "fleet", "driver"] as const

export type PilotRole = (typeof pilotRoleSlugs)[number]

export interface PilotSurface {
  alt: string
  description: string
  group: string
  height: number
  image: string
  slug: string
  title: string
  width: number
}

export interface PilotRoleSpec {
  commercialTruth: string
  contactLabel: string
  eyebrow: string
  icon: IconKey
  label: string
  pilotNeeds: readonly string[]
  signupHref: string
  signupLabel: string
  summary: string
  surfaces: readonly PilotSurface[]
  title: string
  tourOutcomes: readonly string[]
}

export interface PilotLifecycleStage {
  body: string
  icon: IconKey
  label: string
  roleNotes: Record<PilotRole, string>
}

export const pilotCaptureDisclosure =
  "Current-product capture from a disposable synthetic workspace. No private real-world data is shown."

export const pilotTourBoundary =
  "This public tour is read-only. It does not create an account, read or change operating state, send a message, upload a file, enroll an organization, or create a charge."

export const pilotLifecycle: readonly PilotLifecycleStage[] = [
  {
    body: "Define the timber, landing, destination, pay, equipment, timing, and access boundaries before work reaches the board.",
    icon: "ops.document",
    label: "Plan",
    roleNotes: {
      driver: "Keep the profile, rig, credentials, availability, and working radius current.",
      fleet: "Set available trucks, qualified drivers, equipment, and operating windows.",
      host: "Prepare the landing, load value, destination, equipment, schedule, and private route pack."
    }
  },
  {
    body: "Publish a clear opportunity while exact gates, private roads, contacts, and sensitive coordinates remain protected.",
    icon: "nav.loads",
    label: "Publish",
    roleNotes: {
      driver: "See understandable regional work without receiving private access details too early.",
      fleet: "See opportunities that can be evaluated against declared capacity.",
      host: "Move reviewed work from draft to the live board for the intended audience."
    }
  },
  {
    body: "Compare work with truck, trailer, capacity, timing, distance, and relationship access before anyone commits.",
    icon: "action.search",
    label: "Match",
    roleNotes: {
      driver: "Know the stated pay, estimated fuel economics, equipment fit, and schedule before requesting.",
      fleet: "Choose the right unit and driver instead of broadcasting work across the fleet.",
      host: "Review qualified capacity and preserve a clear reason for the operating decision."
    }
  },
  {
    body: "Turn an accepted request into one accountable assignment with frozen operating and commercial terms.",
    icon: "status.assigned",
    label: "Commit",
    roleNotes: {
      driver: "Receive a clear decision, booked window, assignment, and next action.",
      fleet: "Commit named capacity without double-booking a truck or driver.",
      host: "Approve the assignment and release private access only to authorized participants."
    }
  },
  {
    body: "Keep the schedule, assignment-scoped conversation, current notice, route access, and exception owner together.",
    icon: "nav.messages",
    label: "Coordinate",
    roleNotes: {
      driver: "See where to go, what changed, who needs a response, and what happens next.",
      fleet: "Keep dispatch, driver, truck, timing, and exceptions aligned from one queue.",
      host: "See committed capacity, arrival timing, notices, and unresolved operating risks."
    }
  },
  {
    body: "Move the physical load with the active trip, field status, and protected route pack visible to the right people.",
    icon: "truck.log",
    label: "Haul",
    roleNotes: {
      driver: "Work from a phone-first trip view built for the cab and landing.",
      fleet: "Monitor active movements and intervene only where the operation needs attention.",
      host: "Follow what is moving now without chasing every participant by phone."
    }
  },
  {
    body: "Record physical completion, host review, direct driver-payment status, and the next repeatable operating decision.",
    icon: "status.verified",
    label: "Confirm",
    roleNotes: {
      driver: "Confirm completion and remain the only person who can mark direct driver pay received.",
      fleet: "Close the trip, restore capacity, and learn from the completed operating record.",
      host: "Confirm the movement, mark direct driver pay sent, and review the separate LogLoads obligation."
    }
  }
]

export const pilotExperienceLevels = [
  {
    body: "Explore every current role surface through labeled captures and an end-to-end operating narrative. No sign-in and no product state.",
    icon: "ops.audit" as IconKey,
    label: "Public product tour",
    status: "Available now"
  },
  {
    body: "Walk a realistic synthetic day with the LogLoads team. We rehearse decisions, handoffs, privacy, and recovery without touching live providers.",
    icon: "map.network" as IconKey,
    label: "Assisted rehearsal",
    status: "Scheduled with the team"
  },
  {
    body: "Run a bounded real operation only after the named organization, legal posture, data boundaries, participants, support plan, and commercial gates are separately approved.",
    icon: "status.verified" as IconKey,
    label: "Approved live pilot",
    status: "Separate approval required"
  }
] as const

export const pilotProgramPhases = [
  {
    body: "Choose one real operating lane, name the host lead, fleet coordinator, drivers, equipment, landings, destinations, and the out-of-band fallback.",
    label: "Frame one operating day"
  },
  {
    body: "Agree on required fields, visibility, assignment authority, route-access release, completion truth, direct driver pay responsibility, and exception ownership.",
    label: "Write the operating contract"
  },
  {
    body: "Seed only synthetic records and rehearse the full loop on the devices participants will actually use. Correct confusion before any live work.",
    label: "Rehearse safely"
  },
  {
    body: "Verify every launch gate, approve the exact organization and participants, define the window, and keep a named stop-and-rollback decision owner.",
    label: "Open a bounded pilot"
  },
  {
    body: "Run a short daily operating review around unowned exceptions, stale status, privacy events, duplicate commitments, support response, and participant comprehension.",
    label: "Operate with a scorecard"
  },
  {
    body: "Close with evidence: what moved, what still required calls or texts, what users understood, what failed, and whether to stop, repeat, or expand.",
    label: "Decide from evidence"
  }
] as const

export const pilotLaunchGates = [
  {
    body: "A dated counsel-approved operating posture covers the exact commodity, route, relationships, and LogLoads role before Network enrollment.",
    icon: "status.verified" as IconKey,
    title: "Legal posture recorded"
  },
  {
    body: "The exact pilot organization and participants are approved; wildcard enrollment is not accepted and production remains closed to everyone else.",
    icon: "nav.admin" as IconKey,
    title: "Cohort explicitly authorized"
  },
  {
    body: "Identity, membership, assignment, route-pack release, private media, and organization boundaries pass a role-by-role rehearsal.",
    icon: "status.lock" as IconKey,
    title: "Privacy and access proven"
  },
  {
    body: "The exact Supabase, Clerk, storage, monitoring, email, and deployment tenancy is verified without borrowing another venture's provider identity.",
    icon: "truck.service" as IconKey,
    title: "Provider ownership verified"
  },
  {
    body: "Host and driver responsibilities for direct driver pay are accepted. LogLoads remains non-custodial and never moves transportation compensation.",
    icon: "load.pay" as IconKey,
    title: "Money boundary accepted"
  },
  {
    body: "Any 5% fee enrollment and collection are separately approved for the exact host after invoice, webhook, refund, support, and rollback evidence. A pilot does not silently activate charging.",
    icon: "ops.document" as IconKey,
    title: "Commercial gates remain separate"
  },
  {
    body: "Named people own launch, support, incident response, stop authority, fallback coordination, and the end-of-pilot decision.",
    icon: "ops.notice" as IconKey,
    title: "Human operating plan ready"
  }
] as const

export const pilotSuccessCriteria = [
  "Every participant can explain their next action and complete the rehearsed core task on the device they will use in the field.",
  "Every published pilot load has complete pay, equipment, timing, destination, capacity, visibility, and access-boundary information.",
  "Every commitment resolves to one named driver, truck, schedule, and authoritative assignment without a duplicate booking.",
  "Every active movement has a current state, a visible next action, and an owner for any exception.",
  "At least ten completed pilot movements reconcile assignment, capacity, trip, completion, proof, direct-payment status, and the host fee ledger before scope expands.",
  "At least four of five evaluators in each participating role complete their primary workflow without facilitation.",
  "Every physical completion has an authoritative record; direct driver-pay sent and received markers remain controlled by the host and driver respectively.",
  "No private route, gate, contact, credential, or media detail reaches an unauthorized participant.",
  "No physical movement creates more than one commercial obligation, and no fee is collected unless its separate gate is approved.",
  "The closeout shows whether LogLoads reduced status-chasing calls and ambiguity enough that the cohort chooses to repeat the workflow."
] as const

const hostSurfaces: readonly PilotSurface[] = [
  {
    alt: "Synthetic host command center showing current timber work, operating priorities, and exceptions",
    description: "Begin the day with current work, unresolved exceptions, committed capacity, and the next operating decisions in one view.",
    group: "Operate",
    height: 900,
    image: "/pilot/host-command.jpg",
    slug: "host-command",
    title: "Command",
    width: 1440
  },
  {
    alt: "Synthetic host work board separating draft, live, and historical timber opportunities",
    description: "Prepare complete work in Draft, understand what is truly Live, and keep ended or cancelled work in History.",
    group: "Operate",
    height: 900,
    image: "/pilot/host-work.jpg",
    slug: "host-work",
    title: "Work",
    width: 1440
  },
  {
    alt: "Synthetic host live board showing published load capacity and active commitments",
    description: "See published capacity, request pressure, assigned work, and load state without mistaking a draft for live supply.",
    group: "Operate",
    height: 900,
    image: "/pilot/host-live.jpg",
    slug: "host-live",
    title: "Live board",
    width: 1440
  },
  {
    alt: "Synthetic host message center with assignment-scoped conversations",
    description: "Keep operating conversation connected to the assignment and preserve a clear record of what changed.",
    group: "Operate",
    height: 900,
    image: "/pilot/host-messages.jpg",
    slug: "host-messages",
    title: "Messages",
    width: 1440
  },
  {
    alt: "Synthetic host carrier relationship workspace",
    description: "Review established operating relationships and the access each organization has without presenting prospects as capacity.",
    group: "Network",
    height: 900,
    image: "/pilot/host-carriers.jpg",
    slug: "host-carriers",
    title: "Carriers",
    width: 1440
  },
  {
    alt: "Synthetic host landing directory with protected access-pack status",
    description: "Maintain landing facts and protected route-pack readiness while keeping exact private access assignment-gated.",
    group: "Network",
    height: 900,
    image: "/pilot/host-landings.jpg",
    slug: "host-landings",
    title: "Landings",
    width: 1440
  },
  {
    alt: "Synthetic host schedule for upcoming timber movements",
    description: "Read upcoming commitments by time and load so gaps, overlaps, and changes become visible before the shift.",
    group: "Network",
    height: 900,
    image: "/pilot/host-schedule.jpg",
    slug: "host-schedule",
    title: "Schedule",
    width: 1440
  },
  {
    alt: "Synthetic host reliability view with current operating signals",
    description: "Review current operating evidence and exceptions without turning projections into unsupported partner claims.",
    group: "Network",
    height: 900,
    image: "/pilot/host-reliability.jpg",
    slug: "host-reliability",
    title: "Reliability",
    width: 1440
  },
  {
    alt: "Synthetic host assistant with guided operational prompts",
    description: "Use guided prompts to find the next relevant operating view while authorization remains identical to the underlying workspace.",
    group: "Insights",
    height: 900,
    image: "/pilot/host-assistant.jpg",
    slug: "host-assistant",
    title: "Assistant",
    width: 1440
  },
  {
    alt: "Synthetic host analytics view showing current throughput and load movement signals",
    description: "Understand published work, commitments, completion, and exceptions from the records the operation already creates.",
    group: "Insights",
    height: 900,
    image: "/pilot/host-analytics.jpg",
    slug: "host-analytics",
    title: "Analytics",
    width: 1440
  },
  {
    alt: "Synthetic host workspace settings for organization members and permissions",
    description: "Control organization identity, members, roles, and operating permissions without sharing one account across the landing team.",
    group: "Workspace",
    height: 900,
    image: "/pilot/host-workspace.jpg",
    slug: "host-workspace",
    title: "Workspace",
    width: 1440
  },
  {
    alt: "Synthetic host billing view explaining completed-load platform fee obligations",
    description: "See the separate 5% host obligation after an authoritative completion while stated driver pay remains a direct host-to-driver obligation.",
    group: "Workspace",
    height: 900,
    image: "/pilot/host-billing.jpg",
    slug: "host-billing",
    title: "Billing",
    width: 1440
  }
]

const fleetSurfaces: readonly PilotSurface[] = [
  {
    alt: "Synthetic fleet command center showing dispatch priorities and operating exceptions",
    description: "Start with active trips, requests, unassigned work, availability, and exceptions that need a coordinator's decision.",
    group: "Operate",
    height: 900,
    image: "/pilot/fleet-command.jpg",
    slug: "fleet-command",
    title: "Command",
    width: 1440
  },
  {
    alt: "Synthetic fleet dispatch board pairing timber work with drivers and trucks",
    description: "Pair work, qualified drivers, trucks, trailers, and schedules without losing the reason behind the assignment.",
    group: "Operate",
    height: 900,
    image: "/pilot/fleet-dispatch.jpg",
    slug: "fleet-dispatch",
    title: "Dispatch",
    width: 1440
  },
  {
    alt: "Synthetic fleet trip registry with upcoming, active, and completed movements",
    description: "Follow upcoming, active, exception, and completed movements from one accountable trip record.",
    group: "Operate",
    height: 900,
    image: "/pilot/fleet-trips.jpg",
    slug: "fleet-trips",
    title: "Trips",
    width: 1440
  },
  {
    alt: "Synthetic fleet message center with assignment-scoped operating conversations",
    description: "Coordinate with drivers and hosts around the actual assignment rather than rebuilding context from disconnected texts.",
    group: "Operate",
    height: 900,
    image: "/pilot/fleet-messages.jpg",
    slug: "fleet-messages",
    title: "Messages",
    width: 1440
  },
  {
    alt: "Synthetic fleet opportunity board showing available timber work and equipment fit",
    description: "Evaluate stated pay, distance, timing, equipment, access level, and remaining capacity before offering a truck.",
    group: "Find work",
    height: 900,
    image: "/pilot/fleet-opportunities.jpg",
    slug: "fleet-opportunities",
    title: "Opportunities",
    width: 1440
  },
  {
    alt: "Synthetic fleet opportunity detail showing pay, schedule, capacity, equipment fit, and the dispatch decision",
    description: "Inspect one opportunity in full before committing capacity, including stated pay, timing, remaining work, fit, access posture, and the exact dispatch action.",
    group: "Find work",
    height: 900,
    image: "/pilot/fleet-opportunity-detail.jpg",
    slug: "fleet-opportunity-detail",
    title: "Opportunity detail",
    width: 1440
  },
  {
    alt: "Synthetic fleet network view showing established host relationships",
    description: "Understand established private operating relationships without confusing researched prospects with members or available work.",
    group: "Find work",
    height: 900,
    image: "/pilot/fleet-network.jpg",
    slug: "fleet-network",
    title: "Network",
    width: 1440
  },
  {
    alt: "Synthetic fleet driver roster showing current readiness and assignments",
    description: "Keep each driver's profile, readiness, availability, and current assignment visible to authorized coordinators.",
    group: "Capacity",
    height: 900,
    image: "/pilot/fleet-drivers.jpg",
    slug: "fleet-drivers",
    title: "Drivers",
    width: 1440
  },
  {
    alt: "Synthetic fleet truck and trailer registry",
    description: "Maintain truck, trailer, equipment, service, and assignment context so match decisions use the actual rig.",
    group: "Capacity",
    height: 900,
    image: "/pilot/fleet-trucks.jpg",
    slug: "fleet-trucks",
    title: "Trucks",
    width: 1440
  },
  {
    alt: "Synthetic fleet availability planner for drivers and equipment",
    description: "Declare usable capacity by operating window so the dispatch board starts from current truth.",
    group: "Capacity",
    height: 900,
    image: "/pilot/fleet-availability.jpg",
    slug: "fleet-availability",
    title: "Availability",
    width: 1440
  },
  {
    alt: "Synthetic fleet performance view with movement and reliability evidence",
    description: "Review throughput, completed movements, exceptions, and current reliability evidence without inventing guarantees.",
    group: "Insights",
    height: 900,
    image: "/pilot/fleet-performance.jpg",
    slug: "fleet-performance",
    title: "Performance",
    width: 1440
  },
  {
    alt: "Synthetic fleet assistant with guided dispatch prompts",
    description: "Navigate operating questions and next actions while preserving the same role and assignment permissions as the fleet workspace.",
    group: "Insights",
    height: 900,
    image: "/pilot/fleet-assistant.jpg",
    slug: "fleet-assistant",
    title: "Assistant",
    width: 1440
  },
  {
    alt: "Synthetic fleet workspace settings for members and operating permissions",
    description: "Manage organization identity, coordinator access, member roles, and invitations without a shared login.",
    group: "Workspace",
    height: 900,
    image: "/pilot/fleet-workspace.jpg",
    slug: "fleet-workspace",
    title: "Workspace",
    width: 1440
  },
  {
    alt: "Synthetic fleet billing page explaining free access and historical records",
    description: "Confirm that fleet workspace access is free and understand preserved historical subscription records without opening new enrollment.",
    group: "Workspace",
    height: 900,
    image: "/pilot/fleet-billing.jpg",
    slug: "fleet-billing",
    title: "Billing",
    width: 1440
  }
]

const driverSurfaces: readonly PilotSurface[] = [
  {
    alt: "Synthetic driver phone map showing region-level timber load opportunities",
    description: "Start on a phone-first map with useful regional work while exact gates and private routes remain protected until assignment.",
    group: "Core day",
    height: 844,
    image: "/pilot/driver-map.jpg",
    slug: "driver-map",
    title: "Map",
    width: 390
  },
  {
    alt: "Synthetic driver phone load board showing stated pay, schedule, distance, and equipment fit",
    description: "Compare stated pay, after-fuel context, distance, timing, equipment, capacity, and personal fit before requesting.",
    group: "Core day",
    height: 844,
    image: "/pilot/driver-loads.jpg",
    slug: "driver-loads",
    title: "Loads",
    width: 390
  },
  {
    alt: "Synthetic driver phone load detail showing pay, fuel estimate, schedule, fit, route access, and the request decision",
    description: "Open one haul to understand stated pay, after-fuel context, distance, schedule, capacity, equipment fit, protected access, and the next request decision.",
    group: "Core day",
    height: 844,
    image: "/pilot/driver-load-detail.jpg",
    slug: "driver-load-detail",
    title: "Load detail",
    width: 390
  },
  {
    alt: "Synthetic driver phone schedule showing requested, booked, moving, and completed work",
    description: "Keep requested, booked, active, and completed work in one schedule with an obvious next action.",
    group: "Core day",
    height: 844,
    image: "/pilot/driver-schedule.jpg",
    slug: "driver-schedule",
    title: "Schedule",
    width: 390
  },
  {
    alt: "Synthetic driver phone profile with readiness and availability details",
    description: "Maintain the identity, operating radius, availability, and readiness information hosts and fleets need to make a decision.",
    group: "Core day",
    height: 844,
    image: "/pilot/driver-profile.jpg",
    slug: "driver-profile",
    title: "Profile",
    width: 390
  },
  {
    alt: "Synthetic driver phone messages scoped to a timber haul assignment",
    description: "Keep questions and operating changes connected to the work instead of rebuilding context from a group text.",
    group: "Field tools",
    height: 844,
    image: "/pilot/driver-messages.jpg",
    slug: "driver-messages",
    title: "Messages",
    width: 390
  },
  {
    alt: "Synthetic driver phone equipment profile for truck, trailer, and readiness records",
    description: "Keep the actual truck, trailer, equipment, credentials, service state, and fuel economy ready for fit checks.",
    group: "Field tools",
    height: 844,
    image: "/pilot/driver-equipment.jpg",
    slug: "driver-equipment",
    title: "Equipment",
    width: 390
  },
  {
    alt: "Synthetic driver phone assistant with guided next-action prompts",
    description: "Get guided help finding the next relevant screen without expanding what the driver is authorized to see.",
    group: "Field tools",
    height: 844,
    image: "/pilot/driver-assistant.jpg",
    slug: "driver-assistant",
    title: "Assistant",
    width: 390
  },
  {
    alt: "Synthetic driver phone network view with established operating relationships",
    description: "Understand established fleet and host relationships while keeping prospects distinct from members, assignments, or guaranteed work.",
    group: "Field tools",
    height: 844,
    image: "/pilot/driver-network.jpg",
    slug: "driver-network",
    title: "Network",
    width: 390
  }
]

export const pilotRoles: Record<PilotRole, PilotRoleSpec> = {
  driver: {
    commercialTruth: "Driver access is free forever. The stated driver pay is a direct host-to-driver obligation and is never reduced by a LogLoads fee.",
    contactLabel: "Plan a driver rehearsal",
    eyebrow: "Driver experience",
    icon: "truck.log",
    label: "Driver",
    pilotNeeds: [
      "One or more drivers using the phones and field conditions they actually work with",
      "A current truck, trailer, equipment, credential, availability, and fuel-economy profile",
      "Clear rules for requests, decisions, arrival windows, route-pack release, exceptions, and completion",
      "A direct driver-pay process owned by the host and driver outside LogLoads",
      "A fallback contact and stop rule for any access, safety, assignment, or status problem"
    ],
    signupHref: "/sign-up?path=driver",
    signupLabel: "Create a driver profile",
    summary: "Know what is available, what it pays, whether the rig fits, where to go after assignment, and what happens next — from a phone-first cockpit.",
    surfaces: driverSurfaces,
    title: "Know the work before you turn the key.",
    tourOutcomes: [
      "Evaluate work from pay, fit, distance, timing, equipment, and remaining capacity",
      "Keep exact access private until an authorized assignment exists",
      "Move from request to booked schedule to active haul with one visible next action",
      "Confirm completion and independently mark direct driver pay received"
    ]
  },
  fleet: {
    commercialTruth: "Fleet workspace access is free forever. No current subscription enrollment exists, and LogLoads never reduces driver pay.",
    contactLabel: "Plan a fleet rehearsal",
    eyebrow: "Fleet experience",
    icon: "nav.fleet",
    label: "Fleet",
    pilotNeeds: [
      "One accountable fleet coordinator and a small named cohort of drivers",
      "A current roster of trucks, trailers, equipment, driver readiness, and availability",
      "One realistic dispatch window with opportunities, requests, assignments, and exceptions",
      "Defined authority for committing a driver and truck without double-booking capacity",
      "A fallback dispatch channel and named support owner during the pilot window"
    ],
    signupHref: "/sign-up?path=fleet",
    signupLabel: "Create a free fleet workspace",
    summary: "Turn drivers, trucks, availability, opportunities, commitments, trips, and exceptions into one operating picture without charging the fleet or reducing driver pay.",
    surfaces: fleetSurfaces,
    title: "Coordinate every truck without taxing driver pay.",
    tourOutcomes: [
      "Declare real capacity before evaluating work",
      "Pair the right driver, truck, trailer, schedule, and opportunity",
      "Coordinate assignments and exceptions from one accountable queue",
      "Restore capacity from authoritative completion rather than spreadsheet cleanup"
    ]
  },
  host: {
    commercialTruth: "There is no monthly minimum and no fee to post. For separately approved Network work, LogLoads charges the host 5% on top of stated driver pay only after an authoritative physical completion, invoiced monthly in arrears.",
    contactLabel: "Plan a host pilot",
    eyebrow: "Host experience",
    icon: "nav.landing",
    label: "Host",
    pilotNeeds: [
      "One accountable host lead plus named landing, scheduling, and billing contacts",
      "One to three real operating lanes with known timber, destinations, equipment, windows, and capacity",
      "Complete landing and route-pack rules that separate public summaries from assignment-only access",
      "A small approved fleet and driver cohort with a documented out-of-band fallback",
      "Accepted completion, direct driver-pay, separate 5% fee, support, stop, and rollback responsibilities"
    ],
    signupHref: "/sign-up?path=host",
    signupLabel: "Create a host workspace",
    summary: "Prepare timber work, publish it to the right audience, commit qualified capacity, coordinate the live day, and confirm what physically moved.",
    surfaces: hostSurfaces,
    title: "Run the landing from one shared operating picture.",
    tourOutcomes: [
      "Separate planned work from what is truly published and live",
      "Release private landing access only after an authorized commitment",
      "See current capacity, schedule, notices, exceptions, and next decisions",
      "Confirm physical completion and understand the separate host obligation"
    ]
  }
}

export interface PilotSurfaceSelection {
  role: PilotRole
  surface: PilotSurface
}

export const pilotSurfaceSlugs = pilotRoleSlugs.flatMap((role) =>
  pilotRoles[role].surfaces.map((surface) => surface.slug)
)

export function getPilotSurface(value: string): PilotSurfaceSelection | null {
  for (const role of pilotRoleSlugs) {
    const surface = pilotRoles[role].surfaces.find((item) => item.slug === value)

    if (surface) return { role, surface }
  }

  return null
}

export function isPilotRole(value: string): value is PilotRole {
  return pilotRoleSlugs.some((role) => role === value)
}

export function getPilotRole(value: string): PilotRoleSpec | null {
  return isPilotRole(value) ? pilotRoles[value] : null
}
