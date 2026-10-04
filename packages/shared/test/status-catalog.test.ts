import { describe, expect, it } from "vitest";
import {
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  type ActiveStatus,
  type BattleCommand,
  type BattleEvent,
  type BattleState,
  type KernelResult,
  type SkillDefinition,
  type StatusApplication,
} from "../src/index";
import { baseSetup, content, rules as baseRules } from "./fixtures";

// Every hit lands, so a test only rolls what it is about.
const rules = structuredClone(baseRules);
(rules.provisional.hitChanceClampPct as { value: readonly [number, number] }).value = [100, 100];

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};

const meta = { version: 1, status: "draft" as const, example: true };
const strikeWith = (id: string, statuses: StatusApplication[] = [], over: Partial<SkillDefinition> = {}, element: "NEUTRAL" | "FIRE" | "WIND" = "NEUTRAL"): SkillDefinition => ({
  id,
  ...meta,
  name: { th: id },
  kind: "active",
  ownerKind: "player",
  targetRule: "single_enemy",
  range: "ranged",
  mpCost: 1,
  cooldown: 0,
  effectSequence: [{ kind: "damage", damageType: "physical", coefficient: 0.1, flat: 0, element, statuses }],
  tags: [],
  ...over,
});
const enemyStatus = (id: string, statuses: StatusApplication[]): SkillDefinition => ({ ...strikeWith(id), effectSequence: [{ kind: "status", statuses }] });

const HIT = strikeWith("skill:t_hit");

function world(skills: SkillDefinition[] = []) {
  const c = content();
  for (const s of [HIT, ...skills]) c.skills.set(s.id, s);
  const setup = baseSetup();
  setup.player.skillIds = [HIT.id, ...skills.map((s) => s.id)];
  setup.player.gear = { PATK: 70, EFFECT_HIT_PCT: 100 };
  let s = ok(createBattle(rules, c, setup)).state;
  for (let i = 0; i < 50 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
  return { c, s };
}

const st = (statusId: ActiveStatus["statusId"], sourceId: string | null = null, extra: Partial<ActiveStatus> = {}): ActiveStatus => ({ statusId, sourceId, turnsLeft: 3, stacks: 1, fresh: false, ...extra });
/** A copy of the state with these statuses on these units. */
function put(state: BattleState, on: Record<string, ActiveStatus[]>): BattleState {
  const next = structuredClone(state);
  for (const [id, list] of Object.entries(on)) next.units.find((u) => u.unitId === id)!.statuses = list;
  return next;
}
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;
const run = (w: { c: ReturnType<typeof content> }, s: BattleState, cmd: BattleCommand) => applyCommand(rules, w.c, s, cmd, { source: "player" });
const skill = (skillId: string, targetId = "e1"): BattleCommand => ({ type: "skill", actorId: "player", skillId, targetId });
const attack = (targetId = "e1"): BattleCommand => ({ type: "attack", actorId: "player", targetId });
const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe("control statuses (catalog §3.1)", () => {
  it("taunt forces the target; the auto picker and enemy AI go for the taunter", () => {
    const w = world();
    const s = put(w.s, { player: [st("taunt", "e2")] });
    expect(run(w, s, attack("e1"))).toMatchObject({ ok: false, code: "TAUNTED" });
    expect(run(w, s, attack("e2")).ok).toBe(true);
    expect(chooseAutoCommand(s)).toMatchObject({ targetId: "e2" });
  });

  it("disarm blocks the basic attack, and the auto picker guards instead; root blocks fleeing", () => {
    const w = world();
    const s = put(w.s, { player: [st("disarm"), st("root")] });
    expect(run(w, s, attack())).toMatchObject({ ok: false, code: "STATUS_BLOCKED" });
    expect(run(w, s, { type: "flee", actorId: "player" })).toMatchObject({ ok: false, code: "STATUS_BLOCKED" });
    expect(run(w, s, skill(HIT.id)).ok).toBe(true);
  });

  it("berserk and mini block skills; skill lock blocks only the locked skill", () => {
    const other = strikeWith("skill:t_other");
    const w = world([other]);
    expect(run(w, put(w.s, { player: [st("berserk")] }), skill(HIT.id))).toMatchObject({ ok: false, code: "STATUS_BLOCKED" });
    expect(run(w, put(w.s, { player: [st("mini")] }), skill(HIT.id))).toMatchObject({ ok: false, code: "STATUS_BLOCKED" });
    const locked = put(w.s, { player: [st("skill_lock", "e1", { skillId: HIT.id })] });
    expect(run(w, locked, skill(HIT.id))).toMatchObject({ ok: false, code: "STATUS_BLOCKED" });
    expect(run(w, locked, skill(other.id)).ok).toBe(true);
  });

  it("charm sends the attack to the actor's own side", () => {
    const w = world();
    const r = ok(run(w, put(w.s, { player: [st("charm", "e1")] }), attack("e1")));
    const red = of(r.events, "ActionRedirected")[0]!;
    expect(red).toMatchObject({ actorId: "player", statusId: "charm", fromId: "e1", toId: "player" });
    expect(of(r.events, "ActionResolved")[0]).toMatchObject({ actorId: "player", targetId: "player" });
  });

  it("doom knocks the unit out when it runs out", () => {
    const w = world();
    const r = ok(run(w, put(w.s, { e1: [st("doom", "player", { turnsLeft: 1 })] }), skill(HIT.id, "e2")));
    expect(of(r.events, "StatusChanged")).toContainEqual(expect.objectContaining({ unitId: "e1", statusId: "doom", change: "expired" }));
    expect(unit(r.state, "e1").ko).toBe(true);
  });
});

describe("damage over time (catalog §3.2)", () => {
  it("toxic grows a stack every tick; frostbite at 3 stacks freezes", () => {
    const w = world([strikeWith("skill:t_frost", [{ statusId: "frostbite", chancePct: 100, turns: 3 }])]);
    const r = ok(run(w, put(w.s, { e2: [st("toxic", "player")] }), skill(HIT.id)));
    expect(unit(r.state, "e2").statuses!.find((x) => x.statusId === "toxic")!.stacks).toBe(2);
    const frost = ok(run(w, put(w.s, { e1: [st("frostbite", "player", { stacks: 2 })] }), skill("skill:t_frost")));
    expect(of(frost.events, "StatusChanged")).toContainEqual(expect.objectContaining({ unitId: "e1", statusId: "freeze", change: "applied" }));
  });

  it("leech gives what it took to the unit that put it on", () => {
    const w = world();
    const s = put(w.s, { e1: [st("leech", "player")] });
    unit(s, "player").hp -= 30;
    const r = ok(run(w, s, skill(HIT.id, "e2")));
    const tick = of(r.events, "StatusTick").find((e) => e.statusId === "leech")!;
    expect(of(r.events, "ResourceChanged")).toContainEqual(expect.objectContaining({ unitId: "player", source: "leech", hp: -tick.hp }));
  });
});

describe("defence and reaction statuses (catalog §3.4)", () => {
  it("invincible takes a whole hit once; endure keeps 1 HP once", () => {
    const w = world();
    const r = ok(run(w, put(w.s, { e1: [st("invincible")] }), skill(HIT.id)));
    expect(of(r.events, "ActionResolved")[0]).toMatchObject({ damage: 0 });
    expect(unit(r.state, "e1").statuses!.some((x) => x.statusId === "invincible")).toBe(false);
    const big = strikeWith("skill:t_big", [], { effectSequence: [{ kind: "damage", damageType: "physical", coefficient: 50, flat: 0, element: "NEUTRAL" }] });
    w.c.skills.set(big.id, big);
    const s = put(w.s, { e1: [st("endure")] });
    unit(s, "player").skillIds.push(big.id);
    const e = ok(run(w, s, skill(big.id)));
    expect(of(e.events, "ActionResolved")[0]).toMatchObject({ targetHpAfter: 1 });
  });

  it("a counter strikes back once and never sets off another counter", () => {
    const w = world();
    // Stun keeps both enemies from taking their own turns, so every e1 action here is a counter.
    const r = ok(run(w, put(w.s, { e1: [st("counter"), st("stun")], e2: [st("stun")], player: [st("counter")] }), skill(HIT.id)));
    const acts = of(r.events, "ActionResolved").filter((e) => e.actorId === "e1" || e.actorId === "player");
    expect(acts.slice(0, 2).map((e) => [e.actorId, e.action])).toEqual([["player", "skill"], ["e1", "attack"]]);
    expect(acts.filter((e) => e.actorId === "player")).toHaveLength(1);
  });

  it("protect makes the protector take the hit; thorns hurt a physical attacker", () => {
    const w = world();
    const r = ok(run(w, put(w.s, { e1: [st("protect", "e2")], e2: [st("thorns"), st("stun")] }), skill(HIT.id)));
    expect(of(r.events, "ActionResolved")[0]).toMatchObject({ targetId: "e2" });
    expect(of(r.events, "StatusTick")).toContainEqual(expect.objectContaining({ unitId: "player", statusId: "thorns" }));
  });

  it("stealth hides a unit from single-target picks while a visible one is left", () => {
    const w = world();
    const s = put(w.s, { e1: [st("stealth")] });
    expect(run(w, s, skill(HIT.id, "e1"))).toMatchObject({ ok: false, code: "INVALID_TARGET" });
    expect(run(w, s, skill(HIT.id, "e2")).ok).toBe(true);
  });
});

describe("healing and resource statuses (catalog §3.3, §3.7)", () => {
  it("zombie turns a potion into damage; anti-heal halves it", () => {
    const w = world();
    const potion: BattleCommand = { type: "item", actorId: "player", itemId: "item:small_potion", targetId: "player" };
    const hurt = (s: BattleState) => {
      unit(s, "player").hp = 40;
      return s;
    };
    const z = ok(run(w, hurt(put(w.s, { player: [st("zombie")] })), potion));
    expect(of(z.events, "ActionResolved")[0]).toMatchObject({ heal: null, damage: expect.any(Number) });
    expect(unit(z.state, "player").hp).toBeLessThan(40);
    const plain = ok(run(w, hurt(structuredClone(w.s)), potion));
    const anti = ok(run(w, hurt(put(w.s, { player: [st("anti_heal")] })), potion));
    expect(of(anti.events, "ActionResolved")[0]!.heal).toBe(Math.floor((of(plain.events, "ActionResolved")[0]!.heal! * 50) / 100));
  });

  it("MP cost up makes skills cost 50% more MP, rounded up", () => {
    const w = world([strikeWith("skill:t_mp3", [], { mpCost: 3 })]);
    const before = unit(w.s, "player").mp;
    const r = ok(run(w, put(w.s, { player: [st("mp_cost_up")] }), skill("skill:t_mp3")));
    expect(unit(r.state, "player").mp).toBe(before - 5);
  });
});

describe("instant statuses (catalog §3.1, §3.7)", () => {
  it("knockback moves a front-row unit to the back row", () => {
    const w = world([strikeWith("skill:t_push", [{ statusId: "knockback", chancePct: 100, turns: 1 }])]);
    const r = ok(run(w, w.s, skill("skill:t_push")));
    expect(of(r.events, "StatusChanged")[0]).toMatchObject({ unitId: "e1", statusId: "knockback", change: "applied", turnsLeft: 0 });
    expect(unit(r.state, "e1").row).toBe("back");
  });

  it("dispel removes a buff; invert turns buffs into their debuffs", () => {
    const w = world([enemyStatus("skill:t_dispel", [{ statusId: "dispel", chancePct: 100, turns: 1 }]), enemyStatus("skill:t_invert", [{ statusId: "invert", chancePct: 100, turns: 1 }])]);
    const buffed = put(w.s, { e1: [st("def_up"), st("stun")] });
    const d = ok(run(w, buffed, skill("skill:t_dispel")));
    expect(unit(d.state, "e1").statuses!.map((x) => x.statusId)).toEqual(["stun"]);
    const i = ok(run(w, buffed, skill("skill:t_invert")));
    expect(unit(i.state, "e1").statuses!.map((x) => x.statusId).sort()).toEqual(["def_down", "stun"]);
  });

  it("cleanse on yourself removes a harmful status", () => {
    const self: SkillDefinition = { ...strikeWith("skill:t_cleanse"), targetRule: "self", effectSequence: [{ kind: "status", statuses: [{ statusId: "cleanse", chancePct: 100, turns: 1 }] }] };
    const w = world([self]);
    const r = ok(run(w, put(w.s, { player: [st("def_down")] }), skill(self.id, "player")));
    expect(unit(r.state, "player").statuses).toEqual([]);
  });
});

describe("blocking, reactions and marks (catalog §3.5, §3.6)", () => {
  it("immunity blocks one harmful status and is used up; unbuffable blocks buffs", () => {
    const w = world([strikeWith("skill:t_weak", [{ statusId: "def_down", chancePct: 100, turns: 2 }])]);
    const r = ok(run(w, put(w.s, { e1: [st("immunity"), st("stun")] }), skill("skill:t_weak")));
    const changes = of(r.events, "StatusChanged").map((e) => [e.statusId, e.change]);
    expect(changes.slice(0, 2)).toEqual([["immunity", "removed"], ["def_down", "blocked"]]);
    expect(unit(r.state, "e1").statuses!.map((x) => x.statusId)).toEqual(["stun"]);
    const self: SkillDefinition = { ...strikeWith("skill:t_rally"), targetRule: "self", effectSequence: [{ kind: "status", statuses: [{ statusId: "atk_up", chancePct: 100, turns: 2 }] }] };
    w.c.skills.set(self.id, self);
    const s = put(w.s, { player: [st("unbuffable")] });
    unit(s, "player").skillIds.push(self.id);
    expect(of(ok(run(w, s, skill(self.id, "player"))).events, "StatusChanged")[0]).toMatchObject({ statusId: "atk_up", change: "blocked" });
  });

  it("wet meeting fire turns to steam (blind); oil meeting fire burns", () => {
    const w = world([strikeWith("skill:t_fire", [], {}, "FIRE")]);
    const landed = (r: KernelResult) => of(ok(r).events, "StatusChanged").filter((e) => e.unitId === "e1").map((e) => [e.statusId, e.change]);
    expect(landed(run(w, put(w.s, { e1: [st("wet")] }), skill("skill:t_fire")))).toEqual(expect.arrayContaining([["wet", "removed"], ["blind", "applied"]]));
    expect(landed(run(w, put(w.s, { e1: [st("oil")] }), skill("skill:t_fire")))).toEqual(expect.arrayContaining([["oil", "removed"], ["burn", "applied"]]));
  });

  it("a skill with a bonus against a mark hits harder and uses the mark up", () => {
    const consume = strikeWith("skill:t_consume", [], {
      effectSequence: [{ kind: "damage", damageType: "physical", coefficient: 1, flat: 0, element: "NEUTRAL", bonusVsStatus: { statusId: "mark", bonusPct: 50, consume: true } }],
    });
    const w = world([consume]);
    const plain = ok(run(w, w.s, skill(consume.id)));
    const marked = ok(run(w, put(w.s, { e1: [st("mark", "player")] }), skill(consume.id)));
    const dmg = (r: typeof plain) => of(r.events, "ActionResolved")[0]!.breakdown!;
    expect(dmg(marked).final).toBeGreaterThan(dmg(plain).final);
    expect(of(marked.events, "StatusChanged")[0]).toMatchObject({ statusId: "mark", change: "removed" });
  });
});
