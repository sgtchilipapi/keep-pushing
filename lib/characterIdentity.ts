export const DEFAULT_CHARACTER_CLASS_ID = "soldier";
export const DEFAULT_CHARACTER_SLOT_INDEX = 0;
export const CHARACTER_NAME_MIN_LENGTH = 3;
export const CHARACTER_NAME_MAX_LENGTH = 16;
export const CHARACTER_NAME_RESERVATION_TTL_MS = 5 * 60 * 1000;

const CHARACTER_NAME_PATTERN = /^[A-Za-z0-9 ]+$/;
const CHARACTER_CLASS_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

export type CharacterNameValidationCode =
  | "ERR_CHARACTER_NAME_EMPTY"
  | "ERR_CHARACTER_NAME_LENGTH"
  | "ERR_CHARACTER_NAME_FORMAT";

export function canonicalizeCharacterName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeCharacterName(value: string): string {
  return canonicalizeCharacterName(value).toLowerCase();
}

export function validateCharacterName(value: string): CharacterNameValidationCode | null {
  const canonical = canonicalizeCharacterName(value);

  if (canonical.length === 0) {
    return "ERR_CHARACTER_NAME_EMPTY";
  }

  if (
    canonical.length < CHARACTER_NAME_MIN_LENGTH ||
    canonical.length > CHARACTER_NAME_MAX_LENGTH
  ) {
    return "ERR_CHARACTER_NAME_LENGTH";
  }

  if (!CHARACTER_NAME_PATTERN.test(canonical)) {
    return "ERR_CHARACTER_NAME_FORMAT";
  }

  return null;
}

export function assertValidCharacterName(value: string): string {
  const canonical = canonicalizeCharacterName(value);
  const errorCode = validateCharacterName(canonical);

  if (errorCode !== null) {
    switch (errorCode) {
      case "ERR_CHARACTER_NAME_EMPTY":
        throw new Error("ERR_CHARACTER_NAME_EMPTY: character name is required");
      case "ERR_CHARACTER_NAME_LENGTH":
        throw new Error(
          `ERR_CHARACTER_NAME_LENGTH: character name must be ${CHARACTER_NAME_MIN_LENGTH}-${CHARACTER_NAME_MAX_LENGTH} characters`,
        );
      case "ERR_CHARACTER_NAME_FORMAT":
        throw new Error(
          "ERR_CHARACTER_NAME_FORMAT: character name must be ASCII alphanumeric plus spaces",
        );
      default:
        throw new Error("ERR_CHARACTER_NAME_INVALID: invalid character name");
    }
  }

  return canonical;
}

export function normalizeCharacterClassId(value?: string): string {
  const candidate =
    typeof value === "string" && value.trim().length > 0
      ? value.trim().toLowerCase()
      : DEFAULT_CHARACTER_CLASS_ID;

  if (!CHARACTER_CLASS_ID_PATTERN.test(candidate)) {
    throw new Error(
      "ERR_CHARACTER_CLASS_ID_FORMAT: classId must be lowercase alphanumeric, underscore, or dash",
    );
  }

  return candidate;
}

export function normalizeCharacterSlotIndex(value?: number): number {
  if (value === undefined) {
    return DEFAULT_CHARACTER_SLOT_INDEX;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error("ERR_CHARACTER_SLOT_INDEX_INVALID: slotIndex must be an integer >= 0");
  }

  return value;
}
