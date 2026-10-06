/**
 * Secret quest progress from fights (secret-quests.ts; Nut 2026-10-05/06: very hard quests).
 *
 * - When a fight ends the server reduces it to `SecretFightFacts` (what happened, nothing the client
 *   said) and credits each quest of the character's set with `secretQuestCredit`.
 * - Only won fights count, and a fight counts only when every condition the quest carries holds for
 *   the whole fight (its rolled `condition` plus every `require`). Losing, or breaking one condition,
 *   gives nothing for that quest, even for enemies already defeated.
 * - Fight goals: defeat, capture, boss, win, elite_capture, tower. `explore` counts a visit (walking
 *   into the map through a portal, at most one per map per `visitWindowMinutes`); `deliver` counts
 *   materials handed in at a town. Neither comes from a fight.
 * - A finished quest is claimed once; its rewards are this character's own (variant id).
 * - Progress counts only once the set is revealed (the awakening quest; not built). The server keeps
 *   that rule (economy.ts); this module only answers "how much does this fight add".
 */
import { z } from "zod";
import type { BattleState } from "./battle/types";
import { OperationIdSchema } from "./character";
import type { RulesConfig } from "./rules";
import type { Element, SpeciesDefinition } from "./schemas";
import type { SecretQuest, SecretQuestCondition, SecretQuestReward } from "./secret-quests";

/** One fight, as secret quests see it. Built by the server from the final battle state. */
export interface SecretFightFacts {
  won: boolean;
  /** The map the fight started on (absent: tower floors, dev fights). */
  mapId?: string;
  /** The round the fight ended in. */
  round: number;
  /** Companions that started the fight. */
  companions: { element: Element; bondTier: number }[];
  /** The character's HP at the end, in % of its max (floored). */
  characterHpPct: number;
  /** Items used from the bag, capture devices left out (capturing is the goal of capture quests). */
  itemsUsed: number;
  /** The character or any companion was knocked out at some point. */
  knockedOut: boolean;
  /** Enemies defeated (not captured). */
  defeated: { speciesId: string; element: Element }[];
  /** Enemies captured; `elite` marks an elite-pack leader. */
  captured: { speciesId: string; element: Element; elite: boolean }[];
  /** Boss fights: the boss species. */
  bossSpeciesId?: string;
  /** Tower floors: the floor fought. */
  towerFloor?: number;
}

/**
 * Reduce a finished fight to its facts. `isCaptureItem` tells capture devices apart (they never break
 * `no_items`). Server only: it reads the full state.
 */
export function secretFightFacts(state: BattleState, isCaptureItem: (itemId: string) => boolean): SecretFightFacts {
  const player = state.units.find((u) => u.kind === "player");
  const companions = state.units.filter((u) => u.kind === "companion");
  const enemies = state.units.filter((u) => u.side === "enemy");
  const boss = state.boss === undefined ? undefined : state.units.find((u) => u.unitId === state.boss!.unitId);
  const out: SecretFightFacts = {
    won: state.status === "victory",
    round: state.round,
    companions: companions.map((c) => ({ element: c.element, bondTier: c.bondTier ?? 0 })),
    characterHpPct: player === undefined || player.stats.maxHp <= 0 ? 0 : Math.floor((player.hp * 100) / player.stats.maxHp),
    itemsUsed: Object.entries(state.consumed)
      .filter(([id]) => !isCaptureItem(id))
      .reduce((n, [, q]) => n + q, 0),
    knockedOut: (player?.ko ?? false) || companions.some((c) => c.ko || c.fell === true),
    defeated: enemies.filter((u) => state.resolutions[u.unitId] === "defeated" && u.speciesId !== null).map((u) => ({ speciesId: u.speciesId!, element: u.element })),
    captured: enemies
      .filter((u) => state.resolutions[u.unitId] === "captured" && u.speciesId !== null)
      .map((u) => ({ speciesId: u.speciesId!, element: u.element, elite: u.elite !== undefined })),
  };
  if (state.mapId !== undefined) out.mapId = state.mapId;
  if (boss?.speciesId != null) out.bossSpeciesId = boss.speciesId;
  if (state.frontier !== undefined) out.towerFloor = state.frontier.floor;
  return out;
}

/** Every condition a quest carries: the rolled one and the v3 `require` list. */
export function secretQuestConditions(q: SecretQuest): SecretQuestCondition[] {
  return [...new Set([...(q.params.condition !== undefined ? [q.params.condition] : []), ...(q.params.require ?? [])])];
}

/** Whether one condition held for the whole fight. */
export function secretConditionHolds(rules: RulesConfig, q: SecretQuest, c: SecretQuestCondition, f: SecretFightFacts): boolean {
  switch (c) {
    case "solo":
      return f.companions.length === 0;
    case "no_items":
      return f.itemsUsed === 0;
    case "full_team":
      return f.companions.length >= rules.confirmed.maxCompanions.value;
    case "mono_element_team": {
      if (f.companions.length === 0) return false;
      const el = q.params.element ?? f.companions[0]!.element;
      return f.companions.every((x) => x.element === el);
    }
    case "no_knockout":
      return !f.knockedOut;
    case "within_rounds":
      return q.params.rounds !== undefined && f.round <= q.params.rounds;
    case "low_hp_finish":
      return q.params.hpBelowPct !== undefined && f.characterHpPct > 0 && f.characterHpPct < q.params.hpBelowPct;
    case "bond_tier":
      return q.params.bondTier !== undefined && f.companions.some((x) => x.bondTier >= q.params.bondTier!);
  }
}

const matches = (q: SecretQuest, u: { speciesId: string; element: Element }) =>
  (q.params.speciesId === undefined || u.speciesId === q.params.speciesId) && (q.params.element === undefined || u.element === q.params.element);

/**
 * How much this fight adds to the quest (0 when it does not count). Never more than what is left:
 * the caller passes the progress so far.
 */
export function secretQuestCredit(rules: RulesConfig, q: SecretQuest, f: SecretFightFacts, progress = 0): number {
  if (!f.won || progress >= q.params.count) return 0;
  if (!secretQuestConditions(q).every((c) => secretConditionHolds(rules, q, c, f))) return 0;
  let n = 0;
  switch (q.goal) {
    case "defeat":
      n = f.defeated.filter((u) => matches(q, u)).length;
      break;
    case "capture":
      n = f.captured.filter((u) => matches(q, u)).length;
      break;
    case "elite_capture":
      n = f.captured.filter((u) => u.elite && matches(q, u)).length;
      break;
    case "boss":
      n = f.bossSpeciesId !== undefined && f.bossSpeciesId === q.params.speciesId ? 1 : 0;
      break;
    case "win":
      n = q.params.mapId === undefined || f.mapId === q.params.mapId ? 1 : 0;
      break;
    case "tower":
      // Clearing floor `floor` (or any floor above it) under the conditions finishes it.
      n = f.towerFloor !== undefined && q.params.floor !== undefined && f.towerFloor >= q.params.floor ? q.params.count : 0;
      break;
    case "explore":
    case "deliver":
      n = 0;
      break;
  }
  return Math.max(0, Math.min(n, q.params.count - progress));
}

// ---------------------------------------------------------------- visits, hand-ins, claims

/** Window id for a visit: one visit per map counts per window (rules.provisional.secretQuestVisitWindowMinutes). */
export function secretVisitWindow(rules: RulesConfig, at: string): string {
  const ms = rules.provisional.secretQuestVisitWindowMinutes.value * 60_000;
  return String(Math.floor(Date.parse(at) / ms));
}

/** Explore quests a walk into `mapId` adds one to (never past the count). */
export function secretVisitCredit(q: SecretQuest, mapId: string, progress = 0): number {
  return q.goal === "explore" && q.params.mapId === mapId && progress < q.params.count ? 1 : 0;
}

const SecretQuestIdSchema = z.string().regex(/^sq:(element|race|personal):[a-z0-9_]+$/);

/** Hand in materials for a `deliver` quest (in a town; never more than the quest still needs). */
export const SecretDeliverRequestSchema = z.object({ operationId: OperationIdSchema, questId: SecretQuestIdSchema, quantity: z.number().int().min(1).max(9999) }).strict();
export type SecretDeliverRequest = z.infer<typeof SecretDeliverRequestSchema>;

/** Claim a finished quest's rewards (once per quest per character). */
export const SecretClaimRequestSchema = z.object({ questId: SecretQuestIdSchema }).strict();
export type SecretClaimRequest = z.infer<typeof SecretClaimRequestSchema>;

/** A secret title's id: the reward plus the character's variant, so it is theirs alone. */
export function secretTitleId(r: Pick<SecretQuestReward, "rewardId" | "variantId">): string {
  return `title:${r.rewardId.slice("srw:".length)}_${r.variantId}`;
}

/** The reward id behind a secret title id, or null for any other title. */
export function secretTitleRewardId(titleId: string): string | null {
  const m = /^title:([a-z0-9_]+)_(v[0-9a-f]{8})$/.exec(titleId);
  return m === null ? null : `srw:${m[1]}`;
}

/** A reward companion's element: one its species allows, picked by the variant (so it is fixed). */
export function secretCompanionElement(species: Pick<SpeciesDefinition, "allowedElements">, variantId: string): Element {
  const list = [...species.allowedElements].sort();
  return list[Number.parseInt(variantId.slice(1), 16) % list.length]!;
}
