import { beforeEach, describe, expect, it } from "vitest";
import { resetMemoryStore, readDb } from "@/lib/store";
import { resetMemoryBlobs } from "@/lib/storage/blobs";
import type { RequestContext } from "@/lib/domain/types";
import { createPatient, getPatientDetail, listPatients } from "@/lib/services/patients";
import { createAuthorization, getAuthorizationWorkspace, transitionAuthorization } from "@/lib/services/authorizations";
import { createTask } from "@/lib/services/tasks";
import { addNote } from "@/lib/services/collaboration";
import { analyzeAuthorization, runOperationalQuery } from "@/lib/services/intelligence";
import { globalSearch } from "@/lib/services/collaboration";
import { AppError } from "@/lib/domain/errors";
import { changeMemberRole } from "@/lib/services/admin";
import { requestFields } from "../fixtures";

function contextFor(email: string): RequestContext {
  const db = readDb();
  const user = db.users.find((item) => item.email === email);
  if (!user) throw new Error(`Missing ${email}`);
  const profile = db.profiles.find((item) => item.id === user.id)!;
  const membership = db.organizationMembers.find((item) => item.userId === user.id && item.status === "ACTIVE")!;
  const organization = db.organizations.find((item) => item.id === membership.organizationId)!;
  return {
    userId: user.id,
    email: user.email,
    role: membership.role,
    organizationId: organization.id,
    profile,
    organization,
  };
}

beforeEach(() => {
  resetMemoryBlobs();
  resetMemoryStore(new Date("2026-09-26T15:00:00.000Z"));
});

describe("organization isolation", () => {
  it("does not return another organization's patient by id", () => {
    const northstar = contextFor("owner@northstar.demo");
    const lakeside = contextFor("rival@lakeside.demo");
    const secret = listPatients(lakeside, { pageSize: 20 }).items[0];
    expect(secret).toBeTruthy();
    expect(getPatientDetail(northstar, secret.id)).toBeNull();
    expect(listPatients(northstar, { q: "Isolated", pageSize: 50 }).items).toHaveLength(0);
  });

  it("does not surface the other tenant in search", () => {
    const northstar = contextFor("owner@northstar.demo");
    const result = globalSearch(northstar, "PA-LK-9001");
    expect(result.authorizations).toHaveLength(0);
    expect(globalSearch(northstar, "Lakeside-only").tasks).toHaveLength(0);
  });
});

describe("workflow", () => {
  it("creates a patient and an authorization inside the caller's organization", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const db = readDb();
    const payer = db.payers.find((item) => item.organizationId === ctx.organizationId)!;
    const patient = createPatient(ctx, {
      mrn: "NS-NEW-1",
      firstName: "Test",
      lastName: "Patient",
      dateOfBirth: "1990-01-02",
      sex: "FEMALE",
      phone: "(555) 010-0000",
      email: "test.patient@example.com",
      address: "1 Test Street",
      city: "Portland",
      state: "OR",
      zip: "97201",
      primaryPayerId: payer.id,
      memberId: "MEM-1",
      groupNumber: "G-1",
    });
    expect(patient.organizationId).toBe(ctx.organizationId);
    expect(getPatientDetail(contextFor("rival@lakeside.demo"), patient.id)).toBeNull();

    const provider = readDb().providers.find((item) => item.organizationId === ctx.organizationId)!;
    const authorization = createAuthorization(ctx, {
      patientId: patient.id,
      providerId: provider.id,
      payerId: payer.id,
      ...requestFields(),
      priority: "HIGH",
    });
    expect(authorization.status).toBe("DRAFT");
    expect(authorization.organizationId).toBe(ctx.organizationId);
  });

  it("rejects an invalid status transition and accepts a valid one", () => {
    const ctx = contextFor("manager@northstar.demo");
    const draft = readDb().authorizationCases.find(
      (item) =>
        item.organizationId === ctx.organizationId &&
        item.status === "DRAFT" &&
        readDb().authorizationDocuments.some((doc) => doc.authorizationId === item.id && doc.category === "CLINICAL_NOTE"),
    );
    expect(draft).toBeTruthy();
    expect(() => transitionAuthorization(ctx, draft!.id, "APPROVED", "Skip the queue")).toThrow(AppError);
    const moved = transitionAuthorization(ctx, draft!.id, "READY_FOR_REVIEW", "Packet looks complete");
    expect(moved.status).toBe("READY_FOR_REVIEW");
    const history = readDb().authorizationStatusHistory.filter((item) => item.authorizationId === draft!.id);
    expect(history.some((item) => item.newStatus === "READY_FOR_REVIEW" && item.previousStatus === "DRAFT")).toBe(true);
  });

  it("lets a specialist create a task and a note without changing status via AI", async () => {
    const ctx = contextFor("specialist@northstar.demo");
    const authorization = readDb().authorizationCases.find((item) => item.organizationId === ctx.organizationId && item.status === "PENDING")!;
    const before = authorization.status;
    createTask(ctx, {
      title: "Call the payer desk",
      description: "Internal follow-up",
      authorizationId: authorization.id,
      patientId: authorization.patientId,
      assignedUserId: ctx.userId,
      dueDate: "2026-09-26",
      priority: "URGENT",
    });
    addNote(ctx, authorization.id, "Staff note only.");
    const run = await analyzeAuthorization(ctx, authorization.id);
    expect(run.status).toBe("COMPLETED");
    expect(run.output && "disclaimer" in run.output && run.output.disclaimer).toBe("AI-generated — review before use.");
    const after = readDb().authorizationCases.find((item) => item.id === authorization.id)!;
    expect(after.status).toBe(before);
    const workspace = getAuthorizationWorkspace(ctx, authorization.id);
    expect(workspace?.notes.some((note) => note.content === "Staff note only.")).toBe(true);
  });

  it("blocks a viewer from writing and a specialist from changing roles", () => {
    const viewer = contextFor("viewer@northstar.demo");
    expect(() => createPatient(viewer, {
      mrn: "NOPE",
      firstName: "No",
      lastName: "Access",
      dateOfBirth: "1980-01-01",
      sex: "UNKNOWN",
      phone: "",
      email: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      primaryPayerId: null,
      memberId: "",
      groupNumber: "",
    })).toThrow(AppError);

    const specialist = contextFor("specialist@northstar.demo");
    const member = readDb().organizationMembers.find((item) => item.organizationId === specialist.organizationId && item.role === "VIEWER")!;
    expect(() => changeMemberRole(specialist, member.id, "ADMIN")).toThrow(AppError);
  });

  it("answers an operational question without leaving the organization", () => {
    const ctx = contextFor("owner@northstar.demo");
    const result = runOperationalQuery(ctx, "pending_over_five_days");
    expect(result.disclaimer).toBe("AI-generated — review before use.");
    expect(result.items.every((item) => item.href.startsWith("/authorizations/"))).toBe(true);
    expect(result.narrative.toLowerCase()).not.toContain("lakeside");
  });
});

