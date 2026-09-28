import { beforeEach, describe, expect, it } from "vitest";
import { readDb, resetMemoryStore } from "@/lib/store";
import { commitImport, previewImport, templateCsv } from "@/lib/services/imports";
import { deleteAuthRule, saveAuthRule } from "@/lib/services/auth-rules";
import { authRequirement } from "@/lib/domain/auth-rules";
import { csvCell, parseCsv } from "@/lib/imports/csv";
import { AppError } from "@/lib/domain/errors";
import type { PayerAuthRule, RequestContext } from "@/lib/domain/types";

function contextFor(email: string): RequestContext {
  const db = readDb();
  const user = db.users.find((item) => item.email === email)!;
  const membership = db.organizationMembers.find((item) => item.userId === user.id && item.status === "ACTIVE")!;
  return {
    userId: user.id,
    email,
    role: membership.role,
    organizationId: membership.organizationId,
    profile: db.profiles.find((item) => item.id === user.id)!,
    organization: db.organizations.find((item) => item.id === membership.organizationId)!,
  };
}

beforeEach(() => resetMemoryStore(new Date("2026-09-26T15:00:00.000Z")));

describe("CSV parsing", () => {
  it("handles quotes, embedded commas and line breaks, CRLF and a BOM", () => {
    const rows = parseCsv('\uFEFFName,Note\r\n"Shah, Amira","said ""hi""\nnext line"\r\n\r\nLee,plain\n');
    expect(rows).toEqual([["Name", "Note"], ["Shah, Amira", 'said "hi"\nnext line'], ["Lee", "plain"]]);
  });

  it("neutralizes spreadsheet formulas in exported error files", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("produces templates whose headers map back to every field", () => {
    const admin = contextFor("admin@northstar.demo");
    for (const kind of ["patients", "providers", "payers", "authRules"] as const) {
      expect(previewImport(admin, kind, templateCsv(kind), "skip").missingRequired).toEqual([]);
    }
  });
});

describe("payer import", () => {
  it("adds payers with timeframe defaults from the plan type and matches common header names", () => {
    const admin = contextFor("admin@northstar.demo");
    const csv = "Payer Name,Plan Type,Payer ID,Auth Phone\nLone Star Care,Medicare Advantage,LSC01,800-555-0110\nBluebonnet Health,commercial,BBH22,\nBad Plan,Vision only,,";
    const preview = previewImport(admin, "payers", csv, "skip");
    expect(preview.counts).toEqual({ new: 2, update: 0, skip: 0, error: 1 });
    expect(preview.rows[2].messages[0]).toMatch(/Type must be/);
    const result = commitImport(admin, "payers", csv, "skip");
    expect(result).toEqual({ created: 2, updated: 0, skipped: 0, errors: 1 });
    const lsc = readDb().payers.find((payer) => payer.identifier === "LSC01")!;
    expect(lsc.type).toBe("MEDICARE_ADVANTAGE");
    expect(lsc.standardTurnaroundDays).toBe(7);
    expect(lsc.appealWindowDays).toBe(65);
    expect(readDb().auditEvents.some((event) => event.event === "import.completed" && event.metadata.created === 2)).toBe(true);
  });
});

describe("patient import", () => {
  it("validates rows, links payers, and skips or updates existing MRNs", () => {
    const admin = contextFor("admin@northstar.demo");
    const existing = readDb().patients.find((patient) => patient.organizationId === admin.organizationId)!;
    const payer = readDb().payers.find((item) => item.organizationId === admin.organizationId)!;
    const csv = [
      "MRN,Patient First Name,Patient Last Name,DOB,Gender,Primary Insurance,Subscriber ID",
      `NEW-1,Ana,Reyes,04/12/1968,F,${payer.name},SUB-1`,
      `${existing.mrn},${existing.firstName},Changed,${existing.dateOfBirth},U,,`,
      "NEW-2,Bo,Kim,1990-02-30,M,,",
      "NEW-3,Cy,Ode,1970-01-01,M,Unknown Plan,",
      "NEW-1,Ana,Reyes,1968-04-12,F,,",
    ].join("\n");
    const skip = previewImport(admin, "patients", csv, "skip");
    expect(skip.rows.map((row) => row.status)).toEqual(["new", "skip", "error", "error", "error"]);
    expect(skip.rows[2].messages.join(" ")).toMatch(/Date of birth/);
    expect(skip.rows[3].messages.join(" ")).toMatch(/Import payers first/);
    expect(skip.rows[4].messages.join(" ")).toMatch(/Same record as row 2/);

    const update = commitImport(admin, "patients", csv, "update");
    expect(update).toMatchObject({ created: 1, updated: 1, errors: 3 });
    const created = readDb().patients.find((patient) => patient.mrn === "NEW-1")!;
    expect(created.dateOfBirth).toBe("1968-04-12");
    expect(created.primaryPayerId).toBe(payer.id);
    expect(readDb().patients.find((patient) => patient.id === existing.id)?.lastName).toBe("Changed");
  });

  it("refuses missing columns, oversized files and non-managers", () => {
    const admin = contextFor("admin@northstar.demo");
    expect(previewImport(admin, "patients", "First name,Last name\nA,B", "skip").missingRequired).toEqual(["MRN", "Date of birth"]);
    expect(() => commitImport(admin, "patients", "First name,Last name\nA,B", "skip")).toThrow(/missing required columns/);
    const huge = `MRN,First name,Last name,DOB\n${"X,A,B,2000-01-01\n".repeat(5001)}`;
    expect(() => previewImport(admin, "patients", huge, "skip")).toThrow(/5,000/);
    expect(() => previewImport(contextFor("specialist@northstar.demo"), "patients", templateCsv("patients"), "skip")).toThrow(AppError);
  });
});

describe("provider import", () => {
  it("rejects bad NPIs and matches existing providers by NPI", () => {
    const admin = contextFor("admin@northstar.demo");
    const existing = readDb().providers.find((provider) => provider.organizationId === admin.organizationId)!;
    const csv = `Provider Name,NPI,Specialty\nDr New,1234567893,Cardiology\nDr Typo,1234567890,Cardiology\n"${existing.name}",${existing.npi},${existing.specialty}`;
    const preview = previewImport(admin, "providers", csv, "skip");
    expect(preview.rows.map((row) => row.status)).toEqual(["new", "error", "skip"]);
  });
});

describe("payer prior-auth rules", () => {
  it("imports rules and answers required / not required / unknown, preferring exact codes over prefixes", () => {
    const admin = contextFor("admin@northstar.demo");
    const payer = readDb().payers.find((item) => item.organizationId === admin.organizationId && item.identifier)!;
    const csv = [
      "Payer,Code,Prior auth required,Note",
      `${payer.identifier},7214*,Yes,All lumbar MRI`,
      `${payer.name},72146,No,Exception`,
      `${payer.name},J1745,yes,`,
      "Nobody Plan,72148,Yes,",
      `${payer.name},ABC-1,Yes,`,
    ].join("\n");
    const result = commitImport(admin, "authRules", csv, "update");
    // The demo seed already has a J1745 rule for this payer, so that row updates it.
    expect(result).toMatchObject({ created: 2, updated: 1, errors: 2 });
    const rules = readDb().payerAuthRules.filter((rule) => rule.organizationId === admin.organizationId);
    expect(authRequirement(rules, payer.id, "CPT", "72149").requirement).toBe("REQUIRED");
    expect(authRequirement(rules, payer.id, "CPT", "72146").requirement).toBe("NOT_REQUIRED");
    expect(authRequirement(rules, payer.id, "HCPCS", "J1745").requirement).toBe("REQUIRED");
    expect(authRequirement(rules, payer.id, "CPT", "99213").requirement).toBe("UNKNOWN");
    expect(rules.find((rule) => rule.code === "J1745")?.codeType).toBe("HCPCS");
  });

  it("keeps rules inside the organization and lets managers edit them", () => {
    const manager = contextFor("manager@northstar.demo");
    const lakesidePayer = readDb().payers.find((item) => item.organizationId !== manager.organizationId)!;
    expect(() => saveAuthRule(manager, { payerId: lakesidePayer.id, codeType: "CPT", code: "72148", requirement: "REQUIRED", note: "" })).toThrow(/your organization/);
    const own = readDb().payers.find((item) => item.organizationId === manager.organizationId)!;
    const rule = saveAuthRule(manager, { payerId: own.id, codeType: "CPT", code: "70551", requirement: "REQUIRED", note: "checked" }) as PayerAuthRule;
    expect(() => saveAuthRule(contextFor("specialist@northstar.demo"), { payerId: own.id, codeType: "CPT", code: "70552", requirement: "REQUIRED", note: "" })).toThrow(AppError);
    deleteAuthRule(manager, rule.id);
    expect(readDb().payerAuthRules.some((item) => item.id === rule.id)).toBe(false);
  });
});
