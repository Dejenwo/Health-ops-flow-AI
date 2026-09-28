export type IntegrationAvailability = "COMING_SOON" | "AVAILABLE";

export interface IntegrationDefinition {
  key: string;
  name: string;
  category: string;
  description: string;
  availability: IntegrationAvailability;
  note: string;
}

/** None of these are live connections. Requesting one records interest only. */
export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    key: "epic",
    name: "Epic",
    category: "EHR",
    description: "Future SMART on FHIR connection for scheduling and document context.",
    availability: "COMING_SOON",
    note: "Not connected. No Epic data is exchanged.",
  },
  {
    key: "oracle-health",
    name: "Oracle Health",
    category: "EHR",
    description: "Future Millennium connectivity for administrative work queues.",
    availability: "COMING_SOON",
    note: "Not connected. No Oracle Health data is exchanged.",
  },
  {
    key: "athenahealth",
    name: "athenahealth",
    category: "EHR",
    description: "Future athenaOne workflow integration.",
    availability: "COMING_SOON",
    note: "Not connected. No athenahealth data is exchanged.",
  },
  {
    key: "fhir",
    name: "FHIR R4",
    category: "Standards",
    description: "Planned mapping for Patient, Coverage, ServiceRequest, and DocumentReference.",
    availability: "COMING_SOON",
    note: "Architecture only. See docs/FHIR_ARCHITECTURE.md.",
  },
  {
    key: "hl7",
    name: "HL7 v2",
    category: "Standards",
    description: "Planned ADT, ORU, and SIU handling. No public MLLP listener is exposed.",
    availability: "COMING_SOON",
    note: "Architecture only. See docs/HL7_ARCHITECTURE.md.",
  },
  {
    key: "payer-apis",
    name: "Payer APIs",
    category: "Payers",
    description: "Future electronic prior authorization submission and status.",
    availability: "COMING_SOON",
    note: "Demo payers are records only. Nothing is submitted.",
  },
  {
    key: "fax",
    name: "Fax",
    category: "Channels",
    description: "Future inbound and outbound fax for payer packets.",
    availability: "COMING_SOON",
    note: "Not connected. HealthFlow does not send faxes.",
  },
  {
    key: "email",
    name: "Email",
    category: "Channels",
    description: "Transactional email for invites, resets, and task reminders.",
    availability: "AVAILABLE",
    note: "Delivery is not configured in this demo. Reset links are shown on screen.",
  },
  {
    key: "webhooks",
    name: "Webhooks",
    category: "Developer",
    description: "Future signed outbound events for status changes.",
    availability: "AVAILABLE",
    note: "No webhook endpoint is called.",
  },
  {
    key: "rest-api",
    name: "REST API",
    category: "Developer",
    description: "Future organization-scoped API for cases and tasks.",
    availability: "AVAILABLE",
    note: "API keys are not issued in this MVP.",
  },
];
