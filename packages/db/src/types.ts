import type {
  Assignment,
  AuditEvent,
  AvailabilityWindow,
  DispatcherProfile,
  DriverProfile,
  HaulRoute,
  Landing,
  LoaderProfile,
  LoggingCompany,
  MessageEvent,
  MessageThread,
  Mill,
  Notification,
  Rate,
  TrailerProfile,
  TruckProfile,
  TruckSlot,
  User,
  LoadPosting
} from "@logloads/core"

export interface LogLoadsDatabaseState {
  profiles: User[]
  companies: LoggingCompany[]
  driverProfiles: DriverProfile[]
  dispatcherProfiles: DispatcherProfile[]
  loaderProfiles: LoaderProfile[]
  truckProfiles: TruckProfile[]
  trailerProfiles: TrailerProfile[]
  landings: Landing[]
  mills: Mill[]
  haulRoutes: HaulRoute[]
  rates: Rate[]
  loadPostings: LoadPosting[]
  truckSlots: TruckSlot[]
  availabilityWindows: AvailabilityWindow[]
  assignments: Assignment[]
  notifications: Notification[]
  messageThreads: MessageThread[]
  messageEvents: MessageEvent[]
  auditEvents: AuditEvent[]
}

export type LogLoadsTableName = keyof LogLoadsDatabaseState