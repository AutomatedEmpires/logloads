"use client"

import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import {
  Archive,
  Bell,
  BookmarkSimple,
  CalendarBlank,
  ChartDonut,
  ChatCircle,
  CheckCircle,
  CircleDashed,
  CircleNotch,
  Compass,
  CurrencyDollar,
  Eye,
  Funnel,
  GearSix,
  Lock,
  MagnifyingGlass,
  MapPin,
  MapTrifold,
  Megaphone,
  NotePencil,
  PaperPlaneTilt,
  SealCheck,
  ShieldStar,
  Stack,
  Storefront,
  SunHorizon,
  TreeStructure,
  UploadSimple,
  UsersThree,
  Van,
  Warning,
  Wrench
} from "@phosphor-icons/react"

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone"

export type IconKey =
  | "action.call"
  | "action.filter"
  | "action.request"
  | "action.save"
  | "action.search"
  | "action.upload"
  | "load.condition"
  | "load.destination"
  | "load.equipment"
  | "load.origin"
  | "load.pay"
  | "load.schedule"
  | "map.destination"
  | "map.landing"
  | "map.network"
  | "map.route"
  | "nav.admin"
  | "nav.fleet"
  | "nav.landing"
  | "nav.loads"
  | "nav.map"
  | "nav.messages"
  | "nav.today"
  | "nav.trips"
  | "ops.audit"
  | "ops.document"
  | "ops.notice"
  | "ops.queue"
  | "status.assigned"
  | "status.freshness"
  | "status.lock"
  | "status.open"
  | "status.scheduled"
  | "status.verified"
  | "status.warning"
  | "truck.chip"
  | "truck.log"
  | "truck.service"

export interface IconEntry {
  key: IconKey
  icon: PhosphorIcon
  label: string
  weight?: IconWeight
}

export const ICON_REGISTRY = {
  "action.call": { key: "action.call", icon: Bell, label: "Call", weight: "bold" },
  "action.filter": { key: "action.filter", icon: Funnel, label: "Filter" },
  "action.request": { key: "action.request", icon: PaperPlaneTilt, label: "Request" },
  "action.save": { key: "action.save", icon: BookmarkSimple, label: "Save" },
  "action.search": { key: "action.search", icon: MagnifyingGlass, label: "Search" },
  "action.upload": { key: "action.upload", icon: UploadSimple, label: "Upload" },
  "load.condition": { key: "load.condition", icon: Warning, label: "Condition" },
  "load.destination": { key: "load.destination", icon: Storefront, label: "Destination" },
  "load.equipment": { key: "load.equipment", icon: Wrench, label: "Equipment" },
  "load.origin": { key: "load.origin", icon: TreeStructure, label: "Landing" },
  "load.pay": { key: "load.pay", icon: CurrencyDollar, label: "Pay" },
  "load.schedule": { key: "load.schedule", icon: CalendarBlank, label: "Schedule" },
  "map.destination": { key: "map.destination", icon: Storefront, label: "Destination pin", weight: "duotone" },
  "map.landing": { key: "map.landing", icon: MapPin, label: "Landing pin", weight: "fill" },
  "map.network": { key: "map.network", icon: MapTrifold, label: "Network map" },
  "map.route": { key: "map.route", icon: Compass, label: "Route" },
  "nav.admin": { key: "nav.admin", icon: ShieldStar, label: "Admin" },
  "nav.fleet": { key: "nav.fleet", icon: UsersThree, label: "Fleet" },
  "nav.landing": { key: "nav.landing", icon: TreeStructure, label: "Landing board" },
  "nav.loads": { key: "nav.loads", icon: Stack, label: "Loads" },
  "nav.today": { key: "nav.today", icon: SunHorizon, label: "Today" },
  "nav.map": { key: "nav.map", icon: MapTrifold, label: "Map" },
  "nav.messages": { key: "nav.messages", icon: ChatCircle, label: "Messages" },
  "nav.trips": { key: "nav.trips", icon: Van, label: "Trips" },
  "ops.audit": { key: "ops.audit", icon: Eye, label: "Audit" },
  "ops.document": { key: "ops.document", icon: NotePencil, label: "Document" },
  "ops.notice": { key: "ops.notice", icon: Megaphone, label: "Notice" },
  "ops.queue": { key: "ops.queue", icon: ChartDonut, label: "Queue" },
  "status.assigned": { key: "status.assigned", icon: CheckCircle, label: "Assigned", weight: "fill" },
  "status.freshness": { key: "status.freshness", icon: CircleNotch, label: "Freshness" },
  "status.lock": { key: "status.lock", icon: Lock, label: "Protected" },
  "status.open": { key: "status.open", icon: CircleDashed, label: "Open" },
  "status.scheduled": { key: "status.scheduled", icon: CalendarBlank, label: "Scheduled" },
  "status.verified": { key: "status.verified", icon: SealCheck, label: "Verified", weight: "duotone" },
  "status.warning": { key: "status.warning", icon: Warning, label: "Warning", weight: "bold" },
  "truck.chip": { key: "truck.chip", icon: Archive, label: "Chip truck" },
  "truck.log": { key: "truck.log", icon: Van, label: "Log truck" },
  "truck.service": { key: "truck.service", icon: GearSix, label: "Service truck" }
} as const satisfies Record<IconKey, IconEntry>

export function getIcon(name: IconKey): IconEntry {
  return ICON_REGISTRY[name]
}
