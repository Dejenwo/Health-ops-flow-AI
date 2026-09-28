import type { Role } from "@/lib/domain/types";

export const DEMO_PASSWORD = "Northstar-demo-2026";
export const DEMO_INVITE_TOKEN = "northstar-demo-invite-token-0001";

export const DEMO_ACCOUNTS: {
  email: string;
  role: Role;
  name: string;
  title: string;
  org: "northstar" | "lakeside";
}[] = [
  { email: "owner@northstar.demo", role: "OWNER", name: "Jordan Hale", title: "Practice Administrator", org: "northstar" },
  { email: "admin@northstar.demo", role: "ADMIN", name: "Amina Farouk", title: "Operations Lead", org: "northstar" },
  { email: "manager@northstar.demo", role: "MANAGER", name: "Chris Pell", title: "Authorization Manager", org: "northstar" },
  { email: "specialist@northstar.demo", role: "SPECIALIST", name: "Riley Chen", title: "Authorization Specialist", org: "northstar" },
  { email: "viewer@northstar.demo", role: "VIEWER", name: "Sam Okonkwo", title: "Compliance Observer", org: "northstar" },
  { email: "rival@lakeside.demo", role: "OWNER", name: "Parker Quinn", title: "Clinic Director", org: "lakeside" },
];
