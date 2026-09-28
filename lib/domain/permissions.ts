import type { Role } from "@/lib/domain/types";
import { forbidden } from "@/lib/domain/errors";

export const PERMISSIONS = {
  "patients.read": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"],
  "patients.write": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST"],
  "providers.read": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"],
  "providers.write": ["OWNER", "ADMIN", "MANAGER"],
  "payers.read": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"],
  "payers.write": ["OWNER", "ADMIN", "MANAGER"],
  "authorizations.read": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"],
  "authorizations.write": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST"],
  "authorizations.assign": ["OWNER", "ADMIN", "MANAGER"],
  "authorizations.transition": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST"],
  "tasks.read": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"],
  "tasks.write": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST"],
  "notes.write": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST"],
  "documents.read": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"],
  "documents.write": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST"],
  "ai.run": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST"],
  "analytics.read": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"],
  "team.read": ["OWNER", "ADMIN", "MANAGER", "SPECIALIST", "VIEWER"],
  "team.invite": ["OWNER", "ADMIN", "MANAGER"],
  "team.role.change": ["OWNER", "ADMIN"],
  "team.suspend": ["OWNER", "ADMIN"],
  "billing.read": ["OWNER", "ADMIN", "MANAGER"],
  "billing.manage": ["OWNER", "ADMIN"],
  "integrations.manage": ["OWNER", "ADMIN"],
  "audit.read": ["OWNER", "ADMIN"],
  "org.update": ["OWNER", "ADMIN"],
  "settings.security": ["OWNER", "ADMIN"],
  "api.manage": ["OWNER", "ADMIN"],
  "data.import": ["OWNER", "ADMIN", "MANAGER"],
  "authRules.write": ["OWNER", "ADMIN", "MANAGER"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  SPECIALIST: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw forbidden();
  }
}

export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === "OWNER" || target === "ADMIN") return actor === "OWNER";
  if (actor === "OWNER" || actor === "ADMIN") return true;
  if (actor === "MANAGER") return target === "SPECIALIST" || target === "VIEWER";
  return false;
}

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}
