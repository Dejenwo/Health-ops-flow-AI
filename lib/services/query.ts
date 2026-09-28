import { notFound } from "@/lib/domain/errors";
import type { PageResult } from "@/lib/domain/types";

export function inOrg<T extends { organizationId: string }>(rows: T[], organizationId: string): T[] {
  return rows.filter((row) => row.organizationId === organizationId);
}

export function findInOrg<T extends { id: string; organizationId: string }>(
  rows: T[],
  organizationId: string,
  id: string,
): T | null {
  return rows.find((row) => row.id === id && row.organizationId === organizationId) ?? null;
}

export function requireInOrg<T extends { id: string; organizationId: string }>(
  rows: T[],
  organizationId: string,
  id: string,
): T {
  const row = findInOrg(rows, organizationId, id);
  if (!row) throw notFound();
  return row;
}

export function paginate<T>(items: T[], page = 1, pageSize = 20): PageResult<T> {
  const size = Math.min(100, Math.max(1, pageSize || 20));
  const current = Math.max(1, page || 1);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    total: items.length,
    page: current,
    pageSize: size,
  };
}

export function emptyToNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function compareValues(left: string | number | null, right: string | number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}
