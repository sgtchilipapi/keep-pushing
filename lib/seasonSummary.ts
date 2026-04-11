export type SeasonPhase = "active" | "grace" | "ended";

export interface CurrentSeasonSummary {
  seasonId: number;
  seasonNumber: number;
  seasonName: string;
  seasonStartTs: number;
  seasonEndTs: number;
  commitGraceEndTs: number;
  phase: SeasonPhase;
}

const DAY_IN_SECONDS = 24 * 60 * 60;

function parseOptionalInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function getCurrentSeasonSummary(now = new Date()): CurrentSeasonSummary {
  const nowTs = Math.floor(now.getTime() / 1000);
  const seasonId =
    parseOptionalInt(process.env.RUNANA_ACTIVE_SEASON_ID) ??
    parseOptionalInt(process.env.RUNANA_SEASON_ID) ??
    1;
  const seasonStartTs =
    parseOptionalInt(process.env.RUNANA_SEASON_START_TS) ?? nowTs - DAY_IN_SECONDS;
  const seasonEndTs =
    parseOptionalInt(process.env.RUNANA_SEASON_END_TS) ?? nowTs + 7 * DAY_IN_SECONDS;
  const commitGraceEndTs =
    parseOptionalInt(process.env.RUNANA_COMMIT_GRACE_END_TS) ??
    seasonEndTs + 2 * DAY_IN_SECONDS;

  let phase: SeasonPhase = "active";
  if (nowTs >= seasonEndTs && nowTs < commitGraceEndTs) {
    phase = "grace";
  } else if (nowTs >= commitGraceEndTs) {
    phase = "ended";
  }

  return {
    seasonId,
    seasonNumber: seasonId,
    seasonName: `Season ${seasonId}`,
    seasonStartTs,
    seasonEndTs,
    commitGraceEndTs,
    phase,
  };
}
