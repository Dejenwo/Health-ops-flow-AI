import { randomUUID } from "crypto";
import { assertCan } from "@/lib/domain/permissions";
import { validationError } from "@/lib/domain/errors";
import { RULE_CODE_PATTERN } from "@/lib/domain/auth-rules";
import { isValidNpi, normalizeCode } from "@/lib/domain/codes";
import { PAYER_TIMEFRAME_DEFAULTS } from "@/lib/domain/sla";
import { patientSchema, payerSchema, providerSchema } from "@/lib/domain/schemas";
import type { CodeType, Database, Payer, PayerType, RequestContext, Sex } from "@/lib/domain/types";
import { headerKey, parseCsv } from "@/lib/imports/csv";
import { mutate, readDb } from "@/lib/store";
import { pushActivity, pushAudit } from "@/lib/services/events";

/**
 * CSV import for onboarding: patients, providers, payers and payer auth rules.
 * Every import is validated twice: once for the preview, and again on commit from the raw file,
 * so nothing the browser sends back is trusted. Valid rows are written in one transaction; rows
 * with errors are skipped and reported. The uploaded file is never stored.
 */

export const IMPORT_KINDS = ["patients", "providers", "payers", "authRules"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export type DuplicateMode = "skip" | "update";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
  example: string;
}

const f = (key: string, label: string, required: boolean, aliases: string[], example: string): FieldSpec => ({ key, label, required, aliases: [key, label, ...aliases].map(headerKey), example });

export const IMPORT_FIELDS: Record<ImportKind, FieldSpec[]> = {
  patients: [
    f("mrn", "MRN", true, ["medicalrecordnumber", "patientid", "chartnumber", "accountnumber"], "NS-20417"),
    f("firstName", "First name", true, ["first", "ptfirstname", "patientfirstname", "givenname"], "Maria"),
    f("lastName", "Last name", true, ["last", "ptlastname", "patientlastname", "surname", "familyname"], "Lopez"),
    f("dateOfBirth", "Date of birth", true, ["dob", "birthdate", "birthday"], "1968-04-12"),
    f("sex", "Sex", false, ["gender"], "Female"),
    f("phone", "Phone", false, ["phonenumber", "homephone", "mobile", "cellphone"], "214-555-0142"),
    f("email", "Email", false, ["emailaddress"], ""),
    f("address", "Address", false, ["street", "address1", "streetaddress"], "120 Elm St"),
    f("city", "City", false, [], "Dallas"),
    f("state", "State", false, ["st"], "TX"),
    f("zip", "ZIP", false, ["zipcode", "postalcode"], "75201"),
    f("payer", "Primary payer", false, ["payer", "primaryinsurance", "insurance", "plan", "payername", "insurancename"], "Northwind Health Plan"),
    f("memberId", "Member ID", false, ["subscriberid", "policynumber", "insuranceid", "memberno"], "NWH-884120"),
    f("groupNumber", "Group number", false, ["group", "groupno", "groupid"], "G-1182"),
  ],
  providers: [
    f("name", "Name", true, ["providername", "fullname", "physician"], "Amira Shah, MD"),
    f("npi", "NPI", false, ["npinumber", "individualnpi"], "1234567893"),
    f("specialty", "Specialty", true, ["taxonomy", "department"], "Orthopedic surgery"),
    f("phone", "Phone", false, [], ""),
    f("email", "Email", false, [], ""),
    f("status", "Status", false, ["active"], "Active"),
    f("organizationName", "Practice name", false, ["organization", "practice", "group"], ""),
  ],
  payers: [
    f("name", "Name", true, ["payername", "insurance", "plan", "planname"], "Northwind Health Plan"),
    f("type", "Type", false, ["payertype", "plantype", "lineofbusiness"], "Commercial"),
    f("identifier", "Payer ID", false, ["payerid", "identifier", "electronicpayerid", "edipayerid"], "NWH01"),
    f("phone", "Phone", false, ["priorauthphone", "authphone"], "800-555-0100"),
    f("fax", "Fax", false, ["priorauthfax", "authfax"], "800-555-0101"),
    f("website", "Website", false, ["portal", "portalurl", "url"], "https://portal.example.com"),
    f("notes", "Notes", false, [], ""),
    f("standardTurnaroundDays", "Standard decision days", false, ["standarddays", "turnarounddays"], ""),
    f("expeditedTurnaroundHours", "Expedited decision hours", false, ["expeditedhours", "urgenthours"], ""),
    f("appealWindowDays", "Appeal window days", false, ["appealdays"], ""),
  ],
  authRules: [
    f("payer", "Payer", true, ["payername", "payerid", "insurance"], "Northwind Health Plan"),
    f("codeType", "Code type", false, ["codeset", "type"], "CPT"),
    f("code", "Code", true, ["cpt", "hcpcs", "cptcode", "procedurecode", "servicecode"], "72148"),
    f("requirement", "Prior auth required", true, ["requiresauth", "authrequired", "paRequired", "required", "priorauth"], "Yes"),
    f("note", "Note", false, ["notes", "comment"], "MRI requires auth"),
  ],
};

export interface PreviewRow {
  row: number;
  status: "new" | "update" | "skip" | "error";
  summary: string;
  messages: string[];
}

export interface ImportPreview {
  kind: ImportKind;
  totalRows: number;
  columns: { header: string; field: string | null }[];
  missingRequired: string[];
  counts: Record<PreviewRow["status"], number>;
  rows: PreviewRow[];
}

type Values = Record<string, string>;
type Plan = { status: PreviewRow["status"]; summary: string; messages: string[]; apply?: (db: Database) => void };

function mapColumns(kind: ImportKind, headers: string[]) {
  const fields = IMPORT_FIELDS[kind];
  const used = new Set<string>();
  const columns = headers.map((header) => {
    const key = headerKey(header);
    const field = fields.find((item) => !used.has(item.key) && item.aliases.includes(key));
    if (field) used.add(field.key);
    return { header, field: field?.key ?? null };
  });
  const missingRequired = fields.filter((item) => item.required && !used.has(item.key)).map((item) => item.label);
  return { columns, missingRequired };
}

function parseDate(value: string): string | null {
  const text = value.trim();
  let year: number, month: number, day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (!match) return null;
    [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function parseSex(value: string): Sex | null {
  const key = headerKey(value);
  if (!key) return "UNKNOWN";
  if (["f", "female", "woman"].includes(key)) return "FEMALE";
  if (["m", "male", "man"].includes(key)) return "MALE";
  if (["o", "other", "x", "nonbinary"].includes(key)) return "OTHER";
  if (["u", "unknown", "unk"].includes(key)) return "UNKNOWN";
  return null;
}

function parsePayerType(value: string): PayerType | null {
  const key = headerKey(value);
  if (!key) return "COMMERCIAL";
  if (key.includes("medicareadvantage") || key === "ma" || key === "medicare") return "MEDICARE_ADVANTAGE";
  if (key.includes("medicaid")) return "MEDICAID_MANAGED";
  if (key.includes("worker")) return "WORKERS_COMP";
  if (key.includes("commercial") || key === "employer" || key === "private") return "COMMERCIAL";
  if (key === "other") return "OTHER";
  return null;
}

function parseYesNo(value: string): boolean | null {
  const key = headerKey(value);
  if (["yes", "y", "true", "required", "1", "requiresauth"].includes(key)) return true;
  if (["no", "n", "false", "notrequired", "0", "exempt"].includes(key)) return false;
  return null;
}

function findPayer(db: Database, organizationId: string, value: string): Payer | null {
  const key = headerKey(value);
  if (!key) return null;
  return (
    db.payers.find((payer) => payer.organizationId === organizationId && (headerKey(payer.name) === key || (payer.identifier && headerKey(payer.identifier) === key))) ?? null
  );
}

function zodMessages(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): string[] {
  if (result.success || !result.error) return [];
  return result.error.issues.map((issue) => `${issue.path.map(String).join(".") || "row"}: ${issue.message}`);
}

function planRow(kind: ImportKind, db: Database, ctx: RequestContext, values: Values, mode: DuplicateMode, now: string): Plan {
  const base = { createdAt: now, updatedAt: now, createdBy: ctx.userId, updatedBy: ctx.userId };

  if (kind === "patients") {
    const messages: string[] = [];
    const dateOfBirth = parseDate(values.dateOfBirth ?? "");
    if (!dateOfBirth) messages.push("Date of birth must be YYYY-MM-DD or MM/DD/YYYY.");
    else if (dateOfBirth > now.slice(0, 10)) messages.push("Date of birth is in the future.");
    const sex = parseSex(values.sex ?? "");
    if (!sex) messages.push("Sex must be Female, Male, Other or Unknown.");
    let primaryPayerId = "";
    if (values.payer?.trim()) {
      const payer = findPayer(db, ctx.organizationId, values.payer);
      if (!payer) messages.push(`Payer "${values.payer.trim()}" is not in your payer list. Import payers first.`);
      else primaryPayerId = payer.id;
    }
    const candidate = {
      mrn: (values.mrn ?? "").trim(),
      firstName: (values.firstName ?? "").trim(),
      lastName: (values.lastName ?? "").trim(),
      dateOfBirth: dateOfBirth ?? "",
      sex: sex ?? "UNKNOWN",
      phone: (values.phone ?? "").trim(),
      email: (values.email ?? "").trim(),
      address: (values.address ?? "").trim(),
      city: (values.city ?? "").trim(),
      state: (values.state ?? "").trim().toUpperCase(),
      zip: (values.zip ?? "").trim(),
      primaryPayerId,
      memberId: (values.memberId ?? "").trim(),
      groupNumber: (values.groupNumber ?? "").trim(),
    };
    if (dateOfBirth && sex) messages.push(...zodMessages(patientSchema.safeParse(candidate)));
    const summary = `${candidate.lastName}, ${candidate.firstName} · ${candidate.mrn}`;
    if (messages.length) return { status: "error", summary, messages };
    const existing = db.patients.find((item) => item.organizationId === ctx.organizationId && item.mrn.toLowerCase() === candidate.mrn.toLowerCase());
    const record = { ...candidate, primaryPayerId: candidate.primaryPayerId || null };
    if (existing) {
      if (mode === "skip") return { status: "skip", summary, messages: ["A patient with this MRN already exists."] };
      return { status: "update", summary, messages: [], apply: (target) => Object.assign(target.patients.find((item) => item.id === existing.id)!, record, { updatedAt: now, updatedBy: ctx.userId }) };
    }
    return { status: "new", summary, messages: [], apply: (target) => void target.patients.push({ id: randomUUID(), organizationId: ctx.organizationId, ...record, ...base }) };
  }

  if (kind === "providers") {
    const status = headerKey(values.status ?? "");
    const candidate = {
      name: (values.name ?? "").trim(),
      npi: (values.npi ?? "").trim(),
      specialty: (values.specialty ?? "").trim(),
      phone: (values.phone ?? "").trim(),
      email: (values.email ?? "").trim(),
      status: ["inactive", "no", "false", "0"].includes(status) ? ("INACTIVE" as const) : ("ACTIVE" as const),
      organizationName: (values.organizationName ?? "").trim() || ctx.organization.name,
    };
    const messages = zodMessages(providerSchema.safeParse(candidate));
    if (candidate.npi && !isValidNpi(candidate.npi) && !messages.some((item) => item.includes("NPI"))) messages.push("npi: Enter a valid 10-digit NPI.");
    const summary = `${candidate.name}${candidate.npi ? ` · NPI ${candidate.npi}` : ""}`;
    if (messages.length) return { status: "error", summary, messages };
    const existing = db.providers.find(
      (item) => item.organizationId === ctx.organizationId && (candidate.npi ? item.npi === candidate.npi : headerKey(item.name) === headerKey(candidate.name)),
    );
    if (existing) {
      if (mode === "skip") return { status: "skip", summary, messages: ["This provider already exists."] };
      return { status: "update", summary, messages: [], apply: (target) => Object.assign(target.providers.find((item) => item.id === existing.id)!, candidate, { updatedAt: now, updatedBy: ctx.userId }) };
    }
    return { status: "new", summary, messages: [], apply: (target) => void target.providers.push({ id: randomUUID(), organizationId: ctx.organizationId, ...candidate, ...base }) };
  }

  if (kind === "payers") {
    const type = parsePayerType(values.type ?? "");
    const messages: string[] = [];
    if (!type) messages.push("Type must be Commercial, Medicare Advantage, Medicaid managed care, Workers comp or Other.");
    const defaults = PAYER_TIMEFRAME_DEFAULTS[type ?? "COMMERCIAL"];
    const number = (value: string | undefined, fallback: number) => (value?.trim() ? Number(value) : fallback);
    const candidate = {
      name: (values.name ?? "").trim(),
      type: type ?? "COMMERCIAL",
      identifier: (values.identifier ?? "").trim(),
      phone: (values.phone ?? "").trim(),
      fax: (values.fax ?? "").trim(),
      website: (values.website ?? "").trim(),
      notes: (values.notes ?? "").trim(),
      active: true,
      standardTurnaroundDays: number(values.standardTurnaroundDays, defaults.standardTurnaroundDays),
      expeditedTurnaroundHours: number(values.expeditedTurnaroundHours, defaults.expeditedTurnaroundHours),
      appealWindowDays: number(values.appealWindowDays, defaults.appealWindowDays),
      requiredDocuments: [],
    };
    const parsed = payerSchema.safeParse(candidate);
    messages.push(...zodMessages(parsed));
    const summary = `${candidate.name}${candidate.identifier ? ` · ${candidate.identifier}` : ""}`;
    if (messages.length || !parsed.success) return { status: "error", summary, messages };
    const record = { ...candidate, standardTurnaroundDays: parsed.data.standardTurnaroundDays, expeditedTurnaroundHours: parsed.data.expeditedTurnaroundHours, appealWindowDays: parsed.data.appealWindowDays };
    const existing = db.payers.find(
      (item) =>
        item.organizationId === ctx.organizationId &&
        ((candidate.identifier && item.identifier && headerKey(item.identifier) === headerKey(candidate.identifier)) || headerKey(item.name) === headerKey(candidate.name)),
    );
    if (existing) {
      if (mode === "skip") return { status: "skip", summary, messages: ["This payer already exists."] };
      return {
        status: "update",
        summary,
        messages: [],
        apply: (target) => Object.assign(target.payers.find((item) => item.id === existing.id)!, { ...record, requiredDocuments: existing.requiredDocuments }, { updatedAt: now, updatedBy: ctx.userId }),
      };
    }
    return { status: "new", summary, messages: [], apply: (target) => void target.payers.push({ id: randomUUID(), organizationId: ctx.organizationId, ...record, ...base }) };
  }

  // authRules
  const messages: string[] = [];
  const payer = findPayer(db, ctx.organizationId, values.payer ?? "");
  if (!payer) messages.push(`Payer "${(values.payer ?? "").trim()}" is not in your payer list.`);
  const code = normalizeCode(values.code ?? "");
  if (!RULE_CODE_PATTERN.test(code)) messages.push("Code must be a CPT/HCPCS code like 72148 or J1745, or a prefix like 7214*.");
  const typeKey = headerKey(values.codeType ?? "");
  const codeType: CodeType | null = typeKey === "hcpcs" ? "HCPCS" : typeKey === "cpt" ? "CPT" : !typeKey ? (/^[A-V]/.test(code) ? "HCPCS" : "CPT") : null;
  if (!codeType) messages.push("Code type must be CPT or HCPCS.");
  const required = parseYesNo(values.requirement ?? "");
  if (required === null) messages.push("Prior auth required must be Yes or No.");
  const summary = `${payer?.name ?? values.payer ?? ""} · ${code || "?"} · ${required === null ? "?" : required ? "Required" : "Not required"}`;
  if (messages.length || !payer || !codeType || required === null) return { status: "error", summary, messages };
  const record = { payerId: payer.id, codeType, code, requirement: required ? ("REQUIRED" as const) : ("NOT_REQUIRED" as const), note: (values.note ?? "").trim().slice(0, 300) };
  const existing = db.payerAuthRules.find((item) => item.organizationId === ctx.organizationId && item.payerId === payer.id && item.codeType === codeType && item.code === code);
  if (existing) {
    if (mode === "skip") return { status: "skip", summary, messages: ["A rule for this payer and code already exists."] };
    return { status: "update", summary, messages: [], apply: (target) => Object.assign(target.payerAuthRules.find((item) => item.id === existing.id)!, record, { updatedAt: now, updatedBy: ctx.userId }) };
  }
  return { status: "new", summary, messages: [], apply: (target) => void target.payerAuthRules.push({ id: randomUUID(), organizationId: ctx.organizationId, ...record, ...base }) };
}

function duplicateKey(kind: ImportKind, values: Values): string {
  if (kind === "patients") return headerKey(values.mrn ?? "");
  if (kind === "providers") return values.npi?.trim() || headerKey(values.name ?? "");
  if (kind === "payers") return headerKey(values.identifier ?? "") || headerKey(values.name ?? "");
  return `${headerKey(values.payer ?? "")}|${headerKey(values.codeType ?? "")}|${normalizeCode(values.code ?? "")}`;
}

function analyze(ctx: RequestContext, db: Database, kind: ImportKind, csvText: string, mode: DuplicateMode) {
  assertCan(ctx.role, "data.import");
  if (!IMPORT_KINDS.includes(kind)) throw validationError("Unknown import type.");
  if (Buffer.byteLength(csvText, "utf8") > MAX_IMPORT_BYTES) throw validationError("The file is larger than 2 MB. Split it into smaller files.");
  const table = parseCsv(csvText);
  if (table.length < 2) throw validationError("The file needs a header row and at least one data row.");
  const [headers, ...data] = table;
  if (data.length > MAX_IMPORT_ROWS) throw validationError(`Import up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time.`);
  const { columns, missingRequired } = mapColumns(kind, headers);
  const now = new Date().toISOString();
  const seen = new Map<string, number>();
  const plans = data.map((cells, index) => {
    const values: Values = {};
    columns.forEach((column, position) => {
      if (column.field) values[column.field] = (cells[position] ?? "").slice(0, 500);
    });
    const rowNumber = index + 2;
    if (missingRequired.length) return { row: rowNumber, plan: { status: "error" as const, summary: "", messages: [`Missing columns: ${missingRequired.join(", ")}`] } };
    const key = duplicateKey(kind, values);
    if (key && seen.has(key)) {
      return { row: rowNumber, plan: { status: "error" as const, summary: key, messages: [`Same record as row ${seen.get(key)} in this file.`] } };
    }
    if (key) seen.set(key, rowNumber);
    return { row: rowNumber, plan: planRow(kind, db, ctx, values, mode, now) };
  });
  return { columns, missingRequired, plans };
}

export function previewImport(ctx: RequestContext, kind: ImportKind, csvText: string, mode: DuplicateMode): ImportPreview {
  const { columns, missingRequired, plans } = analyze(ctx, readDb(), kind, csvText, mode);
  const counts = { new: 0, update: 0, skip: 0, error: 0 };
  for (const { plan } of plans) counts[plan.status] += 1;
  return {
    kind,
    totalRows: plans.length,
    columns,
    missingRequired,
    counts,
    rows: plans.map(({ row, plan }) => ({ row, status: plan.status, summary: plan.summary, messages: plan.messages })),
  };
}

export function commitImport(ctx: RequestContext, kind: ImportKind, csvText: string, mode: DuplicateMode) {
  return mutate((db) => {
    const { missingRequired, plans } = analyze(ctx, db, kind, csvText, mode);
    if (missingRequired.length) throw validationError(`The file is missing required columns: ${missingRequired.join(", ")}.`);
    const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };
    for (const { plan } of plans) {
      if (plan.status === "error") counts.errors += 1;
      else if (plan.status === "skip") counts.skipped += 1;
      else {
        plan.apply?.(db);
        if (plan.status === "new") counts.created += 1;
        else counts.updated += 1;
      }
    }
    pushAudit(db, { organizationId: ctx.organizationId, actorId: ctx.userId, event: "import.completed", resourceType: "organization", resourceId: ctx.organizationId, metadata: { kind, mode, ...counts } });
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "import.completed",
      summary: `Imported ${kind === "authRules" ? "payer auth rules" : kind}: ${counts.created} added, ${counts.updated} updated, ${counts.skipped} skipped, ${counts.errors} with errors`,
      resourceType: "organization",
      resourceId: ctx.organizationId,
      authorizationId: null,
      patientId: null,
    });
    return counts;
  });
}

export function templateCsv(kind: ImportKind): string {
  const fields = IMPORT_FIELDS[kind];
  return `${fields.map((field) => field.label).join(",")}\r\n${fields.map((field) => (field.example.includes(",") ? `"${field.example}"` : field.example)).join(",")}\r\n`;
}
