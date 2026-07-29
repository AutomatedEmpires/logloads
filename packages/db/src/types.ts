import type {
  Assignment,
  AuditEvent,
  AvailabilityWindow,
  CredentialReview,
  DestinationFacility,
  DirectOffer,
  DispatcherProfile,
  DriverCredential,
  DriverProfile,
  Entitlement,
  EquipmentCombination,
  FutureAvailability,
  HaulRoute,
  HostBillingProfile,
  HostInvoice,
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
  PlatformFeeEvent,
  PrivateNetworkRelationship,
  Rate,
  RichLandingDetails,
  RoutePack,
  SupportRequest,
  TrailerProfile,
  TripDocument,
  TripInspection,
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
  /**
   * The credential vault, and every decision ever taken on it. Two collections
   * rather than a status field on the credential: the decision trail is
   * append-only, so "why was I refused" survives a later approval instead of
   * being overwritten by it.
   */
  driverCredentials: DriverCredential[]
  credentialReviews: CredentialReview[]
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
  tripInspections: TripInspection[]
  tripReviews: TripReview[]
  verificationRecords: VerificationRecord[]
  entitlements: Entitlement[]
  /**
   * Platform fee billing, in lifecycle order: whether the host can be charged,
   * what each completed load accrued, and the monthly bill those accruals land on.
   * Separate from `entitlements`, which is the Dispatch Pro software subscription —
   * collapsing them would let a plan webhook mutate a per-load charge.
   */
  hostBillingProfiles: HostBillingProfile[]
  platformFeeEvents: PlatformFeeEvent[]
  hostInvoices: HostInvoice[]
  operationalNotices: OperationalNotice[]
  notifications: Notification[]
  supportRequests: SupportRequest[]
  messageThreads: MessageThread[]
  messageEvents: MessageEvent[]
  auditEvents: AuditEvent[]
}

export type LogLoadsTableName = keyof LogLoadsDatabaseState
