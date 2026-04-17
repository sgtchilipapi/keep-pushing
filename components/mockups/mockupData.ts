export type MockTone =
  | "neutral"
  | "outline"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type MockKeyValueItem = {
  label: string;
  value: string;
};

export const mockPlayerAccount = {
  verifiedAccount: false,
};

export type MockCharacterSlot =
  | {
      state: "occupied";
      slot: number;
      character: {
        id: string;
        name: string;
        className: string;
        level: number;
        exp: string;
        summary: string;
      };
    }
  | {
      state: "open";
      slot: number;
      summary: string;
    }
  | {
      state: "locked";
      slot: number;
      summary: string;
    };

export const mockCharacterSlots: MockCharacterSlot[] = [
  {
    state: "occupied",
    slot: 1,
    character: {
      id: "rookie-01",
      name: "Astra",
      className: "Warden",
      level: 7,
      exp: "820 / 1000",
      summary: "Frontline sustain build with one pending settlement run.",
    },
  },
  {
    state: "open",
    slot: 2,
    summary: "Create a new character in this slot.",
  },
  {
    state: "locked",
    slot: 3,
    summary: "Locked until the account unlocks an additional roster slot.",
  },
];

export const mockCharacterSummary: MockKeyValueItem[] = [
  { label: "Exp", value: "820 / 1000" },
  { label: "Sync", value: "UNSYNCED" },
  { label: "Highest zone", value: "Zone 2" },
];

export const mockZoneCards = [
  {
    zoneId: "Zone 1",
    title: "Fringe Fields",
    status: "Cleared",
    tone: "success" as MockTone,
    body: "Low-risk entry route with one branch and short recovery windows.",
  },
  {
    zoneId: "Zone 2",
    title: "Signal Wastes",
    status: "Unlocked",
    tone: "info" as MockTone,
    body: "Higher pressure route with branching nodes and longer run length.",
  },
  {
    zoneId: "Zone 3",
    title: "Sealed",
    status: "Locked",
    tone: "warning" as MockTone,
    body: "Locked until the previous route is cleared consistently.",
  },
];

export const mockRunSteps = [
  { title: "Route selected", body: "Zone 1 / Fringe Fields", tone: "success" as MockTone },
  { title: "Current node", body: "Node B2 / Post-battle pause", tone: "info" as MockTone },
  { title: "Next action", body: "Use a pause skill or continue", tone: "warning" as MockTone },
];

export const mockSyncSummary: MockKeyValueItem[] = [
  { label: "Mode", value: "settlement" },
  { label: "Season", value: "Season 3" },
  { label: "Pending run", value: "#014" },
  { label: "Queue depth", value: "2" },
  { label: "Wallet", value: "9x4j...2Pq8" },
  { label: "Grace", value: "17h 24m left" },
];

export const mockSyncAttempts = [
  {
    id: "attempt-3",
    title: "Latest attempt",
    time: "Today, 14:28",
    status: "Awaiting retry ack",
    tone: "warning" as MockTone,
    detail: "Prepared and submitted. Waiting for local device acknowledgment.",
  },
  {
    id: "attempt-2",
    title: "Previous attempt",
    time: "Today, 11:02",
    status: "RPC rejected",
    tone: "danger" as MockTone,
    detail: "Cluster response timed out after signature submission.",
  },
  {
    id: "attempt-1",
    title: "Earlier attempt",
    time: "Yesterday, 22:19",
    status: "Prepared",
    tone: "info" as MockTone,
    detail: "Payload prepared but wallet session expired before signing.",
  },
];

export const mockRunSummary: MockKeyValueItem[] = [
  { label: "Run ID", value: "run_014" },
  { label: "Character", value: "Astra" },
  { label: "Zone", value: "Zone 1" },
  { label: "Class", value: "Warden" },
  { label: "Battles", value: "3 / 3 rewarded" },
  { label: "Status", value: "COMPLETED" },
];

export const mockEncounterLog = [
  {
    id: "battle-1",
    enemy: "Scrap Hound",
    node: "A1",
    winner: "player",
    rounds: "4",
    status: "COMMITTED",
    tone: "success" as MockTone,
  },
  {
    id: "battle-2",
    enemy: "Signal Wisp",
    node: "B1",
    winner: "player",
    rounds: "6",
    status: "COMMITTED",
    tone: "success" as MockTone,
  },
  {
    id: "battle-3",
    enemy: "Framekeeper",
    node: "B2",
    winner: "player",
    rounds: "8",
    status: "PENDING SHARE",
    tone: "warning" as MockTone,
  },
];

export const mockCreateClasses = [
  {
    id: "warden",
    name: "Warden",
    body: "Stable frontline kit with recovery and carry potential.",
    details:
      "Best when you want a forgiving opener with clear turn-to-turn decisions.",
    stats: ["Frontline", "Recovery", "Stable"],
  },
  {
    id: "saboteur",
    name: "Saboteur",
    body: "Tempo-focused attacker built around interruption windows.",
    details:
      "Rewards aggressive timing and works best when route tempo matters more than sustain.",
    stats: ["Tempo", "Burst", "Interrupt"],
  },
  {
    id: "invoker",
    name: "Invoker",
    body: "Utility-heavy route control with delayed pressure.",
    details:
      "Stronger for setup-oriented players who prefer control over early damage.",
    stats: ["Control", "Utility", "Setup"],
  },
];
