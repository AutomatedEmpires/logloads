import type {
  Assignment,
  AuditEvent,
  AvailabilityWindow,
  DestinationFacility,
  DirectOffer,
  DispatcherProfile,
  DriverProfile,
  Entitlement,
  EquipmentCombination,
  FutureAvailability,
  HaulRoute,
  Landing,
  LoaderProfile,
  LoggingCompany,
  LoadPosting,
  MessageEvent,
  MessageThread,
  Mill,
  Notification,
  OperationalNotice,
  OpportunityCapacity,
  Organization,
  OrganizationInvitation,
  OrganizationMembership,
  PrivateNetworkRelationship,
  Rate,
  RichLandingDetails,
  RoutePack,
  TrailerProfile,
  TripDocument,
  TripEvent,
  TripReview,
  TripV2,
  TruckProfile,
  TruckSlot,
  User,
  VerificationRecord
} from "@logloads/contracts"

export interface LogLoadsDatabaseState {
  profiles: User[]
  companies: LoggingCompany[]
  organizations: Organization[]
  organizationMemberships: OrganizationMembership[]
  organizationInvitations: OrganizationInvitation[]
  privateNetworkRelationships: PrivateNetworkRelationship[]
  driverProfiles: DriverProfile[]
  dispatcherProfiles: DispatcherProfile[]
  loaderProfiles: LoaderProfile[]
  truckProfiles: TruckProfile[]
  trailerProfiles: TrailerProfile[]
  equipmentCombinations: EquipmentCombination[]
  landings: Landing[]
  richLandingDetails: RichLandingDetails[]
  mills: Mill[]
  destinationFacilities: DestinationFacility[]
  haulRoutes: HaulRoute[]
  routePacks: RoutePack[]
  rates: Rate[]
  loadPostings: LoadPosting[]
  opportunityCapacities: OpportunityCapacity[]
  truckSlots: TruckSlot[]
  availabilityWindows: AvailabilityWindow[]
  futureAvailability: FutureAvailability[]
  assignments: Assignment[]
  directOffers: DirectOffer[]
  tripsV2: TripV2[]
  tripEvents: TripEvent[]
  tripDocuments: TripDocument[]
  tripReviews: TripReview[]
  verificationRecords: VerificationRecord[]
  entitlements: Entitlement[]
  operationalNotices: OperationalNotice[]
  notifications: Notification[]
  messageThreads: MessageThread[]
  messageEvents: MessageEvent[]
  auditEvents: AuditEvent[]
}

export type LogLoadsTableName = keyof LogLoadsDatabaseState
