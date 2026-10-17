// End-to-end Class2 check against `wrangler dev` (class-change.ts, P16/P28): below Lv50 the trial is
// refused; at Lv50+ in town it starts a practice boss fight with the trial stat %, a retry resumes it,
// a lost or fled try cannot be claimed, a won one gives the branch once (a retry answers the same),
// and afterwards the trial is refused and the branch's skill tree opens: its skills, learned with
// Class2 job points, are in the next fight. The trial also needs Class1 at its job cap (P29). Last, the
// reset scrolls: refused in a fight, then a skill scroll and a stat scroll each return all their points.
// Then Class3 (Lv120): refused below Lv120 and below Class2 Job 70, another branch's Class3 is not
// found; the trial is the tower tyrant at the Class3 stat %, won on Auto and claimed once; Class3 job
// points open its tree and a learned Class3 skill is in the next fight.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:class`.
import { PRODUCTION_RULES, SKILL_TREES, unspentPoints, type PrimaryStats } from "@pmrpg/shared";
import { AUTO_GAP_MS, api, autoToEnd, battleCall, connect, run, sleep, type Msg } from "./smoke-lib";

const account = `acct:class${run}`;
const out: Record<string, unknown> = {};
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", "x-dev-account": account }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as Msg };
};
const must = (ok: boolean, what: string, detail?: unknown) => {
  if (!ok) throw new Error(`${what}: ${JSON.stringify(detail)}`);
};

must((await call("POST", "/character", { operationId: `op_${run}`, name: "สอบอาชีพ", classId: "class:striker", raceId: "race:human", element: "FIRE" })).status === 200, "create");
const T = await connect(account, "map:dawn_town");
const v0 = (await call("GET", "/class")).body;
must(v0.branches.map((b: Msg) => b.id).join() === "class2:breaker,class2:berserker" && v0.blocked === "LEVEL_TOO_LOW", "branches and level gate", v0);
out.tooLow = (await call("POST", "/class/trial/start", { operationId: `trial_low_${run}`, branchId: "class2:breaker" })).body.error;
must(out.tooLow === "LEVEL_TOO_LOW", "refused below Lv50", out.tooLow);

const learn = async (skillId: string, times: number) => {
  for (let i = 0; i < times; i++) {
    const cv = (await call("GET", "/character")).body.character;
    const r = await call("POST", "/character/skills/learn", { expectedVersion: cv.version, skillId });
    must(r.status === 200, `learn ${skillId}`, r.body);
  }
};

// A Lv60 striker with its points in STR/VIT, Lv40 shop gear and three Lv45 companions (dev helpers).
await call("POST", "/dev/level", { level: 60 });
out.jobTooLow = (await call("POST", "/class/trial/start", { operationId: `trial_job_${run}`, branchId: "class2:breaker" })).body.error;
must(out.jobTooLow === "JOB_TOO_LOW", "refused below Class1 Job 50", out.jobTooLow);
await call("POST", "/dev/level", { level: 60, job: 50 });
// A physical build: 50 Class1 points.
await learn("skill:striker_heavy_slash", 10);
await learn("skill:striker_cleave", 10);
await learn("skill:striker_all_in", 10);
await learn("skill:striker_armor_break", 10);
await learn("skill:striker_roar", 10);
const noPoint = await call("POST", "/character/skills/learn", { expectedVersion: (await call("GET", "/character")).body.character.version, skillId: "skill:striker_war_cry" });
must(noPoint.body.error === "NO_POINTS", "Class1 points spent", noPoint.body);
let c = (await call("GET", "/character")).body.character;
const pts = 3 * (c.level - 1);
must((await call("PUT", "/character/stats", { expectedVersion: c.version, stats: { ...c.primaryStats, STR: c.primaryStats.STR + 50, VIT: c.primaryStats.VIT + 50, DEX: c.primaryStats.DEX + 25, AGI: c.primaryStats.AGI + 25 } })).status === 200, "allocate", pts);
const mates = ["species:armor_crab", "species:ember_fox", "species:lantern_snail"];
for (const [i, speciesId] of mates.entries()) await call("POST", "/dev/grant", { operationId: `grant_${run}_${i}`, companion: { speciesId, level: 45 } });
// Lv40 armory pieces (plain, no options), worn.
const wear: [string, string][] = [["equip:shop_sword_40", "MAIN_HAND"], ["equip:shop_armor_40", "ARMOR"], ["equip:shop_cap_40", "HEAD_TOP"], ["equip:shop_boots_40", "FEET"], ["equip:shop_shield_40", "OFF_HAND"]];
for (const [i, [definitionId]] of wear.entries()) await call("POST", "/dev/grant", { operationId: `piece_${run}_${i}`, piece: { definitionId, rarity: "COMMON", affixes: [] } });
for (const [definitionId, slot] of wear) {
  const bundle = (await call("GET", "/character")).body;
  const piece = bundle.equipment.find((e: Msg) => e.definitionId === definitionId);
  const r = await call("PUT", "/character/equipment", { expectedVersion: bundle.character.version, slot, instanceId: piece.id });
  must(r.status === 200, `wear ${definitionId}`, r.body);
}
c = (await call("GET", "/character")).body.character;
const ids = mates.map((_, i) => `mon:grant_${run}_${i}:companion`);
must((await call("PUT", "/character/team", { expectedVersion: c.version, companionIds: ids })).status === 200, "team");

out.otherClassBranch = (await call("POST", "/class/trial/start", { operationId: `trial_x_${run}`, branchId: "class2:bastion" })).body.error;
must(out.otherClassBranch === "NOT_FOUND", "another class's branch", out.otherClassBranch);

// Try 1: flee at once; it settles with nothing and cannot be claimed.
const op1 = `trial_1_${run}`;
const s1 = await call("POST", "/class/trial/start", { operationId: op1, branchId: "class2:breaker" });
must(s1.status === 200, "trial start", s1.body);
must((await call("POST", "/class/trial/start", { operationId: op1, branchId: "class2:breaker" })).body.battleId === s1.body.battleId, "retry resumes the same fight");
must((await call("POST", "/class/trial/start", { operationId: op1, branchId: "class2:berserker" })).body.error === "INVALID_REQUEST", "same id, other branch");
const b1 = battleCall(account, s1.body.battleId);
const gen = (await b1("POST", "/session")).sessionGeneration;
let v = await b1("GET", "");
const lord = v.state.units.find((u: Msg) => u.unitId === "e1");
must(v.state.practice === true && v.state.enemyStatPct === 150, "practice fight with the trial stat %", { practice: v.state.practice, pct: v.state.enemyStatPct });
out.trialBoss = { speciesId: lord.speciesId, maxHp: lord.stats.maxHp, statPct: v.state.enemyStatPct };
for (let i = 0; i < 30 && v.state.status === "active"; i++) {
  if (v.actor === "player") await b1("POST", "/commands", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: v.state.stateVersion, command: { type: "flee", actorId: "player" } });
  else {
    await sleep(AUTO_GAP_MS);
    await b1("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: v.state.stateVersion });
  }
  v = await b1("GET", "");
}
for (let i = 0; i < 50 && !v.settlement.settled; i++) {
  await sleep(200);
  v = await b1("GET", "");
}
must(v.state.status === "fled", "fled", v.state.status);
out.fledClaim = (await call("POST", "/class/trial/claim", { operationId: op1 })).body.error;
must(out.fledClaim === "NOT_WON" && (await call("GET", "/class")).body.trial.status === "lost", "a fled trial is not won", out.fledClaim);

// Then Auto until a try is won (a loss is a new try).
let won: string | null = null;
const tries: string[] = [];
for (let n = 2; n <= 4 && won === null; n++) {
  const op = `trial_${n}_${run}`;
  const s = await call("POST", "/class/trial/start", { operationId: op, branchId: "class2:breaker" });
  must(s.status === 200, "trial start", s.body);
  const end = await autoToEnd(account, s.body.battleId);
  tries.push(`${end.state.status} r${end.state.round}`);
  if (end.state.status === "victory") won = op;
}
out.tries = tries;
must(won !== null, "won a trial on Auto", tries);
const claim = await call("POST", "/class/trial/claim", { operationId: won });
must(claim.body.status === "claimed" && claim.body.class2Id === "class2:breaker", "claim", claim.body);
must((await call("POST", "/class/trial/claim", { operationId: won })).body.class2Id === "class2:breaker", "claim retry answers the same");
out.again = (await call("POST", "/class/trial/start", { operationId: `trial_again_${run}`, branchId: "class2:berserker" })).body.error;
must(out.again === "ALREADY_CHOSEN", "one branch per character", out.again);
const after = (await call("GET", "/character")).body.character;
must(after.class2Id === "class2:breaker", "character has the branch", after);

// The branch tree opens for Class2 job points (dev: Class2 Job 10); learn two of its skills.
await call("POST", "/dev/level", { level: 60, job: 10 });
await learn("skill:c2_breaker_shatter", 5);
await learn("skill:c2_breaker_wave", 5);
// The next fight carries the branch: practice the boss and look at the player unit.
const p = await call("POST", "/practice/start", { operationId: `practice_${run}`, bossId: "boss:crystal_crab_lord" });
const pv = await battleCall(account, p.body.battleId)("GET", "");
const me = pv.state.units.find((u: Msg) => u.unitId === "player");
must(me.skillIds.includes("skill:c2_breaker_shatter") && me.skillIds.includes("skill:c2_breaker_wave") && me.skillIds.includes("skill:striker_all_in"), "branch actives in the fight", me.skillIds);
must(me.skillLevels["skill:c2_breaker_shatter"] === 5 && me.skillLevels["skill:striker_heavy_slash"] === 10, "learned levels in the fight", me.skillLevels);
out.kit = me.skillLevels;

// Reset scrolls (reset.ts): refused in the fight; after fleeing, a skill scroll returns every job point
// (Class1 skills included) and a stat scroll every stat point; a retry spends no second scroll.
await call("POST", "/dev/grant", { operationId: `scrolls_${run}`, items: { "item:stat_reset_scroll": 1, "item:skill_reset_scroll": 1 } });
const inFight = await call("POST", "/character/reset", { operationId: `reset_fight_${run}`, itemId: "item:skill_reset_scroll" });
must(inFight.body.error === "IN_BATTLE", "reset refused in a fight", inFight.body);
const pc = battleCall(account, p.body.battleId);
const fgen = (await pc("POST", "/session")).sessionGeneration;
let fv = await pc("GET", "");
for (let i = 0; i < 20 && fv.state.status === "active"; i++) {
  if (fv.actor === "player") await pc("POST", "/commands", { commandId: crypto.randomUUID(), sessionGeneration: fgen, expectedStateVersion: fv.state.stateVersion, command: { type: "flee", actorId: "player" } });
  else {
    await sleep(AUTO_GAP_MS);
    await pc("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: fgen, expectedStateVersion: fv.state.stateVersion });
  }
  fv = await pc("GET", "");
}
for (let i = 0; i < 50 && !(fv.settlement.settled || fv.settlement.failed > 0); i++) {
  await sleep(200);
  fv = await pc("GET", "");
}
const skillReset = await call("POST", "/character/reset", { operationId: `reset_skill_${run}`, itemId: "item:skill_reset_scroll" });
must(skillReset.status === 200 && Object.keys(skillReset.body.character.skills).length === 0 && skillReset.body.character.class2Id === "class2:breaker", "skill scroll forgets every tree skill", skillReset.body);
must((await call("POST", "/character/reset", { operationId: `reset_skill_${run}`, itemId: "item:skill_reset_scroll" })).status === 200, "skill reset retry answers the same");
const statReset = await call("POST", "/character/reset", { operationId: `reset_stat_${run}`, itemId: "item:stat_reset_scroll" });
must(statReset.status === 200 && Object.values(statReset.body.character.primaryStats).every((v) => v === statReset.body.character.primaryStats.STR), "stat scroll returns every stat point", statReset.body);
const again2 = await call("POST", "/character/reset", { operationId: `reset_stat2_${run}`, itemId: "item:stat_reset_scroll" });
must(again2.body.error === "INSUFFICIENT_ITEMS", "one scroll, one reset", again2.body);
await learn("skill:striker_heavy_slash", 1);
out.reset = { inFight: inFight.body.error, afterSkills: skillReset.body.character.skills, stats: statReset.body.character.primaryStats, second: again2.body.error };

// Class3 (Lv120, Class2 Job 70).
const c3Low = await call("POST", "/class/trial/start", { operationId: `c3_low_${run}`, branchId: "class3:ruin_champion" });
must(c3Low.body.error === "LEVEL_TOO_LOW", "Class3 refused below Lv120", c3Low.body);
await call("POST", "/dev/level", { level: 125, job: 69 });
must((await call("POST", "/class/trial/start", { operationId: `c3_job_${run}`, branchId: "class3:ruin_champion" })).body.error === "JOB_TOO_LOW", "Class3 refused below Class2 Job 70");
await call("POST", "/dev/level", { level: 125, job: 70 });
must((await call("POST", "/class/trial/start", { operationId: `c3_x_${run}`, branchId: "class3:bloodstorm" })).body.error === "NOT_FOUND", "another branch's Class3");
const cv3 = (await call("GET", "/class")).body;
must(cv3.class3?.advance.id === "class3:ruin_champion" && cv3.class3.blocked === null && cv3.class3.trialStatPct === 550, "Class3 offered", cv3.class3);
/** Spend points down a tree in its order, as far as they go (a node whose need is not met yet is skipped). */
const spend = async (treeId: string) => {
  for (const n of SKILL_TREES.get(treeId)!.nodes) {
    for (let i = 0; i < n.maxLevel; i++) {
      const cv = (await call("GET", "/character")).body.character;
      if ((cv.skills[n.skillId] ?? 0) >= n.maxLevel) break;
      const r = await call("POST", "/character/skills/learn", { expectedVersion: cv.version, skillId: n.skillId });
      if (r.status !== 200) break;
    }
  }
};
// A strong striker build again: Class1 and Class2 points, STR/VIT stats, three Lv115 companions.
await learn("skill:striker_heavy_slash", 9);
await learn("skill:striker_cleave", 10);
await learn("skill:striker_all_in", 10);
await learn("skill:striker_armor_break", 10);
await learn("skill:striker_roar", 10);
await spend("class2:breaker");
c = (await call("GET", "/character")).body.character;
// Stat costs rise with the stat (progression.ts): raise STR, VIT, DEX, AGI in a 5:4:2:1 rhythm while points last.
const st: PrimaryStats = { ...c.primaryStats };
const rhythm = ["STR", "VIT", "STR", "DEX", "VIT", "STR", "VIT", "AGI", "STR", "DEX", "VIT", "STR"] as const;
for (let i = 0; ; i++) {
  const k = rhythm[i % rhythm.length]!;
  st[k] += 1;
  if (unspentPoints(PRODUCTION_RULES, c.level, st) < 0) {
    st[k] -= 1;
    break;
  }
}
const alloc = await call("PUT", "/character/stats", { expectedVersion: c.version, stats: st });
must(alloc.status === 200, "allocate Lv125", alloc.body);
for (const [i, speciesId] of mates.entries()) await call("POST", "/dev/grant", { operationId: `grant115_${run}_${i}`, companion: { speciesId, level: 115 } });
c = (await call("GET", "/character")).body.character;
must((await call("PUT", "/character/team", { expectedVersion: c.version, companionIds: mates.map((_, i) => `mon:grant115_${run}_${i}:companion`) })).status === 200, "Lv115 team");
let won3: string | null = null;
const tries3: string[] = [];
for (let n = 1; n <= 5 && won3 === null; n++) {
  const op = `c3_${n}_${run}`;
  const s = await call("POST", "/class/trial/start", { operationId: op, branchId: "class3:ruin_champion" });
  must(s.status === 200, "Class3 trial start", s.body);
  if (n === 1) {
    const tv = await battleCall(account, s.body.battleId)("GET", "");
    const boss = tv.state.units.find((u: Msg) => u.unitId === "e1");
    must(tv.state.practice === true && tv.state.enemyStatPct === 550 && boss.speciesId !== undefined, "Class3 trial: tyrant at 550%", { pct: tv.state.enemyStatPct });
    out.class3Boss = { speciesId: boss.speciesId, maxHp: boss.stats.maxHp, statPct: tv.state.enemyStatPct, enemies: tv.state.units.filter((u: Msg) => u.side === "enemy").length };
  }
  const end = await autoToEnd(account, s.body.battleId);
  tries3.push(`${end.state.status} r${end.state.round}`);
  if (end.state.status === "victory") won3 = op;
}
out.class3Tries = tries3;
must(won3 !== null, "won the Class3 trial on Auto", tries3);
const claim3 = await call("POST", "/class/trial/claim", { operationId: won3 });
must(claim3.body.status === "claimed" && claim3.body.class3Id === "class3:ruin_champion", "Class3 claim", claim3.body);
must((await call("POST", "/class/trial/claim", { operationId: won3 })).body.class3Id === "class3:ruin_champion", "Class3 claim retry answers the same");
must((await call("POST", "/class/trial/claim", { operationId: won })).body.class2Id === "class2:breaker", "the Class2 claim still answers the same");
must((await call("POST", "/class/trial/start", { operationId: `c3_again_${run}`, branchId: "class3:ruin_champion" })).body.error === "ALREADY_CHOSEN", "one Class3 per character");
// Class3 job points open its tree (dev: Class3 Job 10); its first skill is in the next fight.
await call("POST", "/dev/level", { level: 125, job: 10 });
const c3first = SKILL_TREES.get("class3:ruin_champion")!.nodes.find((n) => n.requires.length === 0 && n.cost === 1)!.skillId;
await learn(c3first, 3);
const ch3 = (await call("GET", "/character")).body.character;
must(ch3.class3Id === "class3:ruin_champion" && ch3.jobExp.length === 3 && ch3.skills["skill:c2_breaker_shatter"] !== undefined, "character has Class3 and keeps Class2 skills", ch3);
const p3 = await call("POST", "/practice/start", { operationId: `practice3_${run}`, bossId: "boss:crystal_crab_lord" });
const me3 = (await battleCall(account, p3.body.battleId)("GET", "")).state.units.find((u: Msg) => u.unitId === "player");
must(me3.skillIds.includes(c3first) && me3.skillLevels[c3first] === 3, "Class3 skill in the fight", me3.skillIds);
out.class3 = { claimed: claim3.body.class3Id, skill: c3first, jobExp: ch3.jobExp };
T.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
