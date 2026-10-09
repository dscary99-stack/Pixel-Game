/**
 * Deterministic turn-based combat kernel (chapter 03, chapter 11 §2–§3).
 *
 * Pure: every call clones the state, uses only the server RNG stored in it, and returns
 * new state + events. Same setup + same seed + same commands => identical results.
 * The Battle Durable Object owns persistence, idempotency and auth; this file owns the rules.
 */
import { applyBond, bondBonusPercent, bondTier } from "../bond";
import { companionCombatProfile } from "../companion-growth";
import { companionKit, effectiveSkillLevel, masteryForVictory, skillLevelCap, skillLevelMods, trainedSkillLevel } from "../skill-training";
import { AutoBattlePolicySchema, type AutoBattlePolicyInput, type AutoItemRule } from "./auto-policy";
import { computeDamage, computeHeal, critChanceBp, hitChanceBp } from "../damage";
import { rollLoot } from "../loot";
import { eliteModifierIssues } from "../elite";
import { FrontierModifierIdSchema, frontierMaxReinforcements, frontierModifierStats, frontierStatPct, type FrontierModifierId } from "../frontier";
import { companionExp, killExp } from "../progression";
import { Rng, seedRng } from "../rng";
import type { CaptureProfile, RulesConfig } from "../rules";
import { captureChance, captureCheck, fightCaptureProfile, type CaptureBreakdown } from "../capture";
import { fleeChance, reviveBlock, reviveHp } from "../flee";
import type { BossDefinition, DamageEffect, Element, ItemDefinition, LootTable, Passive, PassiveAction, PassiveEvent, PassiveModifier, SigilDefinition, SkillDefinition, SpeciesDefinition, StatusApplication } from "../schemas";
import { isAreaRule, targetsEnemies } from "../schemas";
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
  /** Needed when the player wears Sigils (their effects). */
  sigils?: ReadonlyMap<string, SigilDefinition>;
  /** Needed for boss fights (chapter 07 §5). */
  bosses?: ReadonlyMap<string, BossDefinition>;
}

/**
 * A boss fight's enemies: the boss front-centre, then each add in its row's next free slot
 * (centre outwards). The boss is always `e1`.
 */
export function bossEnemies(def: BossDefinition): BattleSetup["enemies"] {
  const order = [2, 1, 3, 0, 4];
  const used = { front: 1, back: 0 };
  const next = (row: "front" | "back") => {
    const slot = order[used[row]++];
    if (slot === undefined) reject("FORMATION_INVALID", `boss ${def.id}: too many units in the ${row} row`);
    return slot!;
  };
  const adds = def.adds.map((a, i) => ({ unitId: `e${i + 2}`, speciesId: a.speciesId, element: a.element, row: a.row, slot: next(a.row), lootEligible: a.lootEligible }));
  // Parts stand beside the boss after the adds (chapter 07 §5); they are built from the boss's species.
  const parts = (def.parts ?? []).map((p, i) => ({
    unitId: `e${def.adds.length + i + 2}`,
    speciesId: def.speciesId,
    element: def.element,
    row: p.row,
    slot: next(p.row),
    lootEligible: false,
    part: { partId: p.id, name: p.name.th, effect: p.effect, pct: p.pct, hpPct: p.hpPct },
  }));
  return [{ unitId: "e1", speciesId: def.speciesId, element: def.element, row: "front", slot: 2 }, ...adds, ...parts];
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
  /** Set while a passive's effects resolve, so passives never set off more passives. */
  inPassive = false;
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

/** The account that commands an ally: its controller in a party fight, else the fight's owner. */
export const controllerOf = (state: Pick<BattleState, "ownerAccountId">, u: Pick<BattleUnit, "controllerId">): string => u.controllerId ?? state.ownerAccountId;

/** The combat bag an ally's items come from: its controller's own (party fights), else the fight's. */
export function combatBagOf<S extends Pick<BattleState, "bag" | "consumed" | "members">>(state: S, u: Pick<BattleUnit, "controllerId">): Pick<BattleState, "bag" | "consumed"> {
  const m = u.controllerId === undefined ? undefined : state.members?.find((x) => x.accountId === u.controllerId);
  return m ?? state;
}

/** Companion-box room per player, when the server counted it (P26). */
function roomOf(players: readonly { accountId: string; companionRoom?: number }[]): { companionRoom?: Record<string, number> } {
  const known = players.filter((x) => x.companionRoom !== undefined);
  return known.length === 0 ? {} : { companionRoom: Object.fromEntries(known.map((x) => [x.accountId, x.companionRoom!])) };
}

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

function createBattleInner(rules: RulesConfig, content: BattleContent, setup0: BattleSetup): KernelResult {
  const bossDef = setup0.boss === undefined ? undefined : (content.bosses?.get(setup0.boss.bossId) ?? reject("MISSING_REFERENCE", `boss ${setup0.boss.bossId}`));
  if (bossDef !== undefined && setup0.enemies.length > 0) reject("INVALID_COMMAND", "a boss fight builds its own enemies");
  const tower = setup0.frontier;
  const floor = tower?.floor;
  if (floor !== undefined && (!Number.isInteger(floor) || floor < 1 || floor > rules.confirmed.frontierFloors.value)) reject("INVALID_COMMAND", `no tower floor ${floor}`);
  const modifiers: FrontierModifierId[] = [...(tower?.modifiers ?? [])];
  for (const m of modifiers) if (!FrontierModifierIdSchema.safeParse(m).success) reject("INVALID_COMMAND", `unknown tower gimmick ${m}`);
  if (new Set(modifiers).size !== modifiers.length || modifiers.length > 3) reject("INVALID_COMMAND", "a floor has up to 3 different gimmicks");
  if (tower?.escorts !== undefined && tower.escorts.length > 0 && bossDef === undefined) reject("INVALID_COMMAND", "escorts stand next to a guardian only");
  const queue = (tower?.reinforcements ?? []).map((m) => ({ speciesId: m.speciesId, element: m.element }));
  if (queue.length > frontierMaxReinforcements(rules)) reject("INVALID_COMMAND", `${queue.length} reinforcements > ${frontierMaxReinforcements(rules)}`);
  for (const m of queue) {
    const sp = content.species.get(m.speciesId) ?? reject("MISSING_REFERENCE", `species ${m.speciesId}`);
    if (sp.rank === "BOSS") reject("INVALID_COMMAND", "a reinforcement is never a boss");
    if (!sp.allowedElements.includes(m.element)) reject("INVALID_COMMAND", `reinforcement ${m.speciesId} element not allowed for species`);
  }
  const setup: BattleSetup = bossDef === undefined ? setup0 : { ...setup0, enemies: withEscorts(bossEnemies(bossDef), tower?.escorts ?? []) };
  const towerPct = floor === undefined ? 100 : frontierStatPct(rules, floor);
  const bossLoot = bossDef?.lootTableId;
  if (bossLoot !== undefined && !content.lootTables.has(bossLoot)) reject("MISSING_REFERENCE", `loot table ${bossLoot}`);
  if (bossDef !== undefined) {
    const sp = content.species.get(bossDef.speciesId);
    if (sp?.rank !== "BOSS") reject("INVALID_COMMAND", `boss ${bossDef.id} needs a BOSS species`);
    for (const ph of bossDef.phases) {
      if (ph.telegraph !== undefined && !sp!.skillIds.includes(ph.telegraph.skillId)) reject("MISSING_REFERENCE", `telegraph ${ph.telegraph.skillId} is not the boss's skill`);
    }
  }
  const party = setup.partyMembers ?? [];
  if (party.length > 0) {
    // Nut 2026-10-07: a party fights a boss together, 1 companion each, up to 5 players (10 ally places).
    if (bossDef === undefined || tower !== undefined) reject("INVALID_COMMAND", "only a field boss is fought as a party");
    if (party.length + 1 > rules.confirmed.partyMaxMembers.value) reject("INVALID_COMMAND", `${party.length + 1} players > ${rules.confirmed.partyMaxMembers.value}`);
    const each = rules.confirmed.partyBossCompanionsEach.value;
    for (const m of [{ player: setup.player, companions: setup.companions }, ...party]) {
      if (m.companions.length > each) reject("INVALID_COMMAND", `${m.player.accountId} brings ${m.companions.length} companions > ${each}`);
    }
    const accounts = [setup.player.accountId, ...party.map((m) => m.player.accountId)];
    if (new Set(accounts).size !== accounts.length) reject("INVALID_COMMAND", "a player is in the fight twice");
  }
  // C04 (no duplicate species) is per player's own team; party members may bring the same species.
  const teamIssues = [
    ...[setup.companions, ...party.map((m) => m.companions)].flatMap((cs) =>
      validateTeam(
        rules,
        cs.map((c) => ({ instanceId: c.instance.id, speciesId: c.instance.speciesId })),
      ),
    ),
    ...validateEnemyCount(rules, setup.enemies.length),
  ];
  if (teamIssues.length > 0) reject(teamIssues[0]!.code, teamIssues.map((i) => i.message).join("; "));
  if (setup.enemies.length === 0) reject("INVALID_COMMAND", "battle needs at least one enemy");
  validateBag(rules, content, setup.bag);
  for (const m of party) validateBag(rules, content, m.bag);

  const units: BattleUnit[] = [
    ...allyUnits(rules, content, setup.player, setup.companions, "player", party.length > 0 ? setup.player.accountId : undefined),
    ...party.flatMap((m, i) => allyUnits(rules, content, m.player, m.companions, `player:${i + 2}`, m.player.accountId)),
  ];
  for (const e of setup.enemies) units.push(enemyUnit(rules, content, e, { bossDef, towerPct, modifiers }));

  validateFormation(rules, units, party.length > 0);
  if (!units.some((u) => u.side === "ally" && !u.ko)) reject("INVALID_COMMAND", "no ally can fight");
  const p = setup.player;

  const state: BattleState = {
    battleId: setup.battleId,
    rulesVersion: rules.rulesVersion,
    originMode: setup.originMode,
    ...(setup.practice === true ? { practice: true } : {}),
    ownerAccountId: p.accountId,
    // Pinned for the whole fight (capture.ts): a deploy never changes a running fight's odds.
    captureProfile: rules.provisional.captureProfile.value,
    stateVersion: 0,
    round: 0,
    turnOrder: [],
    turnIndex: 0,
    units,
    bag: { ...setup.bag },
    consumed: {},
    ...(party.length > 0 ? { members: party.map((m, i) => ({ accountId: m.player.accountId, playerUnitId: `player:${i + 2}`, bag: { ...m.bag }, consumed: {} })) } : {}),
    ...roomOf([p, ...party.map((m) => m.player)]),
    ...(setup.partyBonus !== undefined && setup.partyBonus.partners > 0 ? { partyBonus: { ...setup.partyBonus } } : {}),
    ...(setup.mapId !== undefined ? { mapId: setup.mapId } : {}),
    rng: seedRng(setup.seed),
    eventSeq: 0,
    status: "active",
    resolutions: {},
    entitlements: [],
    ...(bossDef !== undefined
      ? { boss: { bossId: bossDef.id, unitId: "e1", phase: 0, shieldBroken: false, telegraph: null, lastTelegraphRound: 0 } }
      : {}),
    ...(floor !== undefined
      ? { frontier: { floor, statPct: towerPct, modifiers, reinforcementsLeft: queue.length, queue, nextUnit: setup.enemies.length + 1 } }
      : {}),
  };
  const ctx = new Ctx(state, rules, content, null);
  ctx.emit({ type: "BattleStarted", originMode: state.originMode, rulesVersion: state.rulesVersion, unitIds: units.map((u) => u.unitId) });
  if (bossDef !== undefined) enterBossPhase(ctx, 0);
  startElites(ctx);
  for (const u of units) if (u.side === "enemy") startFrontierUnit(ctx, u);
  for (const u of units) if (active(u)) firePassives(ctx, u, "battle_start");
  startRound(ctx);
  advanceToAllyInput(ctx);
  return ctx.finish();
}

/** One player's character and companions as units. `controllerId` is set in party fights only. */
function allyUnits(rules: RulesConfig, content: BattleContent, p: BattleSetup["player"], companions: BattleSetup["companions"], playerUnitId: string, controllerId: string | undefined): BattleUnit[] {
  const units: BattleUnit[] = [];
  const ctl = controllerId === undefined ? {} : { controllerId };
  const pStats = deriveStats(p.level, p.primaryStats, p.gear);
  for (const sid of p.skillIds) requireActiveSkill(content, sid);
  const sigils: Record<string, number> = {};
  for (const id of p.sigilIds ?? []) {
    if (content.sigils?.has(id) !== true) reject("MISSING_REFERENCE", `sigil ${id}`);
    sigils[id] = (sigils[id] ?? 0) + 1;
  }
  units.push({
    unitId: playerUnitId,
    side: "ally",
    kind: "player",
    ...ctl,
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
    ...(Object.keys(sigils).length > 0 ? { sigils } : {}),
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

  for (const c of companions) {
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
      ...ctl,
      name: inst.nickname ?? sp.name.th,
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
      passiveIds: kit.map((k) => k.skillId).filter((id) => content.skills.get(id)?.passive !== undefined),
      bondPercent,
      bondTier: bondTier(rules, inst.bond),
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

  return units;
}

/** Boss floors of the tower: escorts take the free enemy cells next to the guardian and its adds, in order. */
function withEscorts(enemies: BattleSetup["enemies"], escorts: readonly { speciesId: string; element: Element }[]): BattleSetup["enemies"] {
  if (escorts.length === 0) return enemies;
  const order = [2, 1, 3, 0, 4];
  const free = (["front", "back"] as const).flatMap((row) => order.map((slot) => ({ row, slot }))).filter((c) => !enemies.some((e) => e.row === c.row && e.slot === c.slot));
  if (escorts.length > free.length) reject("FORMATION_INVALID", `${escorts.length} escorts > ${free.length} free cells`);
  return [...enemies, ...escorts.map((m, i) => ({ unitId: `e${enemies.length + i + 1}`, speciesId: m.speciesId, element: m.element, row: free[i]!.row, slot: free[i]!.slot }))];
}

/**
 * One wild enemy unit: the species at its fixed wild level (C29), a boss's or elite's rank on top, then
 * the tower floor's stat % and gimmicks. Used at fight start and for tower reinforcements.
 */
function enemyUnit(
  rules: RulesConfig,
  content: BattleContent,
  e: BattleSetup["enemies"][number],
  o: { bossDef: BossDefinition | undefined; towerPct: number; modifiers: readonly FrontierModifierId[] },
): BattleUnit {
  const { bossDef, towerPct, modifiers } = o;
  const sp = content.species.get(e.speciesId) ?? reject("MISSING_REFERENCE", `species ${e.speciesId}`);
  if (!sp.allowedElements.includes(e.element)) reject("INVALID_COMMAND", `${e.unitId} element not allowed for species`);
  if (!content.lootTables.has(sp.lootTableId)) reject("MISSING_REFERENCE", `loot table ${sp.lootTableId}`);
  // Wild level is the species' fixed level everywhere (C29). There is no override input.
  const base = deriveStats(sp.fixedWildLevel, sp.wildPrimaryStats);
  // A wild boss has more HP than its species (chapter 07 §5); a captured one never keeps it.
  const isBoss = bossDef !== undefined && e.unitId === "e1";
  const bossLoot = bossDef?.lootTableId;
  // An elite leader is tougher in the wild only (elite.ts, P12); a captured one never keeps it.
  if (e.elite !== undefined) {
    if (sp.rank === "BOSS" || bossDef !== undefined) reject("INVALID_COMMAND", `${e.unitId}: a boss is never an elite`);
    const bad = eliteModifierIssues(e.elite.modifiers);
    if (bad.length > 0) reject("INVALID_COMMAND", `${e.unitId}: ${bad.join("; ")}`);
  }
  const el = rules.provisional.elite.value;
  if (e.part !== undefined && (bossDef === undefined || e.speciesId !== bossDef.speciesId)) reject("INVALID_COMMAND", `${e.unitId}: a part belongs to the boss`);
  const ranked = isBoss
    ? { ...base, maxHp: Math.floor(base.maxHp * bossDef!.hpMultiplier) }
    : e.part !== undefined
      ? { ...base, maxHp: Math.max(1, Math.floor((base.maxHp * bossDef!.hpMultiplier * e.part.hpPct) / 100)) }
    : e.elite !== undefined
      ? scaleWildStats(base, Math.round(el.hpMultiplier * 100), el.powerPct)
      : base;
  // A tower floor scales every enemy the same way an elite is scaled, on top of its rank, then its
  // gimmicks change ATK/DEF/MATK/SPD (frontier.ts); never the level.
  const stats = frontierModifierStats(rules, towerPct === 100 ? ranked : scaleWildStats(ranked, towerPct, towerPct), modifiers);
  // Wild monsters fight with their species' active skills, at the cap their wild level allows.
  for (const id of sp.skillIds) if (!content.skills.has(id)) reject("MISSING_REFERENCE", `skill ${id}`);
  const wildSkillIds = sp.skillIds.filter((id) => content.skills.get(id)?.kind === "active");
  const wildSkillLevel = skillLevelCap(rules, sp.fixedWildLevel);
  const innate = content.skills.get(sp.innatePassiveId);
  const unit: BattleUnit = {
    unitId: e.unitId,
    side: "enemy",
    kind: "enemy",
    name: sp.name.th,
    speciesId: sp.id,
    instanceId: null,
    level: sp.fixedWildLevel,
    element: e.element,
    rank: e.elite !== undefined ? "ELITE" : sp.rank,
    row: e.row,
    slot: e.slot,
    stats,
    hp: stats.maxHp,
    mp: stats.maxMp,
    skillIds: wildSkillIds,
    skillLevels: Object.fromEntries(wildSkillIds.map((id) => [id, wildSkillLevel])),
    passiveIds: innate?.passive !== undefined ? [innate.id] : [],
    basicAttackRange: sp.basicAttackRange,
    primaryStats: { ...sp.wildPrimaryStats },
    statuses: [],
    ko: false,
    retired: false,
    guarding: false,
    cooldowns: {},
    movedThisRound: false,
    captureWindowOpen: e.captureWindowOpen ?? sp.rank !== "BOSS",
    lootTableId: e.lootEligible === false ? null : isBoss && bossLoot !== undefined ? bossLoot : sp.lootTableId,
    ...(e.elite !== undefined ? { elite: { modifiers: [...e.elite.modifiers], enraged: false, moraleBroken: false, counterOn: null } } : {}),
    ...(sp.rank === "BOSS" && (sp.bossActionsPerRound ?? 1) > 1
      ? { actionsPerRound: Math.min(sp.bossActionsPerRound!, rules.provisional.bossActions.value.maxPerRound) }
      : {}),
  };
  if (e.part === undefined) return unit;
  // A part never acts and is not the boss: no skills, no passives, one (unused) action, never capturable.
  const { actionsPerRound: _a, ...still } = unit;
  return { ...still, name: e.part.name, skillIds: [], skillLevels: {}, passiveIds: [], captureWindowOpen: false, lootTableId: null, part: { partId: e.part.partId, effect: e.part.effect, pct: e.part.pct } };
}

/**
 * A wild unit made tougher (an elite leader, a tower floor): HP by `hpPct`, ATK and MATK by `powerPct`,
 * whole numbers, rounded down. Everything else (level, DEF, SPD, skills) stays the species' own.
 */
export function scaleWildStats(stats: DerivedStats, hpPct: number, powerPct: number): DerivedStats {
  return { ...stats, maxHp: Math.floor((stats.maxHp * hpPct) / 100), patk: Math.floor((stats.patk * powerPct) / 100), matk: Math.floor((stats.matk * powerPct) / 100) };
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

/** Ally cells per row: P15's 3 + 3, or P22's 5 + 5 in a party boss fight. */
function allyRowSlots(rules: RulesConfig, row: Row, party: boolean): number {
  if (party) return rules.provisional.partyBoss.value.rowSlots;
  return row === "front" ? rules.provisional.formationFrontSlots.value : rules.provisional.formationBackSlots.value;
}

function validateFormation(rules: RulesConfig, units: BattleUnit[], party: boolean): void {
  const seen = new Set<string>();
  for (const u of units) {
    const max = u.side === "enemy" ? ENEMY_ROW_SLOTS : allyRowSlots(rules, u.row, party);
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
function expAwards(ctx: Ctx, wildLevel: number, elite = false, recipient = ctx.s.ownerAccountId): { exp: number; companionExp: Record<string, number> } {
  // Party bonus (P02) on the base award, before each companion's level scaling; an elite leader gives more.
  const bonus = ctx.s.partyBonus?.expPercent ?? 0;
  const base = elite ? Math.floor((killExp(ctx.rules, wildLevel) * ctx.rules.provisional.elite.value.expPct) / 100) : killExp(ctx.rules, wildLevel);
  const exp = Math.floor((base * (100 + bonus)) / 100);
  const perCompanion: Record<string, number> = {};
  for (const a of ctx.s.units) {
    if (a.side === "ally" && a.instanceId !== null && controllerOf(ctx.s, a) === recipient) perCompanion[a.instanceId] = companionExp(ctx.rules, exp, a.actualLevel ?? a.level, wildLevel);
  }
  return { exp, companionExp: perCompanion };
}

function startRound(ctx: Ctx): void {
  const s = ctx.s;
  // Tower: enemies that fell last round are replaced before the new round's order (frontier.ts).
  if (s.round > 0) arriveReinforcements(ctx);
  s.round += 1;
  s.turnIndex = 0;
  for (const u of s.units) u.movedThisRound = false;
  // Boss parts heal the boss, and the phase may call minions in, before the round's order is made.
  bossRoundStart(ctx);
  // A boss with N actions gets N slots, action k at SPD×(N−k)/N, so its actions spread across the round.
  // Boss parts never act (chapter 07 §5).
  const ready = s.units.filter((u) => active(u) && u.part === undefined).flatMap((u) => {
    const spd = eff(ctx, u).spd;
    const n = u.actionsPerRound ?? 1;
    return Array.from({ length: n }, (_, k) => ({ id: u.unitId, spd: (spd * (n - k)) / n, tie: ctx.rng.nextUint32() }));
  });
  ready.sort((a, b) => b.spd - a.spd || a.tie - b.tie);
  s.turnOrder = ready.map((r) => r.id);
  ctx.emit({ type: "RoundStarted", round: s.round, order: [...s.turnOrder] });
  announceTelegraph(ctx);
}

/**
 * Which of its actions this round the current slot is, for a unit with several (bosses, P15 bossActions).
 * Everyone else is always action 1 of 1.
 */
function roundAction(s: BattleState, u: BattleUnit): { n: number; of: number; first: boolean; last: boolean } {
  if ((u.actionsPerRound ?? 1) <= 1) return { n: 1, of: 1, first: true, last: true };
  let before = 0;
  let after = 0;
  s.turnOrder.forEach((id, i) => {
    if (id !== u.unitId || i === s.turnIndex) return;
    if (i < s.turnIndex) before += 1;
    else after += 1;
  });
  return { n: before + 1, of: before + 1 + after, first: before === 0, last: after === 0 };
}

function beginTurn(ctx: Ctx, u: BattleUnit): void {
  const guardEnded = u.guarding;
  u.guarding = false;
  const ra = roundAction(ctx.s, u);
  // Cooldowns count the owner's turns (O15, Nut 2026-10-07): once per round, even if control takes the turn.
  if (ra.first && ctx.rules.confirmed.cooldownTick.value === "owner_turn_start") {
    for (const k of Object.keys(u.cooldowns)) u.cooldowns[k] = Math.max(0, (u.cooldowns[k] ?? 0) - 1);
  }
  ctx.emit({ type: "TurnStarted", unitId: u.unitId, guardEnded, ...(ra.of > 1 ? { action: ra.n, actionsThisRound: ra.of } : {}) });
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
  const before = u.hp;
  u.hp -= loss;
  ctx.emit({ type: "StatusTick", unitId: u.unitId, statusId, hp: -loss, hpAfter: u.hp });
  if (u.hp === 0) knockOut(ctx, u);
  else firePassives(ctx, u, "hp_below", { hpBefore: before });
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
  // A boss's later actions in a round skip straight to the control rolls (P15 bossActions).
  if (roundAction(ctx.s, u).first) statusTicks(ctx, u);
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

/** turn_start passives and over-time loss and gain, once per unit per round. */
function statusTicks(ctx: Ctx, u: BattleUnit): void {
  firePassives(ctx, u, "turn_start");
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
}

/** After a unit acted: shock hurts it, and acting breaks stealth. */
function afterAction(ctx: Ctx, u: BattleUnit, cmd: BattleCommand["type"]): void {
  if (!active(u)) return;
  if ((cmd === "attack" || cmd === "skill") && statusOf(u, "stealth") !== undefined) removeStatus(ctx, u, "stealth");
  if (statusOf(u, "shock") !== undefined) statusDamage(ctx, u, "shock", Math.max(1, Math.floor((u.stats.maxHp * tuning(ctx).shockPctMaxHp) / 100)));
}

/** End of a unit's turn: its statuses count down, except ones put on during this very turn. Doom kills at 0. */
function endTurn(ctx: Ctx, u: BattleUnit): void {
  if (!active(u)) return;
  // A boss counts its statuses down once a round, after its last action (P15 bossActions).
  if (!roundAction(ctx.s, u).last) return;
  firePassives(ctx, u, "turn_end");
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
    // The unit that put up a shield that ran its time out (snail innate: MP back).
    if (st.statusId === "shield" && st.sourceId !== null) {
      const src = ctx.s.units.find((x) => x.unitId === st.sourceId);
      if (src !== undefined) firePassives(ctx, src, "shield_expired", { other: u });
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
  const shieldHp = a.shieldPct === undefined ? undefined : Math.max(1, Math.floor((target.stats.maxHp * a.shieldPct) / 100));
  if (st !== undefined) {
    st.turnsLeft = Math.max(st.turnsLeft, a.turns);
    // A new shield on an old one keeps the bigger of the two (no stacking).
    if (shieldHp !== undefined) st.shieldHp = Math.max(st.shieldHp ?? 0, shieldHp);
    st.stacks = Math.min(d.maxStacks, st.stacks + (d.maxStacks > 1 ? (a.stacks ?? 1) : 0));
    st.sourceId = source.unitId;
    st.fresh = st.fresh || ownTurn;
    statusEvent(ctx, target, a.statusId, "refreshed", source.unitId, st, rolled ? chance : null);
  } else {
    st = { statusId: a.statusId, sourceId: source.unitId, turnsLeft: a.turns, stacks: Math.min(d.maxStacks, a.stacks ?? 1), fresh: ownTurn };
    if (a.element !== undefined) st.element = a.element;
    if (a.statusId === "skill_lock" && target.lastSkillId !== undefined) st.skillId = target.lastSkillId;
    if (shieldHp !== undefined) st.shieldHp = shieldHp;
    statuses.push(st);
    statusEvent(ctx, target, a.statusId, "applied", source.unitId, st, rolled ? chance : null);
  }
  if (st.shieldHp !== undefined && shieldHp !== undefined) {
    ctx.emit({ type: "ShieldChanged", unitId: target.unitId, change: "gained", amount: shieldHp, shieldLeft: st.shieldHp });
  }
  // Frostbite at full stacks turns into a short freeze.
  if (a.statusId === "frostbite" && st.stacks >= tuning(ctx).frostbiteFreezeStacks) {
    removeStatus(ctx, target, "frostbite");
    applyStatus(ctx, source, target, { statusId: "freeze", chancePct: 100, turns: 1 }, true);
  }
}

// ================================================================ passives (catalog §4)

interface PassiveInfo {
  other?: BattleUnit;
  action?: "attack" | "skill";
  otherStatuses?: readonly ActiveStatus[];
  skill?: SkillDefinition;
  hpBefore?: number;
}

/** One source of passive effects: a passive skill, or a worn Sigil with how many of it are installed. */
interface PassiveSource {
  id: string;
  passive: Passive;
  count: number;
}

/** The passives a unit can use now: its passive skills and worn Sigils; none while sealed (catalog §3.5). */
function livePassives(ctx: Ctx, u: BattleUnit): PassiveSource[] {
  if (statusBlocks(u.statuses, "passives") !== undefined) return [];
  const out: PassiveSource[] = [];
  for (const id of u.passiveIds ?? []) {
    const sk = ctx.content.skills.get(id);
    if (sk?.passive !== undefined) out.push({ id, passive: sk.passive, count: 1 });
  }
  for (const [id, count] of Object.entries(u.sigils ?? {})) {
    const sg = ctx.content.sigils?.get(id);
    if (sg?.effect !== undefined) out.push({ id, passive: sg.effect, count });
  }
  return out;
}

/** guard_reduction modifiers: a guarding unit takes less again, each copy multiplying. */
function guardBonusFactor(ctx: Ctx, u: BattleUnit): number {
  if (!u.guarding) return 1;
  let f = 1;
  for (const m of passiveModifiers(ctx, u)) if (m.kind === "guard_reduction") f *= (100 - m.reductionPct) / 100;
  return f;
}

/**
 * Always-on modifiers, one per installed copy: the same Sigil twice gives its % twice, and the
 * kernel multiplies them (Nut 2026-10-04: duplicate weapon-type effects stack % on %).
 */
function passiveModifiers(ctx: Ctx, u: BattleUnit): PassiveModifier[] {
  return livePassives(ctx, u).flatMap((p) => Array.from({ length: p.count }, () => p.passive.modifiers).flat());
}

/**
 * Fires `u`'s passives for one event: conditions, once-per-battle, then the passive's chance, then its
 * effects in order. Effects of a passive never set off another passive (no chains, chapter 05 §5).
 */
function firePassives(ctx: Ctx, u: BattleUnit, on: PassiveEvent, info: PassiveInfo = {}): void {
  if (ctx.inPassive || !active(u)) return;
  // Triggers fire once per source, however many copies of a Sigil are worn (PROVISIONAL).
  for (const sk of livePassives(ctx, u)) {
    sk.passive.triggers.forEach((tr, i) => {
      if (tr.on !== on || !active(u) || ctx.s.status !== "active") return;
      if (tr.action !== undefined && tr.action !== info.action) return;
      const otherStatuses = info.otherStatuses ?? info.other?.statuses ?? [];
      if (tr.otherHas !== undefined && !otherStatuses.some((x) => x.statusId === tr.otherHas)) return;
      if (tr.skillApplies !== undefined && !(info.skill?.effectSequence ?? []).some((e) => (("statuses" in e ? e.statuses : undefined) ?? []).some((a) => a.statusId === tr.skillApplies))) return;
      if (tr.hpBelowPct !== undefined) {
        const line = tr.hpBelowPct * u.stats.maxHp;
        if (info.hpBefore === undefined || info.hpBefore * 100 < line || u.hp * 100 >= line) return;
      }
      const key = `${sk.id}#${i}`;
      if (tr.oncePerBattle && (u.passivesUsed ?? []).includes(key)) return;
      if (tr.chancePct < 100 && !ctx.rng.chanceBp(tr.chancePct * 100)) return;
      if (tr.oncePerBattle) (u.passivesUsed ??= []).push(key);
      ctx.emit({ type: "PassiveTriggered", unitId: u.unitId, sourceId: sk.id, on });
      ctx.inPassive = true;
      try {
        for (const a of tr.then) passiveAction(ctx, u, a, info.other);
      } finally {
        ctx.inPassive = false;
      }
    });
  }
}

function passiveAction(ctx: Ctx, owner: BattleUnit, a: PassiveAction, other: BattleUnit | undefined): void {
  const side = ctx.s.units.filter((x) => x.side === owner.side && active(x));
  const targets =
    a.target === "self"
      ? [owner]
      : a.target === "other"
        ? other !== undefined && active(other) ? [other] : []
        : a.target === "allies"
          ? side
          : side.sort((x, y) => x.hp / x.stats.maxHp - y.hp / y.stats.maxHp || (x.unitId < y.unitId ? -1 : 1)).slice(0, 1);
  for (const t of targets) {
    if (!active(t)) continue;
    // Harmful only on the other side, helpful only on the owner's (the schema cannot tell for used_skill).
    const harmful = a.kind === "status" && STATUS_DEFINITIONS[a.statuses[0]!.statusId].harmful;
    if (harmful !== (t.side !== owner.side)) continue;
    if (a.kind === "status") for (const x of a.statuses) applyStatus(ctx, owner, t, x);
    else if (a.kind === "heal") {
      const gain = receiveHeal(ctx, t, Math.max(1, Math.floor((t.stats.maxHp * a.pctMaxHp) / 100)));
      if (gain !== 0) ctx.emit({ type: "ResourceChanged", unitId: t.unitId, source: "passive", hp: gain, mp: 0, hpAfter: t.hp, mpAfter: t.mp });
    } else {
      const mp = Math.min(a.amount, t.stats.maxMp - t.mp);
      if (mp > 0) {
        t.mp += mp;
        ctx.emit({ type: "ResourceChanged", unitId: t.unitId, source: "passive", hp: 0, mp, hpAfter: t.hp, mpAfter: t.mp });
      }
    }
  }
}

/** What an instant status does the moment it lands (catalog §3.1, §3.7). */
function instantStatus(ctx: Ctx, source: BattleUnit, target: BattleUnit, what: InstantEffect): void {
  const s = ctx.s;
  // The target's next slot not yet taken this round (a boss may have several).
  const pos = s.turnOrder.findIndex((id, i) => id === target.unitId && i > s.turnIndex);
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
      if (pos > s.turnIndex) s.turnOrder = [...s.turnOrder.filter((_, i) => i !== pos), target.unitId];
      return;
    case "advance":
      // Acts right after the current unit, if it has not acted yet this round.
      if (pos > s.turnIndex + 1) {
        const order = s.turnOrder.filter((_, i) => i !== pos);
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
  // A capture uses a capture item, so whatever forbids items forbids it (berserk).
  if (cmd.type === "capture") blocked("items", "cannot use capture items");
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
  // Safety bound per call only: there is no forced end, the fight goes on until one side loses (O15).
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

/** A backline hunter (elite) reaches the back row with everything. */
const reach = (actor: BattleUnit, range: Range): Range => (actor.elite?.modifiers.includes("backline_hunter") === true ? "ranged" : range);

function requireEnemyTarget(ctx: Ctx, actor: BattleUnit, target: BattleUnit, range: Range): void {
  const side: Side = actor.side === "ally" ? "enemy" : "ally";
  if (!validTargets(ctx.s, side, reach(actor, range)).some((u) => u.unitId === target.unitId)) {
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
function skillCost(rules: RulesConfig, actor: BattleUnit, skill: SkillDefinition) {
  const mods = skillLevelMods(rules, skill, actor.skillLevels?.[skill.id] ?? 1);
  const baseMp = Math.max(0, skill.mpCost + mods.mpCost);
  const up = rules.provisional.statusTuning.value.mpCostUpPct;
  const mpCost = statusOf(actor, "mp_cost_up") === undefined ? baseMp : Math.ceil((baseMp * (100 + up)) / 100);
  return { mods, mpCost, cooldown: Math.max(0, skill.cooldown + mods.cooldown) };
}

/** `free`: a boss's telegraphed move, which costs no MP and sets no cooldown (it was announced instead). */
function doSkill(ctx: Ctx, actor: BattleUnit, skillId: string, target: BattleUnit, free = false): void {
  if (!actor.skillIds.includes(skillId)) reject("INVALID_COMMAND", `${actor.unitId} has no skill ${skillId}`);
  const skill = requireActiveSkill(ctx.content, skillId);
  const cost = skillCost(ctx.rules, actor, skill);
  const { mods } = cost;
  const mpCost = free ? 0 : cost.mpCost;
  const cooldown = free ? 0 : cost.cooldown;
  if ((actor.cooldowns[skillId] ?? 0) > 0) reject("ON_COOLDOWN", `${skillId} ready in ${actor.cooldowns[skillId]} turns`);
  if (actor.mp < mpCost) reject("INSUFFICIENT_RESOURCE", `needs ${mpCost} MP`);
  const effect = skill.effectSequence[0]!;
  if (skill.effectSequence.length !== 1) reject("UNRESOLVED_RULE", "multi-effect skills wait for O15 (multi-hit, chains)");

  const onEnemy = targetsEnemies(skill.targetRule);
  const area = isAreaRule(skill.targetRule);
  if (onEnemy) {
    // An area skill still names one target: any enemy it can reach (enemy_row: that enemy's row).
    requireEnemyTarget(ctx, actor, target, skill.range);
  } else if (effect.kind === "revive") {
    // Checked before anything is spent: a fallen ally, down for a full turn (O15).
    const block = reviveBlock(ctx.rules, ctx.s, actor, target);
    if (block !== null) reject(block.code, block.message);
  } else {
    const allowed = skill.targetRule === "self" ? target.unitId === actor.unitId : skill.targetRule === "single_ally" || skill.targetRule === "all_allies";
    if (!allowed || target.side !== actor.side) reject("INVALID_TARGET", "this skill needs an ally target");
    if (!active(target)) reject("INVALID_TARGET", "only revive skills or items bring a fallen ally back (O15)");
  }

  actor.mp -= mpCost;
  if (cooldown > 0) actor.cooldowns[skillId] = cooldown;
  actor.lastSkillId = skillId;

  if (effect.kind === "revive") {
    actionEvent(ctx, actor, "skill", target, { skillId });
    revive(ctx, actor, target, effect.hpPct, skillId);
    if (active(actor)) firePassives(ctx, actor, "used_skill", { other: target, skill });
    return;
  }

  const coefficient = effect.kind === "status" ? 0 : (effect.coefficient * (100 + mods.powerPercent)) / 100;
  // Extra targets from the skill's level: the chosen target first, then more of the same side, each
  // resolved on its own (its own hit and crit). Picked by the server, never by the client: enemies in
  // formation order (front row first), allies by lowest HP share. Self-only skills never spread.
  // Area skills cover their whole area instead (front row first, then slot order).
  const formation = (a: BattleUnit, b: BattleUnit) => (a.row === b.row ? a.slot - b.slot : a.row === "front" ? -1 : 1);
  const foes: Side = actor.side === "ally" ? "enemy" : "ally";
  const extra = area
    ? (onEnemy
        ? validTargets(ctx.s, foes, reach(actor, skill.range)).filter((u) => skill.targetRule !== "enemy_row" || u.row === target.row)
        : ctx.s.units.filter((u) => u.side === actor.side && active(u))
      )
        .filter((u) => u.unitId !== target.unitId)
        .sort(formation)
    : mods.extraTargets <= 0 || skill.targetRule === "self"
      ? []
      : onEnemy
        ? validTargets(ctx.s, actor.side === "ally" ? "enemy" : "ally", reach(actor, skill.range))
            .filter((u) => u.unitId !== target.unitId)
            .sort((a, b) => (a.row === b.row ? a.slot - b.slot : a.row === "front" ? -1 : 1))
        : ctx.s.units
            .filter((u) => u.side === actor.side && active(u) && u.unitId !== target.unitId)
            .sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp || (a.unitId < b.unitId ? -1 : 1));
  for (const t of [target, ...(area ? extra : extra.slice(0, mods.extraTargets))]) {
    if (!active(t)) continue;
    if (effect.kind === "damage") {
      // Protect covers single-target hits only: an area hit lands on everyone it covers.
      strike(ctx, actor, redirectedTarget(ctx, actor, t), "skill", skillId, { ...effect, coefficient }, false, area);
    } else if (effect.kind === "status") {
      // No damage and no hit roll: each status rolls its own chance (O15, Nut 2026-10-04).
      actionEvent(ctx, actor, "skill", t, { skillId });
      for (const a of effect.statuses) applyStatus(ctx, actor, t, a);
    } else {
      let amount = computeHeal(actor.stats.support, coefficient, effect.flat);
      for (const m of passiveModifiers(ctx, actor)) {
        if (m.kind === "heal_low_hp" && t.hp * 100 < m.belowHpPct * t.stats.maxHp) amount = Math.floor((amount * (100 + m.bonusPct)) / 100);
      }
      const gained = receiveHeal(ctx, t, amount);
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
  if (active(actor)) firePassives(ctx, actor, "used_skill", { other: target, skill });
}

type StrikeEffect = { damageType: "physical" | "magic"; coefficient: number; flat: number; element: BattleUnit["element"] } & Partial<
  Pick<DamageEffect, "penetrationPct" | "accuracyBonusPct" | "critBonusPct" | "execute" | "lifestealPct" | "recoilPct" | "statuses" | "bonusVsStatus">
>;

function strike(ctx: Ctx, actor: BattleUnit, chosen: BattleUnit, action: "attack" | "skill", skillId: string | null, eff: StrikeEffect, isCounter = false, area = false): void {
  const rules = ctx.rules;
  const t = tuning(ctx);
  // A protector steps in front of the unit it protects (catalog §3.4), except against area hits.
  const target = area ? chosen : protectorFor(ctx, actor, chosen);
  if (target !== chosen) firePassives(ctx, target, "protected_ally", { other: chosen });
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
  for (const m of passiveModifiers(ctx, actor)) {
    if (m.kind === "damage_vs_status" && statusOf(target, m.statusId) !== undefined) outgoing *= (100 + m.bonusPct) / 100;
  }
  const breakdown = computeDamage(rules, {
    ...(eff.penetrationPct === undefined ? {} : { defenseModifiers: { penetrationPct: eff.penetrationPct } }),
    ...(outgoing !== 1 ? { outgoingMultiplier: outgoing } : {}),
    incomingMultiplier: incomingDamageFactor(rules, target.statuses, eff.element) * guardBonusFactor(ctx, target) * partArmorFactor(ctx, target),
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
  // Shield (Nut 2026-10-04): soaks what is left after every reduction, before HP.
  const shield = statusOf(target, "shield");
  let absorbed = 0;
  if (damage > 0 && shield?.shieldHp !== undefined) {
    absorbed = Math.min(shield.shieldHp, damage);
    shield.shieldHp -= absorbed;
    damage -= absorbed;
  }
  if (damage >= target.hp && target.hp > 1 && statusOf(target, "endure") !== undefined) {
    damage = target.hp - 1;
    removeStatus(ctx, target, "endure");
  }
  target.hp = Math.max(0, target.hp - damage);
  actionEvent(ctx, actor, action, target, { skillId, hit: true, crit, damage, breakdown, targetHpAfter: target.hp });
  if (absorbed > 0 && shield !== undefined) {
    ctx.emit({ type: "ShieldChanged", unitId: target.unitId, change: shield.shieldHp! > 0 ? "absorbed" : "broken", amount: absorbed, shieldLeft: shield.shieldHp! });
    if (shield.shieldHp! <= 0 && ctx.s.boss?.unitId === target.unitId) ctx.s.boss.shieldBroken = true;
    if (shield.shieldHp === 0) removeStatus(ctx, target, "shield");
  }
  if (!physical && !isCounter) noteMagicHit(ctx, actor, target);
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
  // Passives see the target's statuses as they were when the hit landed (a kill clears them).
  const hitInfo = { other: target, action, otherStatuses: [...(target.statuses ?? [])] };
  if (target.hp === 0) knockOut(ctx, target);
  else if (dealt > 0) {
    breakStatusesOnHit(ctx, target, eff.element);
    elementReactions(ctx, actor, target, eff.element);
    const rage = statusOf(target, "rage");
    if (rage !== undefined) rage.stacks = Math.min(STATUS_DEFINITIONS.rage.maxStacks, rage.stacks + 1);
  }
  if (active(target)) for (const x of eff.statuses ?? []) applyStatus(ctx, actor, target, x);
  if (dealt > 0 && active(target)) frontierOnHit(ctx, actor, target);
  if (dealt > 0) {
    firePassives(ctx, actor, "dealt_damage", hitInfo);
    if (target.ko) firePassives(ctx, actor, "kill", hitInfo);
    else {
      firePassives(ctx, target, "took_damage", { other: actor, action, otherStatuses: [...(actor.statuses ?? [])] });
      firePassives(ctx, target, "hp_below", { hpBefore });
    }
  }
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
  u.downRound = ctx.s.round;
  u.guarding = false;
  u.statuses = [];
  if (u.kind === "companion") u.fell = true;
  ctx.emit({ type: "UnitKnockedOut", unitId: u.unitId });
  for (const x of ctx.s.units) if (x !== u && x.side === u.side && active(x)) firePassives(ctx, x, "ally_down", { other: u });
  if (u.side !== "enemy") return;
  if (ctx.s.resolutions[u.unitId] !== undefined) throw new Error(`enemy ${u.unitId} resolved twice`);
  ctx.s.resolutions[u.unitId] = "defeated";
  ctx.emit({ type: "EnemyDefeated", unitId: u.unitId, speciesId: u.speciesId! });
  if (u.part !== undefined && ctx.s.boss !== undefined) {
    (ctx.s.boss.partsBroken ??= []).push(u.part.partId);
    ctx.emit({ type: "BossPartBroken", unitId: u.unitId, partId: u.part.partId });
  }
  // Parts and summoned minions give nothing (no unbounded reward from resummons); a practice fight gives nothing at all.
  if (u.part !== undefined || u.summoned === true || ctx.s.practice === true) return;
  // Adds without loot eligibility (boss fights) give EXP only. In a party fight every member gets their
  // own loot roll and EXP for the same enemy (owner first, so a solo fight rolls exactly as before).
  const table = u.lootTableId === null ? undefined : ctx.content.lootTables.get(u.lootTableId)!;
  for (const who of fightRecipients(ctx.s)) {
    const entitlement: Entitlement = {
      entitlementId: `${ctx.s.battleId}:${u.unitId}:defeated`,
      kind: "kill",
      enemyUnitId: u.unitId,
      speciesId: u.speciesId!,
      originMode: ctx.s.originMode,
      items:
        table === undefined
          ? []
          : rollLoot(ctx.rules, table, ctx.s.originMode, ctx.rng, {
              percent: ctx.s.partyBonus?.materialDropPercent ?? 0,
              isMaterial: (id) => ctx.content.items.get(id)?.kind === "material",
            }),
      ...expAwards(ctx, u.level, u.elite !== undefined, who),
      ...recipientField(ctx.s, who),
    };
    ctx.s.entitlements.push(entitlement);
    ctx.emit({ type: "RewardEntitled", entitlement });
  }
}

/** Who a fight's rewards go to: the owner, then each party member. */
const fightRecipients = (s: BattleState) => [s.ownerAccountId, ...(s.members ?? []).map((m) => m.accountId)];
const recipientField = (s: BattleState, who: string) => (who === s.ownerAccountId ? {} : { recipientId: who });

function requirePlayerActor(actor: BattleUnit, what: string): void {
  if (actor.kind !== "player") reject("INVALID_COMMAND", `only the player character can ${what} (chapter 03 §2)`);
}

function consumeItem(ctx: Ctx, actor: BattleUnit, itemId: string): void {
  const b = combatBagOf(ctx.s, actor);
  const left = b.bag[itemId] ?? 0;
  if (left <= 0) reject("INSUFFICIENT_RESOURCE", `no ${itemId} in the combat bag`);
  b.bag[itemId] = left - 1;
  b.consumed[itemId] = (b.consumed[itemId] ?? 0) + 1;
  ctx.emit({ type: "ItemConsumed", itemId, remaining: left - 1 });
}

function doItem(ctx: Ctx, actor: BattleUnit, itemId: string, target: BattleUnit): void {
  requirePlayerActor(actor, "use items");
  const item = ctx.content.items.get(itemId) ?? reject("MISSING_REFERENCE", `item ${itemId}`);
  if (item.kind === "revive") {
    const block = reviveBlock(ctx.rules, ctx.s, actor, target);
    if (block !== null) reject(block.code, block.message);
    if ((combatBagOf(ctx.s, actor).bag[itemId] ?? 0) <= 0) reject("INSUFFICIENT_RESOURCE", `no ${itemId} in the combat bag`);
    consumeItem(ctx, actor, itemId);
    actionEvent(ctx, actor, "item", target, {});
    return revive(ctx, actor, target, item.reviveHpPct ?? 1, itemId);
  }
  if (item.kind !== "heal" && item.kind !== "mana" && item.kind !== "support") reject("INVALID_COMMAND", `${item.kind} items are not usable in a fight`);
  if (target.side !== "ally" || !active(target)) reject("INVALID_TARGET", `${item.kind} items need a living ally`);
  if (item.kind === "mana") {
    if ((combatBagOf(ctx.s, actor).bag[itemId] ?? 0) <= 0) reject("INSUFFICIENT_RESOURCE", `no ${itemId} in the combat bag`);
    consumeItem(ctx, actor, itemId);
    actionEvent(ctx, actor, "item", target, {});
    const mp = Math.min(item.restoreMp ?? 0, target.stats.maxMp - target.mp);
    target.mp += mp;
    ctx.emit({ type: "ResourceChanged", unitId: target.unitId, source: "restore_mp", hp: 0, mp, hpAfter: target.hp, mpAfter: target.mp });
    return;
  }
  if (item.kind === "support") {
    if ((combatBagOf(ctx.s, actor).bag[itemId] ?? 0) <= 0) reject("INSUFFICIENT_RESOURCE", `no ${itemId} in the combat bag`);
    consumeItem(ctx, actor, itemId);
    actionEvent(ctx, actor, "item", target, {});
    for (const a of item.statuses ?? []) applyStatus(ctx, actor, target, a);
    return;
  }
  if ((combatBagOf(ctx.s, actor).bag[itemId] ?? 0) <= 0) reject("INSUFFICIENT_RESOURCE", `no ${itemId} in the combat bag`);
  consumeItem(ctx, actor, itemId);
  // Anti-heal and zombie work on potions too.
  const gained = receiveHeal(ctx, target, item.healHp ?? 0);
  actionEvent(ctx, actor, "item", target, gained >= 0 ? { heal: gained, targetHpAfter: target.hp } : { hit: true, damage: -gained, targetHpAfter: target.hp });
}

/**
 * Brings a fallen ally back with `pct`% of its max HP (O15). Its statuses went when it fell; it is not
 * in this round's order, so it acts again from the next round. A companion that fell still counts as
 * having fallen for Bond (bondLossOnFall).
 */
function revive(ctx: Ctx, by: BattleUnit, target: BattleUnit, pct: number, sourceId: string): void {
  target.ko = false;
  target.hp = Math.min(target.stats.maxHp, reviveHp(target.stats.maxHp, pct));
  delete target.downRound;
  ctx.emit({ type: "UnitRevived", unitId: target.unitId, byId: by.unitId, sourceId, hp: target.hp });
}

/** Capture chance for this fight (capture.ts), or the reason it cannot be tried. */
export function captureProbability(rules: RulesConfig, species: SpeciesDefinition, target: BattleUnit, itemQuality: number, profile?: CaptureProfile): number {
  return captureChance(fightCaptureProfile(rules, profile), species, target, itemQuality).probability;
}

function doCapture(ctx: Ctx, actor: BattleUnit, target: BattleUnit, itemId: string, source: CommandSource): void {
  if (source !== "player") reject("AUTO_CAPTURE_FORBIDDEN", "capture is a manual player command only (C15)");
  if (ctx.s.practice === true) reject("INVALID_COMMAND", "nothing can be captured in a practice fight");
  requirePlayerActor(actor, "capture");
  // Every check comes before anything is spent or rolled (C09 level gate, window, item, quality, bag).
  const check = captureCheck(ctx.rules, fightCaptureProfile(ctx.rules, ctx.s.captureProfile), {
    source: "player",
    actor,
    target,
    species: target.speciesId === null ? undefined : ctx.content.species.get(target.speciesId),
    item: ctx.content.items.get(itemId),
    inBag: combatBagOf(ctx.s, actor).bag[itemId] ?? 0,
  });
  if (!check.ok) reject(check.code === "QUALITY_NOT_ENABLED" ? "INVALID_COMMAND" : check.code, check.message);
  const catcherId = controllerOf(ctx.s, actor);
  const room = ctx.s.companionRoom?.[catcherId];
  if (room !== undefined && room <= 0) reject("COMPANION_BOX_FULL", `the companion box is full (${ctx.rules.provisional.companionBox.value.capacity}); release or trade one first`);
  const p = (check as CaptureBreakdown).probability;
  const species = ctx.content.species.get(target.speciesId!)!;

  consumeItem(ctx, actor, itemId); // a failed capture still uses the item, exactly once
  const success = ctx.rng.chance(p);
  actionEvent(ctx, actor, "capture", target, {});
  ctx.emit({ type: "CaptureResolved", targetId: target.unitId, speciesId: species.id, success, probability: p, profileVersion: (check as CaptureBreakdown).profileVersion });
  if (!success) return;

  target.retired = true;
  target.guarding = false;
  if (ctx.s.resolutions[target.unitId] !== undefined) throw new Error(`enemy ${target.unitId} resolved twice`);
  ctx.s.resolutions[target.unitId] = "captured";
  if (room !== undefined) ctx.s.companionRoom![catcherId] = room - 1;
  // The monster goes to whoever caught it; in a party fight the others get the same EXP, no loot.
  const catcher = catcherId;
  for (const who of fightRecipients(ctx.s)) {
    const id = `${ctx.s.battleId}:${target.unitId}:captured`;
    const awards = expAwards(ctx, target.level, target.elite !== undefined, who);
    const entitlement: Entitlement =
      who === catcher
        ? { entitlementId: id, kind: "capture", enemyUnitId: target.unitId, speciesId: species.id, element: target.element, level: ctx.rules.confirmed.capturedInitialLevel.value, ...awards, ...recipientField(ctx.s, who) }
        : { entitlementId: id, kind: "kill", enemyUnitId: target.unitId, speciesId: species.id, originMode: ctx.s.originMode, items: [], ...awards, ...recipientField(ctx.s, who) };
    ctx.s.entitlements.push(entitlement);
    ctx.emit({ type: "RewardEntitled", entitlement });
  }
}

function doMove(ctx: Ctx, actor: BattleUnit, row: Row, slot: number): void {
  const max = allyRowSlots(ctx.rules, row, ctx.s.members !== undefined);
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
  // A practice fight can always be left (nothing rides on it).
  if (ctx.s.practice === true) {
    actionEvent(ctx, actor, "flee", null, { hit: true });
    ctx.emit({ type: "FleeResolved", actorId: actor.unitId, success: true, chancePct: 100 });
    return endBattle(ctx, "fled");
  }
  // From SPD and the monsters' own flee values (O15, Nut 2026-10-07; numbers P19). A refusal spends nothing.
  const f = fleeChance(ctx.rules, ctx.content.species, ctx.s, actor.unitId);
  if (!f.ok) reject(f.code, f.message);
  const chancePct = (f as Extract<typeof f, { ok: true }>).chancePct;
  const ok = ctx.rng.chance(chancePct / 100);
  actionEvent(ctx, actor, "flee", null, { hit: ok });
  ctx.emit({ type: "FleeResolved", actorId: actor.unitId, success: ok, chancePct });
  if (ok) endBattle(ctx, "fled");
}

// ================================================================ enemy AI and end

/** Prototype AI: basic attack on a random valid target. */
/**
 * Wild enemy turn (chapter 08 rule engine, P15 enemyAi): a usable skill by chance, else a basic
 * attack; disarmed with no skill left, it guards. Every pick passes the same checks as a manual
 * command, so the AI never tries what the validator would refuse.
 */
// ================================================================ weekly tower (frontier.ts)

const towerMods = (ctx: Ctx): readonly FrontierModifierId[] => ctx.s.frontier?.modifiers ?? [];

/** A tower enemy entering the fight: the floor's regen and crystal shield gimmicks go on (frontier.ts). */
function startFrontierUnit(ctx: Ctx, u: BattleUnit): void {
  const mods = towerMods(ctx);
  if (!active(u) || mods.length === 0) return;
  const m = ctx.rules.provisional.frontier.value.modifiers;
  if (mods.includes("regen")) applyStatus(ctx, u, u, { statusId: "regen", chancePct: 100, turns: m.regenTurns }, true);
  if (mods.includes("crystal_shield")) applyStatus(ctx, u, u, { statusId: "shield", chancePct: 100, turns: m.shieldTurns, shieldPct: m.shieldPctMaxHp }, true);
}

/** A tower enemy's hit that landed: venom may poison, disrupt may confuse (resistances apply as usual). */
function frontierOnHit(ctx: Ctx, actor: BattleUnit, target: BattleUnit): void {
  if (actor.side !== "enemy" || target.side === "enemy") return;
  const mods = towerMods(ctx);
  if (mods.length === 0) return;
  const m = ctx.rules.provisional.frontier.value.modifiers;
  if (mods.includes("venom") && active(target)) applyStatus(ctx, actor, target, { statusId: "poison", chancePct: m.venomChancePct, turns: m.venomTurns });
  if (mods.includes("disrupt") && active(target)) applyStatus(ctx, actor, target, { statusId: "confuse", chancePct: m.disruptChancePct, turns: m.disruptTurns });
}

/**
 * Tower reinforcements: every enemy cell whose unit fell or was caught (and was not replaced yet) takes
 * the next monster of the pre-rolled queue, in unit order, while the queue lasts. Each one is a real
 * wild unit (EXP, drops, capture), built like the floor's other enemies.
 */
function arriveReinforcements(ctx: Ctx): void {
  const t = ctx.s.frontier;
  if (t === undefined || t.queue === undefined || t.queue.length === 0) return;
  const empty = ctx.s.units.filter((u) => u.side === "enemy" && !active(u) && u.replacedBy === undefined);
  for (const old of empty) {
    const next = t.queue.shift();
    if (next === undefined) break;
    const unitId = `e${t.nextUnit ?? ctx.s.units.length + 1}`;
    t.nextUnit = (t.nextUnit ?? ctx.s.units.length + 1) + 1;
    const unit = enemyUnit(ctx.rules, ctx.content, { unitId, speciesId: next.speciesId, element: next.element, row: old.row, slot: old.slot }, { bossDef: undefined, towerPct: t.statPct, modifiers: t.modifiers ?? [] });
    old.replacedBy = unitId;
    ctx.s.units.push(unit);
    t.reinforcementsLeft = t.queue.length;
    ctx.emit({ type: "ReinforcementArrived", unitId, speciesId: unit.speciesId!, element: unit.element, row: unit.row, slot: unit.slot, replaces: old.unitId, left: t.queue.length });
    startFrontierUnit(ctx, unit);
    firePassives(ctx, unit, "battle_start");
  }
}

// ================================================================ elites (chapter 07 §3, elite.ts)

const elites = (ctx: Ctx) => ctx.s.units.filter((u) => u.elite !== undefined);

/** Fight start: each elite shows its modifiers; the shield goes up and the pack's morale buff goes on. */
function startElites(ctx: Ctx): void {
  const el = ctx.rules.provisional.elite.value;
  for (const u of elites(ctx)) {
    for (const m of u.elite!.modifiers) ctx.emit({ type: "EliteTrait", unitId: u.unitId, modifier: m, change: "active", targetId: null });
    if (u.elite!.modifiers.includes("crystal_shield")) applyStatus(ctx, u, u, { statusId: "shield", chancePct: 100, turns: el.crystalShieldTurns, shieldPct: el.crystalShieldPct }, true);
    if (u.elite!.modifiers.includes("morale")) {
      for (const x of ctx.s.units) {
        if (x.side !== u.side || x === u || !active(x)) continue;
        applyStatus(ctx, u, x, { statusId: "atk_up", chancePct: 100, turns: el.moraleTurns }, true);
        applyStatus(ctx, u, x, { statusId: "matk_up", chancePct: 100, turns: el.moraleTurns }, true);
      }
    }
  }
}

/** After every action: enrage under the HP line; morale breaks when the elite falls (its buffs end). */
function checkElites(ctx: Ctx): void {
  const el = ctx.rules.provisional.elite.value;
  for (const u of elites(ctx)) {
    const e = u.elite!;
    if (!active(u)) {
      if (e.modifiers.includes("morale") && !e.moraleBroken) {
        e.moraleBroken = true;
        ctx.emit({ type: "EliteTrait", unitId: u.unitId, modifier: "morale", change: "broken", targetId: null });
        for (const x of ctx.s.units) {
          if (x.side !== u.side || !active(x)) continue;
          for (const id of ["atk_up", "matk_up"] as const) if (statusOf(x, id)?.sourceId === u.unitId) removeStatus(ctx, x, id);
        }
      }
      if (e.counterOn !== null) {
        ctx.emit({ type: "EliteTrait", unitId: u.unitId, modifier: "magic_counter", change: "cancelled", targetId: e.counterOn });
        e.counterOn = null;
      }
      continue;
    }
    if (e.modifiers.includes("low_hp_enrage") && !e.enraged && u.hp * 100 < el.enrageBelowHpPct * u.stats.maxHp) {
      e.enraged = true;
      ctx.emit({ type: "EliteTrait", unitId: u.unitId, modifier: "low_hp_enrage", change: "enraged", targetId: null });
      applyStatus(ctx, u, u, { statusId: "atk_up", chancePct: 100, turns: el.enrageTurns }, true);
      applyStatus(ctx, u, u, { statusId: "spd_up", chancePct: 100, turns: el.enrageTurns }, true);
    }
  }
}

/** Magic landed on an elite with magic_counter: it warns who it will answer on its next action. */
function noteMagicHit(ctx: Ctx, attacker: BattleUnit, target: BattleUnit): void {
  const e = target.elite;
  if (e === undefined || !e.modifiers.includes("magic_counter") || attacker.side === target.side || !active(target) || e.counterOn !== null) return;
  e.counterOn = attacker.unitId;
  ctx.emit({ type: "EliteTrait", unitId: target.unitId, modifier: "magic_counter", change: "warned", targetId: attacker.unitId });
}

/** The warned counter: a heavy magic strike on that attacker, reaching any row. Called off if it is gone. */
function fireEliteCounter(ctx: Ctx, u: BattleUnit): boolean {
  const e = u.elite;
  if (e === undefined || e.counterOn === null) return false;
  const target = ctx.s.units.find((x) => x.unitId === e.counterOn);
  e.counterOn = null;
  const blocked = statusBlocks(u.statuses, "skills") !== undefined;
  if (target === undefined || !active(target) || blocked) {
    ctx.emit({ type: "EliteTrait", unitId: u.unitId, modifier: "magic_counter", change: "cancelled", targetId: target?.unitId ?? null });
    return false;
  }
  ctx.emit({ type: "EliteTrait", unitId: u.unitId, modifier: "magic_counter", change: "fired", targetId: target.unitId });
  strike(ctx, u, target, "attack", null, { damageType: "magic", coefficient: ctx.rules.provisional.elite.value.counterCoefficientPct / 100, flat: 0, element: u.element }, true);
  return true;
}

// ================================================================ bosses (chapter 07 §5, P17)

function bossDefinition(ctx: Ctx): BossDefinition | undefined {
  return ctx.s.boss === undefined ? undefined : ctx.content.bosses?.get(ctx.s.boss.bossId);
}

function telegraphSkills(ctx: Ctx): Set<string> {
  return new Set((bossDefinition(ctx)?.phases ?? []).flatMap((ph) => (ph.telegraph === undefined ? [] : [ph.telegraph.skillId])));
}

/** Enters a phase: its statuses go on (unresistable), listed ones come off, a pending warning is called off. */
function enterBossPhase(ctx: Ctx, index: number): void {
  const b = ctx.s.boss!;
  const def = bossDefinition(ctx) ?? reject("MISSING_REFERENCE", `boss ${b.bossId}`);
  const ph = def.phases[index]!;
  const boss = ctx.unit(b.unitId);
  b.phase = index;
  if (b.telegraph !== null) {
    ctx.emit({ type: "BossTelegraph", unitId: boss.unitId, skillId: b.telegraph.skillId, change: "cancelled", firesRound: b.telegraph.firesRound });
    b.telegraph = null;
  }
  // A new phase's warning comes no sooner than its own spacing.
  b.lastTelegraphRound = ctx.s.round;
  ctx.emit({ type: "BossPhaseChanged", unitId: boss.unitId, phase: index, phaseId: ph.id });
  for (const id of ph.removeStatuses) if (statusOf(boss, id) !== undefined) removeStatus(ctx, boss, id);
  for (const a of ph.onEnter) applyStatus(ctx, boss, boss, a, true);
  if (ph.summon !== undefined && active(boss)) bossSummon(ctx, ph.summon);
}

/** Damage taken by the boss while its armor parts stand: each takes off its % (multiplied). */
function partArmorFactor(ctx: Ctx, target: BattleUnit): number {
  if (ctx.s.boss?.unitId !== target.unitId) return 1;
  let f = 1;
  for (const u of ctx.s.units) if (u.part?.effect === "armor" && active(u)) f *= (100 - u.part.pct) / 100;
  return f;
}

/** Round start in a boss fight: regen parts heal the boss; the phase's minions come when due. */
function bossRoundStart(ctx: Ctx): void {
  const b = ctx.s.boss;
  if (b === undefined) return;
  const boss = ctx.unit(b.unitId);
  if (!active(boss)) return;
  for (const u of ctx.s.units) {
    if (u.part?.effect !== "regen" || !active(u) || boss.hp >= boss.stats.maxHp) continue;
    const gained = receiveHeal(ctx, boss, Math.max(1, Math.floor((boss.stats.maxHp * u.part.pct) / 100)));
    if (gained !== 0) ctx.emit({ type: "ResourceChanged", unitId: boss.unitId, source: "boss_part", hp: gained, mp: 0, hpAfter: boss.hp, mpAfter: boss.mp });
  }
  const summon = bossDefinition(ctx)?.phases[b.phase]?.summon;
  if (summon !== undefined && b.lastSummonRound !== undefined && ctx.s.round - b.lastSummonRound >= summon.everyRounds) bossSummon(ctx, summon);
}

/**
 * The phase calls its minions in: each takes a free cell of its row (one with no living enemy), while
 * the fight's budget lasts and never past 10 living enemies (C05). They are wild units without loot or
 * EXP, and fall with the boss.
 */
function bossSummon(ctx: Ctx, summon: NonNullable<BossDefinition["phases"][number]["summon"]>): void {
  const b = ctx.s.boss!;
  b.lastSummonRound = ctx.s.round;
  const order = [2, 1, 3, 0, 4];
  const came: string[] = [];
  for (const add of summon.adds) {
    if ((b.summoned ?? 0) >= summon.maxPerFight) break;
    const living = ctx.s.units.filter((u) => u.side === "enemy" && active(u));
    if (living.length >= ctx.rules.confirmed.maxEnemyUnits.value) break;
    const slot = order.find((sl) => !living.some((u) => u.row === add.row && u.slot === sl));
    if (slot === undefined) continue;
    // Units are only ever added, so this number is new; a tower floor's reinforcements count on from it.
    const n = Math.max(ctx.s.units.length + 1, ctx.s.frontier?.nextUnit ?? 0);
    if (ctx.s.frontier !== undefined) ctx.s.frontier.nextUnit = n + 1;
    const unit = enemyUnit(ctx.rules, ctx.content, { unitId: `e${n}`, speciesId: add.speciesId, element: add.element, row: add.row, slot, lootEligible: false }, { bossDef: undefined, towerPct: ctx.s.frontier?.statPct ?? 100, modifiers: ctx.s.frontier?.modifiers ?? [] });
    unit.summoned = true;
    // A summoned minion cannot be caught (it would be a free extra capture each call).
    unit.captureWindowOpen = false;
    ctx.s.units.push(unit);
    b.summoned = (b.summoned ?? 0) + 1;
    came.push(unit.unitId);
    firePassives(ctx, unit, "battle_start");
  }
  if (came.length > 0) ctx.emit({ type: "BossSummoned", unitIds: came, left: summon.maxPerFight - (b.summoned ?? 0) });
}

/** After every action: later phases whose trigger is met, and the capture window. */
function checkBossPhase(ctx: Ctx): void {
  const b = ctx.s.boss;
  const def = bossDefinition(ctx);
  if (b === undefined || def === undefined) return;
  const boss = ctx.unit(b.unitId);
  if (!active(boss)) {
    if (b.telegraph !== null) {
      ctx.emit({ type: "BossTelegraph", unitId: boss.unitId, skillId: b.telegraph.skillId, change: "cancelled", firesRound: b.telegraph.firesRound });
      b.telegraph = null;
    }
    // Parts and summoned minions fall with the boss (they give nothing).
    for (const u of ctx.s.units) if (u.side === "enemy" && active(u) && (u.part !== undefined || u.summoned === true)) knockOut(ctx, u);
    return;
  }
  const hpPct = (boss.hp * 100) / boss.stats.maxHp;
  for (let next = b.phase + 1; next < def.phases.length; next++) {
    const met = def.phases[next]!.enterWhen.some((t) => (t.kind === "hp_below" ? hpPct < t.pct : t.kind === "shield_broken" ? b.shieldBroken : (b.partsBroken ?? []).includes(t.partId)));
    if (!met) break;
    enterBossPhase(ctx, next);
  }
  const capPct = def.phases[b.phase]!.captureBelowHpPct;
  if (!boss.captureWindowOpen && capPct !== undefined && hpPct < capPct) {
    boss.captureWindowOpen = true;
    ctx.emit({ type: "CaptureWindowOpened", unitId: boss.unitId });
  }
}

/** Round start: the phase's heavy move is announced for the next round (the answer window is this round). */
function announceTelegraph(ctx: Ctx): void {
  const b = ctx.s.boss;
  const tg = bossDefinition(ctx)?.phases[b?.phase ?? 0]?.telegraph;
  if (b === undefined || tg === undefined || b.telegraph !== null || !active(ctx.unit(b.unitId))) return;
  if (ctx.s.round - b.lastTelegraphRound < tg.everyRounds) return;
  b.telegraph = { skillId: tg.skillId, firesRound: ctx.s.round + 1 };
  b.lastTelegraphRound = ctx.s.round;
  ctx.emit({ type: "BossTelegraph", unitId: b.unitId, skillId: tg.skillId, change: "announced", firesRound: ctx.s.round + 1 });
}

/**
 * The boss's first action in the warned round uses the announced move. Silence or a skill block on the
 * boss calls it off (an answer to it); a lost turn only puts it back to the boss's next action.
 */
function fireTelegraph(ctx: Ctx, u: BattleUnit): boolean {
  const b = ctx.s.boss;
  if (b === undefined || b.unitId !== u.unitId || b.telegraph === null || ctx.s.round < b.telegraph.firesRound) return false;
  const t = b.telegraph;
  b.telegraph = null;
  const skill = ctx.content.skills.get(t.skillId)!;
  const blocked = statusBlocks(u.statuses, "skills") !== undefined || (skill.mpCost > 0 && statusBlocks(u.statuses, "mp_skills") !== undefined);
  const foes = targetsEnemies(skill.targetRule) ? validTargets(ctx.s, "ally", skill.range) : [u];
  if (blocked || foes.length === 0) {
    ctx.emit({ type: "BossTelegraph", unitId: u.unitId, skillId: t.skillId, change: "cancelled", firesRound: t.firesRound });
    return false;
  }
  ctx.emit({ type: "BossTelegraph", unitId: u.unitId, skillId: t.skillId, change: "fired", firesRound: t.firesRound });
  doSkill(ctx, u, t.skillId, foes[ctx.rng.nextInt(foes.length)]!, true);
  return true;
}

function enemyAct(ctx: Ctx, u: BattleUnit): void {
  if (fireTelegraph(ctx, u)) return;
  if (fireEliteCounter(ctx, u)) return;
  const disarmed = statusBlocks(u.statuses, "attack") !== undefined;
  // A boss keeps its telegraphed moves for the warned turn only.
  const reserved = ctx.s.boss?.unitId === u.unitId ? telegraphSkills(ctx) : undefined;
  const options = skillOptions(ctx.rules, ctx.content, ctx.s, u, ctx.rules.provisional.enemyAi.value.healBelowHpPct).filter((o) => reserved?.has(o.skill.id) !== true);
  if (options.length > 0 && (disarmed || ctx.rng.chanceBp(ctx.rules.provisional.enemyAi.value.skillChancePct * 100))) {
    const pick = options[ctx.rng.nextInt(options.length)]!;
    const target = pick.pool.length === 1 ? pick.pool[0]! : pick.pool[ctx.rng.nextInt(pick.pool.length)]!;
    return doSkill(ctx, u, pick.skill.id, target);
  }
  if (disarmed) {
    u.guarding = true;
    return actionEvent(ctx, u, "guard", null);
  }
  const reachable = validTargets(ctx.s, "ally", reach(u, u.basicAttackRange));
  if (reachable.length === 0) return;
  // A backline hunter goes for the back row while anyone stands there.
  const backRow = u.elite?.modifiers.includes("backline_hunter") === true ? reachable.filter((t) => t.row === "back") : [];
  const targets = backRow.length > 0 ? backRow : reachable;
  const taunter = tauntedBy(ctx.s, u);
  const target = taunter !== undefined && reachable.includes(taunter) ? taunter : targets[ctx.rng.nextInt(targets.length)]!;
  doAttack(ctx, u, target, null);
}

/** Whether putting this status on `t` would do anything (so an AI does not waste a turn). */
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

/** What an AI considers a skill to be, best first for Auto: heal, cleanse, buff, debuff, damage. */
type SkillRole = "heal" | "cleanse" | "buff" | "debuff" | "damage";
const ROLE_ORDER: readonly SkillRole[] = ["heal", "cleanse", "buff", "debuff", "damage"];
interface SkillOption {
  skill: SkillDefinition;
  role: SkillRole;
  mpCost: number;
  /** Targets worth using it on, best first (lowest HP share; a taunter alone when taunted). */
  pool: BattleUnit[];
}

/**
 * The skills `u` could use right now with the targets worth it. It applies the same checks as a manual
 * command (MP, cooldown and the OPEN tick rule, silence, skill lock, taunt, range), so an AI pick never
 * fails validation; heals wait for someone under `healBelowPct` of max HP.
 */
function skillOptions(rules: RulesConfig, content: Pick<BattleContent, "skills">, state: BattleState, u: BattleUnit, healBelowPct: number): SkillOption[] {
  const st = u.statuses ?? [];
  if (u.skillIds.length === 0 || statusBlocks(st, "skills") !== undefined) return [];
  const foes: Side = u.side === "ally" ? "enemy" : "ally";
  const byHp = (a: BattleUnit, b: BattleUnit) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp || (a.unitId < b.unitId ? -1 : 1);
  const useful = (t: BattleUnit, list: readonly StatusApplication[]) => list.some((a) => worthApplying(u, t, a.statusId));
  const out: SkillOption[] = [];
  for (const skillId of u.skillIds) {
    const skill = content.skills.get(skillId);
    if (skill === undefined || skill.kind !== "active" || skill.effectSequence.length !== 1) continue;
    const { mpCost, cooldown } = skillCost(rules, u, skill);
    if ((u.cooldowns[skillId] ?? 0) > 0 || u.mp < mpCost) continue;
    if (mpCost > 0 && statusBlocks(st, "mp_skills") !== undefined) continue;
    if (st.some((x) => x.statusId === "skill_lock" && x.skillId === skillId)) continue;
    const effect = skill.effectSequence[0]!;
    const onEnemy = targetsEnemies(skill.targetRule);
    let pool: BattleUnit[];
    let role: SkillRole;
    if (onEnemy) {
      pool = validTargets(state, foes, reach(u, skill.range)).sort(byHp);
      if (u.elite?.modifiers.includes("backline_hunter") === true) pool.sort((a, b) => (a.row === b.row ? 0 : a.row === "back" ? -1 : 1));
      const taunter = tauntedBy(state, u);
      if (taunter !== undefined && pool.includes(taunter)) pool = [taunter];
      if (effect.kind === "status") pool = pool.filter((t) => useful(t, effect.statuses));
      role = effect.kind === "damage" ? "damage" : "debuff";
    } else {
      pool = (skill.targetRule === "self" ? [u] : state.units.filter((x) => x.side === u.side && active(x))).sort(byHp);
      if (effect.kind === "heal") {
        pool = pool.filter((t) => t.hp * 100 < healBelowPct * t.stats.maxHp).slice(0, 1);
        role = "heal";
      } else {
        if (effect.kind === "status") pool = pool.filter((t) => useful(t, effect.statuses));
        role = effect.kind === "status" && effect.statuses.some((a) => a.statusId === "cleanse") ? "cleanse" : "buff";
      }
    }
    if (pool.length > 0) out.push({ skill, role, mpCost, pool });
  }
  return out;
}

function checkEnd(ctx: Ctx): void {
  if (ctx.s.status !== "active") return;
  checkBossPhase(ctx);
  checkElites(ctx);
  // Tower: with no enemy standing, the queue comes in at once, so the floor goes on until it is empty.
  if (!ctx.s.units.some((u) => u.side === "enemy" && active(u))) arriveReinforcements(ctx);
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
      .map((u) => ({ unitId: u.unitId, instanceId: u.instanceId, hp: u.hp, mp: u.mp, ko: u.ko, maxHp: u.stats.maxHp, maxMp: u.stats.maxMp })),
    consumed: { ...s.consumed },
    unusedReserved: unusedOf(s.bag),
    ...(s.members !== undefined ? { members: Object.fromEntries(s.members.map((m) => [m.accountId, { consumed: { ...m.consumed }, unusedReserved: unusedOf(m.bag) }])) } : {}),
  });
}

function unusedOf(bag: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(bag).filter(([, q]) => q > 0));
}

/**
 * Bond and skill mastery when a fight ends (chapter 04 §5–§6), for every companion that started it.
 * Mastery: won fights only, KO'd or not, counted per enemy defeated or captured (heal or buff loops add
 * nothing). Bond: a companion that fell in the fight loses some, whatever the outcome (Nut 2026-10-03);
 * one that stayed up through a win gains some; nothing else changes it.
 */
function companionResults(ctx: Ctx, outcome: "victory" | "defeat" | "fled"): void {
  // Practice (P17): no Bond up or down, no mastery.
  if (ctx.s.practice === true) return;
  const p = ctx.rules.provisional;
  const won = outcome === "victory";
  const mastery = won ? masteryForVictory(ctx.rules, Object.keys(ctx.s.resolutions).length) : 0;
  for (const who of fightRecipients(ctx.s)) {
    const companions: Record<string, { bond: number; mastery: number }> = {};
    for (const u of ctx.s.units) {
      if (u.kind !== "companion" || u.instanceId === null || controllerOf(ctx.s, u) !== who) continue;
      const bond = u.fell === true ? -p.bondLossOnFall.value : won ? p.bondPerVictory.value : 0;
      if (bond !== 0 || mastery !== 0) companions[u.instanceId] = { bond, mastery };
    }
    if (Object.keys(companions).length === 0) continue;
    const entitlement: Entitlement = { entitlementId: `${ctx.s.battleId}:all:result`, kind: "fight_result", companions, ...recipientField(ctx.s, who) };
    ctx.s.entitlements.push(entitlement);
    ctx.emit({ type: "RewardEntitled", entitlement });
  }
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
  content?: Pick<BattleContent, "items"> & Partial<Pick<BattleContent, "skills">>,
  policyInput: AutoBattlePolicyInput = {},
  /** Needed for skills (costs, the OPEN cooldown rule); without it Auto only attacks. */
  rules?: RulesConfig,
): BattleCommand | null {
  const actor = currentActor(state);
  if (actor === null || actor.side !== "ally") return null;
  const policy = AutoBattlePolicySchema.parse(policyInput);
  if (actor.kind === "player" && content !== undefined) {
    for (const rule of policy.itemRules) {
      const item = content.items.get(rule.itemId);
      if (item === undefined) continue;
      const own = combatBagOf(state, actor);
      if ((own.bag[rule.itemId] ?? 0) <= 0 || (own.consumed[rule.itemId] ?? 0) >= rule.maxPerFight) continue;
      const pick = autoItemTarget(state, actor, item, rule, rules);
      if (pick !== undefined) return { type: "item", actorId: actor.unitId, itemId: rule.itemId, targetId: pick.unitId };
    }
  }
  // Skills (chapter 08 rule engine): heal, cleanse, buff, debuff, then damage, while MP stays above
  // the player's reserve. Each skill is used on the best target it is worth using on.
  const disarmed = statusBlocks(actor.statuses, "attack") !== undefined;
  const sk = policy.skills;
  if (rules !== undefined && content?.skills !== undefined && sk.use) {
    const options = skillOptions(rules, { skills: content.skills }, state, actor, sk.healBelowPercent).filter(
      (o) => (actor.mp - o.mpCost) * 100 >= sk.mpReservePercent * actor.stats.maxMp || o.mpCost === 0,
    );
    const best = options.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))[0];
    if (best !== undefined) return { type: "skill", actorId: actor.unitId, skillId: best.skill.id, targetId: best.pool[0]!.unitId };
  }
  // Disarmed: guard. Taunted: hit the taunter when it can be reached.
  if (disarmed) return { type: "guard", actorId: actor.unitId };
  const targets = validTargets(state, "enemy", actor.basicAttackRange);
  if (targets.length === 0) return null;
  const taunter = tauntedBy(state, actor);
  const target = taunter !== undefined && targets.includes(taunter) ? taunter : targets.reduce((best, u) => (u.hp < best.hp ? u : best));
  return { type: "attack", actorId: actor.unitId, targetId: target.unitId };
}

/**
 * Who an Auto item rule would use its item on now, if anyone (chapter 08 allowed items). Heal: the
 * lowest HP share under the rule's HP %; mana: the lowest MP share under its MP %; revive: the first
 * fallen ally that can be brought back now (needs `rules`); support: the first ally the statuses would
 * still do something for (a buff it lacks, a harmful status to cleanse). "self" limits it to the
 * character.
 */
function autoItemTarget(state: BattleState, actor: BattleUnit, item: ItemDefinition, rule: AutoItemRule, rules: RulesConfig | undefined): BattleUnit | undefined {
  const allies = rule.target === "self" ? [actor] : state.units.filter((u) => u.side === "ally");
  const living = allies.filter(active);
  const share = (v: number, max: number) => (max <= 0 ? 1 : v / max);
  switch (item.kind) {
    case "heal":
      return living.filter((u) => u.hp * 100 < rule.hpBelowPercent * u.stats.maxHp).sort((a, b) => share(a.hp, a.stats.maxHp) - share(b.hp, b.stats.maxHp))[0];
    case "mana":
      return living.filter((u) => u.stats.maxMp > 0 && u.mp * 100 < rule.mpBelowPercent * u.stats.maxMp).sort((a, b) => share(a.mp, a.stats.maxMp) - share(b.mp, b.stats.maxMp))[0];
    case "revive":
      if (rules === undefined) return undefined;
      return allies.find((u) => u.ko && reviveBlock(rules, state, actor, u) === null);
    case "support":
      return living.find((u) => (item.statuses ?? []).some((a) => worthApplying(actor, u, a.statusId)));
    default:
      return undefined;
  }
}

/** What the client may see. The RNG state stays on the server. */
export function publicView(state: BattleState): Omit<BattleState, "rng"> {
  const { rng: _rng, ...rest } = state;
  const out = structuredClone(rest);
  // The tower's pre-rolled reinforcements stay on the server; the client sees how many are left.
  if (out.frontier !== undefined) {
    delete out.frontier.queue;
    delete out.frontier.nextUnit;
  }
  return out;
}
