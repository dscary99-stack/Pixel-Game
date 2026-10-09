import { describe, expect, it } from "vitest";
import {
  CLASS1_DEFINITIONS,
  CLASS2_BRANCHES,
  CLASS2_TRIAL_BOSS_ID,
  CLASS_KITS,
  class2Refusal,
  RACE_DEFINITIONS,
  RACE_PASSIVES,
  SkillDefinitionSchema,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  playerKit,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type KernelResult,
} from "../src/index";
import { baseSetup, content, rules } from "./fixtures";

const c = content();
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const triggered = (events: BattleEvent[], sourceId: string) => events.some((e) => e.type === "PassiveTriggered" && e.sourceId === sourceId);
/** Play the enemies' turns with guard until it is the player's turn again. */
function toPlayer(s: BattleState): { s: BattleState; events: BattleEvent[] } {
  const events: BattleEvent[] = [];
  for (let i = 0; i < 50 && s.status === "active" && currentActor(s)?.unitId !== "player"; i++) {
    const r = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" }));
    events.push(...r.events);
    s = r.state;
  }
  return { s, events };
}

describe("Class1 kits and race passives (chapter 02, P16)", () => {
  it("every class has a passive and four actives, every race a passive, all valid player skills", () => {
    expect(Object.keys(CLASS_KITS).sort()).toEqual(CLASS1_DEFINITIONS.map((d) => d.id).sort());
    expect(Object.keys(RACE_PASSIVES).sort()).toEqual(RACE_DEFINITIONS.map((d) => d.id).sort());
    for (const k of Object.values(CLASS_KITS)) {
      expect(k.actives).toHaveLength(4);
      const p = c.skills.get(k.passiveId)!;
      expect(p).toMatchObject({ kind: "passive", ownerKind: "player" });
      for (const a of k.actives) {
        const sk = c.skills.get(a.skillId)!;
        expect(SkillDefinitionSchema.safeParse(sk).success).toBe(true);
        expect(sk).toMatchObject({ kind: "active", ownerKind: "player" });
      }
    }
    for (const id of Object.values(RACE_PASSIVES)) expect(c.skills.get(id)?.passive).toBeDefined();
  });

  it("opens by level: two actives at Lv1, the third at 8, the fourth at 20", () => {
    expect(playerKit("class:striker", "race:human", 1)).toEqual({
      skillIds: ["skill:striker_heavy_slash", "skill:striker_cleave"],
      passiveIds: ["skill:striker_fighting_blood", "skill:race_human_grit"],
      locked: [
        { skillId: "skill:striker_armor_break", level: 8 },
        { skillId: "skill:striker_all_in", level: 20 },
      ],
    });
    expect(playerKit("class:striker", "race:human", 8).skillIds).toHaveLength(3);
    expect(playerKit("class:striker", "race:human", 20).locked).toEqual([]);
    expect(playerKit("class:nope", "race:nope", 50)).toEqual({ skillIds: [], passiveIds: [], locked: [] });
  });

  it("every class's full kit fights through Auto to the end without a refused command", () => {
    for (const cls of CLASS1_DEFINITIONS) {
      const k = playerKit(cls.id, "race:human", 20);
      const setup = baseSetup({ battleId: `battle:${cls.id}` });
      setup.player.skillIds = k.skillIds;
      setup.player.passiveIds = k.passiveIds;
      setup.player.basicAttackRange = cls.basicAttackRange;
      let s = ok(createBattle(rules, c, setup)).state;
      for (let i = 0; i < 400 && s.status === "active"; i++) {
        const actor = currentActor(s)!;
        const cmd = chooseAutoCommand(s, c, {}, rules) ?? { type: "guard" as const, actorId: actor.unitId };
        s = ok(applyCommand(rules, c, s, cmd, { source: "auto" })).state;
      }
      expect(s.status, cls.id).not.toBe("active");
    }
  });

  it("new passive events: an item use (มนุษย์), a move (ชาวเวหา), a debuff from the enemy (ชาวสนธยา)", () => {
    const start = (raceId: string, over: (s: BattleSetup) => void = () => {}) => {
      const setup = baseSetup();
      setup.player.passiveIds = [RACE_PASSIVES[raceId]!];
      over(setup);
      return toPlayer(ok(createBattle(rules, c, setup)).state).s;
    };
    const human = start("race:human");
    human.units.find((u) => u.unitId === "player")!.hp -= 50;
    const used = ok(applyCommand(rules, c, human, { type: "item", actorId: "player", itemId: "item:small_potion", targetId: "player" }, { source: "player" }));
    expect(triggered(used.events, "skill:race_human_grit")).toBe(true);
    expect(used.events).toContainEqual(expect.objectContaining({ type: "ShieldChanged", unitId: "player", change: "gained" }));

    const sky = start("race:skyborn");
    const moved = ok(applyCommand(rules, c, sky, { type: "move", actorId: "player", row: "back", slot: 1 }, { source: "player" }));
    expect(triggered(moved.events, "skill:race_skyborn_wind")).toBe(true);

    // The fox's bite tries mark (80%) and bleed: give it the skill turn until a debuff lands.
    let veil = ok(createBattle(rules, c, (() => {
      const setup = baseSetup();
      setup.player.passiveIds = [RACE_PASSIVES["race:veilborn"]!];
      return setup;
    })())).state;
    let fired = false;
    for (let i = 0; i < 200 && veil.status === "active" && !fired; i++) {
      const actor = currentActor(veil)!;
      const r = ok(applyCommand(rules, c, veil, { type: "guard", actorId: actor.unitId }, { source: "player" }));
      fired = r.events.some((e) => e.type === "PassiveTriggered" && e.sourceId === "skill:race_veilborn_shade");
      if (fired) {
        const debuffed = r.events.findIndex((e) => e.type === "StatusChanged" && e.unitId === "player" && e.change === "applied");
        expect(debuffed).toBeGreaterThanOrEqual(0);
      }
      veil = r.state;
    }
    expect(fired).toBe(true);
  });
});

describe("Class2 branches (chapter 02, P16/P28)", () => {
  it("two branches per Class1, each a valid passive and two actives", () => {
    for (const cls of CLASS1_DEFINITIONS) expect(CLASS2_BRANCHES.filter((b) => b.classId === cls.id), cls.id).toHaveLength(2);
    expect(new Set(CLASS2_BRANCHES.map((b) => b.id)).size).toBe(18);
    for (const b of CLASS2_BRANCHES) {
      expect(c.skills.get(b.passiveId)?.passive, b.passiveId).toBeDefined();
      for (const a of b.actives) {
        const sk = c.skills.get(a.skillId)!;
        expect(SkillDefinitionSchema.safeParse(sk).success, a.skillId).toBe(true);
        expect(sk).toMatchObject({ kind: "active", ownerKind: "player" });
      }
    }
  });

  it("joins the kit only for its own class: actives at Lv50 and 60, the passive with them", () => {
    const k50 = playerKit("class:guardian", "race:human", 50, "class2:bastion");
    expect(k50.skillIds).toEqual([...playerKit("class:guardian", "race:human", 50).skillIds, "skill:c2_bastion_wall"]);
    expect(k50.passiveIds).toEqual(["skill:guardian_heart", "skill:c2_bastion_layers", "skill:race_human_grit"]);
    expect(k50.locked).toEqual([{ skillId: "skill:c2_bastion_stand_in", level: 60 }]);
    expect(playerKit("class:guardian", "race:human", 60, "class2:bastion").skillIds).toHaveLength(6);
    expect(playerKit("class:striker", "race:human", 60, "class2:bastion")).toEqual(playerKit("class:striker", "race:human", 60));
  });

  it("the trial is refused below Lv50, for another class's branch, and once a branch is taken", () => {
    const g = { classId: "class:guardian", level: 49, class2Id: null };
    expect(class2Refusal(rules, g, "class2:bastion")).toBe("LEVEL_TOO_LOW");
    expect(class2Refusal(rules, { ...g, level: 50 }, "class2:bastion")).toBeNull();
    expect(class2Refusal(rules, { ...g, level: 50 }, "class2:breaker")).toBe("NOT_FOUND");
    expect(class2Refusal(rules, { ...g, level: 80, class2Id: "class2:sentinel" }, "class2:bastion")).toBe("ALREADY_CHOSEN");
  });

  it("a class trial is a practice boss fight only, and scales the boss by the trial stat %", () => {
    const trial = (over: Partial<BattleSetup>) => createBattle(rules, c, { ...baseSetup({ enemies: [], boss: { bossId: CLASS2_TRIAL_BOSS_ID }, bag: {}, practice: true, classTrial: true }), ...over });
    expect(trial({ practice: undefined })).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(createBattle(rules, c, baseSetup({ classTrial: true, practice: true }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    const scaled = ok(trial({})).state;
    const plain = ok(trial({ classTrial: undefined })).state;
    const hp = (s: BattleState) => s.units.find((u) => u.unitId === "e1")!.stats.maxHp;
    expect(Math.abs(hp(scaled) - Math.floor((hp(plain) * rules.provisional.classChange.value.trialStatPct) / 100))).toBeLessThanOrEqual(1);
    expect(scaled.enemyStatPct).toBe(rules.provisional.classChange.value.trialStatPct);
  });

  it("every branch's full kit fights the trial through Auto to the end without a refused command", () => {
    for (const b of CLASS2_BRANCHES) {
      const cls = CLASS1_DEFINITIONS.find((d) => d.id === b.classId)!;
      const k = playerKit(cls.id, "race:human", 60, b.id);
      const setup = baseSetup({ battleId: `battle:${b.id}`, enemies: [], boss: { bossId: CLASS2_TRIAL_BOSS_ID }, bag: {}, practice: true, classTrial: true });
      setup.player = { ...setup.player, level: 60, skillIds: k.skillIds, passiveIds: k.passiveIds, basicAttackRange: cls.basicAttackRange };
      let s = ok(createBattle(rules, c, setup)).state;
      for (let i = 0; i < 1500 && s.status === "active"; i++) {
        const actor = currentActor(s)!;
        const cmd = chooseAutoCommand(s, c, {}, rules) ?? { type: "guard" as const, actorId: actor.unitId };
        s = ok(applyCommand(rules, c, s, cmd, { source: "auto" })).state;
      }
      expect(s.status, b.id).not.toBe("active");
    }
  });
});
