/**
 * Rules configuration, tagged with the decision register (docs/GAME_DESIGN_MASTER.md, chapter 00).
 *
 * - CONFIRMED values are game rules. Do not change them without a new user decision.
 * - PROVISIONAL values are prototype assumptions. They are config, not balance results.
 * - OPEN values are `null`. Code that depends on them must reject with UNRESOLVED_RULE,
 *   unless a test fixture supplies an explicit override (see `withFixtureOverrides`).
 */

export type RuleStatus = "CONFIRMED" | "PROVISIONAL" | "OPEN";

export interface Rule<T> {
  readonly value: T;
  /** Decision register ID, e.g. "C09", "P15", "O07". */
  readonly decision: string;
  readonly status: RuleStatus;
  readonly note?: string;
}

const confirmed = <T>(value: T, decision: string, note?: string): Rule<T> =>
  note === undefined ? { value, decision, status: "CONFIRMED" } : { value, decision, status: "CONFIRMED", note };
const provisional = <T>(value: T, decision: string, note?: string): Rule<T> =>
  note === undefined ? { value, decision, status: "PROVISIONAL" } : { value, decision, status: "PROVISIONAL", note };
const open = <T>(decision: string, note?: string): Rule<T | null> =>
  note === undefined ? { value: null, decision, status: "OPEN" } : { value: null, decision, status: "OPEN", note };

export type Rank = "NORMAL" | "ELITE" | "BOSS";

/** Piecewise table: first entry whose maxHpRatio >= current HP ratio wins. */
export interface CaptureHpFactorStep {
  readonly maxHpRatio: number;
  readonly factor: number;
}

export interface CaptureRateTable {
  /** [min, max] probability (0–1) per rank. */
  readonly rankBounds: Readonly<Record<Rank, readonly [number, number]>>;
  readonly hpFactor: readonly CaptureHpFactorStep[];
}

/**
 * When a skill cooldown counter goes down. O15 has not decided this.
 * "owner_turn_start": the counter drops by 1 when the owner's turn starts, before it acts.
 */
export type CooldownTickPolicy = "owner_turn_start";

export const RULES = {
  rulesVersion: "design-1.0/phase-b",
  confirmed: {
    playerMaxLevel: confirmed(200, "C12"),
    maxCompanions: confirmed(5, "C04"),
    allowDuplicateSpeciesInTeam: confirmed(false, "C04", "same species is a duplicate even with a different element"),
    maxEnemyUnits: confirmed(10, "C05", "includes boss parts and adds that are separate units"),
    itemsUsableInBattle: confirmed(true, "C05"),
    speciesSkillCount: confirmed(3, "C06", "plus exactly one innate passive"),
    captureWildLevelGap: confirmed(5, "C09", "wildLevel <= playerLevel + 5"),
    capturedInitialLevel: confirmed(1, "C09"),
    autoCapture: confirmed(false, "C15"),
    energySystem: confirmed(false, "C16"),
    offlineFarming: confirmed(false, "C14"),
    globalFarmRewardCap: confirmed(false, "C16"),
    lootCandidateRange: confirmed([50, 100] as const, "C19", "unique candidate item IDs per species, Sigil included"),
    maxLootTypesPerEnemy: confirmed(5, "C19"),
    sigilBaseDropRange: confirmed([0.00005, 0.0005] as const, "C22", "probability 0–1; 0.005%–0.05% in UI"),
    maxSigilsPerWeapon: confirmed(4, "C23"),
    maxSigilsPerNonWeapon: confirmed(1, "C23", "shields and non-weapon off-hands included"),
    allowDuplicateSigils: confirmed(true, "C24"),
    headgearSharedSigilGroup: confirmed(true, "C24", "one HEADGEAR group for top/mid/low"),
    sigilRemovalPremiumRoute: confirmed(false, "C25"),
    premiumPower: confirmed(false, "C26"),
    playersVisibleInMap: confirmed(true, "C03", "maps are split into channels"),
    privateEncounters: confirmed(
      true,
      "O05",
      "user decision 2026-10-03: everyone sees the same packs, each player who engages gets a private fight; no kill-stealing",
    ),
  },
  provisional: {
    autoHuntLootRetention: provisional(0.7, "P01", "multiplier, applied once per candidate; not 0.70%"),
    manualStartLootRetention: provisional(1, "P01", "manual start, then Auto Battle: x1"),
    primaryStatStart: provisional(10, "P03"),
    statPointsPerLevel: provisional(3, "P03"),
    manualStatCap: provisional(150, "P03"),
    /** [fromValueInclusive, toValueInclusive, costPerPoint] for the NEW value being bought. */
    statCostBands: provisional(
      [
        [11, 60, 1],
        [61, 100, 2],
        [101, 150, 3],
      ] as const,
      "P03",
    ),
    armorK: provisional(200, "P04"),
    hitChanceClampPct: provisional([20, 98] as const, "P04"),
    critChanceClampPct: provisional([0, 60] as const, "P04"),
    critBaseMultiplier: provisional(1.5, "P04"),
    critMaxMultiplier: provisional(2.5, "P04"),
    armorReductionCapPct: provisional(50, "P04"),
    armorPenetrationCapPct: provisional(40, "P04"),
    elementStrong: provisional(1.25, "P04", "chapter 02 element chart"),
    elementWeak: provisional(0.8, "P04", "chapter 02 element chart"),
    roundingMode: provisional("half_up_once" as const, "P04", "round once on the result event"),
    guardDamageMultiplier: provisional(0.6, "P15", "guard reduces damage by 40% until the guard's next turn starts"),
    formationFrontSlots: provisional(3, "P15"),
    formationBackSlots: provisional(3, "P15"),
    actionsPerRound: provisional(1, "P15"),
    companionMaxLevel: provisional(200, "P05"),
    /** Combat bag (chapter 03 §2): 8 distinct item types, per-kind stack caps. */
    combatBagMaxTypes: provisional(8, "P15", "chapter 03 §2 proposal"),
    combatBagStackCaps: provisional(
      { heal: 10, capture: 10, support: 5, attack: 5, revive: 2 } as const,
      "P15",
      "chapter 03 §2 proposal",
    ),
    // World / walking slice (Phase B). Prototype numbers; the art proof and playtests may change them.
    worldTileSizePx: provisional(32, "P10", "walk grid; player frame stays 64px and overlaps tiles"),
    walkStepMs: provisional(250, "P10", "one orthogonal tile step = 4 tiles/s"),
    diagonalStepFactor: provisional(1.4142, "P10", "8-direction movement; a diagonal step costs sqrt(2)"),
    moveBurstMs: provisional(500, "P11", "latency allowance: steps may arrive this much early after a pause, never faster on average"),
    channelsPerMap: provisional(2, "P11", "prototype channel count per map"),
    channelCapacity: provisional(50, "P11", "players per channel; not a load-tested number"),
    positionSaveIntervalMs: provisional(10_000, "P11", "how often a channel writes moved players' positions to D1"),
    // Encounters (Phase C). Hunting speed numbers are P12 assumptions.
    packRespawnMs: provisional(60_000, "P12", "a visible pack is re-rolled this often; a player who fought it waits for the next one"),
    engageRangeTiles: provisional(1, "P10", "must stand next to (or on) the pack to start a fight"),
    // Auto Hunt pacing (chapter 08: the server, not the client's frame rate, sets the action cadence).
    // Prototype values so a watching client can show each action; not a farming limit or quota.
    autoBattleActionMs: provisional(700, "P01", "server-paced Auto Hunt battle: one ally action per this many ms"),
    autoHuntResultPauseMs: provisional(1500, "P01", "after an Auto Hunt fight ends, the result stays on screen this long before walking on"),
    // EXP and levels. The player table is Nut's "exp-proposal-1.0" (docs/design/EXP_DESIGN_LV001_200.md,
    // 2026-10-03, PROVISIONAL): minutes per level from linear anchors, times 2 reference kills a minute,
    // times the reference EXP of a normal kill at that level, rounded half-up to 10. The JSON beside it is
    // checked row by row in tests. It is for the player's base level only.
    playerExpTable: provisional(
      {
        anchors: [[1, 1], [10, 4], [25, 12], [49, 40], [50, 41], [80, 90], [119, 180], [120, 185], [150, 360], [170, 600], [190, 900], [199, 1200]],
        killsPerMinute: 2,
      } as const,
      "P03",
      "Nut's exp-proposal-1.0 (2026-10-03): 120 normal kills/hour reference, not playtested; Lv200 needs 5,465,771,910 EXP",
    ),
    // Reference EXP of a normal wild enemy at fixed species level M: 20 + 6M + 2M². The proposal calls this
    // a budget per species; until species carry their own EXP every species uses it. Elite/Boss get the same
    // (the proposal rejects a flat x10 for bosses; their EXP comes with content). A capture gives the same EXP
    // as a kill (chapter 04 §3 proposal).
    referenceNormalExp: provisional({ base: 20, linear: 6, quadratic: 2 } as const, "P03", "Nut's exp-proposal-1.0 normal_xp_formula"),
    // Companions (Nut's companion-exp-proposal-1.0, docs/design/COMPANION_EXP_DESIGN_LV001_200.md, PROVISIONAL):
    // the first cycle needs 25% of the player's EXP per level, rounded half-up to 10, the same for every
    // species, rank and element. The Rebirth 1–3 columns (30/35/40%) are scenarios only; Rebirth stays O03/O04.
    companionExpTable: provisional({ percentOfPlayer: 25 } as const, "P05", "Nut's companion-exp-proposal-1.0 first cycle; checked row by row against the JSON"),
    // A companion fighting enemies far above it gets less (proposal §5): per target, the award is scaled by
    // min(1, E(min(cap, C + gap)) / E(M)), C = the companion's level at fight start, M = the enemy's wild
    // level, E = referenceNormalExp. The player's EXP is never scaled by this.
    companionTrainingLevelGap: provisional(10, "P05", "Nut's companion-exp-proposal-1.0 §5 (new provisional value, needs feel testing)"),
    // Sigil removal (chapter 05 §4, chapter 06). Coins per Sigil by the equipment's required level:
    // [fromLevelInclusive, coins]. Lv50/120/200 = 3 hours of the chapter 06 manual net example;
    // the Lv1 tier has no source number and is a pure prototype guess.
    sigilRemovalCostTiers: provisional(
      [
        [1, 300],
        [50, 10_800],
        [120, 37_800],
        [200, 95_000],
      ] as const,
      "P08",
      "fixed by item level, never by market price or the player's income; values are P12 assumptions",
    ),
  },
  unresolved: {
    tradeLevelGap: open<number>("O01", "user range 20–40; proposal +30"),
    companionEffectiveLevelGap: open<number>("O02"),
    maxRebirths: open<number>("O03"),
    captureRates: open<CaptureRateTable>("O07", "rank bounds and HP factor table"),
    cooldownTick: open<CooldownTickPolicy>("O15", "cooldown counter tick point"),
    fleeChance: open<number>("O15", "flee formula"),
    reviveRules: open<true>("O15", "revive timeline"),
    stalemateResolution: open<true>("O15"),
  },
} as const;

export type RulesConfig = typeof RULES & {
  /** Names of OPEN rules replaced by a test fixture. Production must refuse any non-empty list. */
  readonly fixtureOverrides: readonly string[];
};

type UnresolvedKey = keyof typeof RULES.unresolved;
type UnresolvedValue<K extends UnresolvedKey> = NonNullable<(typeof RULES.unresolved)[K]["value"]>;

export const PRODUCTION_RULES: RulesConfig = { ...RULES, fixtureOverrides: [] };

/**
 * Fill OPEN rules for a test or a local preview. The result is marked so that the server
 * can refuse it outside dev (validator 8 in chapter 12: no silent production defaults for OPEN).
 */
export function withFixtureOverrides(
  base: RulesConfig,
  overrides: { [K in UnresolvedKey]?: UnresolvedValue<K> },
): RulesConfig {
  const unresolved: Record<string, Rule<unknown>> = { ...base.unresolved };
  const names: string[] = [...base.fixtureOverrides];
  for (const [key, value] of Object.entries(overrides)) {
    const current = unresolved[key];
    if (current === undefined) throw new Error(`Unknown unresolved rule: ${key}`);
    unresolved[key] = { ...current, value, note: `TEST FIXTURE OVERRIDE (${current.decision} still OPEN)` };
    if (!names.includes(key)) names.push(key);
  }
  return { ...base, unresolved: unresolved as unknown as RulesConfig["unresolved"], fixtureOverrides: names };
}
