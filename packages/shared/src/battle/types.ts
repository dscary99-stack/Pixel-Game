import type { OriginMode, LootLine } from "../loot";
import type { Rank } from "../rules";
import type { RngState } from "../rng";
import type { Element, MonsterInstance, PrimaryStats } from "../schemas";
import type { DamageBreakdown } from "../damage";
import type { DerivedStats, GearBonuses } from "../stats";
import type { ErrorCode } from "../validators";

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
  level: number;
  element: Element;
  rank: Rank | null;
  row: Row;
  slot: number;
  stats: DerivedStats;
  hp: number;
  mp: number;
  /** Active skills this unit may use. */
  skillIds: string[];
  basicAttackRange: Range;
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
    }
  | {
      entitlementId: string;
      kind: "capture";
      enemyUnitId: string;
      speciesId: string;
      element: Element;
      /** Always the confirmed initial level (C09). */
      level: number;
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
  | { type: "TurnStarted"; unitId: string; guardEnded: boolean }
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
  };
  companions: (Position & { instance: MonsterInstance; hp?: number; mp?: number })[];
  enemies: (Position & { unitId: string; speciesId: string; element: Element; captureWindowOpen?: boolean })[];
  bag: Record<string, number>;
}

export type KernelResult =
  | { ok: true; state: BattleState; events: BattleEvent[] }
  | { ok: false; code: ErrorCode; message: string };
