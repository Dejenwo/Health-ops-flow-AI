import type { AuthorizationCase, AuthorizationDocument, DocumentCategory, Payer, Provider } from "@/lib/domain/types";
import { isValidIcd10, isValidNpi, isValidServiceCode, POS_PATTERN } from "@/lib/domain/codes";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/domain/labels";

/** Documents that count as clinical support for a request. */
export const CLINICAL_SUPPORT: readonly DocumentCategory[] = ["CLINICAL_NOTE", "LAB_RESULT", "IMAGING", "REFERRAL"];

export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
}

/**
 * The packet checklist that must pass before a case can be marked ready for review or submitted.
 * Shown to staff as a checklist and enforced by the service layer.
 */
export function readinessChecklist(input: {
  authorization: AuthorizationCase;
  orderingProvider: Provider | null;
  payer: Payer | null;
  documents: AuthorizationDocument[];
}): ReadinessItem[] {
  const { authorization, orderingProvider, payer, documents } = input;
  const categories = new Set(documents.map((document) => document.category));
  const items: ReadinessItem[] = [
    { key: "member", label: "Member ID recorded", ok: authorization.memberId.trim().length > 0 },
    {
      key: "lines",
      label: "At least one service line with a valid CPT/HCPCS code and units",
      ok:
        authorization.lines.length > 0 &&
        authorization.lines.every((line) => isValidServiceCode(line.codeType, line.code) && line.requestedUnits >= 1),
    },
    {
      key: "diagnoses",
      label: "Primary diagnosis with a valid ICD-10-CM code",
      ok: authorization.diagnoses.length > 0 && authorization.diagnoses.every((entry) => isValidIcd10(entry.code)),
    },
    {
      key: "npi",
      label: "Ordering provider has a valid NPI",
      ok: Boolean(orderingProvider && isValidNpi(orderingProvider.npi)),
    },
    { key: "pos", label: "Place of service recorded", ok: POS_PATTERN.test(authorization.placeOfService) },
    { key: "date", label: "Requested service date recorded", ok: /^\d{4}-\d{2}-\d{2}$/.test(authorization.requestedServiceDate) },
    {
      key: "clinical",
      label: "Clinical support attached (note, lab, imaging, or referral)",
      ok: CLINICAL_SUPPORT.some((category) => categories.has(category)),
    },
  ];
  for (const category of payer?.requiredDocuments ?? []) {
    items.push({
      key: `payer-doc-${category}`,
      label: `${DOCUMENT_CATEGORY_LABEL[category]} attached (required by ${payer?.name ?? "payer"})`,
      ok: categories.has(category),
    });
  }
  return items;
}

export function readinessGaps(items: ReadinessItem[]): string[] {
  return items.filter((item) => !item.ok).map((item) => item.label);
}
