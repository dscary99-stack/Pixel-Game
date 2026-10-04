/**
 * Deterministic turn-based combat kernel (chapter 03, chapter 11 §2–§3).
 *
 * Pure: every call clones the state, uses only the server RNG stored in it, and returns
 * new state + events. Same setup + same seed + same commands => identical results.
 * The Battle Durable Object owns persistence, idempotency and auth; this file owns the rules.
 */
import { applyBond, bondBonusPercent } from "../bond";
import { companionCombatProfile } from "../companion-growth";
import { companionKit, effectiveSkillLevel, masteryForVictory, skillLevelCap, skillLevelMods, trainedSkillLevel } from "../skill-training";
import { NO_AUTO_POLICY, type AutoBattlePolicy } from "./auto-policy";
import { computeDamage, computeHeal, critChanceBp, hitChanceBp } from "../damage";
import { rollLoot } from "../loot";
import { companionExp, killExp } from "../progression";
import { Rng, seedRng } from "../rng";
import type { RulesConfig } from "../rules";
import type { DamageEffect, ItemDefinition, LootTable, SkillDefinition, SpeciesDefinition, StatusApplication } from "../schemas";
import { deriveStats, type DerivedStats } from "../stats";
import {
  INVERT_PAIRS,
  STATUS_DEFINITIONS,
  incomingDamageFactor,
  overTimeAmount,
  statusBlocks,
  type InstantEffect,
  type StatusBlock,
  type StatusId,
  statsWithStatuses,
  statusChancePct,
  statusResistancePct,
  type ActiveStatus,
} from "../status";
import { validateEnemyCount, validateTeam, type ErrorCode } from "../validators";
import type {
  BattleCommand,
  BattleEvent,
  BattleEventBody,
  BattleSetup,
  BattleState,
  BattleUnit,
  CommandSource,
  Entitlement,
  KernelResult,
  Range,
  Row,
  Side,
} from "./types";

export interface BattleContent {
  species: ReadonlyMap<string, SpeciesDefinition>;
  skills: ReadonlyMap<string, SkillDefinition>;
  items: ReadonlyMap<string, ItemDefinition>;
  lootTables: ReadonlyMap<string, LootTable>;
}

/** Enemy formation: up to 10 units in two rows of 5. Ally formation: front 3 / back 3 (P15). */
const ENEMY_ROW_SLOTS = 5;

class Rejection extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
const reject = (code: ErrorCode, message: string): never => {
  throw new Rejection(code, message);
};

/** Mutable working context for one kernel call. */
class Ctx {
  readonly events: BattleEvent[] = [];
  readonly rng: Rng;
  constructor(
    readonly s: BattleState,
    readonly rules: RulesConfig,
    readonly content: BattleContent,
    readonly causeId: string | null,
  ) {
    this.rng = new Rng(s.rng);
  }
  emit(body: BattleEventBody): void {
    this.s.eventSeq += 1;
    this.events.push({ eventId: `${this.s.battleId}:${this.s.eventSeq}`, seq: this.s.eventSeq, causeId: this.causeId, ...body });
  }
  unit(id: string): BattleUnit {
    return this.s.units.find((u) => u.unitId === id) ?? reject("INVALID_TARGET", `unknown unit ${id}`);
  }
  finish(): KernelResult {
    this.s.rng = this.rng.state();
    this.s.stateVersion += 1;
    return { ok: true, state: this.s, events: this.events };
  }
}

const active = (u: BattleUnit) => !u.ko && !u.retired;

/** A unit's stats with its statuses applied (status.ts). Base `stats` never change mid-fight. */
const eff = (ctx: Ctx, u: BattleUnit): DerivedStats => statsWithStatuses(ctx.rules, u.stats, u.statuses);

// ================================================================ setup

export function createBattle(rules: RulesConfig, content: BattleContent, setup: BattleSetup): KernelResult {
  try {
    return createBattleInner(rules, content, setup);
  } catch (e) {
    if (e instanceof Rejection) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

function createBattleInner(rules: RulesConfig, content: BattleContent, setup: BattleSetup): KernelResult {
  const teamIssues = [
    ...validateTeam(
      rules,
      setup.companions.map((c) => ({ instanceId: c.instance.id, speciesId: c.instance.speciesId })),
    ),
    ...validateEnemyCount(rules, setup.enemies.length),
  ];
  if (teamIssues.length > 0) reject(teamIssues[0]!.code, teamIssues.map((i) => i.message).join("; "));
  if (setup.enemies.length === 0) reject("INVALID_COMMAND", "battle needs at least one enemy");
  validateBag(rules, content, setup.bag);

  const units: BattleUnit[] = [];
  const p = setup.player;
  const pStats = deriveStats(p.level, p.primaryStats, p.gear);
  for (const sid of p.skillIds) requireActiveSkill(content, sid);
  units.push({
    unitId: "player",
    side: "ally",
    kind: "player",
    name: p.name,
    speciesId: null,
    instanceId: null,
    level: p.level,
    element: p.element,
    rank: null,
    row: p.row,
    slot: p.slot,
    stats: pStats,
    hp: clampResource(p.hp, pStats.maxHp),
    mp: clampResource(p.mp, pStats.maxMp),
    skillIds: [...p.skillIds],
    basicAttackRange: p.basicAttackRange,
    primaryStats: { ...p.primaryStats },
    statuses: [],
    ko: (p.hp ?? pStats.maxHp) <= 0,
    retired: false,
    guarding: false,
    cooldowns: {},
    movedThisRound: false,
    captureWindowOpen: false,
    lootTableId: null,
  });

  for (const c of setup.companions) {
    const inst = c.instance;
    if (inst.ownerId !== p.accountId) reject("NOT_OWNER", `${inst.id} is not owned by ${p.accountId}`);
    const sp = content.species.get(inst.speciesId) ?? reject("MISSING_REFERENCE", `species ${inst.speciesId}`);
    if (!sp.allowedElements.includes(inst.element)) reject("INVALID_COMMAND", `${inst.id} has element outside species`);
    const { level, primaryStats } = companionCombatProfile(rules, sp, inst, p.level);
    const bondPercent = bondBonusPercent(rules, inst.bond);
    const stats = applyBond(rules, sp.archetype, inst.bond, deriveStats(level, primaryStats));
    // The kit with any Rebirth variant now in use (chapter 04 §7); a variant keeps its base skill's
    // trained level, which works only up to what the fighting level allows (chapter 04 §5).
    const kit = companionKit(rules, sp, inst, level);
    for (const k of kit) if (!content.skills.has(k.skillId)) reject("MISSING_REFERENCE", `skill ${k.skillId}`);
    const skillLevels = Object.fromEntries(
      kit.map((k) => [k.skillId, effectiveSkillLevel(rules, trainedSkillLevel(inst.trainedSkillLevels, k.baseId), level)]),
    );
    units.push({
      unitId: `ally:${inst.id}`,
      side: "ally",
      kind: "companion",
      name: sp.name.th,
      speciesId: sp.id,
      instanceId: inst.id,
      level,
      actualLevel: inst.currentLevel,
      element: inst.element,
      rank: null,
      row: c.row,
      slot: c.slot,
      stats,
      hp: clampResource(c.hp, stats.maxHp),
      mp: clampResource(c.mp, stats.maxMp),
      skillIds: kit.map((k) => k.skillId).filter((id) => content.skills.get(id)?.kind === "active"),
      skillLevels,
      bondPercent,
      ...(inst.rebirthStage >= 3 && sp.rebirthCosmetic !== undefined
        ? { cosmetic: { effect: sp.rebirthCosmetic.effect, color: sp.rebirthCosmetic.color } }
        : {}),
      basicAttackRange: sp.basicAttackRange,
      primaryStats: { ...primaryStats },
      statuses: [],
      ko: (c.hp ?? stats.maxHp) <= 0,
      retired: false,
      guarding: false,
      cooldowns: {},
      movedThisRound: false,
      captureWindowOpen: false,
      lootTableId: null,
    });
  }

  for (const e of setup.enemies) {
    const sp = content.species.get(e.speciesId) ?? reject("MISSING_REFERENCE", `species ${e.speciesId}`);
    if (!sp.allowedElements.includes(e.element)) reject("INVALID_COMMAND", `${e.unitId} element not allowed for species`);
    if (!content.lootTables.has(sp.lootTableId)) reject("MISSING_REFERENCE", `loot table ${sp.lootTableId}`);
    // Wild level is the species' fixed level everywhere (C29). There is no override input.
    const stats = deriveStats(sp.fixedWildLevel, sp.wildPrimaryStats);
    // Wild monsters fight with their species' active skills, at the cap their wild level allows.
    for (const id of sp.skillIds) if (!content.skills.has(id)) reject("MISSING_REFERENCE", `skill ${id}`);
    const wildSkillIds = sp.skillIds.filter((id) => content.skills.get(id)?.kind === "active");
    const wildSkillLevel = skillLevelCap(rules, sp.fixedWildLevel);
    units.push({
      unitId: e.unitId,
      side: "enemy",
      kind: "enemy",
      name: sp.name.th,
      speciesId: sp.id,
      instanceId: null,
      level: sp.fixedWildLevel,
      element: e.element,
      rank: sp.rank,
      row: e.row,
      slot: e.slot,
      stats,
      hp: stats.maxHp,
      mp: stats.maxMp,
      skillIds: wildSkillIds,
      skillLevels: Object.fromEntries(wildSkillIds.map((id) => [id, wildSkillLevel])),
      basicAttackRange: sp.basicAttackRange,
      primaryStats: { ...sp.wildPrimaryStats },
      statuses: [],
      ko: false,
      retired: false,
      guarding: false,
      cooldowns: {},
      movedThisRound: false,
      captureWindowOpen: e.captureWindowOpen ?? sp.rank !== "BOSS",
      lootTableId: sp.lootTableId,
    });
  }

  validateFormation(rules, units);
  if (!units.some((u) => u.side === "ally" && !u.ko)) reject("INVALID_COMMAND", "no ally can fight");

  const state: BattleState = {
    battleId: setup.battleId,
    rulesVersion: rules.rulesVersion,
    originMode: setup.originMode,
    ownerAccountId: p.accountId,
    stateVersion: 0,
    round: 0,
    turnOrder: [],
    turnIndex: 0,
    units,
    bag: { ...setup.bag },
    consumed: {},
    ...(setup.partyBonus !== undefined && setup.partyBonus.partners > 0 ? { partyBonus: { ...setup.partyBonus } } : {}),
    rng: seedRng(setup.seed),
    eventSeq: 0,
    status: "active",
    resolutions: {},
    entitlements: [],
  };
  const ctx = new Ctx(state, rules, content, null);
  ctx.emit({ type: "BattleStarted", originMode: state.originMode, rulesVersion: state.rulesVersion, unitIds: units.map((u) => u.unitId) });
  startRound(ctx);
  advanceToAllyInput(ctx);
  return ctx.finish();
}

function clampResource(v: number | undefined, max: number): number {
  return v === undefined ? max : Math.max(0, Math.min(max, Math.floor(v)));
}

function requireActiveSkill(content: BattleContent, id: string): SkillDefinition {
  const s = content.skills.get(id) ?? reject("MISSING_REFERENCE", `skill ${id}`);
  if (s.kind !== "active") reject("INVALID_COMMAND", `${id} is not an active skill`);
  return s;
}

function validateBag(rules: RulesConfig, content: BattleContent, bag: Record<string, number>): void {
  const ids = Object.keys(bag).filter((id) => (bag[id] ?? 0) > 0);
  const maxTypes = rules.provisional.combatBagMaxTypes.value;
  if (ids.length > maxTypes) reject("BAG_INVALID", `${ids.length} item types > ${maxTypes}`);
  const caps = rules.provisional.combatBagStackCaps.value as Record<string, number>;
  for (const id of ids) {
    const item = content.items.get(id) ?? reject("MISSING_REFERENCE", `item ${id}`);
    const qty = bag[id]!;
    if (!Number.isInteger(qty)) reject("BAG_INVALID", `${id} quantity must be an integer`);
    const cap = caps[item.kind];
    if (cap === undefined) reject("BAG_INVALID", `${item.kind} items are not combat items`);
    if (qty > cap!) reject("BAG_INVALID", `${id} x${qty} > stack cap ${cap}`);
  }
}

function validateFormation(rules: RulesConfig, units: BattleUnit[]): void {
  const seen = new Set<string>();
  for (const u of units) {
    const max =
      u.side === "enemy"
        ? ENEMY_ROW_SLOTS
        : u.row === "front"
          ? rules.provisional.formationFrontSlots.value
          : rules.provisional.formationBackSlots.value;
    if (!Number.isInteger(u.slot) || u.slot < 0 || u.slot >= max) reject("FORMATION_INVALID", `${u.unitId} slot ${u.slot} out of range`);
    const key = `${u.side}:${u.row}:${u.slot}`;
    if (seen.has(key)) reject("FORMATION_INVALID", `two units at ${key}`);
    seen.add(key);
  }
}

// ================================================================ rounds and turns

/** Order by SPD at round start; ties broken by server RNG (chapter 03 §1). */
/**
 * EXP from one enemy: the character's award, and each companion's award scaled by its level at fight
 * start (unit levels never change mid-fight). Every companion that started the fight counts, KO'd or not.
 */
function expAwards(ctx: Ctx, wildLevel: number): { exp: number; companionExp: Record<string, number> } {
  // Party bonus (P02) on the base award, before each companion's level scaling.
  const bonus = ctx.s.partyBonus?.expPercent ?? 0;
  const exp = Math.floor((killExp(ctx.rules, wildLevel) * (100 + bonus)) / 100);
  const perCompanion: Record<string, number> = {};
  for (const a of ctx.s.units) {
    if (a.side === "ally" && a.instanceId !== null) perCompanion[a.instanceId] = companionExp(ctx.rules, exp, a.actualLevel ?? a.level, wildLevel);
  }
  return { exp, companionExp: perCompanion };
}

function startRound(ctx: Ctx): void {
  const s = ctx.s;
  s.round += 1;
  s.turnIndex = 0;
  for (const u of s.units) u.movedThisRound = false;
  const ready = s.units.filter(active).map((u) => ({ id: u.unitId, spd: eff(ctx, u).spd, tie: ctx.rng.nextUint32() }));
  ready.sort((a, b) => b.spd - a.spd || a.tie - b.tie);
  s.turnOrder = ready.map((r) => r.id);
  ctx.emit({ type: "RoundStarted", round: s.round, order: [...s.turnOrder] });
}

function beginTurn(ctx: Ctx, u: BattleUnit): void {
  const guardEnded = u.guarding;
  u.guarding = false;
  if (ctx.rules.unresolved.cooldownTick.value === "owner_turn_start") {
    for (const k of Object.keys(u.cooldowns)) u.cooldowns[k] = Math.max(0, (u.cooldowns[k] ?? 0) - 1);
  }
  ctx.emit({ type: "TurnStarted", unitId: u.unitId, guardEnded });
}

// ================================================================ statuses (status.ts)

const tuning = (ctx: Ctx) => ctx.rules.provisional.statusTuning.value;
const statusOf = (u: BattleUnit, id: StatusId): ActiveStatus | undefined => u.statuses?.find((x) => x.statusId === id);

function statusEvent(
  ctx: Ctx,
  u: BattleUnit,
  statusId: StatusId,
  change: Extract<BattleEventBody, { type: "StatusChanged" }>["change"],
  sourceId: string | null,
  st?: Pick<ActiveStatus, "turnsLeft" | "stacks">,
  chancePct: number | null = null,
): void {
  ctx.emit({ type: "StatusChanged", unitId: u.unitId, statusId, sourceId, change, turnsLeft: st?.turnsLeft ?? 0, stacks: st?.stacks ?? 0, chancePct });
}

function removeStatus(ctx: Ctx, u: BattleUnit, id: StatusId, change: "removed" | "expired" = "removed"): ActiveStatus | undefined {
  const st = statusOf(u, id);
  if (st === undefined) return undefined;
  u.statuses = u.statuses!.filter((x) => x !== st);
  statusEvent(ctx, u, id, change, st.sourceId, { turnsLeft: 0, stacks: st.stacks });
  return st;
}

/** HP loss from a status (ticks, shock, link, reflect): never below 0, knocks out at 0. */
function statusDamage(ctx: Ctx, u: BattleUnit, statusId: StatusId, amount: number): number {
  const loss = Math.min(Math.max(0, amount), u.hp);
  if (loss <= 0 || !active(u)) return 0;
  u.hp -= loss;
  ctx.emit({ type: "StatusTick", unitId: u.unitId, statusId, hp: -loss, hpAfter: u.hp });
  if (u.hp === 0) knockOut(ctx, u);
  return loss;
}

/**
 * Healing that lands on a unit: anti-heal cuts it, zombie turns it into damage (catalog §3.3, §3.7).
 * Returns the HP actually gained (negative when zombie hurt the unit).
 */
function receiveHeal(ctx: Ctx, u: BattleUnit, amount: number): number {
  let a = amount;
  if (statusOf(u, "anti_heal") !== undefined) a = Math.floor((a * (100 - tuning(ctx).antiHealPct)) / 100);
  if (statusOf(u, "zombie") !== undefined) {
    const loss = Math.min(a, u.hp);
    u.hp -= loss;
    if (u.hp === 0) knockOut(ctx, u);
    return -loss;
  }
  const gained = Math.min(a, u.stats.maxHp - u.hp); // overheal discarded
  u.hp += gained;
  return gained;
}

/**
 * Status effects at the start of a unit's turn (O15 timing, status.ts): over-time loss and gain, then
 * control. Returns false when the unit cannot act this turn.
 */
function statusTurnStart(ctx: Ctx, u: BattleUnit): boolean {
  for (const st of [...(u.statuses ?? [])]) {
    const d = STATUS_DEFINITIONS[st.statusId];
    if (d.overTime === undefined || !active(u)) continue;
    const res = d.overTime.resource;
    const amount = overTimeAmount(ctx.rules, d, st.stacks, res === "hp" ? u.stats.maxHp : u.stats.maxMp, u.rank === "BOSS");
    if (res === "mp") {
      const change = amount > 0 ? Math.min(amount, u.mp) : -Math.min(-amount, u.stats.maxMp - u.mp);
      if (change !== 0) {
        u.mp -= change;
        ctx.emit({ type: "ResourceChanged", unitId: u.unitId, source: amount > 0 ? "mana_burn" : "mp_regen", hp: 0, mp: -change, hpAfter: u.hp, mpAfter: u.mp });
      }
    } else if (amount > 0) {
      const lost = statusDamage(ctx, u, st.statusId, amount);
      // Leech gives what it took to whoever put it there.
      const src = st.statusId === "leech" && st.sourceId !== null ? ctx.s.units.find((x) => x.unitId === st.sourceId) : undefined;
      if (src !== undefined && active(src) && lost > 0) {
        const gain = receiveHeal(ctx, src, lost);
        ctx.emit({ type: "ResourceChanged", unitId: src.unitId, source: "leech", hp: gain, mp: 0, hpAfter: src.hp, mpAfter: src.mp });
      }
    } else {
      const gain = receiveHeal(ctx, u, -amount);
      if (gain !== 0) ctx.emit({ type: "StatusTick", unitId: u.unitId, statusId: st.statusId, hp: gain, hpAfter: u.hp });
    }
    if (d.growsEachTick === true && active(u)) st.stacks = Math.min(d.maxStacks, st.stacks + 1);
  }
  if (!active(u)) return false;
  for (const st of u.statuses ?? []) {
    const d = STATUS_DEFINITIONS[st.statusId];
    const skip = d.skipsTurn === "always" || (d.skipsTurn !== undefined && ctx.rng.chanceBp(tuning(ctx)[d.skipsTurn] * 100));
    if (skip) {
      ctx.emit({ type: "TurnSkipped", unitId: u.unitId, statusId: st.statusId });
      return false;
    }
  }
  return true;
}

/** After a unit acted: shock hurts it, and acting breaks stealth. */
function afterAction(ctx: Ctx, u: BattleUnit, cmd: BattleCommand["type"]): void {
  if (!active(u)) return;
  if ((cmd === "attack" || cmd === "skill") && statusOf(u, "stealth") !== undefined) removeStatus(ctx, u, "stealth");
  if (statusOf(u, "shock") !== undefined) statusDamage(ctx, u, "shock", Math.max(1, Math.floor((u.stats.maxHp * tuning(ctx).shockPctMaxHp) / 100)));
}

/** End of a unit's turn: its statuses count down, except ones put on during this very turn. Doom kills at 0. */
function endTurn(ctx: Ctx, u: BattleUnit): void {
  if (u.statuses === undefined || !active(u)) return;
  const kept: ActiveStatus[] = [];
  const expired: ActiveStatus[] = [];
  for (const st of u.statuses) {
    if (st.fresh) {
      st.fresh = false;
      kept.push(st);
      continue;
    }
    st.turnsLeft -= 1;
    (st.turnsLeft > 0 ? kept : expired).push(st);
  }
  u.statuses = kept;
  for (const st of expired) {
    statusEvent(ctx, u, st.statusId, "expired", st.sourceId, { turnsLeft: 0, stacks: st.stacks });
    if (st.statusId === "doom" && active(u)) {
      u.hp = 0;
      knockOut(ctx, u);
    }
  }
}

/**
 * Tries to put a status on a unit. Bosses are immune to hard control (checked first); unbuffable and
 * immunity block; harmful statuses roll the skill's chance offset by resistance and effect hit, never
 * above the skill's chance; helpful ones roll the skill's chance as is; `guaranteed` (element reactions)
 * skips the roll. The same status again refreshes it or adds stacks. Instant statuses act and are not kept.
 */
function applyStatus(ctx: Ctx, source: BattleUnit, target: BattleUnit, a: StatusApplication, guaranteed = false): void {
  if (!active(target)) return;
  const d = STATUS_DEFINITIONS[a.statusId];
  const existing = statusOf(target, a.statusId);
  if (d.harmful && d.hardControl === true && target.rank === "BOSS") return statusEvent(ctx, target, a.statusId, "immune", source.unitId, existing);
  if (!d.harmful && statusBlocks(target.statuses, "helpful_statuses") !== undefined) return statusEvent(ctx, target, a.statusId, "blocked", source.unitId, existing);
  const chance = guaranteed
    ? 100
    : d.harmful
      ? statusChancePct(a.chancePct, eff(ctx, source).effectHitPct, statusResistancePct(ctx.rules, d, eff(ctx, target), target.primaryStats))
      : a.chancePct;
  const rolled = chance < 100;
  if (rolled && !ctx.rng.chanceBp(Math.round(chance * 100))) return statusEvent(ctx, target, a.statusId, "resisted", source.unitId, existing, chance);
  // Immunity takes the first harmful status that would land, then ends.
  if (d.harmful && statusOf(target, "immunity") !== undefined) {
    removeStatus(ctx, target, "immunity");
    return statusEvent(ctx, target, a.statusId, "blocked", source.unitId, existing, rolled ? chance : null);
  }
  if (d.instant !== undefined) {
    statusEvent(ctx, target, a.statusId, "applied", source.unitId, { turnsLeft: 0, stacks: 0 }, rolled ? chance : null);
    return instantStatus(ctx, source, target, d.instant);
  }
  const ownTurn = currentActor(ctx.s)?.unitId === target.unitId;
  const statuses = (target.statuses ??= []);
  let st = existing;
  if (st !== undefined) {
    st.turnsLeft = Math.max(st.turnsLeft, a.turns);
    st.stacks = Math.min(d.maxStacks, st.stacks + (d.maxStacks > 1 ? (a.stacks ?? 1) : 0));
    st.sourceId = source.unitId;
    st.fresh = st.fresh || ownTurn;
    statusEvent(ctx, target, a.statusId, "refreshed", source.unitId, st, rolled ? chance : null);
  } else {
    st = { statusId: a.statusId, sourceId: source.unitId, turnsLeft: a.turns, stacks: Math.min(d.maxStacks, a.stacks ?? 1), fresh: ownTurn };
    if (a.element !== undefined) st.element = a.element;
    if (a.statusId === "skill_lock" && target.lastSkillId !== undefined) st.skillId = target.lastSkillId;
    statuses.push(st);
    statusEvent(ctx, target, a.statusId, "applied", source.unitId, st, rolled ? chance : null);
  }
  // Frostbite at full stacks turns into a short freeze.
  if (a.statusId === "frostbite" && st.stacks >= tuning(ctx).frostbiteFreezeStacks) {
    removeStatus(ctx, target, "frostbite");
    applyStatus(ctx, source, target, { statusId: "freeze", chancePct: 100, turns: 1 }, true);
  }
}

/** What an instant status does the moment it lands (catalog §3.1, §3.7). */
function instantStatus(ctx: Ctx, source: BattleUnit, target: BattleUnit, what: InstantEffect): void {
  const s = ctx.s;
  const pos = s.turnOrder.indexOf(target.unitId);
  const buffs = () => (target.statuses ?? []).filter((x) => !STATUS_DEFINITIONS[x.statusId].harmful);
  switch (what) {
    case "knockback":
    case "pull": {
      // Moves to the other row's first free slot; nothing happens when that row is full.
      const row: Row = what === "knockback" ? "back" : "front";
      if (target.row === row) return;
      const max = target.side === "enemy" ? ENEMY_ROW_SLOTS : row === "front" ? ctx.rules.provisional.formationFrontSlots.value : ctx.rules.provisional.formationBackSlots.value;
      for (let slot = 0; slot < max; slot++) {
        if (!s.units.some((u) => u.side === target.side && u.row === row && u.slot === slot)) {
          target.row = row;
          target.slot = slot;
          return;
        }
      }
      return;
    }
    case "delay":
      // Not acted yet this round: goes to the end of the round's order.
      if (pos > s.turnIndex) s.turnOrder = [...s.turnOrder.filter((id) => id !== target.unitId), target.unitId];
      return;
    case "advance":
      // Acts right after the current unit, if it has not acted yet this round.
      if (pos > s.turnIndex + 1) {
        const order = s.turnOrder.filter((id) => id !== target.unitId);
        order.splice(s.turnIndex + 1, 0, target.unitId);
        s.turnOrder = order;
      }
      return;
    case "cleanse": {
      const worst = (target.statuses ?? []).find((x) => STATUS_DEFINITIONS[x.statusId].harmful);
      if (worst !== undefined) removeStatus(ctx, target, worst.statusId);
      return;
    }
    case "dispel": {
      const b = buffs()[0];
      if (b !== undefined) removeStatus(ctx, target, b.statusId);
      return;
    }
    case "steal_buff": {
      const b = buffs()[0];
      if (b === undefined) return;
      removeStatus(ctx, target, b.statusId);
      const app: StatusApplication = { statusId: b.statusId, chancePct: 100, turns: b.turnsLeft, stacks: b.stacks };
      if (b.element !== undefined) app.element = b.element;
      applyStatus(ctx, source, source, app, true);
      return;
    }
    case "invert":
      for (const b of buffs()) {
        const into = INVERT_PAIRS[b.statusId];
        if (into === undefined) continue;
        removeStatus(ctx, target, b.statusId);
        applyStatus(ctx, source, target, { statusId: into, chancePct: 100, turns: b.turnsLeft }, true);
      }
      return;
    case "extend":
      for (const b of buffs()) b.turnsLeft += 1;
      return;
  }
}

/** Ends statuses that a hit breaks: sleep on any damage, freeze on fire. */
function breakStatusesOnHit(ctx: Ctx, target: BattleUnit, element: BattleUnit["element"]): void {
  for (const st of [...(target.statuses ?? [])]) {
    const d = STATUS_DEFINITIONS[st.statusId];
    if (d.endsOnDamage === true || (d.endsOnElement !== undefined && d.endsOnElement === element)) removeStatus(ctx, target, st.statusId);
  }
}

/** Element reactions on a hit that landed (catalog §3.6): wet and oil meet an element. */
function elementReactions(ctx: Ctx, actor: BattleUnit, target: BattleUnit, element: BattleUnit["element"]): void {
  if (!active(target)) return;
  const react = (statusId: StatusId, turns: number) => applyStatus(ctx, actor, target, { statusId, chancePct: 100, turns }, true);
  if (statusOf(target, "wet") !== undefined) {
    if (element === "WIND") {
      removeStatus(ctx, target, "wet");
      react("frostbite", 2);
    } else if (element === "FIRE") {
      removeStatus(ctx, target, "wet"); // steam
      react("blind", 1);
    } else if (element === "EARTH") {
      removeStatus(ctx, target, "wet"); // mud
      react("spd_down", 2);
    }
  }
  if (element === "FIRE" && statusOf(target, "oil") !== undefined) {
    removeStatus(ctx, target, "oil");
    react("burn", 2);
  }
}

/** Who a single-target hit really lands on: a protector takes it for the protected unit. */
function protectorFor(ctx: Ctx, actor: BattleUnit, target: BattleUnit): BattleUnit {
  const p = statusOf(target, "protect");
  const guard = p?.sourceId == null ? undefined : ctx.s.units.find((u) => u.unitId === p.sourceId);
  return guard !== undefined && active(guard) && guard.side === target.side && guard.unitId !== actor.unitId ? guard : target;
}

/**
 * Commands a status forbids (catalog §3.1): silence (MP skills), berserk/mini (skills), disarm (attack),
 * berserk (items), root (move, flee), skill lock (one skill), taunt (must hit the taunter).
 */
function checkStatusBlocks(ctx: Ctx, actor: BattleUnit, cmd: BattleCommand): void {
  const st = actor.statuses;
  if (st === undefined || st.length === 0) return;
  const blocked = (what: StatusBlock, label: string) => {
    const by = statusBlocks(st, what);
    if (by !== undefined) reject(what === "mp_skills" ? "SILENCED" : "STATUS_BLOCKED", `${STATUS_DEFINITIONS[by.statusId].th}: ${label}`);
  };
  if (cmd.type === "skill") {
    blocked("skills", "cannot use skills");
    const skill = ctx.content.skills.get(cmd.skillId);
    if ((skill?.mpCost ?? 0) > 0) blocked("mp_skills", "cannot use MP skills");
    if (st.some((x) => x.statusId === "skill_lock" && x.skillId === cmd.skillId)) reject("STATUS_BLOCKED", `${cmd.skillId} is locked`);
  }
  if (cmd.type === "attack") blocked("attack", "cannot attack");
  if (cmd.type === "item") blocked("items", "cannot use items");
  if (cmd.type === "move") blocked("move", "cannot move");
  if (cmd.type === "flee") blocked("flee", "cannot flee");
  if (cmd.type === "attack" || cmd.type === "skill") {
    const taunter = tauntedBy(ctx.s, actor);
    const target = ctx.unit(cmd.targetId);
    if (taunter !== undefined && target.side === taunter.side && target.unitId !== taunter.unitId) {
      reject("TAUNTED", `${actor.unitId} must target ${taunter.unitId}`);
    }
  }
}

/** The living unit taunting this one, if any. */
function tauntedBy(state: BattleState, u: BattleUnit): BattleUnit | undefined {
  const t = u.statuses?.find((x) => x.statusId === "taunt");
  const by = t?.sourceId == null ? undefined : state.units.find((x) => x.unitId === t.sourceId);
  return by !== undefined && active(by) && by.side !== u.side ? by : undefined;
}

/** Confuse (a roll) and charm (always) send an attack or damage skill to the actor's own side. */
function redirectedTarget(ctx: Ctx, actor: BattleUnit, target: BattleUnit): BattleUnit {
  if (target.side === actor.side) return target;
  const charmed = statusOf(actor, "charm") !== undefined;
  const confused = statusOf(actor, "confuse") !== undefined;
  if (!charmed && !(confused && ctx.rng.chanceBp(tuning(ctx).confuseRedirectChancePct * 100))) return target;
  const own = ctx.s.units.filter((u) => u.side === actor.side && active(u));
  const others = own.filter((u) => u.unitId !== actor.unitId);
  const pool = others.length > 0 ? others : own;
  const to = pool[ctx.rng.nextInt(pool.length)]!;
  ctx.emit({ type: "ActionRedirected", actorId: actor.unitId, statusId: charmed ? "charm" : "confuse", fromId: target.unitId, toId: to.unitId });
  return to;
}

/** Moves to the next unit able to act. Enemy turns are resolved by the server AI. */
function advanceToAllyInput(ctx: Ctx): void {
  const s = ctx.s;
  // Safety bound only; a real stalemate rule is O15.
  for (let guard = 0; guard < 10_000 && s.status === "active"; guard++) {
    if (s.turnIndex >= s.turnOrder.length) startRound(ctx);
    const u = ctx.unit(s.turnOrder[s.turnIndex]!);
    if (!active(u)) {
      s.turnIndex += 1;
      continue;
    }
    beginTurn(ctx, u);
    // Statuses first: over-time ticks can knock the unit out, control can take the turn (O15).
    const canAct = statusTurnStart(ctx, u);
    if (!canAct) {
      if (active(u)) endTurn(ctx, u);
      s.turnIndex += 1;
      checkEnd(ctx);
      continue;
    }
    if (u.side === "ally") return;
    enemyAct(ctx, u);
    afterAction(ctx, u, "attack");
    endTurn(ctx, u);
    s.turnIndex += 1;
    checkEnd(ctx);
  }
}

/** The current actor, or null if the battle is over. */
export function currentActor(state: BattleState): BattleUnit | null {
  if (state.status !== "active") return null;
  const id = state.turnOrder[state.turnIndex];
  return state.units.find((u) => u.unitId === id) ?? null;
}

// ================================================================ commands

export interface ApplyOptions {
  source: CommandSource;
  causeId?: string;
}

export function applyCommand(
  rules: RulesConfig,
  content: BattleContent,
  state: BattleState,
  cmd: BattleCommand,
  opts: ApplyOptions,
): KernelResult {
  const ctx = new Ctx(structuredClone(state), rules, content, opts.causeId ?? null);
  try {
    if (ctx.s.status !== "active") reject("BATTLE_OVER", `battle is ${ctx.s.status}`);
    const actor = currentActor(ctx.s);
    if (actor === null || actor.unitId !== cmd.actorId || actor.side !== "ally") {
      reject("NOT_YOUR_TURN", `it is ${actor?.unitId ?? "nobody"}'s turn`);
    }
    checkStatusBlocks(ctx, actor!, cmd);
    resolveCommand(ctx, actor!, cmd, opts.source);
    afterAction(ctx, actor!, cmd.type);
    if (ctx.s.status === "active") endTurn(ctx, actor!);
    ctx.s.turnIndex += 1;
    checkEnd(ctx);
    advanceToAllyInput(ctx);
    return ctx.finish();
  } catch (e) {
    if (e instanceof Rejection) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

function resolveCommand(ctx: Ctx, actor: BattleUnit, cmd: BattleCommand, source: CommandSource): void {
  switch (cmd.type) {
    case "attack":
      return doAttack(ctx, actor, ctx.unit(cmd.targetId), null);
    case "skill":
      return doSkill(ctx, actor, cmd.skillId, ctx.unit(cmd.targetId));
    case "guard":
      actor.guarding = true;
      return actionEvent(ctx, actor, "guard", null);
    case "item":
      return doItem(ctx, actor, cmd.itemId, ctx.unit(cmd.targetId));
    case "capture":
      return doCapture(ctx, actor, ctx.unit(cmd.targetId), cmd.itemId, source);
    case "move":
      return doMove(ctx, actor, cmd.row, cmd.slot);
    case "flee":
      return doFlee(ctx, actor);
    default:
      reject("INVALID_COMMAND", "unknown command");
  }
}

function actionEvent(
  ctx: Ctx,
  actor: BattleUnit,
  action: BattleCommand["type"],
  target: BattleUnit | null,
  extra: Partial<Extract<BattleEventBody, { type: "ActionResolved" }>> = {},
): void {
  ctx.emit({
    type: "ActionResolved",
    actorId: actor.unitId,
    action,
    targetId: target?.unitId ?? null,
    skillId: null,
    hit: null,
    crit: null,
    damage: null,
    heal: null,
    breakdown: null,
    targetHpAfter: target?.hp ?? null,
    ...extra,
  });
}

/** Living targets on a side; melee must hit a living front-row unit first (chapter 03 §1). */
export function validTargets(state: BattleState, side: Side, range: Range): BattleUnit[] {
  const living = state.units.filter((u) => u.side === side && active(u));
  // Stealth hides a unit from single-target picks unless every unit of that side is hidden.
  const seen = living.filter((u) => !u.statuses?.some((x) => x.statusId === "stealth"));
  const alive = seen.length > 0 ? seen : living;
  if (range === "ranged") return alive;
  const front = alive.filter((u) => u.row === "front");
  return front.length > 0 ? front : alive;
}

function requireEnemyTarget(ctx: Ctx, actor: BattleUnit, target: BattleUnit, range: Range): void {
  const side: Side = actor.side === "ally" ? "enemy" : "ally";
  if (!validTargets(ctx.s, side, range).some((u) => u.unitId === target.unitId)) {
    reject("INVALID_TARGET", `${target.unitId} is not a valid ${range} target`);
  }
}

function doAttack(ctx: Ctx, actor: BattleUnit, target: BattleUnit, _skill: null): void {
  requireEnemyTarget(ctx, actor, target, actor.basicAttackRange);
  // Phase A assumption: basic attacks are physical, coefficient 1, NEUTRAL element; imbue gives its element.
  const element = statusOf(actor, "imbue")?.element ?? "NEUTRAL";
  strike(ctx, actor, redirectedTarget(ctx, actor, target), "attack", null, { damageType: "physical", coefficient: 1, flat: 0, element });
}

/** What using a skill costs this unit now: its level's table (chapter 04 §5), then MP cost up. */
function skillCost(ctx: Ctx, actor: BattleUnit, skill: SkillDefinition) {
  const mods = skillLevelMods(ctx.rules, skill, actor.skillLevels?.[skill.id] ?? 1);
  const baseMp = Math.max(0, skill.mpCost + mods.mpCost);
  const mpCost = statusOf(actor, "mp_cost_up") === undefined ? baseMp : Math.ceil((baseMp * (100 + tuning(ctx).mpCostUpPct)) / 100);
  return { mods, mpCost, cooldown: Math.max(0, skill.cooldown + mods.cooldown) };
}

function doSkill(ctx: Ctx, actor: BattleUnit, skillId: string, target: BattleUnit): void {
  if (!actor.skillIds.includes(skillId)) reject("INVALID_COMMAND", `${actor.unitId} has no skill ${skillId}`);
  const skill = requireActiveSkill(ctx.content, skillId);
  const { mods, mpCost, cooldown } = skillCost(ctx, actor, skill);
  if (cooldown > 0 && ctx.rules.unresolved.cooldownTick.value === null) {
    reject("UNRESOLVED_RULE", "skill cooldown tick point is OPEN (O15)");
  }
  if ((actor.cooldowns[skillId] ?? 0) > 0) reject("ON_COOLDOWN", `${skillId} ready in ${actor.cooldowns[skillId]} turns`);
  if (actor.mp < mpCost) reject("INSUFFICIENT_RESOURCE", `needs ${mpCost} MP`);
  const effect = skill.effectSequence[0]!;
  if (skill.effectSequence.length !== 1) reject("UNRESOLVED_RULE", "multi-effect skills wait for O15 (multi-hit, chains)");

  const onEnemy = effect.kind === "damage" || (effect.kind === "status" && skill.targetRule === "single_enemy");
  if (onEnemy) {
    if (skill.targetRule !== "single_enemy") reject("INVALID_COMMAND", "damage skill must target a single enemy in Phase A");
    requireEnemyTarget(ctx, actor, target, skill.range);
  } else {
    const allowed = skill.targetRule === "self" ? target.unitId === actor.unitId : skill.targetRule === "single_ally";
    if (!allowed || target.side !== actor.side) reject("INVALID_TARGET", "this skill needs an ally target");
    if (!active(target)) reject("INVALID_TARGET", "heals do not revive (chapter 03 §6)");
  }

  actor.mp -= mpCost;
  if (cooldown > 0) actor.cooldowns[skillId] = cooldown;
  actor.lastSkillId = skillId;

  const coefficient = effect.kind === "status" ? 0 : (effect.coefficient * (100 + mods.powerPercent)) / 100;
  // Extra targets from the skill's level: the chosen target first, then more of the same side, each
  // resolved on its own (its own hit and crit). Picked by the server, never by the client: enemies in
  // formation order (front row first), allies by lowest HP share. Self-only skills never spread.
  const extra =
    mods.extraTargets <= 0 || skill.targetRule === "self"
      ? []
      : onEnemy
        ? validTargets(ctx.s, actor.side === "ally" ? "enemy" : "ally", skill.range)
            .filter((u) => u.unitId !== target.unitId)
            .sort((a, b) => (a.row === b.row ? a.slot - b.slot : a.row === "front" ? -1 : 1))
        : ctx.s.units
            .filter((u) => u.side === actor.side && active(u) && u.unitId !== target.unitId)
            .sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp || (a.unitId < b.unitId ? -1 : 1));
  for (const t of [target, ...extra.slice(0, mods.extraTargets)]) {
    if (!active(t)) continue;
    if (effect.kind === "damage") {
      strike(ctx, actor, redirectedTarget(ctx, actor, t), "skill", skillId, { ...effect, coefficient });
    } else if (effect.kind === "status") {
      // No damage and no hit roll: each status rolls its own chance (O15, Nut 2026-10-04).
      actionEvent(ctx, actor, "skill", t, { skillId });
      for (const a of effect.statuses) applyStatus(ctx, actor, t, a);
    } else {
      const gained = receiveHeal(ctx, t, computeHeal(actor.stats.support, coefficient, effect.flat));
      actionEvent(ctx, actor, "skill", t, gained >= 0 ? { skillId, heal: gained, targetHpAfter: t.hp } : { skillId, hit: true, damage: -gained, targetHpAfter: t.hp });
      if (!active(t)) continue;
      const mp = Math.min(effect.restoreMp ?? 0, t.stats.maxMp - t.mp);
      if (mp > 0) {
        t.mp += mp;
        ctx.emit({ type: "ResourceChanged", unitId: t.unitId, source: "restore_mp", hp: 0, mp, hpAfter: t.hp, mpAfter: t.mp });
      }
      for (const a of effect.statuses ?? []) applyStatus(ctx, actor, t, a);
    }
  }
}

type StrikeEffect = { damageType: "physical" | "magic"; coefficient: number; flat: number; element: BattleUnit["element"] } & Partial<
  Pick<DamageEffect, "penetrationPct" | "accuracyBonusPct" | "critBonusPct" | "execute" | "lifestealPct" | "recoilPct" | "statuses" | "bonusVsStatus">
>;

function strike(ctx: Ctx, actor: BattleUnit, chosen: BattleUnit, action: "attack" | "skill", skillId: string | null, eff: StrikeEffect, isCounter = false): void {
  const rules = ctx.rules;
  const t = tuning(ctx);
  // A protector steps in front of the unit it protects (catalog §3.4).
  const target = protectorFor(ctx, actor, chosen);
  // Statuses change the numbers of both sides (status.ts); max HP never changes.
  const a = statsWithStatuses(rules, actor.stats, actor.statuses);
  const d = statsWithStatuses(rules, target.stats, target.statuses);
  const hit = ctx.rng.chanceBp(hitChanceBp(rules, a.accuracyPct, d.evasionPct, eff.accuracyBonusPct ?? 0));
  if (!hit) {
    actionEvent(ctx, actor, action, target, { skillId, hit: false, crit: false, damage: 0 });
    return;
  }
  const crit = ctx.rng.chanceBp(critChanceBp(rules, a.critPct + (eff.critBonusPct ?? 0)));
  const physical = eff.damageType === "physical";
  const hpBefore = target.hp;
  // Outgoing: execute, focus (used up), bonus against a status, oil meeting fire.
  let outgoing = 1;
  if (eff.execute !== undefined && hpBefore * 100 < eff.execute.belowHpPct * target.stats.maxHp) outgoing *= (100 + eff.execute.bonusPct) / 100;
  if (statusOf(actor, "focus") !== undefined) {
    outgoing *= (100 + t.focusPct) / 100;
    removeStatus(ctx, actor, "focus");
  }
  const vs = eff.bonusVsStatus;
  if (vs !== undefined && statusOf(target, vs.statusId) !== undefined) {
    outgoing *= (100 + vs.bonusPct) / 100;
    if (vs.consume) removeStatus(ctx, target, vs.statusId);
  }
  if (eff.element === "FIRE" && statusOf(target, "oil") !== undefined) outgoing *= (100 + t.oilFireBonusPct) / 100;
  const breakdown = computeDamage(rules, {
    ...(eff.penetrationPct === undefined ? {} : { defenseModifiers: { penetrationPct: eff.penetrationPct } }),
    ...(outgoing !== 1 ? { outgoingMultiplier: outgoing } : {}),
    incomingMultiplier: incomingDamageFactor(rules, target.statuses, eff.element),
    attackPower: physical ? a.patk : a.matk,
    skillCoefficient: eff.coefficient,
    skillFlat: eff.flat,
    defense: physical ? d.pdef : d.mdef,
    attackElement: eff.element,
    defenderElement: target.element,
    crit,
    critDamageBonus: a.critDamageBonus,
    guarding: target.guarding,
  });
  let damage = breakdown.final;
  // Invincible takes the whole hit once; endure keeps 1 HP once.
  if (damage > 0 && statusOf(target, "invincible") !== undefined) {
    damage = 0;
    removeStatus(ctx, target, "invincible");
  }
  if (damage >= target.hp && target.hp > 1 && statusOf(target, "endure") !== undefined) {
    damage = target.hp - 1;
    removeStatus(ctx, target, "endure");
  }
  target.hp = Math.max(0, target.hp - damage);
  actionEvent(ctx, actor, action, target, { skillId, hit: true, crit, damage, breakdown, targetHpAfter: target.hp });
  // Lifesteal and recoil work on the damage that landed, not on overkill.
  const dealt = hpBefore - target.hp;
  const lifesteal = (eff.lifestealPct ?? 0) + (statusOf(actor, "lifesteal_up") !== undefined ? t.lifestealUpPct : 0);
  if (lifesteal > 0 && dealt > 0 && active(actor)) {
    const gain = receiveHeal(ctx, actor, Math.floor((dealt * lifesteal) / 100));
    if (gain !== 0) ctx.emit({ type: "ResourceChanged", unitId: actor.unitId, source: "lifesteal", hp: gain, mp: 0, hpAfter: actor.hp, mpAfter: actor.mp });
  }
  if (eff.recoilPct !== undefined && dealt > 0) {
    const loss = Math.min(Math.floor((dealt * eff.recoilPct) / 100), actor.hp - 1);
    if (loss > 0) {
      actor.hp -= loss;
      ctx.emit({ type: "ResourceChanged", unitId: actor.unitId, source: "recoil", hp: -loss, mp: 0, hpAfter: actor.hp, mpAfter: actor.mp });
    }
  }
  // Reflect (magic) and thorns (physical) send part of the damage back.
  const back = physical ? (statusOf(target, "thorns") !== undefined ? t.thornsPct : 0) : statusOf(target, "reflect") !== undefined ? t.reflectPct : 0;
  if (back > 0 && dealt > 0 && active(actor)) statusDamage(ctx, actor, physical ? "thorns" : "reflect", Math.max(1, Math.floor((dealt * back) / 100)));
  // Link passes part of the damage to the other linked units of that side (never on and on).
  if (dealt > 0 && statusOf(target, "link") !== undefined) {
    for (const u of ctx.s.units) {
      if (u !== target && u.side === target.side && statusOf(u, "link") !== undefined) statusDamage(ctx, u, "link", Math.max(1, Math.floor((dealt * t.linkSharePct) / 100)));
    }
  }
  if (target.hp === 0) knockOut(ctx, target);
  else if (dealt > 0) {
    breakStatusesOnHit(ctx, target, eff.element);
    elementReactions(ctx, actor, target, eff.element);
    const rage = statusOf(target, "rage");
    if (rage !== undefined) rage.stacks = Math.min(STATUS_DEFINITIONS.rage.maxStacks, rage.stacks + 1);
  }
  if (active(target)) for (const x of eff.statuses ?? []) applyStatus(ctx, actor, target, x);
  // Counter: a basic attack back, once; a counter never starts another (chapter 03 §6).
  if (!isCounter && active(target) && active(actor) && statusOf(target, "counter") !== undefined && statusBlocks(target.statuses, "attack") === undefined) {
    if (validTargets(ctx.s, actor.side, target.basicAttackRange).some((u) => u.unitId === actor.unitId)) {
      const element = statusOf(target, "imbue")?.element ?? "NEUTRAL";
      strike(ctx, target, actor, "attack", null, { damageType: "physical", coefficient: 1, flat: 0, element }, true);
    }
  }
}

function knockOut(ctx: Ctx, u: BattleUnit): void {
  u.ko = true;
  u.guarding = false;
  u.statuses = [];
  if (u.kind === "companion") u.fell = true;
  ctx.emit({ type: "UnitKnockedOut", unitId: u.unitId });
  if (u.side !== "enemy") return;
  if (ctx.s.resolutions[u.unitId] !== undefined) throw new Error(`enemy ${u.unitId} resolved twice`);
  ctx.s.resolutions[u.unitId] = "defeated";
  ctx.emit({ type: "EnemyDefeated", unitId: u.unitId, speciesId: u.speciesId! });
  const table = ctx.content.lootTables.get(u.lootTableId!)!;
  const entitlement: Entitlement = {
    entitlementId: `${ctx.s.battleId}:${u.unitId}:defeated`,
    kind: "kill",
    enemyUnitId: u.unitId,
    speciesId: u.speciesId!,
    originMode: ctx.s.originMode,
    items: rollLoot(ctx.rules, table, ctx.s.originMode, ctx.rng, {
      percent: ctx.s.partyBonus?.materialDropPercent ?? 0,
      isMaterial: (id) => ctx.content.items.get(id)?.kind === "material",
    }),
    ...expAwards(ctx, u.level),
  };
  ctx.s.entitlements.push(entitlement);
  ctx.emit({ type: "RewardEntitled", entitlement });
}

function requirePlayerActor(actor: BattleUnit, what: string): void {
  if (actor.kind !== "player") reject("INVALID_COMMAND", `only the player character can ${what} (chapter 03 §2)`);
}

function consumeItem(ctx: Ctx, itemId: string): void {
  const left = ctx.s.bag[itemId] ?? 0;
  if (left <= 0) reject("INSUFFICIENT_RESOURCE", `no ${itemId} in the combat bag`);
  ctx.s.bag[itemId] = left - 1;
  ctx.s.consumed[itemId] = (ctx.s.consumed[itemId] ?? 0) + 1;
  ctx.emit({ type: "ItemConsumed", itemId, remaining: left - 1 });
}

function doItem(ctx: Ctx, actor: BattleUnit, itemId: string, target: BattleUnit): void {
  requirePlayerActor(actor, "use items");
  const item = ctx.content.items.get(itemId) ?? reject("MISSING_REFERENCE", `item ${itemId}`);
  if (item.kind === "revive") reject("UNRESOLVED_RULE", "revive timeline is OPEN (O15)");
  if (item.kind !== "heal") reject("INVALID_COMMAND", `${item.kind} items are not usable in Phase A`);
  if (target.side !== "ally" || !active(target)) reject("INVALID_TARGET", "heal items need a living ally");
  if ((ctx.s.bag[itemId] ?? 0) <= 0) reject("INSUFFICIENT_RESOURCE", `no ${itemId} in the combat bag`);
  consumeItem(ctx, itemId);
  // Anti-heal and zombie work on potions too.
  const gained = receiveHeal(ctx, target, item.healHp ?? 0);
  actionEvent(ctx, actor, "item", target, gained >= 0 ? { heal: gained, targetHpAfter: target.hp } : { hit: true, damage: -gained, targetHpAfter: target.hp });
}

/** Capture probability (chapter 04 §3). Status and mastery factors are 1 until those systems exist. */
export function captureProbability(rules: RulesConfig, species: SpeciesDefinition, target: BattleUnit, itemQuality: number): number | null {
  const table = rules.unresolved.captureRates.value;
  if (table === null) return null;
  const ratio = target.hp / target.stats.maxHp;
  const step = [...table.hpFactor].sort((a, b) => a.maxHpRatio - b.maxHpRatio).find((s) => ratio <= s.maxHpRatio);
  const hpFactor = step?.factor ?? 1;
  const [lo, hi] = table.rankBounds[species.rank];
  return Math.min(hi, Math.max(lo, species.captureBaseRate * hpFactor * 1 * 1 * itemQuality));
}

function doCapture(ctx: Ctx, actor: BattleUnit, target: BattleUnit, itemId: string, source: CommandSource): void {
  if (source === "auto" || ctx.rules.confirmed.autoCapture.value !== false) {
    reject("AUTO_CAPTURE_FORBIDDEN", "capture is a manual player command only (C15)");
  }
  requirePlayerActor(actor, "capture");
  if (target.side !== "enemy" || !active(target)) reject("INVALID_TARGET", "capture needs a living enemy");
  // Level gate is checked before any item is consumed (C09).
  const gap = ctx.rules.confirmed.captureWildLevelGap.value;
  if (target.level > actor.level + gap) {
    reject("LEVEL_INELIGIBLE", `wild Lv${target.level} > player Lv${actor.level} + ${gap}`);
  }
  if (!target.captureWindowOpen) reject("NO_VALID_CAPTURE_WINDOW", "this target has no open capture window");
  const species = ctx.content.species.get(target.speciesId!)!;
  const item = ctx.content.items.get(itemId) ?? reject("MISSING_REFERENCE", `item ${itemId}`);
  if (item.kind !== "capture" || item.captureSpeciesId !== species.id) {
    reject("INVALID_COMMAND", `${itemId} cannot capture ${species.id}`);
  }
  if ((ctx.s.bag[itemId] ?? 0) <= 0) reject("INSUFFICIENT_RESOURCE", `no ${itemId} in the combat bag`);
  const p = captureProbability(ctx.rules, species, target, item.captureQuality ?? 1);
  if (p === null) reject("UNRESOLVED_RULE", "capture rate table is OPEN (O07)");

  consumeItem(ctx, itemId); // a failed capture still uses the item, exactly once
  const success = ctx.rng.chance(p!);
  actionEvent(ctx, actor, "capture", target, {});
  ctx.emit({ type: "CaptureResolved", targetId: target.unitId, speciesId: species.id, success, probability: p! });
  if (!success) return;

  target.retired = true;
  target.guarding = false;
  if (ctx.s.resolutions[target.unitId] !== undefined) throw new Error(`enemy ${target.unitId} resolved twice`);
  ctx.s.resolutions[target.unitId] = "captured";
  const entitlement: Entitlement = {
    entitlementId: `${ctx.s.battleId}:${target.unitId}:captured`,
    kind: "capture",
    enemyUnitId: target.unitId,
    speciesId: species.id,
    element: target.element,
    level: ctx.rules.confirmed.capturedInitialLevel.value,
    ...expAwards(ctx, target.level),
  };
  ctx.s.entitlements.push(entitlement);
  ctx.emit({ type: "RewardEntitled", entitlement });
}

function doMove(ctx: Ctx, actor: BattleUnit, row: Row, slot: number): void {
  const max = row === "front" ? ctx.rules.provisional.formationFrontSlots.value : ctx.rules.provisional.formationBackSlots.value;
  if (!Number.isInteger(slot) || slot < 0 || slot >= max) reject("FORMATION_INVALID", `slot ${slot} out of range`);
  if (actor.row === row && actor.slot === slot) reject("INVALID_COMMAND", "already there");
  if (actor.movedThisRound) reject("INVALID_COMMAND", "this unit was already moved this round");
  const other = ctx.s.units.find((u) => u.side === actor.side && u.row === row && u.slot === slot);
  if (other !== undefined && other.movedThisRound) reject("INVALID_COMMAND", `${other.unitId} was already moved this round`);
  if (other !== undefined) {
    other.row = actor.row;
    other.slot = actor.slot;
    other.movedThisRound = true;
  }
  actor.row = row;
  actor.slot = slot;
  actor.movedThisRound = true;
  actionEvent(ctx, actor, "move", other ?? null);
}

function doFlee(ctx: Ctx, actor: BattleUnit): void {
  requirePlayerActor(actor, "flee");
  const chance = ctx.rules.unresolved.fleeChance.value;
  if (chance === null) reject("UNRESOLVED_RULE", "flee formula is OPEN (O15)");
  const ok = ctx.rng.chance(chance!);
  actionEvent(ctx, actor, "flee", null, { hit: ok });
  if (ok) endBattle(ctx, "fled");
}

// ================================================================ enemy AI and end

/** Prototype AI: basic attack on a random valid target. */
/**
 * Wild enemy turn (chapter 08 rule engine, P15 enemyAi): a usable skill by chance, else a basic
 * attack; disarmed with no skill left, it guards. Every pick passes the same checks as a manual
 * command, so the AI never tries what the validator would refuse.
 */
function enemyAct(ctx: Ctx, u: BattleUnit): void {
  const disarmed = statusBlocks(u.statuses, "attack") !== undefined;
  const options = enemySkillOptions(ctx, u);
  if (options.length > 0 && (disarmed || ctx.rng.chanceBp(ctx.rules.provisional.enemyAi.value.skillChancePct * 100))) {
    const pick = options[ctx.rng.nextInt(options.length)]!;
    return doSkill(ctx, u, pick.skillId, pick.target);
  }
  if (disarmed) {
    u.guarding = true;
    return actionEvent(ctx, u, "guard", null);
  }
  const targets = validTargets(ctx.s, "ally", u.basicAttackRange);
  if (targets.length === 0) return;
  const taunter = tauntedBy(ctx.s, u);
  const target = taunter !== undefined && targets.includes(taunter) ? taunter : targets[ctx.rng.nextInt(targets.length)]!;
  doAttack(ctx, u, target, null);
}

/** Whether putting this status on `t` would do anything (so the AI does not waste a turn). */
function worthApplying(caster: BattleUnit, t: BattleUnit, statusId: StatusId): boolean {
  const list = t.statuses ?? [];
  const has = (harmful: boolean) => list.some((x) => STATUS_DEFINITIONS[x.statusId].harmful === harmful);
  switch (statusId) {
    case "protect":
      return t.unitId !== caster.unitId && statusOf(t, "protect") === undefined;
    case "cleanse":
      return has(true);
    case "dispel":
    case "steal_buff":
    case "invert":
    case "extend":
      return has(false);
    default:
      return STATUS_DEFINITIONS[statusId].instant !== undefined || statusOf(t, statusId) === undefined;
  }
}

/** The skills an enemy could use right now, each with the target the AI would give it. */
function enemySkillOptions(ctx: Ctx, u: BattleUnit): { skillId: string; target: BattleUnit }[] {
  const st = u.statuses ?? [];
  if (u.skillIds.length === 0 || statusBlocks(st, "skills") !== undefined) return [];
  const ai = ctx.rules.provisional.enemyAi.value;
  const out: { skillId: string; target: BattleUnit }[] = [];
  const useful = (t: BattleUnit, list: readonly StatusApplication[]) => list.some((a) => worthApplying(u, t, a.statusId));
  for (const skillId of u.skillIds) {
    const skill = ctx.content.skills.get(skillId);
    if (skill === undefined || skill.kind !== "active" || skill.effectSequence.length !== 1) continue;
    const { mpCost, cooldown } = skillCost(ctx, u, skill);
    if (cooldown > 0 && ctx.rules.unresolved.cooldownTick.value === null) continue;
    if ((u.cooldowns[skillId] ?? 0) > 0 || u.mp < mpCost) continue;
    if (mpCost > 0 && statusBlocks(st, "mp_skills") !== undefined) continue;
    if (st.some((x) => x.statusId === "skill_lock" && x.skillId === skillId)) continue;
    const effect = skill.effectSequence[0]!;
    const onEnemy = effect.kind === "damage" || (effect.kind === "status" && skill.targetRule === "single_enemy");
    let pool: BattleUnit[];
    if (onEnemy) {
      if (skill.targetRule !== "single_enemy") continue;
      pool = validTargets(ctx.s, "ally", skill.range);
      const taunter = tauntedBy(ctx.s, u);
      if (taunter !== undefined && pool.includes(taunter)) pool = [taunter];
      if (effect.kind === "status") pool = pool.filter((t) => useful(t, effect.statuses));
    } else {
      pool = skill.targetRule === "self" ? [u] : ctx.s.units.filter((x) => x.side === u.side && active(x));
      if (effect.kind === "heal") {
        pool = pool.filter((t) => t.hp * 100 < ai.healBelowHpPct * t.stats.maxHp).sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp);
        pool = pool.slice(0, 1);
      } else if (effect.kind === "status") pool = pool.filter((t) => useful(t, effect.statuses));
    }
    if (pool.length === 0) continue;
    out.push({ skillId, target: pool[pool.length === 1 ? 0 : ctx.rng.nextInt(pool.length)]! });
  }
  return out;
}

function checkEnd(ctx: Ctx): void {
  if (ctx.s.status !== "active") return;
  const enemiesLeft = ctx.s.units.some((u) => u.side === "enemy" && active(u));
  const alliesLeft = ctx.s.units.some((u) => u.side === "ally" && active(u));
  if (!enemiesLeft) endBattle(ctx, "victory");
  else if (!alliesLeft) endBattle(ctx, "defeat");
}

function endBattle(ctx: Ctx, outcome: "victory" | "defeat" | "fled"): void {
  const s = ctx.s;
  s.status = outcome;
  companionResults(ctx, outcome);
  // Buffs, guard and cooldowns end with the fight; HP/MP carry over (chapter 03 §3).
  for (const u of s.units) {
    u.guarding = false;
    u.cooldowns = {};
    u.statuses = [];
  }
  ctx.emit({
    type: "BattleEnded",
    outcome,
    allies: s.units
      .filter((u) => u.side === "ally")
      .map((u) => ({ unitId: u.unitId, instanceId: u.instanceId, hp: u.hp, mp: u.mp, ko: u.ko })),
    consumed: { ...s.consumed },
    unusedReserved: Object.fromEntries(Object.entries(s.bag).filter(([, q]) => q > 0)),
  });
}

/**
 * Bond and skill mastery when a fight ends (chapter 04 §5–§6), for every companion that started it.
 * Mastery: won fights only, KO'd or not, counted per enemy defeated or captured (heal or buff loops add
 * nothing). Bond: a companion that fell in the fight loses some, whatever the outcome (Nut 2026-10-03);
 * one that stayed up through a win gains some; nothing else changes it.
 */
function companionResults(ctx: Ctx, outcome: "victory" | "defeat" | "fled"): void {
  const p = ctx.rules.provisional;
  const won = outcome === "victory";
  const mastery = won ? masteryForVictory(ctx.rules, Object.keys(ctx.s.resolutions).length) : 0;
  const companions: Record<string, { bond: number; mastery: number }> = {};
  for (const u of ctx.s.units) {
    if (u.kind !== "companion" || u.instanceId === null) continue;
    const bond = u.fell === true ? -p.bondLossOnFall.value : won ? p.bondPerVictory.value : 0;
    if (bond !== 0 || mastery !== 0) companions[u.instanceId] = { bond, mastery };
  }
  if (Object.keys(companions).length === 0) return;
  const entitlement: Entitlement = { entitlementId: `${ctx.s.battleId}:all:result`, kind: "fight_result", companions };
  ctx.s.entitlements.push(entitlement);
  ctx.emit({ type: "RewardEntitled", entitlement });
}

// ================================================================ auto battle

/**
 * Auto Battle for the current ally (C14). First the player's item rules, in order (chapter 08:
 * only allowed items, only below the set HP, at most the set count per fight; items are the
 * character's action), then a basic attack on the lowest-HP valid enemy.
 * Never captures (C15), never flees.
 */
export function chooseAutoCommand(
  state: BattleState,
  content?: Pick<BattleContent, "items">,
  policy: AutoBattlePolicy = NO_AUTO_POLICY,
): BattleCommand | null {
  const actor = currentActor(state);
  if (actor === null || actor.side !== "ally") return null;
  if (actor.kind === "player" && content !== undefined) {
    for (const rule of policy.itemRules) {
      if (content.items.get(rule.itemId)?.kind !== "heal") continue;
      if ((state.bag[rule.itemId] ?? 0) <= 0 || (state.consumed[rule.itemId] ?? 0) >= rule.maxPerFight) continue;
      const pool = rule.target === "self" ? [actor] : state.units.filter((u) => u.side === "ally" && active(u));
      const low = pool
        .filter((u) => active(u) && u.hp * 100 < rule.hpBelowPercent * u.stats.maxHp)
        .sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp)[0];
      if (low !== undefined) return { type: "item", actorId: actor.unitId, itemId: rule.itemId, targetId: low.unitId };
    }
  }
  // Disarmed: guard. Taunted: hit the taunter when it can be reached.
  if (statusBlocks(actor.statuses, "attack") !== undefined) return { type: "guard", actorId: actor.unitId };
  const targets = validTargets(state, "enemy", actor.basicAttackRange);
  if (targets.length === 0) return null;
  const taunter = tauntedBy(state, actor);
  const target = taunter !== undefined && targets.includes(taunter) ? taunter : targets.reduce((best, u) => (u.hp < best.hp ? u : best));
  return { type: "attack", actorId: actor.unitId, targetId: target.unitId };
}

/** What the client may see. The RNG state stays on the server. */
export function publicView(state: BattleState): Omit<BattleState, "rng"> {
  const { rng: _rng, ...rest } = state;
  return structuredClone(rest);
}
