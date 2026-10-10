import type { PartyBonus } from "../party";
import type { OriginMode, LootLine } from "../loot";
import type { CaptureProfile, Rank } from "../rules";
import type { RngState } from "../rng";
import type { Element, MonsterInstance, PassiveEvent, PrimaryStats } from "../schemas";
import type { DamageBreakdown } from "../damage";
import type { DerivedStats, GearBonuses } from "../stats";
import type { ErrorCode } from "../validators";
import type { ActiveStatus, StatusId } from "../status";
import type { EliteModifier } from "../elite";
import type { FrontierModifierId } from "../frontier";

export type Side = "ally" | "enemy";
export type Row = "front" | "back";
export type Range = "melee" | "ranged";

export interface BattleUnit {
  unitId: string;
  side: Side;
  kind: "player" | "companion" | "enemy";
  /** Party boss fights: the account that commands this ally. Absent = the fight's owner. */
  controllerId?: string;
  name: string;
  speciesId: string | null;
  /** MonsterInstance id for companions; null for player and wild enemies. */
  instanceId: string | null;
  /** The level this unit fights at (a companion's effective level, O02). */
  level: number;
  /** Companions only: the real level, for EXP (it can be above `level`). */
  actualLevel?: number;
  element: Element;
  rank: Rank | null;
  row: Row;
  slot: number;
  stats: DerivedStats;
  hp: number;
  mp: number;
  /** Active skills this unit may use. */
  skillIds: string[];
  /** Companions only: the level each skill works at in this fight (trained, capped by `level`). Missing = 1. */
  skillLevels?: Record<string, number>;
  /** Companions only: the Bond % already applied to `stats` (shown in the UI). */
  bondPercent?: number;
  /** Companions only: the Bond tier at fight start (secret quest `bond_tier` condition). */
  bondTier?: number;
  /** Companions only: the stage-3 Rebirth look, drawn by the client (Nut 2026-10-03: with an effect). */
  cosmetic?: { effect: string; color: string };
  /** Companions only: knocked out at some point in this fight (Bond goes down, Nut 2026-10-03). */
  fell?: boolean;
  basicAttackRange: Range;
  /** The primary stats behind `stats`; some resist statuses (O15, Nut 2026-10-04). Absent on older states. */
  primaryStats?: PrimaryStats;
  /** Statuses on this unit now (status.ts). Absent on older states = none. */
  statuses?: ActiveStatus[];
  /** The last skill this unit used in this fight (skill lock takes it). */
  lastSkillId?: string;
  /** Passive skills with effects this unit fights with (the companion's innate, a wild monster's innate). */
  passiveIds?: string[];
  /** Sigils the player wears: id → installed copies (their effects, chapter 05 §4–§5). */
  sigils?: Record<string, number>;
  /**
   * Elite leaders only (elite.ts): their modifiers, whether enrage has fired, whether morale broke,
   * and who a warned magic counter will hit on its next action.
   */
  elite?: { modifiers: EliteModifier[]; enraged: boolean; moraleBroken: boolean; counterOn: string | null };
  /** Wild bosses with more than one action per round (chapter 03); absent means 1. */
  actionsPerRound?: number;
  /** Once-per-battle passives already used ("skillId#trigger index"). */
  passivesUsed?: string[];
  ko: boolean;
  /** The round this unit fell in (0 = it started the fight down). Revive works from the next round (O15). */
  downRound?: number;
  /** Captured enemies leave the fight without kill loot. */
  retired: boolean;
  /** Tower floors: a fallen or captured enemy whose cell a reinforcement took (the unit that came in). */
  replacedBy?: string;
  /** Boss fights: a part of the boss (never acts, no EXP/loot, falls with the boss). */
  part?: { partId: string; effect: "armor" | "regen"; pct: number };
  /** Boss fights: a minion the boss called in mid-fight (no EXP/loot, falls with the boss). */
  summoned?: boolean;
  guarding: boolean;
  cooldowns: Record<string, number>;
  movedThisRound: boolean;
  /** Enemies only. Normal/Elite default open; bosses need an explicit window (C08 + chapter 04 §3). */
  captureWindowOpen: boolean;
  lootTableId: string | null;
}

export type BattleStatus = "active" | "victory" | "defeat" | "fled";

/**
 * What one fight owes the economy. In a party boss fight every member gets their own copy of each
 * enemy's reward (own loot roll, own companions' EXP) under the same id with `recipientId` set;
 * absent = the fight's owner.
 */
export type Entitlement = (
  | {
      entitlementId: string;
      kind: "kill";
      enemyUnitId: string;
      speciesId: string;
      originMode: OriginMode;
      /** Rolled once by the server and persisted before delivery; retries never re-roll. */
      items: LootLine[];
      /** EXP for the character. Absent on older entitlements = 0. */
      exp?: number;
      /** EXP per companion instance that started the fight, scaled by its level then (companionExp). */
      companionExp?: Record<string, number>;
    }
  | {
      entitlementId: string;
      kind: "capture";
      enemyUnitId: string;
      speciesId: string;
      element: Element;
      /** Always the confirmed initial level (C09). */
      level: number;
      /** A capture gives the same EXP as a kill, without kill loot (chapter 04 §3 proposal). */
      exp?: number;
      companionExp?: Record<string, number>;
    }
  | {
      /** `${battleId}:all:result` — one per ended fight that changes a companion (chapter 04 §5–§6). */
      entitlementId: string;
      kind: "fight_result";
      /** Per companion instance that started the fight: Bond change (negative after a fall) and mastery gained. */
      companions: Record<string, { bond: number; mastery: number }>;
      /** No EXP here: it came with each enemy's own entitlement. */
      exp?: undefined;
      companionExp?: undefined;
    }
) & { recipientId?: string };

/** Party boss fights (Nut 2026-10-07): a member other than the owner, with their own combat bag. */
export interface PartyMemberState {
  accountId: string;
  playerUnitId: string;
  bag: Record<string, number>;
  consumed: Record<string, number>;
}

export interface BossState {
  bossId: string;
  unitId: string;
  /** Index into the definition's phases. */
  phase: number;
  /** Set once a shield on the boss is broken by damage (a `shield_broken` phase trigger). */
  shieldBroken: boolean;
  /** An announced heavy move: used on the boss's first action in `firesRound`. */
  telegraph: { skillId: string; firesRound: number } | null;
  /** Round of the last announcement, for `everyRounds`. */
  lastTelegraphRound: number;
  /** Parts broken so far (`part_broken` triggers). */
  partsBroken?: string[];
  /** Minions called in so far this fight, and the round of the last call. */
  summoned?: number;
  lastSummonRound?: number;
}

export interface BattleState {
  battleId: string;
  rulesVersion: string;
  /** Fixed at encounter start; toggling Auto later never changes reward mode (chapter 11 §5). */
  originMode: OriginMode;
  /** Training ground (P17): nothing earned or lost (BattleSetup.practice). */
  practice?: boolean;
  /** Class2 trial (BattleSetup.classTrial): the enemy stat % that summons also get. */
  enemyStatPct?: number;
  ownerAccountId: string;
  stateVersion: number;
  round: number;
  turnOrder: string[];
  turnIndex: number;
  units: BattleUnit[];
  /** Reserved combat bag: itemId -> remaining quantity. In a party fight, the owner's bag. */
  bag: Record<string, number>;
  consumed: Record<string, number>;
  /** Party boss fights: the other members (up to partyMaxMembers − 1), each with their own bag. */
  members?: PartyMemberState[];
  /** Free companion-box places per account, counted at fight start and used by captures (P26). Absent = no limit. */
  companionRoom?: Record<string, number>;
  /** Party bonus locked at fight start (P02). Absent on older states = none. */
  partyBonus?: PartyBonus;
  /** The map the fight started on (field packs and boss lairs); absent for tower floors and dev fights. */
  mapId?: string;
  /** Boss fights only: phase, telegraph and capture progress (chapter 07 §5). */
  boss?: BossState;
  /** Weekly tower floors only (frontier.ts): the floor, the stat % its enemies carry, its gimmicks and reinforcements. */
  frontier?: {
    floor: number;
    statPct: number;
    modifiers?: FrontierModifierId[];
    /** Reinforcements still to come (the queue itself stays on the server: `queue`). */
    reinforcementsLeft?: number;
    /** Server only (stripped by publicView): the pre-rolled replacements in arrival order. */
    queue?: { speciesId: string; element: Element }[];
    /** Server only: the number for the next reinforcement's unit id (e<n>). */
    nextUnit?: number;
  };
  /** The capture rules this fight started with (capture.ts); absent on states from before pinning = current profile. */
  captureProfile?: CaptureProfile;
  /** Private server RNG state. Never sent to the client. */
  rng: RngState;
  eventSeq: number;
  status: BattleStatus;
  resolutions: Record<string, "defeated" | "captured">;
  entitlements: Entitlement[];
}

// ---------------------------------------------------------------- commands

export type BattleCommand =
  | { type: "attack"; actorId: string; targetId: string }
  | { type: "skill"; actorId: string; skillId: string; targetId: string }
  | { type: "guard"; actorId: string }
  | { type: "item"; actorId: string; itemId: string; targetId: string }
  | { type: "capture"; actorId: string; targetId: string; itemId: string }
  | { type: "move"; actorId: string; row: Row; slot: number }
  | { type: "flee"; actorId: string };

export type CommandSource = "player" | "auto";

// ---------------------------------------------------------------- events

interface EventBase {
  eventId: string;
  seq: number;
  causeId: string | null;
}

export type BattleEventBody =
  | { type: "BattleStarted"; originMode: OriginMode; rulesVersion: string; unitIds: string[] }
  | { type: "RoundStarted"; round: number; order: string[] }
  | { type: "BossPhaseChanged"; unitId: string; phase: number; phaseId: string }
  /** A boss part was broken: its effect on the boss ends. */
  | { type: "BossPartBroken"; unitId: string; partId: string }
  /** The boss called minions into free cells; `left` more may come this fight. */
  | { type: "BossSummoned"; unitIds: string[]; left: number }
  /** announced at a round's start, fired on the boss's first action of `firesRound`, or cancelled (phase change, silence, KO). */
  | { type: "BossTelegraph"; unitId: string; skillId: string; change: "announced" | "fired" | "cancelled"; firesRound: number }
  | { type: "CaptureWindowOpened"; unitId: string }
  /** An elite modifier showed itself: in play at the start, enrage, morale broken, counter warned / fired / called off. */
  | { type: "EliteTrait"; unitId: string; modifier: EliteModifier; change: "active" | "enraged" | "broken" | "warned" | "fired" | "cancelled"; targetId: string | null }
  /** `action`/`actionsThisRound` only for a unit with more than one action this round (bosses). */
  | { type: "TurnStarted"; unitId: string; guardEnded: boolean; action?: number; actionsThisRound?: number }
  | {
      type: "ActionResolved";
      actorId: string;
      action: BattleCommand["type"];
      targetId: string | null;
      skillId: string | null;
      hit: boolean | null;
      crit: boolean | null;
      damage: number | null;
      heal: number | null;
      breakdown: DamageBreakdown | null;
      targetHpAfter: number | null;
    }
  | { type: "ItemConsumed"; itemId: string; remaining: number }
  | { type: "UnitKnockedOut"; unitId: string }
  /** A side effect of an action on its user or target (lifesteal, recoil, MP restore). */
  | { type: "ResourceChanged"; unitId: string; source: "lifesteal" | "recoil" | "restore_mp" | "leech" | "mana_burn" | "mp_regen" | "passive" | "boss_part"; hp: number; mp: number; hpAfter: number; mpAfter: number }
  /** A status landed, was refreshed, missed its roll, met immunity, ran out or was ended early. */
  | {
      type: "StatusChanged";
      unitId: string;
      statusId: StatusId;
      sourceId: string | null;
      change: "applied" | "refreshed" | "resisted" | "immune" | "blocked" | "expired" | "removed";
      turnsLeft: number;
      stacks: number;
      /** The final chance (0–100) for a roll; null when nothing was rolled. */
      chancePct: number | null;
    }
  /** Damage (+) or healing (−) over time at the start of the unit's turn. */
  | { type: "StatusTick"; unitId: string; statusId: StatusId; hp: number; hpAfter: number }
  /** Confuse or charm sent an attack to the actor's own side. */
  | { type: "ActionRedirected"; actorId: string; statusId: StatusId; fromId: string; toId: string }
  /** A passive or innate of this unit fired (catalog §4); its effects follow as their own events. */
  /** `sourceId`: the passive skill or the Sigil whose effect fired. */
  | { type: "PassiveTriggered"; unitId: string; sourceId: string; on: PassiveEvent }
  /** A shield was put on, soaked part of a hit, or broke (Nut 2026-10-04: after damage reduction). */
  | { type: "ShieldChanged"; unitId: string; change: "gained" | "absorbed" | "broken"; amount: number; shieldLeft: number }
  /** The unit loses this turn to a control status. */
  | { type: "TurnSkipped"; unitId: string; statusId: StatusId }
  | { type: "EnemyDefeated"; unitId: string; speciesId: string }
  /** Tower floors: a pre-rolled replacement entered a fallen enemy's cell (frontier.ts). */
  | { type: "ReinforcementArrived"; unitId: string; speciesId: string; element: Element; row: Row; slot: number; replaces: string; left: number }
  /** A flee try (O15): the chance in % it was rolled at. */
  | { type: "FleeResolved"; actorId: string; success: boolean; chancePct: number }
  /** A fallen ally is back (O15); it acts again from the next round. `sourceId`: the skill or item. */
  | { type: "UnitRevived"; unitId: string; byId: string; sourceId: string; hp: number }
  | { type: "CaptureResolved"; targetId: string; speciesId: string; success: boolean; probability: number; profileVersion: string }
  | { type: "RewardEntitled"; entitlement: Entitlement }
  | {
      type: "BattleEnded";
      outcome: Exclude<BattleStatus, "active">;
      /** maxHp/maxMp: the unit's own maxima in this fight (absent on older events). */
      allies: { unitId: string; instanceId: string | null; hp: number; mp: number; ko: boolean; maxHp?: number; maxMp?: number }[];
      consumed: Record<string, number>;
      unusedReserved: Record<string, number>;
      /** Party boss fights: each other member's bag result (the fields above are the owner's). */
      members?: Record<string, { consumed: Record<string, number>; unusedReserved: Record<string, number> }>;
    };

export type BattleEvent = EventBase & BattleEventBody;

// ---------------------------------------------------------------- setup

export interface Position {
  row: Row;
  slot: number;
}

export type PlayerSetup = BattleSetup["player"];
export type CompanionSetup = BattleSetup["companions"][number];

/** A party boss fight member besides the owner (Nut 2026-10-07: 1 companion each, 5 players = 10 places). */
export interface PartyMemberSetup {
  player: PlayerSetup;
  companions: CompanionSetup[];
  bag: Record<string, number>;
}

export interface BattleSetup {
  battleId: string;
  originMode: OriginMode;
  /** Server-only seed. */
  seed: string;
  /** Party boss fights only: the other members. Allies then use partyBossRowSlots cells per row. */
  partyMembers?: PartyMemberSetup[];
  player: Position & {
    accountId: string;
    name: string;
    level: number;
    element: Element;
    primaryStats: PrimaryStats;
    gear?: GearBonuses;
    /** HP/MP carry over between fights (chapter 03 §3). Defaults to max. */
    hp?: number;
    mp?: number;
    skillIds: string[];
    /** Learned levels of the skill tree (skill-tree.ts); a skill missing here is Lv1. */
    skillLevels?: Record<string, number>;
    /** Class and race passives (player-kit.ts). */
    passiveIds?: string[];
    basicAttackRange: Range;
    /** Every Sigil installed in the worn gear, one entry per copy. */
    sigilIds?: string[];
    /** Free places in the character's companion box when the fight starts (P26); omitted = no limit. */
    companionRoom?: number;
  };
  companions: (Position & { instance: MonsterInstance; hp?: number; mp?: number })[];
  enemies: (Position & {
    unitId: string;
    speciesId: string;
    element: Element;
    captureWindowOpen?: boolean;
    lootEligible?: boolean;
    elite?: { modifiers: EliteModifier[] };
    /** Boss parts only (bossEnemies builds them from the boss definition). */
    part?: { partId: string; name: string; effect: "armor" | "regen"; pct: number; hpPct: number };
  })[];
  /**
   * A practice fight at the town training ground (P17): nothing is earned or lost. No EXP, loot,
   * capture, Bond or mastery; HP/MP and items are not touched (the bag is empty).
   */
  practice?: boolean;
  /**
   * The Class2 trial (class-change.ts): a practice boss fight where the boss and everything it calls
   * get the rules' trial stat % (P28). Needs `practice` and `boss`.
   */
  classTrial?: boolean;
  /** 3 for the Class3 trial (its own stat %, P28); a Class2 trial leaves it out. */
  classTrialTier?: 3;
  bag: Record<string, number>;
  /** Counted by the server when the fight starts (P02); never from the client. */
  partyBonus?: PartyBonus;
  /** The map the fight starts on (set by the Map Channel DO; secret quest map goals). */
  mapId?: string;
  /** A boss fight (chapter 07 §5): the kernel builds the boss and its adds; `enemies` must be empty. */
  boss?: { bossId: string };
  /**
   * A weekly tower floor (frontier.ts): every enemy gets the floor's stat % on HP and ATK/MATK, worked
   * out here from the rules (never a number from outside). Wild level stays the species' own (C29).
   */
  frontier?: {
    floor: number;
    /** The floor's gimmicks (content ids; their numbers come from the rules). */
    modifiers?: FrontierModifierId[];
    /** Boss floors: monsters that fill the free cells next to the guardian and its adds. */
    escorts?: { speciesId: string; element: Element }[];
    /** The finite, pre-rolled replacement queue (frontier.ts), in arrival order. */
    reinforcements?: { speciesId: string; element: Element }[];
  };
}

export type KernelResult =
  | { ok: true; state: BattleState; events: BattleEvent[] }
  | { ok: false; code: ErrorCode; message: string };
