export const ROLES = ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ["ACTIVE", "INVITED", "SUSPENDED"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const ORG_TYPES = [
  "CLINIC",
  "HOSPITAL",
  "HEALTH_SYSTEM",
  "MSO",
  "BILLING_COMPANY",
  "OTHER",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const SEX_VALUES = ["FEMALE", "MALE", "OTHER", "UNKNOWN"] as const;
export type Sex = (typeof SEX_VALUES)[number];

export const PROVIDER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const PAYER_TYPES = [
  "COMMERCIAL",
  "MEDICARE_ADVANTAGE",
  "MEDICAID_MANAGED",
  "WORKERS_COMP",
  "OTHER",
] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

export const AUTH_STATUSES = [
  "DRAFT",
  "NEEDS_INFORMATION",
  "READY_FOR_REVIEW",
  "SUBMITTED",
  "PENDING",
  "ADDITIONAL_INFORMATION_REQUESTED",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "DENIED",
  "APPEALED",
  "WITHDRAWN",
  "CLOSED",
] as const;
export type AuthStatus = (typeof AUTH_STATUSES)[number];

/** Payer outcomes. These are recorded only through the decision workflow, never a plain status change. */
export const DECISION_OUTCOMES = ["APPROVED", "PARTIALLY_APPROVED", "DENIED"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const REVIEW_TYPES = ["STANDARD", "EXPEDITED"] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const CODE_TYPES = ["CPT", "HCPCS"] as const;
export type CodeType = (typeof CODE_TYPES)[number];

export const UNIT_TYPES = ["UNITS", "VISITS", "DAYS"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const LINE_DECISIONS = ["PENDING", "APPROVED", "PARTIALLY_APPROVED", "DENIED"] as const;
export type LineDecision = (typeof LINE_DECISIONS)[number];

export const SITES_OF_CARE = [
  "OFFICE",
  "OUTPATIENT_HOSPITAL",
  "AMBULATORY_SURGERY_CENTER",
  "INPATIENT_HOSPITAL",
  "IMAGING_CENTER",
  "HOME",
  "TELEHEALTH",
  "OTHER",
] as const;
export type SiteOfCare = (typeof SITES_OF_CARE)[number];

export const DENIAL_REASONS = [
  "MEDICAL_NECESSITY",
  "MISSING_INFORMATION",
  "NOT_A_COVERED_BENEFIT",
  "OUT_OF_NETWORK",
  "MEMBER_NOT_ELIGIBLE",
  "DUPLICATE_REQUEST",
  "SITE_OF_CARE",
  "OTHER",
] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];

export const PEER_TO_PEER_STATUSES = ["NOT_REQUESTED", "REQUESTED", "SCHEDULED", "COMPLETED", "DECLINED"] as const;
export type PeerToPeerStatus = (typeof PEER_TO_PEER_STATUSES)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  "CLINICAL_NOTE",
  "REFERRAL",
  "INSURANCE_CARD",
  "LAB_RESULT",
  "IMAGING",
  "PAYER_CORRESPONDENCE",
  "AUTHORIZATION_FORM",
  "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_PROCESSING_STATUSES = ["STORED", "QUEUED", "PROCESSED", "FAILED"] as const;
export type DocumentProcessingStatus = (typeof DOCUMENT_PROCESSING_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "CASE_ASSIGNED",
  "STATUS_CHANGED",
  "AUTHORIZATION_APPROVED",
  "AUTHORIZATION_DENIED",
  "ADDITIONAL_INFORMATION_REQUESTED",
  "TASK_DUE",
  "TASK_OVERDUE",
  "DOCUMENT_REQUIRED",
  "AI_ANALYSIS_COMPLETE",
  "PAYER_OVERDUE",
  "AUTHORIZATION_EXPIRING",
  "APPEAL_DEADLINE",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const PLAN_IDS = ["STARTER", "PROFESSIONAL", "ENTERPRISE"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "DEMO"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const AI_OPERATIONS = [
  "analyzeAuthorization",
  "summarizeDocuments",
  "identifyMissingInformation",
  "generateChecklist",
  "draftAuthorizationSummary",
  "draftPayerFollowup",
  "summarizePayerResponse",
] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];

export const AI_DISCLAIMER = "AI-generated — review before use." as const;

export interface NotificationPreferences {
  caseAssigned: boolean;
  statusChanged: boolean;
  taskDue: boolean;
  aiComplete: boolean;
  emailEnabled: boolean;
}

export interface WorkflowFlags {
  priorAuthorization: boolean;
  eligibility: boolean;
  referrals: boolean;
  denials: boolean;
  documentManagement: boolean;
}

export const SSO_PROVIDERS = ["microsoft", "google", "oidc"] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];

export interface SsoDomain {
  domain: string;
  verificationToken: string;
  verifiedAt: string | null;
}

export interface SsoConfig {
  enabled: boolean;
  provider: SsoProvider;
  /** Microsoft Entra directory (tenant) ID. Tokens from any other tenant are rejected. */
  tenantId: string;
  /** Issuer URL for a custom OIDC provider (Okta, Ping, OneLogin...). */
  issuer: string;
  /** Client credentials for a custom OIDC provider. Microsoft and Google use the platform app. */
  clientId: string;
  clientSecretEncrypted: string | null;
  domains: SsoDomain[];
  /** Create accounts on first sign-in for people in a verified domain. */
  jitProvisioning: boolean;
  /** Role given to accounts created on first sign-in. Never above Manager. */
  defaultRole: "VIEWER" | "SPECIALIST" | "MANAGER";
  /** Members must use SSO. Owners keep password sign-in as a break-glass path. */
  requireSso: boolean;
  lastLoginAt: string | null;
}

export interface UserIdentity {
  /** "microsoft:<tid>:<oid>", "google:<sub>" or "oidc:<issuer>|<sub>" */
  key: string;
  provider: SsoProvider;
  email: string;
  linkedAt: string;
}

export interface ScimConfig {
  tokenHash: string;
  /** First characters of the token, so admins can tell tokens apart. */
  tokenPrefix: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
}

export interface OrganizationSecurity {
  requireMfa: boolean;
  idleTimeoutMinutes: number;
}

export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string;
  /** Incremented to revoke every session the user holds. */
  sessionVersion: number;
  /** External identities (SSO) linked to this account. */
  identities: UserIdentity[];
  mfaEnabled: boolean;
  /** AES-GCM encrypted TOTP secret. Never returned to the browser after enrollment. */
  mfaSecretEncrypted: string | null;
  /** Encrypted secret waiting for the first valid code. */
  mfaPendingSecretEncrypted: string | null;
  /** SHA-256 hashes of unused recovery codes. */
  mfaRecoveryCodeHashes: string[];
  /** Last accepted TOTP time step, to block code replay. */
  mfaLastStep: number;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  fullName: string;
  jobTitle: string;
  phone: string;
  onboardingCompleted: boolean;
  notificationPreferences: NotificationPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  type: OrgType;
  specialty: string;
  providerCount: number;
  workflows: WorkflowFlags;
  security: OrganizationSecurity;
  /** Last case sequence number issued. Case numbers are never derived from row counts. */
  caseSequence: number;
  /** Single sign-on configuration. Null until an admin sets it up. */
  sso: SsoConfig | null;
  /** SCIM provisioning token. Only a hash is stored. */
  scim: ScimConfig | null;
  synthetic: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  status: MemberStatus;
  lastActiveAt: string | null;
  /** Identifier the customer's identity provider uses for this person (SCIM externalId). */
  scimExternalId?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface Patient {
  id: string;
  organizationId: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: Sex;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  primaryPayerId: string | null;
  memberId: string;
  groupNumber: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface Provider {
  id: string;
  organizationId: string;
  name: string;
  npi: string;
  specialty: string;
  phone: string;
  email: string;
  status: ProviderStatus;
  organizationName: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface Payer {
  id: string;
  organizationId: string;
  name: string;
  type: PayerType;
  identifier: string;
  phone: string;
  fax: string;
  website: string;
  notes: string;
  active: boolean;
  /** Calendar days the payer has to decide a standard request. */
  standardTurnaroundDays: number;
  /** Hours the payer has to decide an expedited request. */
  expeditedTurnaroundHours: number;
  /** Days after a denial during which an appeal can be filed. */
  appealWindowDays: number;
  /** Document categories this payer expects before submission. */
  requiredDocuments: DocumentCategory[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export const AUTH_REQUIREMENTS = ["REQUIRED", "NOT_REQUIRED"] as const;
export type AuthRequirement = (typeof AUTH_REQUIREMENTS)[number];

/**
 * A practice's own record of whether a payer requires prior auth for a code. `code` is either an
 * exact code ("72148") or a prefix ending in "*" ("7214*") covering a code family.
 */
export interface PayerAuthRule {
  id: string;
  organizationId: string;
  payerId: string;
  codeType: CodeType;
  code: string;
  requirement: AuthRequirement;
  note: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface AuthorizationLine {
  id: string;
  codeType: CodeType;
  code: string;
  modifiers: string[];
  description: string;
  requestedUnits: number;
  unitType: UnitType;
  approvedUnits: number | null;
  decision: LineDecision;
}

export interface DiagnosisEntry {
  code: string;
  description: string;
}

export interface AuthorizationCase {
  id: string;
  organizationId: string;
  authorizationNumber: string;
  patientId: string;
  payerId: string;
  memberId: string;
  groupNumber: string;
  /** Short human title for the request, e.g. "Right knee arthroplasty". Codes live on the lines. */
  procedure: string;
  lines: AuthorizationLine[];
  /** First entry is the primary diagnosis. */
  diagnoses: DiagnosisEntry[];
  /** Ordering provider. */
  providerId: string;
  renderingProviderId: string | null;
  facilityName: string;
  /** CMS two-digit place of service code. */
  placeOfService: string;
  siteOfCare: SiteOfCare;
  requestedServiceDate: string;
  priority: Priority;
  reviewType: ReviewType;
  clinicalReason: string;
  status: AuthStatus;
  assignedUserId: string | null;
  submissionDate: string | null;
  /** When the payer's decision clock runs out for the current submission. */
  payerDueAt: string | null;
  decisionDate: string | null;
  decisionOutcome: DecisionOutcome | null;
  validFrom: string | null;
  validTo: string | null;
  denialReason: DenialReason | null;
  denialDetail: string;
  determinationDocumentId: string | null;
  appealDeadline: string | null;
  appealSubmittedAt: string | null;
  peerToPeerStatus: PeerToPeerStatus;
  peerToPeerAt: string | null;
  peerToPeerNotes: string;
  closedReason: string;
  /** Set when this request replaces an earlier one after submission. */
  supersedesId: string | null;
  payerReference: string;
  internalNotes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface AuthorizationStatusHistory {
  id: string;
  organizationId: string;
  authorizationId: string;
  previousStatus: AuthStatus | null;
  newStatus: AuthStatus;
  changedBy: string;
  reason: string;
  createdAt: string;
}

export interface AuthorizationDocument {
  id: string;
  organizationId: string;
  patientId: string | null;
  authorizationId: string | null;
  uploadedBy: string;
  filename: string;
  storageKey: string;
  size: number;
  mimeType: string;
  category: DocumentCategory;
  processingStatus: DocumentProcessingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CaseNote {
  id: string;
  organizationId: string;
  authorizationId: string;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  organizationId: string;
  authorizationId: string | null;
  patientId: string | null;
  title: string;
  description: string;
  assignedUserId: string | null;
  dueDate: string | null;
  priority: Priority;
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface ActivityEvent {
  id: string;
  organizationId: string;
  actorId: string | null;
  type: string;
  summary: string;
  resourceType: string;
  resourceId: string;
  authorizationId: string | null;
  patientId: string | null;
  metadata: SafeMetadata;
  createdAt: string;
}

export interface AiAnalysis {
  caseSummary: string;
  availableInformation: string[];
  potentiallyMissingInformation: string[];
  documentationChecklist: string[];
  administrativeNextSteps: string[];
  questionsForHumanReview: string[];
  limitations: string[];
  disclaimer: typeof AI_DISCLAIMER;
}

export interface AiTextDraft {
  text: string;
  disclaimer: typeof AI_DISCLAIMER;
}

export interface AiRun {
  id: string;
  organizationId: string;
  authorizationId: string | null;
  requestedBy: string;
  provider: "mock" | "anthropic" | "openai";
  model: string;
  operation: AiOperation;
  status: "COMPLETED" | "FAILED";
  inputFingerprint: string;
  output: AiAnalysis | AiTextDraft | null;
  error: string | null;
  latencyMs: number;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export type SafeMetadata = Record<string, string | number | boolean | null>;

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorId: string | null;
  event: string;
  resourceType: string;
  resourceId: string;
  metadata: SafeMetadata;
  createdAt: string;
}

export interface IntegrationConnection {
  id: string;
  organizationId: string;
  providerKey: string;
  status: "REQUESTED" | "CONNECTED";
  requestedAt: string | null;
  requestedBy: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  organizationId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  tokenHash: string;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface ContactRequest {
  id: string;
  name: string;
  email: string;
  organization: string;
  message: string;
  createdAt: string;
}

export interface Database {
  users: UserAccount[];
  profiles: Profile[];
  organizations: Organization[];
  organizationMembers: OrganizationMember[];
  patients: Patient[];
  providers: Provider[];
  payers: Payer[];
  authorizationCases: AuthorizationCase[];
  authorizationStatusHistory: AuthorizationStatusHistory[];
  authorizationDocuments: AuthorizationDocument[];
  caseNotes: CaseNote[];
  tasks: Task[];
  activityEvents: ActivityEvent[];
  aiRuns: AiRun[];
  notifications: AppNotification[];
  auditEvents: AuditEvent[];
  integrationConnections: IntegrationConnection[];
  subscriptions: Subscription[];
  invitations: Invitation[];
  passwordResetTokens: PasswordResetToken[];
  contactRequests: ContactRequest[];
  payerAuthRules: PayerAuthRule[];
  /** Schema version of the stored document, used for forward migrations of the file store. */
  schemaVersion: number;
}

export interface RequestContext {
  userId: string;
  email: string;
  role: Role;
  organizationId: string;
  profile: Profile;
  organization: Organization;
}

export const CURRENT_SCHEMA_VERSION = 5;

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
