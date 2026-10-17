/**
 * Flee and revive checks (O15, Nut 2026-10-07). Pure: the kernel runs them before anything is spent or
 * rolled, and the client calls the same functions to show the chance or why a command cannot be used.
 *
 * Flee: chance = clamp(lowest flee value among living enemies × player SPD / fastest living enemy SPD,
 * min, max). A monster's flee value is its species' `fleeBasePct`, else the rank default (P19); an Elite
 * unit is never above the ELITE default; a boss is 0. Any 0 means the fight cannot be fled.
 *
 * Revive: a fallen ally can come back from the round after it fell ("down 1 turn"), with the HP % of the
 * skill or item; no limit per fight.
 */
import type { RulesConfig } from "./rules";
import type { SpeciesDefinition } from "./schemas";
import { statsWithStatuses } from "./status";
import type { BattleState, BattleUnit } from "./battle/types";

export interface FleeChance {
  ok: true;
  /** Lowest flee value among living enemies, and whose it is. */
  basePct: number;
  baseUnitId: string;
  playerSpd: number;
  enemySpd: number;
  /** Before the bounds. */
  rawPct: number;
  /** What the server rolls against, in % (not rounded). */
  chancePct: number;
  capped: "min" | "max" | null;
}

export interface FleeRefused {
  ok: false;
  code: "FLEE_FORBIDDEN" | "INVALID_COMMAND";
  message: string;
}

/** One enemy's flee value. */
export function unitFleeBasePct(rules: RulesConfig, species: Pick<SpeciesDefinition, "rank" | "fleeBasePct"> | undefined, unit: Pick<BattleUnit, "rank">): number {
  const d = rules.provisional.flee.value.rankDefaultPct;
  const rank = unit.rank ?? species?.rank ?? "NORMAL";
  if (rank === "BOSS" || species?.rank === "BOSS") return 0;
  const own = species?.fleeBasePct ?? d[species?.rank ?? "NORMAL"];
  return rank === "ELITE" ? Math.min(own, d.ELITE) : own;
}

export function fleeChance(
  rules: RulesConfig,
  species: ReadonlyMap<string, Pick<SpeciesDefinition, "rank" | "fleeBasePct">>,
  state: Pick<BattleState, "units" | "boss">,
  actorId: string,
): FleeChance | FleeRefused {
  const actor = state.units.find((u) => u.unitId === actorId);
  if (actor === undefined || actor.kind !== "player") return { ok: false, code: "INVALID_COMMAND", message: "only the player can flee" };
  if (state.boss !== undefined) return { ok: false, code: "FLEE_FORBIDDEN", message: "there is no fleeing from a boss" };
  const foes = state.units.filter((u) => u.side === "enemy" && !u.ko && !u.retired);
  if (foes.length === 0) return { ok: false, code: "INVALID_COMMAND", message: "no enemy left" };
  let base = Infinity;
  let baseUnitId = foes[0]!.unitId;
  let enemySpd = 0;
  for (const u of foes) {
    const b = unitFleeBasePct(rules, u.speciesId === null ? undefined : species.get(u.speciesId), u);
    if (b < base) {
      base = b;
      baseUnitId = u.unitId;
    }
    enemySpd = Math.max(enemySpd, statsWithStatuses(rules, u.stats, u.statuses).spd);
  }
  if (base <= 0) return { ok: false, code: "FLEE_FORBIDDEN", message: `${baseUnitId} cannot be fled from` };
  const { minPct, maxPct } = rules.provisional.flee.value;
  const playerSpd = statsWithStatuses(rules, actor.stats, actor.statuses).spd;
  const rawPct = enemySpd <= 0 ? maxPct : (base * playerSpd) / enemySpd;
  const chancePct = Math.min(maxPct, Math.max(minPct, rawPct));
  return { ok: true, basePct: base, baseUnitId, playerSpd, enemySpd, rawPct, chancePct, capped: rawPct < minPct ? "min" : rawPct > maxPct ? "max" : null };
}

/** Whether a fallen ally can be revived now; null when it can, else why not. */
export function reviveBlock(rules: RulesConfig, state: Pick<BattleState, "round">, source: Pick<BattleUnit, "side">, target: Pick<BattleUnit, "side" | "ko" | "retired" | "downRound">): { code: "INVALID_TARGET" | "REVIVE_NOT_READY"; message: string } | null {
  if (target.side !== source.side || !target.ko || target.retired) return { code: "INVALID_TARGET", message: "revive needs a fallen ally" };
  const wait = rules.confirmed.reviveAfterDownRounds.value;
  const down = target.downRound ?? 0;
  if (state.round < down + wait) return { code: "REVIVE_NOT_READY", message: `fell in round ${down}; can be revived from round ${down + wait}` };
  return null;
}

/** HP a revive gives back: the % of max HP, at least 1. */
export const reviveHp = (maxHp: number, pct: number) => Math.max(1, Math.floor((maxHp * pct) / 100));
