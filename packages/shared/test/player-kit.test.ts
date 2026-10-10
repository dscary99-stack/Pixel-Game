import { describe, expect, it } from "vitest";
import {
  CLASS1_DEFINITIONS,
  CLASS2_BRANCHES,
  CLASS2_TRIAL_BOSS_ID,
  CLASS3_ADVANCES,
  CLASS3_TRIAL_BOSS_ID,
  SKILL_TREES,
  characterTrees,
  class3Refusal,
  classView,
  companionPrimaryStats,
  TREE_PASSIVE_IDS,
  jobExpForLevel,
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
import { baseSetup, companion, content, rules } from "./fixtures";

const c = content();
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
/** Every node of the character's trees at its max level. */
const everything = (classId: string, class2Id?: string, class3Id?: string): Record<string, number> =>
  Object.fromEntries([classId, class2Id, class3Id].flatMap((id) => (id === undefined ? [] : SKILL_TREES.get(id)!.nodes)).map((n) => [n.skillId, n.maxLevel]));
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
  it("every class and branch has a tree, every race a passive, all valid player skills", () => {
    for (const cls of CLASS1_DEFINITIONS) expect(SKILL_TREES.get(cls.id)?.tier, cls.id).toBe(1);
    for (const b of CLASS2_BRANCHES) expect(SKILL_TREES.get(b.treeId)?.tier, b.id).toBe(2);
    expect(Object.keys(RACE_PASSIVES).sort()).toEqual(RACE_DEFINITIONS.map((d) => d.id).sort());
    for (const t of SKILL_TREES.values()) {
      for (const n of t.nodes) {
        const sk = c.skills.get(n.skillId)!;
        expect(SkillDefinitionSchema.safeParse(sk).success, n.skillId).toBe(true);
        expect(sk.ownerKind).toBe("player");
        expect(sk.kind === "passive", n.skillId).toBe(TREE_PASSIVE_IDS.has(n.skillId));
      }
    }
    for (const id of Object.values(RACE_PASSIVES)) expect(c.skills.get(id)?.passive).toBeDefined();
  });

  it("the kit is what was learned: actives with their levels, learned passives, the race passive", () => {
    expect(playerKit("class:striker", "race:human", null)).toEqual({ skillIds: [], skillLevels: {}, passiveIds: ["skill:race_human_grit"] });
    const k = playerKit("class:striker", "race:human", null, { "skill:striker_heavy_slash": 4, "skill:striker_fighting_blood": 1, "skill:arcanist_storm": 3, "skill:striker_cleave": 99 });
    expect(k).toEqual({
      skillIds: ["skill:striker_heavy_slash", "skill:striker_cleave"],
      skillLevels: { "skill:striker_heavy_slash": 4, "skill:striker_cleave": 10 },
      passiveIds: ["skill:striker_fighting_blood", "skill:race_human_grit"],
    });
    expect(playerKit("class:nope", "race:nope", null, { "skill:striker_heavy_slash": 1 })).toEqual({ skillIds: [], skillLevels: {}, passiveIds: [] });
  });

  it("every class's full tree fights through Auto to the end without a refused command", () => {
    for (const cls of CLASS1_DEFINITIONS) {
      const k = playerKit(cls.id, "race:human", null, everything(cls.id));
      const setup = baseSetup({ battleId: `battle:${cls.id}` });
      setup.player.level = 49;
      setup.player.skillIds = k.skillIds;
      setup.player.skillLevels = k.skillLevels;
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
  it("two branches per Class1, each with its own tree", () => {
    for (const cls of CLASS1_DEFINITIONS) expect(CLASS2_BRANCHES.filter((b) => b.classId === cls.id), cls.id).toHaveLength(2);
    expect(new Set(CLASS2_BRANCHES.map((b) => b.id)).size).toBe(18);
  });

  it("a branch tree counts only for its own class", () => {
    const learned = { ...everything("class:guardian", "class2:bastion") };
    const k = playerKit("class:guardian", "race:human", "class2:bastion", learned);
    expect(k.skillIds).toContain("skill:c2_bastion_wall");
    expect(k.passiveIds).toContain("skill:c2_bastion_layers");
    expect(playerKit("class:striker", "race:human", "class2:bastion", learned).skillIds).toEqual([]);
    expect(playerKit("class:guardian", "race:human", null, learned).skillIds).not.toContain("skill:c2_bastion_wall");
  });

  it("the trial is refused below Lv50, below Class1 job cap, for another class's branch, and once a branch is taken", () => {
    const job40 = [jobExpForLevel(rules, 1, 50)];
    const g = { classId: "class:guardian", level: 49, class2Id: null, jobExp: job40 };
    expect(class2Refusal(rules, g, "class2:bastion")).toBe("LEVEL_TOO_LOW");
    expect(class2Refusal(rules, { ...g, level: 50 }, "class2:bastion")).toBeNull();
    expect(class2Refusal(rules, { ...g, level: 50, jobExp: [job40[0]! - 1] }, "class2:bastion")).toBe("JOB_TOO_LOW");
    expect(class2Refusal(rules, { ...g, level: 50, jobExp: undefined }, "class2:bastion")).toBe("JOB_TOO_LOW");
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

  it("every branch's full tree fights the trial through Auto to the end without a refused command", () => {
    for (const b of CLASS2_BRANCHES) {
      const cls = CLASS1_DEFINITIONS.find((d) => d.id === b.classId)!;
      const k = playerKit(cls.id, "race:human", b.id, everything(cls.id, b.id));
      const setup = baseSetup({ battleId: `battle:${b.id}`, enemies: [], boss: { bossId: CLASS2_TRIAL_BOSS_ID }, bag: {}, practice: true, classTrial: true });
      setup.player = { ...setup.player, level: 60, skillIds: k.skillIds, skillLevels: k.skillLevels, passiveIds: k.passiveIds, basicAttackRange: cls.basicAttackRange };
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

describe("Class3 (chapter 02, P16/P28)", () => {
  const job = (tier: 1 | 2, lv: number) => jobExpForLevel(rules, tier, lv);
  const ready = { classId: "class:guardian", level: 120, class2Id: "class2:bastion", class3Id: null, jobExp: [job(1, 50), job(2, 70), 0] };

  it("the trial is refused without a branch, below Lv120, below Class2 job cap, for another branch's Class3, and once taken", () => {
    expect(class3Refusal(rules, ready, "class3:aegis_sovereign")).toBeNull();
    expect(class3Refusal(rules, { ...ready, class2Id: null }, "class3:aegis_sovereign")).toBe("NO_CLASS2");
    expect(class3Refusal(rules, { ...ready, level: 119 }, "class3:aegis_sovereign")).toBe("LEVEL_TOO_LOW");
    expect(class3Refusal(rules, { ...ready, jobExp: [job(1, 50), job(2, 70) - 1, 0] }, "class3:aegis_sovereign")).toBe("JOB_TOO_LOW");
    expect(class3Refusal(rules, ready, "class3:dread_bulwark")).toBe("NOT_FOUND");
    expect(class3Refusal(rules, ready, "class3:nope")).toBe("NOT_FOUND");
    expect(class3Refusal(rules, { ...ready, class3Id: "class3:aegis_sovereign" }, "class3:aegis_sovereign")).toBe("ALREADY_CHOSEN");
  });

  it("the class view offers the branch's Class3 once there is a branch", () => {
    expect(classView(rules, { ...ready, class2Id: null }, null).class3).toBeNull();
    const v = classView(rules, ready, null);
    expect(v.class3).toMatchObject({ advance: { id: "class3:aegis_sovereign" }, trialLevel: 120, trialJobLevel: 70, bossId: CLASS3_TRIAL_BOSS_ID, blocked: null });
    expect(v.class3!.advance.skills.length).toBe(SKILL_TREES.get("class3:aegis_sovereign")!.nodes.length);
  });

  it("the Class3 tree counts only with its own branch", () => {
    const learned = everything("class:guardian", "class2:bastion", "class3:aegis_sovereign");
    const k = playerKit("class:guardian", "race:human", "class2:bastion", learned, "class3:aegis_sovereign");
    const c3 = SKILL_TREES.get("class3:aegis_sovereign")!.nodes.map((n) => n.skillId);
    expect([...k.skillIds, ...k.passiveIds].filter((id) => c3.includes(id)).length).toBe(c3.length);
    expect(playerKit("class:guardian", "race:human", "class2:sentinel", learned, "class3:aegis_sovereign").skillIds.some((id) => c3.includes(id))).toBe(false);
    expect(characterTrees("class:guardian", "class2:sentinel", "class3:aegis_sovereign").map((t) => t.id)).toEqual(["class:guardian", "class2:sentinel"]);
  });

  it("the Class3 trial is the tower tyrant at the Class3 trial stat %, only in a class trial", () => {
    const trial = (over: Partial<BattleSetup>) => createBattle(rules, c, { ...baseSetup({ enemies: [], boss: { bossId: CLASS3_TRIAL_BOSS_ID }, bag: {}, practice: true, classTrial: true, classTrialTier: 3 }), ...over });
    expect(trial({ classTrial: undefined })).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    const s = ok(trial({})).state;
    expect(s.enemyStatPct).toBe(rules.provisional.classChange.value.class3TrialStatPct);
  });

  it("every Class3 full tree fights the trial through Auto to the end without a refused command", () => {
    for (const a of CLASS3_ADVANCES) {
      const b = CLASS2_BRANCHES.find((x) => x.id === a.branchId)!;
      const cls = CLASS1_DEFINITIONS.find((d) => d.id === b.classId)!;
      const k = playerKit(cls.id, "race:human", b.id, everything(cls.id, b.id, a.id), a.id);
      const mates = (["species:armor_crab", "species:ember_fox", "species:lantern_snail"] as const).map((sp, i) => {
        const def = c.species.get(sp)!;
        const inst = { ...companion(`m${i}`, sp, def.allowedElements[0]!, 115), primaryStats: companionPrimaryStats(rules, def.archetype, `seed${i}`, 115, 0) };
        return { instance: inst, row: (i === 0 ? "front" : "back") as "front" | "back", slot: i === 0 ? 0 : i };
      });
      const setup = baseSetup({ battleId: `battle:${a.id}`, enemies: [], boss: { bossId: CLASS3_TRIAL_BOSS_ID }, bag: {}, practice: true, classTrial: true, classTrialTier: 3, companions: mates });
      setup.player = { ...setup.player, level: 120, gear: { PATK: 126, MATK: 126, SUPPORT: 120, PDEF: 90, MDEF: 70, HP: 500, MP: 120 }, skillIds: k.skillIds, skillLevels: k.skillLevels, passiveIds: k.passiveIds, basicAttackRange: cls.basicAttackRange };
      let s = ok(createBattle(rules, c, setup)).state;
      for (let i = 0; i < 3000 && s.status === "active"; i++) {
        const actor = currentActor(s)!;
        const cmd = chooseAutoCommand(s, c, {}, rules) ?? { type: "guard" as const, actorId: actor.unitId };
        s = ok(applyCommand(rules, c, s, cmd, { source: "auto" })).state;
      }
      expect(s.status, a.id).not.toBe("active");
    }
  });
});
