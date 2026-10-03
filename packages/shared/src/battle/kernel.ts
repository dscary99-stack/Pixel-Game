/**
 * Deterministic turn-based combat kernel (chapter 03, chapter 11 §2–§3).
 *
 * Pure: every call clones the state, uses only the server RNG stored in it, and returns
 * new state + events. Same setup + same seed + same commands => identical results.
 * The Battle Durable Object owns persistence, idempotency and auth; this file owns the rules.
 */
import { computeDamage, computeHeal, critChanceBp, hitChanceBp } from "../damage";
import { rollLoot } from "../loot";
import { killExp } from "../progression";
import { Rng, seedRng } from "../rng";
import type { RulesConfig } from "../rules";
import type { ItemDefinition, LootTable, SkillDefinition, SpeciesDefinition } from "../schemas";
import { deriveStats } from "../stats";
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
    const stats = deriveStats(inst.currentLevel, inst.primaryStats);
    units.push({
      unitId: `ally:${inst.id}`,
      side: "ally",
      kind: "companion",
      name: sp.name.th,
      speciesId: sp.id,
      instanceId: inst.id,
      level: inst.currentLevel,
      element: inst.element,
      rank: null,
      row: c.row,
      slot: c.slot,
      stats,
      hp: clampResource(c.hp, stats.maxHp),
      mp: clampResource(c.mp, stats.maxMp),
      skillIds: sp.skillIds.filter((id) => content.skills.get(id)?.kind === "active"),
      basicAttackRange: sp.basicAttackRange,
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
      skillIds: [],
      basicAttackRange: sp.basicAttackRange,
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
function startRound(ctx: Ctx): void {
  const s = ctx.s;
  s.round += 1;
  s.turnIndex = 0;
  for (const u of s.units) u.movedThisRound = false;
  const ready = s.units.filter(active).map((u) => ({ id: u.unitId, spd: u.stats.spd, tie: ctx.rng.nextUint32() }));
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
    if (u.side === "ally") return;
    enemyAct(ctx, u);
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
    resolveCommand(ctx, actor!, cmd, opts.source);
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
  const alive = state.units.filter((u) => u.side === side && active(u));
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
  // Phase A assumption: basic attacks are physical, coefficient 1, NEUTRAL element.
  strike(ctx, actor, target, "attack", null, { damageType: "physical", coefficient: 1, flat: 0, element: "NEUTRAL" });
}

function doSkill(ctx: Ctx, actor: BattleUnit, skillId: string, target: BattleUnit): void {
  if (!actor.skillIds.includes(skillId)) reject("INVALID_COMMAND", `${actor.unitId} has no skill ${skillId}`);
  const skill = requireActiveSkill(ctx.content, skillId);
  if (skill.cooldown > 0 && ctx.rules.unresolved.cooldownTick.value === null) {
    reject("UNRESOLVED_RULE", "skill cooldown tick point is OPEN (O15)");
  }
  if ((actor.cooldowns[skillId] ?? 0) > 0) reject("ON_COOLDOWN", `${skillId} ready in ${actor.cooldowns[skillId]} turns`);
  if (actor.mp < skill.mpCost) reject("INSUFFICIENT_RESOURCE", `needs ${skill.mpCost} MP`);
  const effect = skill.effectSequence[0]!;
  if (skill.effectSequence.length !== 1) reject("UNRESOLVED_RULE", "multi-effect skills wait for O15 (multi-hit, chains)");

  if (effect.kind === "damage") {
    if (skill.targetRule !== "single_enemy") reject("INVALID_COMMAND", "damage skill must target a single enemy in Phase A");
    requireEnemyTarget(ctx, actor, target, skill.range);
  } else {
    const allowed = skill.targetRule === "self" ? target.unitId === actor.unitId : skill.targetRule === "single_ally";
    if (!allowed || target.side !== actor.side) reject("INVALID_TARGET", "heal needs an ally target");
    if (!active(target)) reject("INVALID_TARGET", "heals do not revive (chapter 03 §6)");
  }

  actor.mp -= skill.mpCost;
  if (skill.cooldown > 0) actor.cooldowns[skillId] = skill.cooldown;

  if (effect.kind === "damage") {
    strike(ctx, actor, target, "skill", skillId, effect);
  } else {
    const amount = computeHeal(actor.stats.support, effect.coefficient, effect.flat);
    const applied = Math.min(amount, target.stats.maxHp - target.hp); // overheal discarded
    target.hp += applied;
    actionEvent(ctx, actor, "skill", target, { skillId, heal: applied, targetHpAfter: target.hp });
  }
}

function strike(
  ctx: Ctx,
  actor: BattleUnit,
  target: BattleUnit,
  action: "attack" | "skill",
  skillId: string | null,
  eff: { damageType: "physical" | "magic"; coefficient: number; flat: number; element: BattleUnit["element"] },
): void {
  const rules = ctx.rules;
  const hit = ctx.rng.chanceBp(hitChanceBp(rules, actor.stats.accuracyPct, target.stats.evasionPct));
  if (!hit) {
    actionEvent(ctx, actor, action, target, { skillId, hit: false, crit: false, damage: 0 });
    return;
  }
  const crit = ctx.rng.chanceBp(critChanceBp(rules, actor.stats.critPct));
  const physical = eff.damageType === "physical";
  const breakdown = computeDamage(rules, {
    attackPower: physical ? actor.stats.patk : actor.stats.matk,
    skillCoefficient: eff.coefficient,
    skillFlat: eff.flat,
    defense: physical ? target.stats.pdef : target.stats.mdef,
    attackElement: eff.element,
    defenderElement: target.element,
    crit,
    critDamageBonus: actor.stats.critDamageBonus,
    guarding: target.guarding,
  });
  target.hp = Math.max(0, target.hp - breakdown.final);
  actionEvent(ctx, actor, action, target, { skillId, hit: true, crit, damage: breakdown.final, breakdown, targetHpAfter: target.hp });
  if (target.hp === 0) knockOut(ctx, target);
}

function knockOut(ctx: Ctx, u: BattleUnit): void {
  u.ko = true;
  u.guarding = false;
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
    items: rollLoot(ctx.rules, table, ctx.s.originMode, ctx.rng),
    exp: killExp(ctx.rules, u.level),
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
  const applied = Math.min(item.healHp ?? 0, target.stats.maxHp - target.hp);
  target.hp += applied;
  actionEvent(ctx, actor, "item", target, { heal: applied, targetHpAfter: target.hp });
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
    exp: killExp(ctx.rules, target.level),
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
function enemyAct(ctx: Ctx, u: BattleUnit): void {
  const targets = validTargets(ctx.s, "ally", u.basicAttackRange);
  if (targets.length === 0) return;
  const target = targets[ctx.rng.nextInt(targets.length)]!;
  doAttack(ctx, u, target, null);
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
  // Buffs, guard and cooldowns end with the fight; HP/MP carry over (chapter 03 §3).
  for (const u of s.units) {
    u.guarding = false;
    u.cooldowns = {};
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

// ================================================================ auto battle

/**
 * Auto Battle policy for the current ally (C14): basic attack on the lowest-HP valid enemy.
 * Never captures (C15), never flees.
 */
export function chooseAutoCommand(state: BattleState): BattleCommand | null {
  const actor = currentActor(state);
  if (actor === null || actor.side !== "ally") return null;
  const targets = validTargets(state, "enemy", actor.basicAttackRange);
  if (targets.length === 0) return null;
  const target = targets.reduce((best, u) => (u.hp < best.hp ? u : best));
  return { type: "attack", actorId: actor.unitId, targetId: target.unitId };
}

/** What the client may see. The RNG state stays on the server. */
export function publicView(state: BattleState): Omit<BattleState, "rng"> {
  const { rng: _rng, ...rest } = state;
  return structuredClone(rest);
}
