"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import type { BattleEvent, BattleResult } from "../../types/battle";
import type { CombatantSnapshot } from "../../types/combat";

type Side = "left" | "right";

type ReplayFrame = {
  event: Extract<
    BattleEvent,
    { type: "ACTION" | "STUNNED_SKIP" | "STATUS_EFFECT_RESOLVE" }
  >;
  logCursorIndex: number;
  leftHp: number;
  rightHp: number;
  displayLeftHp: number;
  displayRightHp: number;
  leftCooldowns: Record<string, number>;
  rightCooldowns: Record<string, number>;
  displayLeftCooldowns: Record<string, number>;
  displayRightCooldowns: Record<string, number>;
  actionLabelSide: Side | null;
  actionLabelText: string;
  leftFlash: "damage" | "recover" | null;
  rightFlash: "damage" | "recover" | null;
  logLine: string;
};

const SKILL_META: Record<string, { name: string; icon: string }> = {
  "1000": { name: "Basic Attack", icon: "◼" },
  "1001": { name: "Volt Strike", icon: "⚡" },
  "1002": { name: "Finishing Blow", icon: "✦" },
  "1003": { name: "Surge", icon: "⬢" },
  "1004": { name: "Barrier", icon: "▦" },
  "1005": { name: "Repair", icon: "✚" },
};

const ACTIVE_SKILL_IDS = ["1001", "1002", "1003", "1004", "1005"] as const;
const NAME_BANK = [
  "Ironclaw",
  "Bloodfang",
  "Wolfbite",
  "Razorbeast",
  "Stonejaw",
  "Grimhound",
  "Nightfang",
  "Brutehorn",
  "Skullwolf",
  "Venomtail",
  "Gunshock",
  "Steelshot",
  "Bladefist",
  "Axebreaker",
  "Hammerfall",
  "Quickshot",
  "Deadtrigger",
  "Blastcore",
  "Ironburst",
  "Killspike",
  "Maskhead",
  "Boneface",
  "Scarjaw",
  "Redeye",
  "Steelmask",
  "Grimface",
  "Halfskull",
  "Madgrin",
  "Coldeye",
  "Rustface",
  "Blackthorn",
  "Frostbite",
  "Darkclaw",
  "Stormfury",
  "Ironfang",
  "Voidstrike",
  "Shadowburn",
  "Bloodspark",
  "Ashbreaker",
  "Steelrage",
  "Brawler",
  "Outlaw",
  "Reaper",
  "Crusher",
  "Slasher",
  "Breaker",
  "Hunter",
  "Warden",
  "Striker",
  "Ravager",
] as const;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickDistinct<T>(values: readonly T[], count: number): T[] {
  const mutable = [...values];
  const picked: T[] = [];

  while (picked.length < count && mutable.length > 0) {
    const index = randomInt(0, mutable.length - 1);
    const [value] = mutable.splice(index, 1);
    if (value !== undefined) {
      picked.push(value);
    }
  }

  return picked;
}

function buildRandomCharacter(entityId: string, side: Side): CombatantSnapshot {
  const [skill1, skill2] = pickDistinct(ACTIVE_SKILL_IDS, 2) as [
    string,
    string,
  ];
  const hpMax = randomInt(950, 1450);
  const [name] = pickDistinct(NAME_BANK, 1) as [string];

  return {
    entityId,
    side: side === "left" ? "PLAYER" : "ENEMY",
    name,
    hp: hpMax,
    hpMax,
    atk: randomInt(85, 145),
    def: randomInt(60, 120),
    spd: randomInt(70, 140),
    accuracyBP: randomInt(8600, 9600),
    evadeBP: randomInt(300, 1300),
    activeSkillIds: [skill1, skill2],
    passiveSkillIds: ["2001", "2002"],
  };
}

function buildDefaultCharacter(
  entityId: string,
  side: Side,
): CombatantSnapshot {
  return {
    entityId,
    side: side === "left" ? "PLAYER" : "ENEMY",
    name: side === "left" ? "Vanguard" : "Sentinel",
    hp: 1200,
    hpMax: 1200,
    atk: 110,
    def: 90,
    spd: side === "left" ? 105 : 100,
    accuracyBP: 9000,
    evadeBP: 900,
    activeSkillIds: ["1001", "1002"],
    passiveSkillIds: ["2001", "2002"],
  };
}

function formatCombatantName(
  entityId: string,
  leftId: string,
  leftName: string,
  rightId: string,
  rightName: string,
): string {
  if (entityId === leftId) {
    return leftName;
  }

  if (entityId === rightId) {
    return rightName;
  }

  return entityId;
}

function formatEventLine(
  event: BattleEvent,
  leftId: string,
  leftName: string,
  rightId: string,
  rightName: string,
): string {
  switch (event.type) {
    case "ROUND_START":
      return `Round ${event.round} start`;
    case "ACTION":
      return `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} uses ${SKILL_META[event.skillId]?.name ?? event.skillId} on ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)}`;
    case "COOLDOWN_SET":
      return `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} sets cooldown on ${SKILL_META[event.skillId]?.name ?? event.skillId} to ${event.cooldownRemainingTurns}`;
    case "STUNNED_SKIP":
      return `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} is stunned and loses their action`;
    case "HIT_RESULT":
      return event.didHit
        ? `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} hits ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} (${event.rollBP}/${event.hitChanceBP})`
        : `${formatCombatantName(event.actorId, leftId, leftName, rightId, rightName)} misses ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} (${event.rollBP}/${event.hitChanceBP})`;
    case "DAMAGE":
      return `${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} takes ${event.amount} damage (HP now ${event.targetHpAfter})`;
    case "STATUS_APPLY":
      return `${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} gains ${event.statusId} from ${formatCombatantName(event.sourceId, leftId, leftName, rightId, rightName)} (${event.remainingTurns} turns)`;
    case "STATUS_REFRESH":
      return `${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} refreshes ${event.statusId} to ${event.remainingTurns} turns`;
    case "STATUS_APPLY_FAILED":
      return `${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} failed to gain ${event.statusId} (${event.reason})`;
    case "STATUS_EFFECT_RESOLVE":
      return `${event.statusId} resolves on ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)} during ${event.phase} (hpΔ ${event.hpDelta}, hp ${event.targetHpAfter})`;
    case "STATUS_EXPIRE":
      return `${event.statusId} expired on ${formatCombatantName(event.targetId, leftId, leftName, rightId, rightName)}`;
    case "DEATH":
      return `${formatCombatantName(event.entityId, leftId, leftName, rightId, rightName)} was defeated`;
    case "ROUND_END":
      return `Round ${event.round} end`;
    case "BATTLE_END":
      return `Battle ended by ${event.reason}. Winner: ${event.winnerEntityId}, Loser: ${event.loserEntityId}`;
    default:
      return "Unknown event.";
  }
}

function decrementCooldowns(
  cooldowns: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(cooldowns).map(([skillId, value]) => [
      skillId,
      Math.max(0, value - 1),
    ]),
  );
}

function toStatusName(statusId: string): string {
  return statusId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function buildFrames(result: BattleResult): ReplayFrame[] {
  const leftId = result.playerInitial.entityId;
  const rightId = result.enemyInitial.entityId;
  const leftName = result.playerInitial.name ?? leftId;
  const rightName = result.enemyInitial.name ?? rightId;

  let leftHp = result.playerInitial.hp;
  let rightHp = result.enemyInitial.hp;
  let leftCooldowns: Record<string, number> = {
    "1000": 0,
    [result.playerInitial.activeSkillIds[0]]: 0,
    [result.playerInitial.activeSkillIds[1]]: 0,
  };
  let rightCooldowns: Record<string, number> = {
    "1000": 0,
    [result.enemyInitial.activeSkillIds[0]]: 0,
    [result.enemyInitial.activeSkillIds[1]]: 0,
  };
  let displayLeftHp = leftHp;
  let displayRightHp = rightHp;
  let displayLeftCooldowns = { ...leftCooldowns };
  let displayRightCooldowns = { ...rightCooldowns };
  let lastUsedSkillByActor: Record<string, string> = {};

  const frames: ReplayFrame[] = [];
  let index = 0;

  while (index < result.events.length) {
    const mainEvent = result.events[index];

    if (
      mainEvent.type === "STATUS_EFFECT_RESOLVE" &&
      mainEvent.phase === "onRoundStart" &&
      mainEvent.hpDelta !== 0
    ) {
      const event = mainEvent;
      let actionLabelSide: Side | null =
        event.targetId === leftId
          ? "left"
          : event.targetId === rightId
            ? "right"
            : null;
      let actionLabelText = `${toStatusName(event.statusId)} (${formatDelta(event.hpDelta)})`;

      if (event.targetId === leftId) {
        leftHp = event.targetHpAfter;
      }
      if (event.targetId === rightId) {
        rightHp = event.targetHpAfter;
      }

      frames.push({
        event,
        logCursorIndex: index,
        leftHp,
        rightHp,
        displayLeftHp,
        displayRightHp,
        leftCooldowns: { ...leftCooldowns },
        rightCooldowns: { ...rightCooldowns },
        displayLeftCooldowns: { ...displayLeftCooldowns },
        displayRightCooldowns: { ...displayRightCooldowns },
        actionLabelSide,
        actionLabelText,
        leftFlash:
          event.targetId === leftId
            ? event.hpDelta < 0
              ? "damage"
              : "recover"
            : null,
        rightFlash:
          event.targetId === rightId
            ? event.hpDelta < 0
              ? "damage"
              : "recover"
            : null,
        logLine: formatEventLine(event, leftId, leftName, rightId, rightName),
      });

      index += 1;
      continue;
    }

    if (mainEvent.type !== "ACTION" && mainEvent.type !== "STUNNED_SKIP") {
      index += 1;
      continue;
    }

    const tickStartLeftHp = leftHp;
    const tickStartRightHp = rightHp;
    let tickEndIndex = index;
    let actionLabelSide: Side | null =
      mainEvent.actorId === leftId
        ? "left"
        : mainEvent.actorId === rightId
          ? "right"
          : null;
    let actionLabelText = "";
    let logLine = formatEventLine(
      mainEvent,
      leftId,
      leftName,
      rightId,
      rightName,
    );
    let skillName =
      mainEvent.type === "ACTION"
        ? (SKILL_META[mainEvent.skillId]?.name ?? mainEvent.skillId)
        : "Turn";
    let didHit: boolean | null = null;
    let actionHpDelta = 0;

    if (mainEvent.type === "ACTION") {
      lastUsedSkillByActor = {
        ...lastUsedSkillByActor,
        [mainEvent.actorId]: skillName,
      };
    }

    let cursor = index;
    while (cursor < result.events.length) {
      const event = result.events[cursor];
      if (
        cursor > index &&
        (event.type === "ACTION" ||
          event.type === "STUNNED_SKIP" ||
          (event.type === "STATUS_EFFECT_RESOLVE" &&
            event.phase === "onRoundStart" &&
            event.hpDelta !== 0))
      ) {
        break;
      }

      tickEndIndex = cursor;
      logLine = formatEventLine(event, leftId, leftName, rightId, rightName);

      if (event.type === "DAMAGE") {
        if (event.targetId === leftId) {
          actionHpDelta += leftHp - event.targetHpAfter;
          leftHp = event.targetHpAfter;
        }
        if (event.targetId === rightId) {
          actionHpDelta += rightHp - event.targetHpAfter;
          rightHp = event.targetHpAfter;
        }
      }

      if (event.type === "HIT_RESULT" && event.actorId === mainEvent.actorId) {
        didHit = event.didHit;
      }

      if (event.type === "COOLDOWN_SET") {
        if (event.actorId === leftId) {
          leftCooldowns = {
            ...leftCooldowns,
            [event.skillId]: event.cooldownRemainingTurns,
          };
        }
        if (event.actorId === rightId) {
          rightCooldowns = {
            ...rightCooldowns,
            [event.skillId]: event.cooldownRemainingTurns,
          };
        }
      }

      if (event.type === "ROUND_END") {
        leftCooldowns = decrementCooldowns(leftCooldowns);
        rightCooldowns = decrementCooldowns(rightCooldowns);
        displayLeftHp = leftHp;
        displayRightHp = rightHp;
        displayLeftCooldowns = { ...leftCooldowns };
        displayRightCooldowns = { ...rightCooldowns };
      }

      if (event.type === "BATTLE_END") {
        displayLeftHp = leftHp;
        displayRightHp = rightHp;
        displayLeftCooldowns = { ...leftCooldowns };
        displayRightCooldowns = { ...rightCooldowns };
      }

      cursor += 1;
    }

    if (mainEvent.type === "STUNNED_SKIP") {
      actionLabelText = `${formatCombatantName(mainEvent.actorId, leftId, leftName, rightId, rightName)} is stunned and lost the turn!`;
    } else {
      const actionName = lastUsedSkillByActor[mainEvent.actorId] ?? skillName;
      const signedDelta = didHit === false ? 0 : -actionHpDelta;
      actionLabelText = `${actionName} (${formatDelta(signedDelta)})`;
    }

    const leftDelta = leftHp - tickStartLeftHp;
    const rightDelta = rightHp - tickStartRightHp;

    frames.push({
      event: mainEvent,
      logCursorIndex: tickEndIndex,
      leftHp,
      rightHp,
      displayLeftHp,
      displayRightHp,
      leftCooldowns: { ...leftCooldowns },
      rightCooldowns: { ...rightCooldowns },
      displayLeftCooldowns: { ...displayLeftCooldowns },
      displayRightCooldowns: { ...displayRightCooldowns },
      actionLabelSide,
      actionLabelText,
      leftFlash: leftDelta < 0 ? "damage" : leftDelta > 0 ? "recover" : null,
      rightFlash: rightDelta < 0 ? "damage" : rightDelta > 0 ? "recover" : null,
      logLine,
    });

    index = cursor;
  }

  const lastFrame = frames[frames.length - 1];
  if (
    lastFrame !== undefined &&
    (lastFrame.displayLeftHp !== displayLeftHp ||
      lastFrame.displayRightHp !== displayRightHp ||
      JSON.stringify(lastFrame.displayLeftCooldowns) !==
        JSON.stringify(displayLeftCooldowns) ||
      JSON.stringify(lastFrame.displayRightCooldowns) !==
        JSON.stringify(displayRightCooldowns))
  ) {
    frames.push({
      ...lastFrame,
      displayLeftHp,
      displayRightHp,
      displayLeftCooldowns: { ...displayLeftCooldowns },
      displayRightCooldowns: { ...displayRightCooldowns },
      leftFlash: null,
      rightFlash: null,
    });
  }

  return frames;
}

export default function BattleDashboardPage() {
  const [leftCharacter, setLeftCharacter] = useState<CombatantSnapshot>(() =>
    buildDefaultCharacter("10001", "left"),
  );
  const [rightCharacter, setRightCharacter] = useState<CombatantSnapshot>(() =>
    buildDefaultCharacter("20001", "right"),
  );
  const [result, setResult] = useState<BattleResult | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRequestingBattle, setIsRequestingBattle] = useState(false);

  const frames = useMemo(() => (result ? buildFrames(result) : []), [result]);
  const currentFrame = frames[currentFrameIndex];
  const battleLogLines = useMemo(() => {
    if (!result) {
      return [];
    }

    const leftId = result.playerInitial.entityId;
    const rightId = result.enemyInitial.entityId;
    const leftName = result.playerInitial.name ?? leftId;
    const rightName = result.enemyInitial.name ?? rightId;

    return result.events.map((event) =>
      formatEventLine(event, leftId, leftName, rightId, rightName),
    );
  }, [result]);
  const visibleBattleLogLines = useMemo(() => {
    const cursor = currentFrame?.logCursorIndex ?? -1;
    return battleLogLines.slice(0, cursor + 1).reverse();
  }, [battleLogLines, currentFrame?.logCursorIndex]);

  const runBattle = useCallback(async () => {
    setIsRequestingBattle(true);
    setIsPlaying(false);
    setCurrentFrameIndex(0);

    const response = await fetch("/api/combat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerInitial: leftCharacter,
        enemyInitial: rightCharacter,
        seed: randomInt(1, 1000000),
      }),
    });

    if (!response.ok) {
      setResult(null);
      setIsRequestingBattle(false);
      return;
    }

    const battleResult = (await response.json()) as BattleResult;
    setResult(battleResult);
    setCurrentFrameIndex(0);
    setIsPlaying(true);
    setIsRequestingBattle(false);
  }, [leftCharacter, rightCharacter]);

  useEffect(() => {
    if (!isPlaying || frames.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrentFrameIndex((previous) => {
        if (previous >= frames.length - 1) {
          window.clearInterval(timer);
          setIsPlaying(false);
          return previous;
        }

        return previous + 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [frames.length, isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    if (currentFrameIndex >= frames.length - 1) {
      setIsPlaying(false);
    }
  }, [currentFrameIndex, frames.length, isPlaying]);

  const leftHp = currentFrame?.displayLeftHp ?? leftCharacter.hp;
  const rightHp = currentFrame?.displayRightHp ?? rightCharacter.hp;
  const battleId = result?.battleId ?? "—";
  const leftActionText =
    currentFrame?.actionLabelSide === "left"
      ? currentFrame.actionLabelText
      : "";
  const rightActionText =
    currentFrame?.actionLabelSide === "right"
      ? currentFrame.actionLabelText
      : "";
  const leftSkills = ["1000", ...leftCharacter.activeSkillIds];
  const rightSkills = ["1000", ...rightCharacter.activeSkillIds];
  const currentRound = currentFrame?.event.round ?? 1;
  const controlsDisabled = isPlaying || isRequestingBattle;

  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <header style={panelHeaderStyle}>Battle ID: {battleId}</header>

        <div
          style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "1fr" }}
        >
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={runBattle}
            style={{ ...buttonStyle, gridColumn: "1 / -1" }}
          >
            Simulate Battle
          </button>
        </div>
        <div style={roundBannerStyle}>ROUND {currentRound}</div>

        <section style={combatStageStyle}>
          <div style={arenaGridStyle}>
            <ArenaCell
              name={leftCharacter.name ?? leftCharacter.entityId}
              actionText={leftActionText}
              side="left"
              flash={currentFrame?.leftFlash ?? null}
              onRandomize={() =>
                setLeftCharacter(buildRandomCharacter("10001", "left"))
              }
              randomizeDisabled={controlsDisabled}
              isActive={
                currentFrame?.event.type === "ACTION" &&
                "actorId" in currentFrame.event &&
                currentFrame.event.actorId === leftCharacter.entityId
              }
            />
            <ArenaCell
              name={rightCharacter.name ?? rightCharacter.entityId}
              actionText={rightActionText}
              side="right"
              flash={currentFrame?.rightFlash ?? null}
              onRandomize={() =>
                setRightCharacter(buildRandomCharacter("20001", "right"))
              }
              randomizeDisabled={controlsDisabled}
              isActive={
                currentFrame?.event.type === "ACTION" &&
                "actorId" in currentFrame.event &&
                currentFrame.event.actorId === rightCharacter.entityId
              }
            />
          </div>

          <div style={arenaGridBodyStyle}>
            <StatsCell
              hp={leftHp}
              hpMax={leftCharacter.hpMax}
              initiative={leftCharacter.spd}
              skillIds={leftSkills}
              cooldowns={
                currentFrame?.displayLeftCooldowns ?? {
                  "1000": 0,
                  [leftCharacter.activeSkillIds[0]]: 0,
                  [leftCharacter.activeSkillIds[1]]: 0,
                }
              }
            />
            <StatsCell
              hp={rightHp}
              hpMax={rightCharacter.hpMax}
              initiative={rightCharacter.spd}
              skillIds={rightSkills}
              cooldowns={
                currentFrame?.displayRightCooldowns ?? {
                  "1000": 0,
                  [rightCharacter.activeSkillIds[0]]: 0,
                  [rightCharacter.activeSkillIds[1]]: 0,
                }
              }
            />
          </div>
        </section>

        <details style={detailsStyle} open>
          <summary
            style={{
              cursor: "pointer",
              fontWeight: 700,
              marginBottom: "0.5rem",
            }}
          >
            Battle Log
          </summary>
          <ol
            style={{
              margin: 0,
              paddingLeft: "1.2rem",
              maxHeight: 220,
              overflowY: "auto",
              display: "grid",
              gap: "0.3rem",
            }}
          >
            {visibleBattleLogLines.map((line, index) => (
              <li
                key={`battle-log-${index}`}
                style={{ fontWeight: index === 0 ? 700 : 400 }}
              >
                {line}
              </li>
            ))}
          </ol>
        </details>
      </section>
    </main>
  );
}

type ArenaCellProps = {
  name: string;
  actionText: string;
  side: Side;
  isActive: boolean;
  flash: "damage" | "recover" | null;
  onRandomize: () => void;
  randomizeDisabled: boolean;
};

function ArenaCell({
  name,
  actionText,
  side,
  isActive,
  flash,
  onRandomize,
  randomizeDisabled,
}: ArenaCellProps) {
  const flashColor =
    flash === "damage"
      ? "var(--danger-soft)"
      : flash === "recover"
        ? "var(--success-soft)"
        : undefined;

  return (
    <article
      style={{
        ...arenaCellStyle,
        borderRight: side === "left" ? "1px solid var(--border)" : undefined,
      }}
    >
      <p style={actionTextStyle}>{actionText}</p>
      <div
        style={{
          border: "2px dashed var(--border-strong)",
          display: "grid",
          placeItems: "center",
          fontSize: "1.25rem",
          letterSpacing: "0.05em",
          borderRadius: 18,
          background:
            flashColor ??
            (isActive ? "var(--brand-primary-soft)" : "var(--surface-soft)"),
          color: "var(--text)",
          transition: "background 0.25s ease, box-shadow 0.25s ease",
          boxShadow: flashColor ? `0 0 0 2px ${flashColor}` : "none",
        }}
      >
        {name}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onRandomize}
          disabled={randomizeDisabled}
          style={{
            width: 32,
            height: 32,
            border: "1px solid var(--border-strong)",
            borderRadius: 999,
            background: "var(--surface-strong)",
            color: "var(--text)",
            cursor: randomizeDisabled ? "not-allowed" : "pointer",
            opacity: randomizeDisabled ? 0.45 : 1,
          }}
          title={`Randomize ${side}`}
        >
          🎲
        </button>
      </div>
    </article>
  );
}

type StatsCellProps = {
  hp: number;
  hpMax: number;
  initiative: number;
  skillIds: string[];
  cooldowns: Record<string, number>;
};

function StatsCell({
  hp,
  hpMax,
  initiative,
  skillIds,
  cooldowns,
}: StatsCellProps) {
  const hpPercent = Math.max(0, Math.min(100, Math.round((hp / hpMax) * 100)));
  const initiativePercent = Math.max(
    0,
    Math.min(100, Math.round((initiative / 200) * 100)),
  );

  return (
    <article style={statsCellStyle}>
      <div style={{ display: "grid", gap: "0.35rem", marginBottom: "0.7rem" }}>
        <span>HP:</span>
        <div style={barTrackStyle}>
          <div
            style={{
              width: `${hpPercent}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, var(--brand-secondary) 0%, var(--grass) 100%)",
            }}
          />
        </div>
      </div>
      <div style={{ display: "grid", gap: "0.3rem", marginBottom: "0.75rem" }}>
        <span>Initiative:</span>
        <div style={{ ...barTrackStyle, height: 12 }}>
          <div
            style={{
              width: `${initiativePercent}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, var(--brand-primary) 0%, var(--accent) 100%)",
            }}
          />
        </div>
      </div>
      <section>
        <h4>Actions</h4>
        <ul>
          {skillIds.map((skillId) => {
            const cooldown = cooldowns[skillId] ?? 0;
            return (
              <li key={skillId}>
                <span>{SKILL_META[skillId]?.icon ?? "◻"} </span>
                <span>{SKILL_META[skillId]?.name ?? skillId} </span>
                <small>{cooldown > 0 ? `CD ${cooldown}` : "Ready"}</small>
              </li>
            );
          })}
        </ul>
      </section>
    </article>
  );
}

const buttonStyle: CSSProperties = {
  border: "1px solid var(--brand-primary-active)",
  borderRadius: 12,
  background:
    "linear-gradient(180deg, var(--brand-primary) 0%, var(--brand-primary-active) 100%)",
  color: "var(--text-inverse)",
  padding: "0.7rem 0.8rem",
  fontWeight: 700,
  letterSpacing: "0.03em",
  boxShadow: "0 12px 24px rgba(118, 174, 218, 0.28)",
  cursor: "pointer",
};

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "1rem",
  background:
    "radial-gradient(circle at top left, rgba(118, 174, 218, 0.12), transparent 24%), linear-gradient(180deg, var(--cloud) 0%, var(--page) 40%, var(--page-alt) 100%)",
  color: "var(--text)",
};

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: 1100,
  margin: "0 auto",
  display: "grid",
  gap: "0.9rem",
};

const glassPanelStyle: CSSProperties = {
  border: "1px solid var(--border-soft)",
  borderRadius: 18,
  background:
    "linear-gradient(180deg, var(--haze) 0%, rgba(255, 255, 255, 0.1) 100%), var(--surface)",
  boxShadow: "var(--shadow-elevated)",
  backdropFilter: "blur(18px) saturate(160%)",
  WebkitBackdropFilter: "blur(18px) saturate(160%)",
};

const panelHeaderStyle: CSSProperties = {
  ...glassPanelStyle,
  padding: "0.75rem 1rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
};

const roundBannerStyle: CSSProperties = {
  ...glassPanelStyle,
  padding: "0.55rem 0.8rem",
  fontWeight: 800,
  letterSpacing: "0.06em",
  textAlign: "center",
};

const combatStageStyle: CSSProperties = {
  ...glassPanelStyle,
  overflow: "hidden",
};

const arenaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  borderBottom: "1px solid var(--border)",
  minHeight: 320,
};

const arenaGridBodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
};

const detailsStyle: CSSProperties = {
  ...glassPanelStyle,
  padding: "0.75rem 1rem",
};

const arenaCellStyle: CSSProperties = {
  padding: "0.75rem",
  display: "grid",
  gridTemplateRows: "auto 1fr auto",
  gap: "0.75rem",
};

const actionTextStyle: CSSProperties = {
  margin: 0,
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "0.5rem",
  minHeight: "3rem",
  background: "var(--surface-strong)",
};

const statsCellStyle: CSSProperties = {
  borderRight: "1px solid var(--border)",
  padding: "0.75rem",
};

const barTrackStyle: CSSProperties = {
  height: 20,
  border: "1px solid var(--border)",
  borderRadius: 999,
  overflow: "hidden",
  background: "rgba(255, 255, 255, 0.72)",
};
