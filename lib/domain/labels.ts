import type {
  AuthStatus,
  DenialReason,
  LineDecision,
  PeerToPeerStatus,
  ReviewType,
  SiteOfCare,
  UnitType,
  DocumentCategory,
  NotificationType,
  OrgType,
  PayerType,
  Priority,
  Role,
  Sex,
  TaskStatus,
} from "@/lib/domain/types";

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  SPECIALIST: "Specialist",
  VIEWER: "Viewer",
};

export const STATUS_LABEL: Record<AuthStatus, string> = {
  DRAFT: "Draft",
  NEEDS_INFORMATION: "Needs information",
  READY_FOR_REVIEW: "Ready for review",
  SUBMITTED: "Submitted",
  PENDING: "Pending",
  ADDITIONAL_INFORMATION_REQUESTED: "Info requested",
  APPROVED: "Approved",
  PARTIALLY_APPROVED: "Partially approved",
  DENIED: "Denied",
  APPEALED: "Appealed",
  WITHDRAWN: "Withdrawn",
  CLOSED: "Closed",
};

export const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  STANDARD: "Standard",
  EXPEDITED: "Expedited",
};

export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  UNITS: "Units",
  VISITS: "Visits",
  DAYS: "Days",
};

export const LINE_DECISION_LABEL: Record<LineDecision, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  PARTIALLY_APPROVED: "Reduced",
  DENIED: "Denied",
};

export const SITE_OF_CARE_LABEL: Record<SiteOfCare, string> = {
  OFFICE: "Office",
  OUTPATIENT_HOSPITAL: "Outpatient hospital",
  AMBULATORY_SURGERY_CENTER: "Ambulatory surgery center",
  INPATIENT_HOSPITAL: "Inpatient hospital",
  IMAGING_CENTER: "Imaging center",
  HOME: "Home",
  TELEHEALTH: "Telehealth",
  OTHER: "Other",
};

export const DENIAL_REASON_LABEL: Record<DenialReason, string> = {
  MEDICAL_NECESSITY: "Medical necessity not established",
  MISSING_INFORMATION: "Missing or incomplete information",
  NOT_A_COVERED_BENEFIT: "Not a covered benefit",
  OUT_OF_NETWORK: "Out of network",
  MEMBER_NOT_ELIGIBLE: "Member not eligible",
  DUPLICATE_REQUEST: "Duplicate request",
  SITE_OF_CARE: "Site of care not approved",
  OTHER: "Other",
};

export const PEER_TO_PEER_LABEL: Record<PeerToPeerStatus, string> = {
  NOT_REQUESTED: "Not requested",
  REQUESTED: "Requested",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  DECLINED: "Declined by payer",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const SEX_LABEL: Record<Sex, string> = {
  FEMALE: "Female",
  MALE: "Male",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

export const ORG_TYPE_LABEL: Record<OrgType, string> = {
  CLINIC: "Clinic",
  HOSPITAL: "Hospital",
  HEALTH_SYSTEM: "Health system",
  MSO: "MSO",
  BILLING_COMPANY: "Billing company",
  OTHER: "Other",
};

export const PAYER_TYPE_LABEL: Record<PayerType, string> = {
  COMMERCIAL: "Commercial",
  MEDICARE_ADVANTAGE: "Medicare Advantage",
  MEDICAID_MANAGED: "Medicaid managed care",
  WORKERS_COMP: "Workers' compensation",
  OTHER: "Other",
};

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  CLINICAL_NOTE: "Clinical note",
  REFERRAL: "Referral",
  INSURANCE_CARD: "Insurance card",
  LAB_RESULT: "Lab result",
  IMAGING: "Imaging",
  PAYER_CORRESPONDENCE: "Payer correspondence",
  AUTHORIZATION_FORM: "Authorization form",
  OTHER: "Other",
};

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  CASE_ASSIGNED: "Case assigned",
  STATUS_CHANGED: "Status changed",
  AUTHORIZATION_APPROVED: "Authorization approved",
  AUTHORIZATION_DENIED: "Authorization denied",
  ADDITIONAL_INFORMATION_REQUESTED: "Additional information requested",
  TASK_DUE: "Task due",
  TASK_OVERDUE: "Task overdue",
  DOCUMENT_REQUIRED: "Document required",
  AI_ANALYSIS_COMPLETE: "AI analysis complete",
  PAYER_OVERDUE: "Payer decision overdue",
  AUTHORIZATION_EXPIRING: "Authorization expiring",
  APPEAL_DEADLINE: "Appeal deadline",
};

export function patientName(person: { firstName: string; lastName: string }): string {
  return `${person.lastName}, ${person.firstName}`;
}
