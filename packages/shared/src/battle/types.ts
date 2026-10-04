import type { PartyBonus } from "../party";
import type { OriginMode, LootLine } from "../loot";
import type { Rank } from "../rules";
import type { RngState } from "../rng";
import type { Element, MonsterInstance, PassiveEvent, PrimaryStats } from "../schemas";
import type { DamageBreakdown } from "../damage";
import type { DerivedStats, GearBonuses } from "../stats";
import type { ErrorCode } from "../validators";
import type { ActiveStatus, StatusId } from "../status";

export type Side = "ally" | "enemy";
export type Row = "front" | "back";
export type Range = "melee" | "ranged";

export interface BattleUnit {
  unitId: string;
  side: Side;
  kind: "player" | "companion" | "enemy";
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
  /** Wild bosses with more than one action per round (chapter 03); absent means 1. */
  actionsPerRound?: number;
  /** Once-per-battle passives already used ("skillId#trigger index"). */
  passivesUsed?: string[];
  ko: boolean;
  /** Captured enemies leave the fight without kill loot. */
  retired: boolean;
  guarding: boolean;
  cooldowns: Record<string, number>;
  movedThisRound: boolean;
  /** Enemies only. Normal/Elite default open; bosses need an explicit window (C08 + chapter 04 §3). */
  captureWindowOpen: boolean;
  lootTableId: string | null;
}

export type BattleStatus = "active" | "victory" | "defeat" | "fled";

export type Entitlement =
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
    };

export interface BattleState {
  battleId: string;
  rulesVersion: string;
  /** Fixed at encounter start; toggling Auto later never changes reward mode (chapter 11 §5). */
  originMode: OriginMode;
  ownerAccountId: string;
  stateVersion: number;
  round: number;
  turnOrder: string[];
  turnIndex: number;
  units: BattleUnit[];
  /** Reserved combat bag: itemId -> remaining quantity. */
  bag: Record<string, number>;
  consumed: Record<string, number>;
  /** Party bonus locked at fight start (P02). Absent on older states = none. */
  partyBonus?: PartyBonus;
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
  | { type: "ResourceChanged"; unitId: string; source: "lifesteal" | "recoil" | "restore_mp" | "leech" | "mana_burn" | "mp_regen" | "passive"; hp: number; mp: number; hpAfter: number; mpAfter: number }
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
  | { type: "CaptureResolved"; targetId: string; speciesId: string; success: boolean; probability: number }
  | { type: "RewardEntitled"; entitlement: Entitlement }
  | {
      type: "BattleEnded";
      outcome: Exclude<BattleStatus, "active">;
      allies: { unitId: string; instanceId: string | null; hp: number; mp: number; ko: boolean }[];
      consumed: Record<string, number>;
      unusedReserved: Record<string, number>;
    };

export type BattleEvent = EventBase & BattleEventBody;

// ---------------------------------------------------------------- setup

export interface Position {
  row: Row;
  slot: number;
}

export interface BattleSetup {
  battleId: string;
  originMode: OriginMode;
  /** Server-only seed. */
  seed: string;
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
    basicAttackRange: Range;
    /** Every Sigil installed in the worn gear, one entry per copy. */
    sigilIds?: string[];
  };
  companions: (Position & { instance: MonsterInstance; hp?: number; mp?: number })[];
  enemies: (Position & { unitId: string; speciesId: string; element: Element; captureWindowOpen?: boolean })[];
  bag: Record<string, number>;
  /** Counted by the server when the fight starts (P02); never from the client. */
  partyBonus?: PartyBonus;
}

export type KernelResult =
  | { ok: true; state: BattleState; events: BattleEvent[] }
  | { ok: false; code: ErrorCode; message: string };
