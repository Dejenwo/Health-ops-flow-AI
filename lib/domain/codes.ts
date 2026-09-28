import type { CodeType } from "@/lib/domain/types";

/**
 * Format checks for identifiers staff type by hand. These catch typos and swapped fields.
 * They do not prove a code is billable, current, or covered. Code-set lookups belong to a
 * licensed code service (AMA CPT, CMS HCPCS, CDC ICD-10-CM) and are out of scope here.
 */

/** NPI check digit: Luhn over "80840" + first nine digits (CMS NPI standard). */
export function isValidNpi(value: string): boolean {
  const npi = value.trim();
  if (!/^[12]\d{9}$/.test(npi)) return false;
  const digits = `80840${npi.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(npi[9]);
}

/** Builds a valid NPI from a nine-digit base. Used for synthetic demo data only. */
export function npiWithCheckDigit(base9: string): string {
  if (!/^[12]\d{8}$/.test(base9)) throw new Error("NPI base must be nine digits starting with 1 or 2.");
  for (let check = 0; check <= 9; check += 1) {
    const candidate = `${base9}${check}`;
    if (isValidNpi(candidate)) return candidate;
  }
  throw new Error("Unreachable");
}

/** CPT Category I (5 digits), Category II (4 digits + F), Category III (4 digits + T). */
export const CPT_PATTERN = /^\d{4}[0-9FT]$/;
/** HCPCS Level II: letter A–V followed by four digits. */
export const HCPCS_PATTERN = /^[A-V]\d{4}$/;
/** ICD-10-CM: letter (not U), digit, alphanumeric, optional dot and up to four more characters. */
export const ICD10_PATTERN = /^[A-TV-Z]\d[0-9A-Z](\.[0-9A-Z]{1,4})?$/;
export const MODIFIER_PATTERN = /^[0-9A-Z]{2}$/;
/** CMS place of service codes are two digits. */
export const POS_PATTERN = /^\d{2}$/;

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidServiceCode(codeType: CodeType, code: string): boolean {
  const normalized = normalizeCode(code);
  return codeType === "CPT" ? CPT_PATTERN.test(normalized) : HCPCS_PATTERN.test(normalized);
}

export function isValidIcd10(code: string): boolean {
  return ICD10_PATTERN.test(normalizeCode(code));
}

export const PLACE_OF_SERVICE: Record<string, string> = {
  "02": "Telehealth other than home",
  "10": "Telehealth in patient's home",
  "11": "Office",
  "12": "Home",
  "19": "Off campus outpatient hospital",
  "21": "Inpatient hospital",
  "22": "On campus outpatient hospital",
  "23": "Emergency room",
  "24": "Ambulatory surgical center",
  "31": "Skilled nursing facility",
  "49": "Independent clinic",
  "81": "Independent laboratory",
  "99": "Other place of service",
};
