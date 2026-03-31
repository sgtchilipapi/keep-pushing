# SSOT.md
# Single Source of Truth
# Project: Turn-Based AI-Learning RPG
# Version: v1.0
# Status: LOCKED SPEC FOR MVP IMPLEMENTATION

---

# 1. Project Overview

## 1.1 Game Summary

This project is a **mobile-first multiplayer RPG** set in an **iron sci-fi dystopian world dominated by AI overlords**.

Players control a **single combatant** navigating a **menu-driven world**. Combat occurs through **deterministic turn-based simulation** where characters progressively become **better decision-makers through battle experience**.

The core innovation is **AI learning behavior** at the character level. Characters adjust their combat choices over time based on past results.

The world evolves through **shared exploration and milestone discoveries**, providing global information advantages but **no shared combat power**.

---

# 2. Core Design Principles

## 2.1 Determinism

The entire combat system must be **fully deterministic**.

Requirements:

- All randomness must come from a **seeded RNG**
- No floating-point math in core combat logic
- All calculations use **integers**
- Event logs must fully reconstruct battles

Benefits:

- Reproducible simulations
- Easy debugging
- Cheat prevention
- Replayable battles

---

## 2.2 Server Authority

All combat simulations must run **server-side only**.

Flow:

Client → API request  
Server → simulate full battle  
Server → return event log  
Client → replay animation

The server is the **only authority** for outcomes.

Rule: **EXP claims are never client/server-provided inputs; they are computed by on-chain logic.**

---

## 2.3 Vertical Slice Development

Development follows **Vertical Slice Expansion**:

1. Minimal working battle simulator
2. Replay UI
3. Add persistence
4. Add exploration
5. Add crafting
6. Add learning persistence

Every stage must produce a **working playable slice**.

---

# 3. Technology Stack

## 3.1 Frontend

- Next.js (App Router)
- React
- TypeScript

## 3.2 Backend API

- Next.js Route Handlers
- TypeScript

No Express.

## 3.3 Database

- PostgreSQL
- Prisma ORM

## 3.4 Game Engine

Pure TypeScript modules located in:

    /engine

The engine must not depend on:

- Prisma
- HTTP frameworks
- UI libraries

---

# 4. Folder Structure

    /app
      /api
        /auth
        /character
        /combat
        /world
        /craft

    /components

    /engine
      /battle
      /rng

    /lib
      /prisma
      /types

    /tests

---

## 4.1 Type Contract Source of Truth

Shared battle/combat contracts are canonical under:

- `/types/combat.ts`
- `/types/battle.ts`

Rules:

- Use shared `/types` exports for battle/combat DTOs and event contracts.
- Public API request/response contracts are canonical under `/types/api/*` (for example, combat API DTOs under `/types/api/combat.ts`).
- Engine battle/combat input/output contracts remain internal simulation contracts under `/types/combat.ts` and `/types/battle.ts`.
- Route handlers must validate API DTO contracts first and then map DTOs to engine inputs through an explicit boundary (adapter/mapping layer).
- Current tactical API may accept client-supplied snapshots for rapid combat iteration, but strategic direction is character-ID driven requests with server-side snapshot assembly from persisted character state.
- Do not define parallel battle/combat contract unions in engine modules.
- Canonical event keys use normalized naming (`actorId`, `targetId`, `sourceId`, `rollBP`, `entityId`).

---

# 5. Combat System

## 5.1 Battle Format

All combat is:

- **1 vs 1**
- **Turn-based**
- **Max 30 rounds**

---

## 5.2 Initiative System

Each combatant has:

    SPD
    initiative

At the start of every round:

    initiative += SPD

During the round:

    while initiative >= 100:
        perform action
        initiative -= 100

This allows faster units to act multiple times per round.

---

## 5.3 Action Ordering

Actions are ordered by:

1. Highest `initiative`
2. Highest `SPD`
3. Lowest `entityId`

No randomness allowed in ordering.

---

## 5.4 Status Resolution Timing (Canonical)

Status effects resolve in two deterministic windows:

1. **On Apply** (`onApply`) for successful applications/reapplications where resulting duration is `> 0`.
2. **Round Start** (`onRoundStart`) before any actions from either side.

Canonical per-round processing order:

1. Status effect resolution
2. Action resolution
3. Status duration decrement/expire
4. Cooldown decrement
5. Round end

Additional invariants:
- Status resolver ordering uses explicit priority values.
- Multi-target status resolution order is deterministic: `SPD` descending, then `entityId` ascending.
- Death short-circuits all further processing immediately.
- Event logs must include lifecycle events and `STATUS_EFFECT_RESOLVE` timing events.

---

# 6. Loadout System

Each character has:

    2 Active Skills
    2 Passive Skills
    Basic Attack

Available combat actions:

    Basic Attack
    Active Skill 1
    Active Skill 2

Passives apply modifiers automatically.


## 6.1 Skill Identity Contract

Skill and passive identities are canonical numeric-string IDs.

- Active skill IDs use the `1000+` range and remain `string` values at all boundaries.
- Passive skill IDs use the `2000+` range and remain `string` values at all boundaries.
- `skillId`/`passiveId` are immutable identities used for runtime joins, persistence, and event payloads.
- `skillName` is mutable display metadata and must not be used as an identity key.
- Clients should submit/store IDs while rendering names for UX.

---

# 7. Numeric System

All numbers are integers.

## 7.1 Core Stats

    HP: 1000 – 5000
    ATK: 80 – 260
    DEF: 40 – 200
    SPD: 80 – 160

---

## 7.2 Accuracy and Evasion

Accuracy and evade use **basis points**.

    0 – 10000

Typical values:

    accuracyBP: 7000 – 9500
    evadeBP: 500 – 3000

---

# 8. Hit Chance Formula

    hitChanceBP = clamp(
        actor.accuracyBP - target.evadeBP + skill.accuracyModBP,
        500,
        9500
    )

Roll:

    roll = RNG.nextInt(1, 10000)
    hit = roll <= hitChanceBP

---

# 9. Damage Formula

    raw = skill.basePower + actor.ATK
    mitigationDen = 100 + target.DEF

    damage = floor((raw * 100) / mitigationDen)
    damage = max(1, damage)

---

# 10. Skills

## 10.1 Skill Types

### Active Skills

Executed during combat.

Properties:

    cooldownTurns
    basePower
    tags[]
    accuracyModBP
    statusEffects[]

---

### Passive Skills

Always active modifiers.

Types allowed:

1. Flat stat modifier
2. Conditional modifier
3. Limited triggered effect

Triggered passives must remain minimal in MVP.

---

# 11. Status Effects

## 11.1 Duration

Statuses last:

    1 – 3 turns

At end of round:

    durationTurns -= 1

If duration reaches zero:

    STATUS_EXPIRE

---

## 11.2 Stacking

Statuses **do not stack**.

Reapplying a status:

    refresh duration

---

# 12. Cooldowns

Skill cooldowns use **turns**.

When used:

    cooldownRemainingTurns = cooldownTurns

At end of round:

    cooldownRemainingTurns -= 1

Minimum is zero.

---

# 13. Battle Event Log

The server returns a **BattleResult**.

Structure:

    BattleResult {
        battleId
        seed
        playerInitial
        enemyInitial
        events[]
    }

---

## 13.1 Event Types

    ROUND_START
    ACTION
    HIT_RESULT
    DAMAGE
    STATUS_APPLY
    STATUS_REFRESH
    STATUS_EXPIRE
    COOLDOWN_SET
    ROUND_END
    DEATH
    BATTLE_END

Clients replay events sequentially.

---

# 14. RNG System

Use deterministic RNG:

    xorshift32

Properties:

- seeded
- reproducible
- integer-only

Seed is included in battle results.

---

# 15. Learning System

## 15.1 Purpose

Characters adjust decision weights based on past battles.

Learning is:

- **per character**
- **per enemy archetype**

Learning does not affect other players.

---

## 15.2 Stored Data

    skillEffectivenessWeight ∈ [-1000, 1000]

For each:

    characterId
    enemyArchetypeId
    skillId

---

## 15.3 Contribution Calculation

For each skill used:

    damagePart = (damageDealt * 1000) / enemyHPMax
    statusPart = (statusTurnsApplied * 1000) / 3

    contrib =
    (700 * damagePart + 300 * statusPart) / 1000

---

## 15.4 Weight Update

    learningRate = 150

    delta =
        sign(win/loss)
        * learningRate
        * contrib
        / 1000

Clamp:

    [-1000, 1000]

---

# 16. AI Decision Model

Each action candidate receives a score.

Candidates:

    Basic Attack
    Active Skill 1
    Active Skill 2

Score formula:

    score =
        baseScore
        * learnedWeight
        * matchupBonus
        * timingBonus
        - wastePenalty

Examples:

    execute bonus if enemy HP < threshold
    stun bonus if enemy about to act
    cleanse bonus if debuffed
    shieldbreak bonus if enemy shielded

---

# 17. Progression

Skills unlock by **character level**.

Example schedule:

    Level 1 → Active
    Level 3 → Active
    Level 5 → Passive
    Level 7+ → alternating unlocks

Players may re-equip skills anytime **outside combat**.

---

# 18. World System

The world is **persistent and shared**.

Players explore nodes.

Node types:

    Encounter
    Resource
    Boss

---

## 18.1 Global Discoveries

Milestones unlock global information:

    enemy archetypes
    weakness tags
    new zones

New players benefit from shared knowledge.

---

# 19. Exploration Loop

Gameplay loop:

    Open Map
    → Select Node
    → Encounter
    → Battle Simulation
    → Results
    → Loot / Materials
    → Craft Gear
    → Improve Loadout
    → Repeat

---

# 20. Crafting System

Players collect materials from enemies.

Materials:

    Scrap Metal
    Circuit Shards
    Polymer Sheets
    Nano Gel
    Capacitors
    Alloy Plates
    Signal Cores
    Overseer Fragments

---

## 20.1 Craftable Items

Total craftable items in MVP:

    30

Categories:

    10 Weapons
    10 Armor
    10 Utility Modules

---

# 21. Enemy Archetypes

Total:

    10 archetypes

Examples:

    Scrap Drone
    Razor Hound
    Plated Enforcer
    Signal Witch
    Nano Leech
    Cloak Stalker
    Overclock Brute
    Ward Turret
    Protocol Knight
    Overseer Unit

Each archetype defines:

    stat band
    weakness tags
    skill kit


## 21.1 Persistent Enemy Instance Model

Enemy archetypes remain static templates, while spawned enemies are persistent instances with mutable runtime state.

Canonical enemy domains:

    Enemy Instance Root (identity + lifetime counters)
    Enemy Instance Stats (base + bonus stats)
    Enemy Instance Loadout (active/passive slots)
    Enemy Instance Learning State (adaptive weights)
    Enemy Instance Presence (active/dead/despawned lifecycle)

Design rules:

- Enemy instances are system-owned (no player authority field).
- Presence/lifecycle state controls encounter eligibility.
- Enemy snapshots should remain shape-compatible with character snapshots where practical.


---

# 22. Persistence Model

The system never stores mid-battle state.

Stored data:

    Users
    Characters
    Inventory
    Equipment
    Skill Unlocks
    Learning Weights
    World Milestones
    World Discoveries
    Battle Summaries


## 22.1 Enemy Persistence and Validation Anchors

Enemy-side persistence includes both template and instance layers:

    EnemyArchetypeRegistry (static template)
    EnemySkillSet (optional reusable skill template)
    EnemyDropTable (reward validation template)
    EnemyInstanceRoot / Stats / Loadout / Learning / Presence (live spawned enemy)

Enemy learning should be keyed by opponent buckets (for example: class/role, weapon family, build category), not by exact character identity, to avoid unbounded storage growth.


---

# 23. Security

Server validates:

- equipped skills
- owned items
- unlocked nodes
- character ownership

Combat cannot be influenced by client input once simulation begins.

---

# 24. Telemetry

Server stores battle summaries:

    winner
    rounds
    damage totals
    skills used

Used for balancing.

---

# 25. Development Workflow

Every feature must:

1. Follow SSOT.md
2. Maintain deterministic behavior
3. Preserve vertical slice functionality

Never merge work that breaks the playable slice.

---

# END OF SSOT
