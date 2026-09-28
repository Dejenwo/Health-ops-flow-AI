import type { PlanId } from "@/lib/domain/types";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMonthly: number | null;
  priceLabel: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

export const PLANS: PlanDefinition[] = [
  {
    id: "STARTER",
    name: "Starter",
    priceMonthly: 149,
    priceLabel: "$149",
    description: "For a single clinic team getting prior authorization work out of inboxes.",
    features: [
      "1 organization",
      "Up to 5 users",
      "Prior authorization workspace",
      "Tasks, notes, and document metadata",
      "Mock or bring-your-own AI key",
    ],
    cta: "Start free",
  },
  {
    id: "PROFESSIONAL",
    name: "Professional",
    priceMonthly: 449,
    priceLabel: "$449",
    description: "For multi-provider groups that need assignment, analytics, and audit history.",
    features: [
      "Unlimited users on one organization",
      "Role-based access",
      "Operational analytics",
      "AI administrative drafts with human review",
      "Audit log",
    ],
    cta: "Start free",
    highlighted: true,
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    priceMonthly: null,
    priceLabel: "Talk to us",
    description: "For health systems that need a security review before any production data.",
    features: [
      "Security review and BAA discussion",
      "SSO and SCIM roadmap",
      "Dedicated environments",
      "Integration planning for FHIR, HL7, and payer APIs",
      "No live EHR connection is included today",
    ],
    cta: "Contact us",
  },
];

export function getPlan(id: PlanId): PlanDefinition {
  const plan = PLANS.find((item) => item.id === id);
  if (!plan) throw new Error(`Unknown plan ${id}`);
  return plan;
}
