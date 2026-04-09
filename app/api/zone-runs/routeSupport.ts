export function statusForZoneRunError(message: string): number {
  if (
    message.startsWith("ERR_INVALID_") ||
    message.startsWith("ERR_EMPTY_") ||
    message.startsWith("ERR_UNKNOWN_ZONE_ID") ||
    message.startsWith("ERR_UNKNOWN_ZONE_NODE")
  ) {
    return 400;
  }

  if (message.startsWith("ERR_CHARACTER_NOT_FOUND")) {
    return 404;
  }

  if (message.startsWith("ERR_ACTIVE_ZONE_RUN_NOT_FOUND")) {
    return 404;
  }

  if (
    message.startsWith("ERR_ACTIVE_ZONE_RUN_EXISTS") ||
    message.startsWith("ERR_CHARACTER_NOT_CONFIRMED") ||
    message.startsWith("ERR_CHARACTER_CURSOR_UNAVAILABLE") ||
    message.startsWith("ERR_INITIAL_SETTLEMENT_REQUIRED") ||
    message.startsWith("ERR_ZONE_LOCKED") ||
    message.startsWith("ERR_SEASON_NOT_ACTIVE") ||
    message.startsWith("ERR_ACTIVE_SEASON_UNRESOLVED") ||
    message.startsWith("ERR_ZONE_RUN_")
  ) {
    return 409;
  }

  return 500;
}
