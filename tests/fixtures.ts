/** Shared request payload for integration tests. */
export function requestFields() {
  return {
    renderingProviderId: null,
    memberId: "MEM-1",
    groupNumber: "G-1",
    procedure: "Physical therapy, right shoulder",
    lines: [
      { codeType: "CPT" as const, code: "97161", modifiers: [], description: "PT evaluation", requestedUnits: 1, unitType: "VISITS" as const },
      { codeType: "CPT" as const, code: "97110", modifiers: ["GP"], description: "Therapeutic exercise", requestedUnits: 12, unitType: "VISITS" as const },
    ],
    diagnoses: [{ code: "M25.511", description: "Pain in right shoulder" }],
    placeOfService: "11",
    siteOfCare: "OFFICE" as const,
    facilityName: "Northstar Specialty Clinic",
    requestedServiceDate: "2026-10-01",
    priority: "NORMAL" as const,
    reviewType: "STANDARD" as const,
    clinicalReason: "Administrative packet",
    assignedUserId: null,
    internalNotes: "",
  };
}
