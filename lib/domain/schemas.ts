import { AppError } from "@/lib/domain/errors";
import { z } from "zod";
import { isValidIcd10, isValidNpi, isValidServiceCode, MODIFIER_PATTERN, normalizeCode, POS_PATTERN } from "@/lib/domain/codes";
import {
  AUTH_STATUSES,
  CODE_TYPES,
  DECISION_OUTCOMES,
  DENIAL_REASONS,
  DOCUMENT_CATEGORIES,
  PEER_TO_PEER_STATUSES,
  REVIEW_TYPES,
  SITES_OF_CARE,
  UNIT_TYPES,
  ORG_TYPES,
  PAYER_TYPES,
  PRIORITIES,
  PROVIDER_STATUSES,
  ROLES,
  SEX_VALUES,
  TASK_STATUSES,
} from "@/lib/domain/types";

const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const optionalId = z.string().uuid().optional().or(z.literal(""));

/** NIST SP 800-63B: length over composition rules. */
export const MIN_PASSWORD_LENGTH = 12;
const newPassword = z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(200);
const shortText = (max = 160) => z.string().trim().min(1).max(max);
const optionalText = (max = 200) => z.string().trim().max(max).optional().or(z.literal(""));

export const signInSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  next: z.string().max(300).optional(),
});

export const signUpSchema = z.object({
  fullName: shortText(120),
  email: z.string().trim().email().max(200),
  password: newPassword,
});

export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, ""))
    .refine((value) => /^\d{6}$/.test(value) || /^[a-z0-9]{5}-[a-z0-9]{5}$/i.test(value), "Enter the 6-digit code or a recovery code."),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  nextPassword: newPassword,
});

export const orgSecuritySchema = z.object({
  requireMfa: z.boolean(),
  idleTimeoutMinutes: z.coerce.number().int().min(5).max(60),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(200),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(300),
  password: newPassword,
});

export const onboardingSchema = z.object({
  organizationName: shortText(160),
  organizationType: z.enum(ORG_TYPES),
  specialty: shortText(120),
  providerCount: z.coerce.number().int().min(1).max(100000),
  fullName: shortText(120),
  jobTitle: shortText(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  eligibility: z.boolean().optional(),
  referrals: z.boolean().optional(),
  denials: z.boolean().optional(),
  documentManagement: z.boolean().optional(),
});

export const patientSchema = z.object({
  mrn: shortText(40),
  firstName: shortText(80),
  lastName: shortText(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date."),
  sex: z.enum(SEX_VALUES),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  state: z.string().trim().max(40).optional().or(z.literal("")),
  zip: z.string().trim().max(20).optional().or(z.literal("")),
  primaryPayerId: z.string().uuid().optional().or(z.literal("")),
  memberId: z.string().trim().max(80).optional().or(z.literal("")),
  groupNumber: z.string().trim().max(80).optional().or(z.literal("")),
});

export const providerSchema = z.object({
  name: shortText(160),
  npi: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidNpi(value), "Enter a valid 10-digit NPI.")
    .optional(),
  specialty: shortText(120),
  phone: optionalText(40),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  status: z.enum(PROVIDER_STATUSES),
  organizationName: shortText(160),
});

export const payerSchema = z.object({
  name: shortText(160),
  type: z.enum(PAYER_TYPES),
  identifier: shortText(80),
  phone: optionalText(40),
  fax: optionalText(40),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  active: z.boolean().optional(),
  standardTurnaroundDays: z.coerce.number().int().min(1).max(60),
  expeditedTurnaroundHours: z.coerce.number().int().min(1).max(168),
  appealWindowDays: z.coerce.number().int().min(1).max(365),
  requiredDocuments: z.array(z.enum(DOCUMENT_CATEGORIES)).max(DOCUMENT_CATEGORIES.length).default([]),
});

export const lineSchema = z
  .object({
    id: optionalId,
    codeType: z.enum(CODE_TYPES),
    code: z.string().trim().min(1, "Enter a code.").max(10),
    modifiers: z.string().trim().max(20).optional().or(z.literal("")),
    description: shortText(200),
    requestedUnits: z.coerce.number().int().min(1, "At least 1.").max(9999),
    unitType: z.enum(UNIT_TYPES),
  })
  .superRefine((line, ctx) => {
    if (!isValidServiceCode(line.codeType, line.code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["code"],
        message: line.codeType === "CPT" ? "CPT codes look like 72148, 0001F or 0042T." : "HCPCS codes look like J1745.",
      });
    }
    for (const modifier of splitModifiers(line.modifiers ?? "")) {
      if (!MODIFIER_PATTERN.test(modifier)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["modifiers"], message: "Modifiers are two letters or digits, e.g. RT, 59." });
        break;
      }
    }
  });

export const diagnosisSchema = z.object({
  code: z.string().trim().refine(isValidIcd10, "ICD-10-CM codes look like M17.11."),
  description: shortText(200),
});

export const authorizationSchema = z.object({
  patientId: id,
  providerId: id,
  renderingProviderId: optionalId,
  payerId: id,
  memberId: optionalText(80),
  groupNumber: optionalText(80),
  procedure: shortText(200),
  lines: z.array(lineSchema).min(1, "Add at least one service line.").max(25),
  diagnoses: z.array(diagnosisSchema).min(1, "Add the primary diagnosis.").max(12),
  placeOfService: z.string().trim().regex(POS_PATTERN, "Use the two-digit place of service code."),
  siteOfCare: z.enum(SITES_OF_CARE),
  facilityName: optionalText(160),
  requestedServiceDate: isoDate,
  priority: z.enum(PRIORITIES),
  reviewType: z.enum(REVIEW_TYPES),
  clinicalReason: z.string().trim().max(4000).optional().or(z.literal("")),
  assignedUserId: optionalId,
  internalNotes: z.string().trim().max(4000).optional().or(z.literal("")),
});

export function splitModifiers(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((part) => normalizeCode(part))
    .filter(Boolean);
}

export const decisionSchema = z
  .object({
    authorizationId: id,
    outcome: z.enum(DECISION_OUTCOMES),
    payerReference: shortText(80),
    decisionDate: isoDate,
    validFrom: isoDate.optional().or(z.literal("")),
    validTo: isoDate.optional().or(z.literal("")),
    lines: z
      .array(z.object({ id, approvedUnits: z.coerce.number().int().min(0).max(9999) }))
      .max(25)
      .default([]),
    denialReason: z.enum(DENIAL_REASONS).optional().or(z.literal("")),
    denialDetail: z.string().trim().max(2000).optional().or(z.literal("")),
    determinationDocumentId: optionalId,
    reason: z.string().trim().min(3).max(1000),
  })
  .superRefine((value, ctx) => {
    if (value.outcome !== "DENIED") {
      if (!value.validFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validFrom"], message: "Enter the approved start date." });
      if (!value.validTo) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validTo"], message: "Enter the approved end date." });
      if (value.validFrom && value.validTo && value.validTo < value.validFrom) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validTo"], message: "End date must be on or after the start date." });
      }
    } else if (!value.denialReason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["denialReason"], message: "Choose the denial reason from the payer letter." });
    }
  });

export const rescheduleSchema = z.object({
  authorizationId: id,
  requestedServiceDate: isoDate,
  reason: z.string().trim().min(3).max(1000),
});

export const peerToPeerSchema = z.object({
  authorizationId: id,
  status: z.enum(PEER_TO_PEER_STATUSES),
  scheduledAt: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const supersedeSchema = z.object({
  authorizationId: id,
  reason: z.string().trim().min(3).max(1000),
});

export const transitionSchema = z.object({
  authorizationId: id,
  status: z.enum(AUTH_STATUSES),
  reason: z.string().trim().min(3).max(1000),
});

export const assignSchema = z.object({
  authorizationId: id,
  assignedUserId: z.string().uuid().nullable(),
});

export const payerResponseSchema = z.object({
  authorizationId: id,
  payerReference: shortText(80),
  summary: z.string().trim().min(3).max(2000),
});

export const taskSchema = z.object({
  title: shortText(160),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  authorizationId: z.string().uuid().optional().or(z.literal("")),
  patientId: z.string().uuid().optional().or(z.literal("")),
  assignedUserId: z.string().uuid().optional().or(z.literal("")),
  dueDate: isoDate.optional().or(z.literal("")),
  priority: z.enum(PRIORITIES),
  status: z.enum(TASK_STATUSES).optional(),
});

export const noteSchema = z.object({
  authorizationId: id,
  content: z.string().trim().min(1).max(5000),
});

export const profileSchema = z.object({
  fullName: shortText(120),
  jobTitle: shortText(120),
  phone: optionalText(40),
});

export const organizationSettingsSchema = z.object({
  name: shortText(160),
  type: z.enum(ORG_TYPES),
  specialty: shortText(120),
  providerCount: z.coerce.number().int().min(1).max(100000),
});

export const inviteSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(ROLES),
});

export const roleChangeSchema = z.object({
  memberId: id,
  role: z.enum(ROLES),
});

export const contactSchema = z.object({
  name: shortText(120),
  email: z.string().trim().email().max(200),
  organization: shortText(160),
  message: z.string().trim().min(10).max(4000),
});

export const notificationPrefsSchema = z.object({
  caseAssigned: z.boolean(),
  statusChanged: z.boolean(),
  taskDue: z.boolean(),
  aiComplete: z.boolean(),
  emailEnabled: z.boolean(),
});

export const planChangeSchema = z.object({
  plan: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]),
});

export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).slice(0, 3).join(" ");
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      if (key && !fields[key]) fields[key] = issue.message;
    }
    throw new AppError(message || "Invalid input.", "VALIDATION", fields);
  }
  return result.data;
}

export const ssoSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["microsoft", "google", "oidc"]),
  tenantId: z.string().trim().max(64).default(""),
  issuer: z.string().trim().max(300).default(""),
  clientId: z.string().trim().max(300).default(""),
  clientSecret: z.string().max(500).default(""),
  jitProvisioning: z.boolean(),
  defaultRole: z.enum(["VIEWER", "SPECIALIST", "MANAGER"]),
  requireSso: z.boolean(),
});

export const ssoDomainSchema = z.object({ domain: z.string().trim().min(4).max(253) });
