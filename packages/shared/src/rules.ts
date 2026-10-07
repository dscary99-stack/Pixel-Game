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

/**
 * One capture rule set (capture.ts). A fight pins the profile it started with (BattleState.captureProfile),
 * so a deploy never changes the odds of a fight already running.
 */
export interface CaptureProfile {
  readonly version: string;
  /** Multiplies the species base by the target's rank (ELITE is harder; BOSS has its own low base). */
  readonly rankFactors: Readonly<Record<Rank, number>>;
  /** [min, max] probability (0–1) per rank, applied last. Never makes an ineligible target capturable. */
  readonly rankBounds: Readonly<Record<Rank, readonly [number, number]>>;
  readonly hpFactor: readonly CaptureHpFactorStep[];
  /** The best one active status counts; anything not listed is 1. */
  readonly statusFactors: Readonly<Record<string, number>>;
  /** Capture item qualities this profile accepts, with their factor. Anything else is refused. */
  readonly qualityFactors: Readonly<Record<string, number>>;
  /** Capture mastery: every account the same in v1. */
  readonly masteryFactor: number;
  /** No pity: failures never raise the next chance. */
  readonly pity: false;
}

/**
 * When a skill cooldown counter goes down (O15, Nut 2026-10-07: cooldowns count turns).
 * "owner_turn_start": the counter drops by 1 when the owner's turn starts, before it acts, so a skill
 * with cooldown N used on turn T is ready again on the owner's turn T+N.
 */
export type CooldownTickPolicy = "owner_turn_start";

/** Flee chance (O15 decided 2026-10-07, numbers P19): from SPD and each monster's own flee value. */
export interface FleeProfile {
  /** A species without its own `fleeBasePct` uses this by its rank; an Elite unit is never above ELITE. 0 = no fleeing. */
  readonly rankDefaultPct: Readonly<Record<Rank, number>>;
  readonly minPct: number;
  readonly maxPct: number;
}

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
    autoHuntDisconnectGraceMs: confirmed(0, "O11", "user decision 2026-10-03: Auto Hunt stops the moment the connection closes; no grace"),
    autoHuntSameCadence: confirmed(
      true,
      "C14",
      "user decision 2026-10-03: an Auto Hunt fight is a real fight with Auto on, at the same action cadence as Auto Battle",
    ),
    // Status effects (chapter 03 §6, O15 parts decided by Nut 2026-10-04; see status.ts).
    statusLandsByChance: confirmed(true, "O15", "Nut 2026-10-04: every status has a chance to land, not 100%, unless a skill sets 100%"),
    controlImmunityAfterControl: confirmed(false, "O15", "Nut 2026-10-04: no immunity turn after stun/sleep/freeze"),
    sigilDuplicatesStackPercentOnPercent: confirmed(true, "O09", "Nut 2026-10-04: duplicate Sigils with weapon-type % effects stack % on % (multiplied)"),
    rareDropBelowChance: confirmed(0.01, "chapter08", "Nut 2026-10-04: a rare drop is one whose drop chance is under 1% (mostly upgrade/crafting materials, equipment, fashion)"),
    sigilPrefixOnEquipment: confirmed(true, "C24", "Nut 2026-10-04: an installed Sigil puts a prefix before the equipment's name"),
    shieldAfterDamageReduction: confirmed(true, "O15", "Nut 2026-10-04: a shield soaks damage after damage reduction"),
    statsOffsetStatusChance: confirmed(true, "O15", "Nut 2026-10-04: some high stats offset the chance of a status landing"),
    effectHitCappedAtSkillChance: confirmed(
      true,
      "O15",
      "Nut 2026-10-04: effect hit offsets effect resistance, never above the skill's chance: chance = skill × (1 − max(0, res − hit)/100)",
    ),
    // Nut 2026-10-07: the rest of the end-of-build decision batch.
    weeklyUnclaimedExpires: confirmed(true, "chapter09", "Nut 2026-10-07: a weekly reward not claimed before the week ends is gone"),
    sigilFullOnOffHandAndDualWield: confirmed(
      true,
      "O09",
      "Nut 2026-10-07: Sigils and effects on the off hand and on a second weapon count in full; weapons that can go in either hand have lower stats to make up for it",
    ),
    maxCharactersPerAccount: confirmed(10, "O10", "Nut 2026-10-07: 10 characters per account, for many different builds"),
    loginProviders: confirmed(["google", "facebook", "local"] as const, "O11", "Nut 2026-10-07: sign in with Google, Facebook, or an ID created in the game"),
    partyMaxMembers: confirmed(5, "P02", "Nut 2026-10-07: a party has up to 5 players"),
    partyBossCompanionsEach: confirmed(
      1,
      "P02",
      "Nut 2026-10-07: in a party boss fight each member brings 1 companion, so 5 players fill the 10 ally places",
    ),
    // O01 (Nut 2026-10-07): a companion received from someone else is at most 30 levels above you, and a
    // companion you have fights at its own level, with no cap (replaces the P05 min(level, player + 10)).
    tradeLevelGap: confirmed(30, "O01", "Nut 2026-10-07: a received companion (and its species' wild level) may be at most the recipient's level + 30"),
    companionBattleLevelCap: confirmed(false, "O01", "Nut 2026-10-07: no level limit on taking a companion into battle; it fights at its real level"),
    // The rest of O15 (Nut 2026-10-07): per-skill cooldowns, flee, revive, no forced end.
    cooldownTick: confirmed<CooldownTickPolicy>("owner_turn_start", "O15", "Nut 2026-10-07: each skill has its own cooldown in turns, set by its impact"),
    fleeFromSpeedAndMonster: confirmed(true, "O15", "Nut 2026-10-07: the flee % comes from SPD plus the flee chance of those monsters"),
    reviveAfterDownRounds: confirmed(1, "O15", "Nut 2026-10-07: a fallen unit can be revived after it has been down 1 turn (read as: from the next round)"),
    reviveHpFromSource: confirmed(true, "O15", "Nut 2026-10-07: the HP % a revive gives depends on the skill or item"),
    reviveLimitPerFight: confirmed(false, "O15", "Nut 2026-10-07: no limit on revives in a fight"),
    forcedFightEnd: confirmed(false, "O15", "Nut 2026-10-07: no forced loss or draw; the fight goes on until one side loses"),
    // Refining / ตีบวก (refine.ts; Nut's REFINEMENT_DESIGN v2.1, 2026-10-07). These parts are CONFIRMED there.
    refineRiskySuccessBp: confirmed(
      [6000, 5000, 4000, 2000, 1000] as const,
      "P07",
      "Nut v2.1: success for targets +6..+10 in basis points (60/50/40/20/10%), the same with or without a ward",
    ),
    refineBreakFromTarget: confirmed(6, "P07", "Nut v2.1: a failed attempt at target +6 or higher destroys the piece unless a ward was used"),
    refineNoPity: confirmed(true, "P07", "Nut v2.1: no guarantee, no pity counter, no chance that grows with failures"),
    refineWardExists: confirmed(true, "P07", "Nut v2.1: a ward item, crafted from farmed coins plus monster materials (never Premium)"),
    refineBreakDestroysSigils: confirmed(
      true,
      "O16",
      "Nut 2026-10-07: Sigils on a piece destroyed by refining are lost with it; the player is warned first and can take them out (paid removal) beforehand",
    ),
    // Weekly battle tower (chapter 07 §4 "tower", frontier.ts). Nut 2026-10-06 decided these.
    frontierFloorByFloor: confirmed(true, "chapter07", "Nut 2026-10-06: the tower is climbed floor by floor"),
    frontierEntriesPerWeek: confirmed(
      1,
      "chapter07",
      "Nut 2026-10-06: a character may enter once per week (the quest week, P13 reset); Nut's own decision for this tower, not an energy/stamina system (C16)",
    ),
    frontierEnemiesGrowPerFloor: confirmed(true, "chapter07", "Nut 2026-10-06: enemies get stronger each floor (never by wild level, C29)"),
    frontierBossEveryFloors: confirmed(10, "chapter07", "Nut 2026-10-06: a boss every 10 floors"),
    frontierFloors: confirmed(100, "chapter07", "Nut 2026-10-06: 100 floors to start"),
    frontierForBossRareItems: confirmed(true, "chapter07", "Nut 2026-10-06: the point is hunting the bosses' rare items (drop chance under 1%)"),
    frontierCapture: confirmed(true, "chapter07", "Nut 2026-10-06: monsters inside can be captured (normal capture, by hand, C15)"),
    // Nut 2026-10-06 (second round, 04:37Z).
    secretQuestRewardKinds: confirmed(
      ["title", "fashion", "companion", "gear"] as const,
      "chapter02",
      "Nut 2026-10-06: secret quest rewards can be any kind: a unique title, unique fashion, a unique monster, special equipment",
    ),
    secretQuestsVeryHard: confirmed(true, "chapter02", "Nut 2026-10-06: secret quests must be very hard so the reward is worth it"),
    frontierFloorNames: confirmed(true, "chapter07", "Nut 2026-10-06: Claude names every tower floor"),
    frontierMonstersPerFloor: confirmed(10, "chapter07", "Nut 2026-10-06: every tower floor has 10 monsters"),
    frontierHarderEveryFloor: confirmed(true, "chapter07", "Nut 2026-10-06: difficulty rises on every floor"),
    frontierFloorGimmicks: confirmed(true, "chapter07", "Nut 2026-10-06: each floor has its own gimmick (high attack, high defence, status, disruption, ...)"),
    frontierReinforcements: confirmed(
      true,
      "chapter07",
      "Nut 2026-10-06: on later floors a monster that dies is replaced by a reinforcement, so a floor holds more than 10 (finite queue: rewards stay bounded, chapter 07 §5)",
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
    /**
     * O09 (Nut 2026-10-07): Sigils on the off hand and a second weapon count in full, so weapons that can be
     * held in either hand pay for it with lower stats. Content check: a one-hand weapon's PATK/MATK is at most
     * this % of a two-hand weapon's at the same required level.
     */
    /**
     * Login accounts (O10/O11, Nut 2026-10-07: Google, Facebook, an ID made in the game; 10 characters each).
     * Ops numbers Claude set: how long a sign-in lasts, password rules, and the lock after wrong passwords.
     */
    login: provisional(
      {
        sessionDays: 30,
        loginIdMin: 4,
        loginIdMax: 24,
        passwordMin: 8,
        passwordMax: 128,
        /** PBKDF2-SHA256; Workers allow at most 100,000 iterations. */
        pbkdf2Iterations: 100_000,
        /** This many wrong passwords in the window locks password sign-in for that ID until the window ends. */
        failedLoginLimit: 10,
        failedLoginWindowMs: 15 * 60_000,
      } as const,
      "P21",
      "sign-in lasts 30 days; ID 4–24 of a–z 0–9 _ . -; password 8–128; 10 wrong passwords lock that ID for 15 minutes",
    ),
    oneHandWeaponAttackPct: provisional(60, "P20", "one-hand weapon PATK/MATK ≤ 60% of a two-hand weapon at the same required level"),
    guardDamageMultiplier: provisional(0.6, "P15", "guard reduces damage by 40% until the guard's next turn starts"),
    formationFrontSlots: provisional(3, "P15"),
    formationBackSlots: provisional(3, "P15"),
    actionsPerRound: provisional(1, "P15"),
    /**
     * Bosses may act 2–3 times a round, a disclosed exception shown in the round's timeline (chapter 03).
     * Each action is its own slot in the order, spread out by SPD (action k of N at SPD×(N−k)/N), so the
     * player sees when each comes. Per action: hard control still never lands on a boss, a turn-skip roll
     * (paralysis and the like) costs only that action, and a KO ends the rest. Over-time ticks and
     * turn_start passives happen on the boss's first action of the round; status countdown and turn_end
     * passives on its last, so a 3-action boss does not burn statuses 3× as fast. Never carried over to
     * companions: a captured boss acts once like any companion. Claude's first pass.
     */
    /**
     * Gear rarity and affixes (chapter 05 §2–§3, P09). Rarity of a dropped piece by weight (out of
     * 1000); Legendary needs a unique effect, which no gear has yet, so it never rolls. Affix count
     * per rarity (at most 3). Affix values grow by this percent of the Lv1 value per item level.
     * Claude's first pass, tune in playtests.
     */
    gearRarityWeights: provisional({ COMMON: 600, UNCOMMON: 280, RARE: 100, EPIC: 20, LEGENDARY: 0 } as const, "P09", "Claude's first pass"),
    affixCountByRarity: provisional({ COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 3 } as const, "P09", "chapter 05 §3: random affixes <= 3 by rarity"),
    /**
     * Paid reroll of one affix (chapter 05 §3): coins and the pool's material, both by item level.
     * Values are P12 economy assumptions (Claude's first pass); resources are spent on the roll.
     */
    affixRerollCost: provisional({ coinsBase: 300, coinsPerLevel: 60, materialBase: 2, materialPerTenLevels: 1 } as const, "P12", "coins = 300 + 60 × item level; material = 2 + 1 per 10 item levels"),
    /**
     * Selling and salvaging gear (chapter 09 sinks, disposal.ts). Sell: (base + perLevel × item level)
     * × rarity %. Salvage: the pool's reroll material, by rarity, + more per 10 item levels. P12
     * assumptions (Claude's first pass); a validator keeps craft → sell / salvage below the recipe cost.
     */
    gearDisposal: provisional(
      {
        sellBase: 4,
        sellPerLevel: 4,
        sellRarityPct: { COMMON: 100, UNCOMMON: 150, RARE: 250, EPIC: 400, LEGENDARY: 600 },
        salvageBase: { COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 5, LEGENDARY: 8 },
        salvagePerTenLevels: 1,
      } as const,
      "P12",
      "sell = (4 + 4 × item level) × rarity %; salvage = reroll material 1/2/3/5 + 1 per 10 item levels",
    ),
    /**
     * Daily / Weekly quests (chapter 09, P13). Periods reset at a server-defined UTC hour (21:00 UTC =
     * 04:00 Bangkok), weekly on Monday at that hour. Daily: 8 choices, rewards for up to 4. Weekly:
     * several choices, the main reward once enough are done. Counts and rewards are Claude's first
     * pass (P12); quest EXP is a share of the character's current level step.
     */
    quests: provisional(
      {
        resetHourUtc: 21,
        dailyChoices: 8,
        dailyClaims: 4,
        weeklyChoices: 6,
        weeklyMainNeeds: 3,
        /** Quests only name monsters whose wild level is at most the character's level + this. */
        levelSlack: 3,
        daily: { coinsBase: 40, coinsPerLevel: 8, expPctOfLevel: 8, itemId: "item:small_potion", itemQty: 2 },
        weekly: { coinsBase: 400, coinsPerLevel: 60, expPctOfLevel: 40, itemId: "item:phoenix_feather", itemQty: 1 },
        counts: { hunt: 10, areaHunt: 20, capture: 1, craft: 3, deliver: 5, weeklyHunt: 40, weeklyAreaHunt: 100, weeklyCapture: 3, weeklyCraft: 10, weeklyBoss: 2 },
      } as const,
      "P13",
      "chapter 09 Daily 8 choose 4, Weekly several ways; numbers are Claude's first pass",
    ),
    /**
     * Secret quests after the Lv200 awakening quest (Nut 2026-10-05: the game has no ending). Each
     * character gets 1 element quest + 1 race quest + `personalCount` personal quests, rolled once at
     * creation from a server-keyed seed of account id + character name, hidden until unlocked.
     * Nut 2026-10-06: more personal quests, and challenging ones; 7 is Claude's pick for "more".
     */
    secretQuests: provisional(
      { personalCount: 7 } as const,
      "P16",
      "Nut 2026-10-05: element + race + personal secret quests after the Lv200 awakening; Nut 2026-10-06: more and harder personal ones (7 is Claude's pick)",
    ),
    /**
     * Explore secret quests ("visit a map N times"): one visit per map counts per window, so walking
     * back and forth through a portal does not farm it (secret-progress.ts, A111).
     */
    secretQuestVisitWindowMinutes: provisional(60, "P16", "one counted visit per map per hour; Claude's pick so 150–300 visits stay a long goal"),
    /**
     * Weekly tower run (frontier.ts; Nut's decisions are in `confirmed`). Floor stat % = 100 +
     * statPctPerFloor × floor on HP and ATK/MATK (like an elite's), wild level never changes. Every floor
     * fields 10 monsters (C, Nut 2026-10-06); species climb by wild level, one step every
     * floorsPerSpeciesStep floors, from a window of speciesWindow species (the top one repeats when
     * content runs out). From eliteFromFloor a normal floor's leader is elite at eliteChancePct.
     * HP/MP carry between floors; after every checkpointEveryFloors-th floor cleared, units still
     * standing get checkpointRestorePct of max HP/MP back.
     * Gimmicks (Nut 2026-10-06): one per floor, two from twoModifiersFromFloor, three from
     * threeModifiersFromFloor; their numbers are in `modifiers`. Reinforcements from reinforceFromFloor:
     * a finite queue growing from reinforceFirst to reinforceLast at the top floor; the reserves gimmick
     * adds reservesBonusPct more (rounded up). Claude's first pass.
     */
    frontier: provisional(
      {
        statPctPerFloor: 4,
        floorsPerSpeciesStep: 10,
        speciesWindow: 2,
        eliteFromFloor: 5,
        eliteChancePct: 30,
        checkpointEveryFloors: 5,
        checkpointRestorePct: 30,
        twoModifiersFromFloor: 50,
        threeModifiersFromFloor: 80,
        reinforceFromFloor: 31,
        reinforceFirst: 2,
        reinforceLast: 30,
        reservesBonusPct: 50,
        modifiers: {
          fierceAtkPct: 30,
          toughDefPct: 40,
          arcaneMatkPct: 30,
          swiftSpdPct: 20,
          venomChancePct: 25,
          venomTurns: 3,
          disruptChancePct: 12,
          disruptTurns: 1,
          regenTurns: 99,
          shieldPctMaxHp: 15,
          shieldTurns: 99,
        },
      } as const,
      "P12",
      "tower: ×(1 + 4% × floor) HP/ATK/MATK, 10 monsters a floor, elite leaders from floor 5 at 30%, 30% HP/MP back every 5 floors, gimmicks 1/2/3 (from floors 50/80), reinforcements 2→30 from floor 31 (+50% with reserves); Claude's first pass",
    ),
    affixLevelScalePct: provisional(2, "P09", "affix value × (1 + 2% per item level above 1); Claude's first pass"),
    bossActions: provisional({ maxPerRound: 3 } as const, "P15", "bosses act up to 3 times a round; statuses count once per round"),
    /**
     * Elite packs (chapter 07 §3, elite.ts): the leader is tougher and carries 1 modifier (2 from
     * `twoModifiersFromLevel`), picked from allowed pairs; capture keeps its species/element at Lv1 and
     * never its multipliers. Rewards: EXP × `expPct`; loot stays the species' own table. Claude's first
     * pass (P12 hunt speed assumptions: elite fights aim at 2–4 minutes).
     */
    elite: provisional(
      {
        hpMultiplier: 2.5,
        powerPct: 115,
        twoModifiersFromLevel: 60,
        crystalShieldPct: 20,
        crystalShieldTurns: 10,
        moraleTurns: 10,
        enrageBelowHpPct: 30,
        enrageTurns: 3,
        counterCoefficientPct: 150,
        expPct: 300,
      } as const,
      "P12",
      "elite leader HP ×2.5, ATK/MATK ×1.15, EXP ×3; 1 modifier, 2 from Lv60; Claude's first pass",
    ),
    /**
     * Wild enemy AI (chapter 08 rule engine, same validator as manual): each turn a usable skill is
     * picked with this chance, else a basic attack. Heals only when an ally is under the HP line, and
     * a status-only skill only when the target lacks that status. Wild skills work at the level cap
     * their wild level allows (chapter 04 §5 table). Claude's first pass, tune in playtests.
     */
    enemyAi: provisional({ skillChancePct: 50, healBelowHpPct: 50 } as const, "P15", "wild enemies use their species' skills; Claude's first pass"),
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
    // Auto pacing (chapter 08: the server, not the client's frame rate, sets the action cadence).
    // One cadence for Auto Battle and Auto Hunt (user decision 2026-10-03); not a farming limit.
    // Companion growth, effective level and Rebirth. Nut delegated these on 2026-10-03 ("คิดให้เลย");
    // the numbers are Claude's proposal in docs/design/COMPANION_GROWTH_PARTY_REBIRTH.md, PROVISIONAL.
    companionGrowthWeights: provisional(
      {
        tank: { STR: 17, VIT: 40, INT: 7, DEX: 10, AGI: 8, SPI: 18 },
        physical: { STR: 38, VIT: 14, INT: 5, DEX: 20, AGI: 18, SPI: 5 },
        magic: { STR: 4, VIT: 12, INT: 40, DEX: 16, AGI: 8, SPI: 20 },
        support: { STR: 5, VIT: 20, INT: 14, DEX: 7, AGI: 16, SPI: 38 },
        control: { STR: 5, VIT: 9, INT: 12, DEX: 18, AGI: 36, SPI: 20 },
      } as const,
      "P05",
      "each level-up point lands on a stat by these archetype weights (chapter 04 §4 order); same total for everyone",
    ),
    companionGrowthPointsPerLevel: provisional(3, "P05", "same budget as the player's stat points; only the split is random"),
    maxRebirths: provisional(3, "P05", "was O03; Nut delegated 2026-10-03: three stages, the O03 proposal"),
    rebirthBonusPercent: provisional([4, 7, 10] as const, "P05", "O03 proposal: total bonus over base primary stats at stage 1/2/3; not added together"),
    rebirthRequirements: provisional(
      {
        companionLevel: 200,
        playerLevel: [100, 150, 200],
        coins: [50_000, 150_000, 400_000],
        speciesMaterial: [30, 60, 100],
      } as const,
      "P05",
      "was O04; Nut delegated 2026-10-03: per stage 1/2/3; the trial (บททดสอบ) is not built yet",
    ),
    // Skill levels and Bond (chapter 04 §5–§6, P06). Gate table from chapter 04 §5; costs, mastery and
    // Bond numbers are Claude's proposal (docs/design/SKILL_LEVELS_BOND.md), PROVISIONAL.
    skillLevelUnlocks: provisional(
      [1, 10, 20, 35, 50, 75, 100, 130, 160, 190] as const,
      "P06",
      "chapter 04 §5: skill level N needs companion level unlocks[N-1]; in a fight the companion's fighting level decides",
    ),
    skillPowerPercentPerLevel: provisional(4, "P06", "default step for a skill without its own levelSteps: +% coefficient per level above 1"),
    skillMasteryPerEnemy: provisional(1, "P06", "mastery each companion that started a won fight gets per enemy defeated or captured in it"),
    skillMasteryCap: provisional(5_000, "P06", "a companion's unspent mastery stops here"),
    skillTrainCost: provisional(
      {
        // Index = current level - 1 (training 1→2 uses index 0, 9→10 uses index 8).
        mastery: [10, 20, 30, 40, 50, 60, 70, 80, 90],
        coins: [100, 400, 900, 1_600, 2_500, 3_600, 4_900, 6_400, 8_100],
        speciesMaterial: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      } as const,
      "P06",
      "training always succeeds once paid (chapter 04 §5); mastery is the companion's pool, spent on the skill the player picks",
    ),
    bondPerVictory: provisional(2, "P06", "each companion that started a won fight and did not fall in it"),
    bondLossOnFall: provisional(2, "P06", "Nut 2026-10-03: a companion knocked out in a fight loses Bond (once per fight, any outcome); never below 0; time offline never lowers it"),
    bondTierSize: provisional(200, "P06", "chapter 04 §6 tiers: 0–199, 200–399, 400–599, 600–799, 800–1000"),
    bondTierBonusPercent: provisional([0, 1, 2, 3, 5] as const, "P06", "small capped bonus on the archetype's stat, per tier"),
    // Rebirth variants (chapter 04 §7). Nut 2026-10-03: unlock levels OK; changing a branch is allowed and
    // is a coin sink; the stage-3 cosmetic has an effect. Prices are Claude's proposal.
    rebirthVariantUnlockLevels: provisional(
      [20, 50, 100] as const,
      "P05",
      "Nut OK'd 2026-10-03: the R1/R2/R3 variant works once the companion fights at this level; before it the base skill is used",
    ),
    rebirthBranchChangeCoins: provisional(
      [50_000, 150_000, 400_000] as const,
      "P05",
      "coins to switch the branch of stage 1/2/3 at the town NPC (Nut: a coin sink, burn more); the same as that stage's Rebirth price",
    ),
    // Status numbers (O15 timing accepted from Claude's list 2026-10-04; numbers are Claude's proposal).
    statusTuning: provisional(
      {
        /** Each matching primary stat point adds this % resistance (VIT 50 = 10%). */
        resistPerStatPointPct: 0.2,
        /** Per stack, on patk/matk/pdef/mdef/spd; half for the side effects of burn and paralyze. */
        statModPct: 20,
        /** Total up/down on one stat stays within ±this %. */
        statModCapPct: 50,
        blindAccuracyPct: 30,
        evasionShiftPct: 15,
        accuracyShiftPct: 15,
        critShiftPct: 15,
        resShiftPct: 20,
        poisonPctMaxHp: 5,
        /** Nut 2026-10-04: poison takes the most HP; burn and bleed less, with stat downs instead. */
        burnPctMaxHp: 3,
        /** Up to 3 stacks, so at most 3%, still below poison. */
        bleedPctMaxHpPerStack: 1,
        /** Grows a stack each tick (max 4): 1, 2, 3, 4%. */
        toxicPctMaxHpPerStack: 1,
        frostbitePctMaxHp: 2,
        /** Frostbite at this many stacks turns into a 1-turn freeze. */
        frostbiteFreezeStacks: 3,
        corrodePctMaxHp: 1,
        /** Taken from the unit and given to whoever put it there. */
        leechPctMaxHp: 3,
        /** Shock: lost after each action the unit takes. */
        shockPctMaxHp: 3,
        manaBurnPctMaxMp: 10,
        regenPctMaxHp: 6,
        mpRegenPctMaxMp: 8,
        /** A boss never loses more than this % of max HP to one status tick. */
        bossDotMaxHpPctPerTick: 1,
        /** A paralyzed unit (SPD 0, Nut 2026-10-04) loses its turn on this roll. */
        paralyzeSkipChancePct: 25,
        fearSkipChancePct: 30,
        /** A confused unit's attack or damage skill goes to its own side on this roll (charm: always). */
        confuseRedirectChancePct: 50,
        vulnerablePct: 20,
        markPct: 15,
        dmgReductionPct: 20,
        elementWardPct: 30,
        antiHealPct: 50,
        mpCostUpPct: 50,
        /** A linked unit hit passes this % of the damage to every other linked unit on its side. */
        linkSharePct: 30,
        /** Reflect: magic damage taken; thorns: physical damage taken. Sent back to the attacker. */
        reflectPct: 30,
        thornsPct: 15,
        focusPct: 50,
        lifestealUpPct: 20,
        /** Oil + a fire hit: extra damage on that hit, then burn. */
        oilFireBonusPct: 30,
      } as const,
      "P04",
      "O15 parts: PROVISIONAL numbers; timing (own-turn durations, ticks at turn start, refresh, boss hard-control immunity) is the list Nut reviewed 2026-10-04",
    ),
    // Party (chapter 08 "Party", P02): bonus while partners hunt on the same map and channel.
    partyExpPercentPerMember: provisional(5, "P02", "per eligible additional member"),
    partyExpPercentCap: provisional(15, "P02"),
    partyMaterialDropPercentPerMember: provisional(2, "P02", "relative, ordinary materials only; never Sigils, capture or gear"),
    partyMaterialDropPercentCap: provisional(6, "P02"),
    partyActivityWindowMs: provisional(5 * 60_000, "P02", "a partner counts if they started a fight within this window (standing still does not count)"),
    autoBattleActionMs: provisional(700, "P01", "Auto Battle and Auto Hunt: one ally action per this many ms"),
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
    // Capture (capture.ts; CAPTURE_DESIGN_O07_V1, Nut chose this approach 2026-10-07). The approach is decided;
    // every number here is PROVISIONAL until playtest. First round only: standard items, mastery 1, no pity.
    captureProfile: provisional<CaptureProfile>(
      {
        version: "capture-v1",
        rankFactors: { NORMAL: 1, ELITE: 0.6, BOSS: 1 },
        rankBounds: { NORMAL: [0.05, 0.9], ELITE: [0.02, 0.6], BOSS: [0.01, 0.3] },
        hpFactor: [
          { maxHpRatio: 0.25, factor: 2 },
          { maxHpRatio: 0.5, factor: 1.5 },
          { maxHpRatio: 1, factor: 1 },
        ],
        statusFactors: { sleep: 1.25, freeze: 1.25, stun: 1.25, petrify: 1.25, paralyze: 1.15, root: 1.15, silence: 1.1 },
        qualityFactors: { "1": 1 },
        masteryFactor: 1,
        pity: false,
      },
      "P18",
      "decides O07: Nut 2026-10-07 chose CAPTURE_DESIGN_O07_V1 round one; numbers PROVISIONAL (playtest); higher item qualities and capture mastery are later work",
    ),
    // Refining (refine.ts; Nut's REFINEMENT_DESIGN v2.1). PROVISIONAL parts of that document.
    refineMaxLevel: provisional(10, "P07", "v2.1: the +10 cap is still a trial value"),
    refineSafeSuccessBp: provisional([9500, 9000, 8500, 8000, 7500] as const, "P07", "v2.1: targets +1..+5; a failure keeps the level"),
    refineFeeLv200: provisional(
      [1000, 2000, 4000, 7000, 12000, 20000, 35000, 55000, 85000, 130000] as const,
      "P07",
      "v2.1: coins per attempt at upgrade cost level 200, by target +1..+10; other levels scale by refineLevelFactor",
    ),
    refineStones: provisional([1, 1, 2, 2, 3, 4, 5, 6, 8, 10] as const, "P07", "v2.1: refine stones per attempt, by target +1..+10"),
    refineLevelFactor: provisional(
      { exponent: 1.5, floorPct: 3 } as const,
      "P07",
      "v2.1: fee = round10 half up (base × max(3%, (upgradeCostLevel/200)^1.5)); computed in integers (refine.ts)",
    ),
    refineStoneTiers: provisional(
      [
        [1, 49],
        [50, 99],
        [100, 149],
        [150, 200],
      ] as const,
      "P07",
      "v2.1: stone and ward tiers by upgrade cost level (basic / fused / dense / star)",
    ),
    refineStatPctPerLevel: provisional(3, "P07", "v2.1: +3% of each refinable base stat per level, not compounded (+30% at +10)"),
    refineWardCraft: provisional(
      [
        { target: 6, coinsLv200: 50_000, common: 20, rare: 2, core: 0 },
        { target: 7, coinsLv200: 100_000, common: 35, rare: 4, core: 1 },
        { target: 8, coinsLv200: 200_000, common: 60, rare: 8, core: 2 },
        { target: 9, coinsLv200: 400_000, common: 100, rare: 16, core: 4 },
        { target: 10, coinsLv200: 800_000, common: 160, rare: 32, core: 8 },
      ] as const,
      "P07",
      "v2.1: ward recipe per target; coins use the tier's top level (49/99/149/200) in the fee formula",
    ),
    refineWardConsumedOnSuccess: provisional(true, "P07", "v2.1 proposal: a ward is used up whether the attempt succeeds or fails"),
    flee: provisional<FleeProfile>(
      { rankDefaultPct: { NORMAL: 60, ELITE: 40, BOSS: 0 }, minPct: 5, maxPct: 95 },
      "P19",
      "decides O15 flee: chance = clamp(lowest flee value among living enemies × player SPD / fastest enemy SPD, 5%, 95%); bosses 0 = cannot flee; Claude's numbers",
    ),
  },
  // Nut answered the last OPEN rules on 2026-10-07. A new OPEN rule goes here as open<T>(...) with value null.
  unresolved: {} as Readonly<Record<string, Rule<null>>>,
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
