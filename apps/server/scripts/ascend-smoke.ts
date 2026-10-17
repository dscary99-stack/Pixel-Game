// End-to-end divine awakening check against `wrangler dev` (ascension.ts, P31): without a Class3 the
// race trial is refused; at Lv200 with a Class3 (dev shortcut) another race's trial is not found, and
// the character's own is the tower tyrant at the ascension stat %, won on Auto with the race goal
// (Stonekin: hits taken) reached; a win short of the goal reads as lost. The claim in town pays
// coins + materials once (no coins: refused; a retry replays; a second claim is refused), the evolved
// passive replaces the race passive, and in the next fight the awakening gauge fills from real actions
// until the character awakens (once a fight). Then the path switch costs coins and replays on retry, and
// the attainment quest (refused before ascending) opens the secret quests once.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:ascend`.
import { PRODUCTION_RULES, SKILL_TREES, exampleContentMaps, unspentPoints, type PrimaryStats } from "@pmrpg/shared";
import { AUTO_GAP_MS, api, autoToEnd, battleCall, connect, run, sleep, type Msg } from "./smoke-lib";

const account = `acct:ascend${run}`;
const asc = PRODUCTION_RULES.provisional.ascension.value;
const content = exampleContentMaps();
const out: Record<string, unknown> = {};
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", "x-dev-account": account }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as Msg };
};
const must = (ok: boolean, what: string, detail?: unknown) => {
  if (!ok) throw new Error(`${what}: ${JSON.stringify(detail)}`);
};

must((await call("POST", "/character", { operationId: `op_${run}`, name: "จุติเทพ", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" })).status === 200, "create");
const T = await connect(account, "map:dawn_town");
const v0 = (await call("GET", "/class")).body;
must(v0.ascension?.blocked === "NO_CLASS3" && v0.ascension.ascension.id === "ascend:stonekin", "ascension offered, needs Class3", v0.ascension);
out.noClass3 = (await call("POST", "/class/trial/start", { operationId: `asc_no3_${run}`, branchId: "ascend:stonekin" })).body.error;
must(out.noClass3 === "NO_CLASS3", "refused without Class3", out.noClass3);

// Lv200 with Bastion and Aegis Sovereign at full job points (dev shortcut past the class trials).
await call("POST", "/dev/level", { level: 200 });
must((await call("POST", "/dev/class", { class2Id: "class2:bastion", class3Id: "class3:aegis_sovereign" })).status === 200, "dev class");
must((await call("POST", "/class/trial/start", { operationId: `asc_x_${run}`, branchId: "ascend:human" })).body.error === "NOT_FOUND", "another race's trial");
/** Spend points down a tree in its order, as far as they go. */
const spend = async (treeId: string) => {
  for (let pass = 0; pass < 3; pass++) {
    for (const n of SKILL_TREES.get(treeId)!.nodes) {
      for (let i = 0; i < n.maxLevel; i++) {
        const cv = (await call("GET", "/character")).body.character;
        if ((cv.skills[n.skillId] ?? 0) >= n.maxLevel) break;
        const r = await call("POST", "/character/skills/learn", { expectedVersion: cv.version, skillId: n.skillId });
        if (r.status !== 200) break;
      }
    }
  }
};
await spend("class:guardian");
await spend("class2:bastion");
await spend("class3:aegis_sovereign");
let c = (await call("GET", "/character")).body.character;
const st: PrimaryStats = { ...c.primaryStats };
const rhythm = ["STR", "VIT", "STR", "DEX", "VIT", "STR", "VIT", "AGI", "STR", "DEX", "VIT", "STR"] as const;
for (let i = 0, miss = 0; miss < rhythm.length; i++) {
  const k = rhythm[i % rhythm.length]!;
  st[k] += 1;
  if (st[k] > PRODUCTION_RULES.provisional.manualStatCap.value || unspentPoints(PRODUCTION_RULES, c.level, st) < 0) {
    st[k] -= 1;
    miss += 1;
  } else miss = 0;
}
must((await call("PUT", "/character/stats", { expectedVersion: c.version, stats: st })).status === 200, "allocate Lv200");
const mates = ["species:armor_crab", "species:ember_fox", "species:lantern_snail"];
for (const [i, speciesId] of mates.entries()) await call("POST", "/dev/grant", { operationId: `grant195_${run}_${i}`, companion: { speciesId, level: 195 } });
const wear: [string, string][] = [["equip:shop_sword_40", "MAIN_HAND"], ["equip:shop_armor_40", "ARMOR"], ["equip:shop_cap_40", "HEAD_TOP"], ["equip:shop_boots_40", "FEET"], ["equip:shop_shield_40", "OFF_HAND"]];
for (const [i, [definitionId]] of wear.entries()) await call("POST", "/dev/grant", { operationId: `piece_${run}_${i}`, piece: { definitionId, rarity: "COMMON", affixes: [] } });
for (const [definitionId, slot] of wear) {
  const bundle = (await call("GET", "/character")).body;
  const piece = bundle.equipment.find((e: Msg) => e.definitionId === definitionId);
  must((await call("PUT", "/character/equipment", { expectedVersion: bundle.character.version, slot, instanceId: piece.id })).status === 200, `wear ${definitionId}`);
}
c = (await call("GET", "/character")).body.character;
must((await call("PUT", "/character/team", { expectedVersion: c.version, companionIds: mates.map((_, i) => `mon:grant195_${run}_${i}:companion`) })).status === 200, "Lv195 team");
const cv = (await call("GET", "/class")).body;
must(cv.ascension.blocked === null && cv.ascension.trialStatPct === asc.trialStatPct, "trial open", cv.ascension);

// The race trial: the tyrant at the ascension stat %, on Auto until a try is won.
let won: string | null = null;
const tries: string[] = [];
for (let n = 1; n <= 5 && won === null; n++) {
  const op = `asc_trial_${n}_${run}`;
  const s = await call("POST", "/class/trial/start", { operationId: op, branchId: "ascend:stonekin" });
  must(s.status === 200, "trial start", s.body);
  if (n === 1) {
    const tv = await battleCall(account, s.body.battleId)("GET", "");
    must(tv.state.practice === true && tv.state.enemyStatPct === asc.trialStatPct, "trial: tyrant at the ascension stat %", { pct: tv.state.enemyStatPct });
    must(tv.state.raceTrial?.kind === "hits_taken" && tv.state.raceTrial.need === cv.ascension.goal.need, "trial: the Stonekin goal", tv.state.raceTrial);
    must((await call("POST", "/class/trial/claim", { operationId: op })).body.error === "INVALID_REQUEST", "a race trial is not claimed through /class");
  }
  // A long fight: keep Auto going until it ends (autoToEnd stops after 300 actions).
  let end = await autoToEnd(account, s.body.battleId);
  for (let k = 0; k < 6 && end.state.status === "active"; k++) end = await autoToEnd(account, s.body.battleId);
  const goal = end.state.raceTrial;
  tries.push(`${end.state.status} r${end.state.round} goal ${goal.count}/${goal.need}`);
  const met = end.state.status === "victory" && goal.count >= goal.need;
  // The class panel agrees once the economy has settled the fight.
  let tv = (await call("GET", "/class")).body.trial;
  for (let k = 0; k < 20 && tv?.status === "started"; k++) {
    await new Promise((res) => setTimeout(res, 250));
    tv = (await call("GET", "/class")).body.trial;
  }
  must(tv?.status === (met ? "won" : "lost") && tv.raceGoal?.count === goal.count, "class panel: won only with the goal", { tv, goal });
  if (!met && end.state.status === "victory") must((await call("POST", "/town/ascend", { operationId: `asc_short_${n}_${run}`, trialOperationId: op, path: "a", expectedCoins: asc.coins })).body.error === "GOAL_NOT_MET", "a win short of the goal is refused");
  if (met) won = op;
}
out.tries = tries;
must(won !== null, "won the race trial on Auto with the goal", tries);

// The claim pays coins + rift cores once.
const claim = (operationId: string, path: "a" | "b") => call("POST", "/town/ascend", { operationId, trialOperationId: won, path, expectedCoins: asc.coins });
out.poor = (await claim(`asc_poor_${run}`, "a")).body.error;
must(out.poor === "INSUFFICIENT_COINS", "no coins: refused", out.poor);
for (let i = 0; i * 1_000_000 < asc.coins + asc.pathSwitchCoins; i++) await call("POST", "/dev/grant", { operationId: `coins_${run}_${i}`, coins: 1_000_000 });
await call("POST", "/dev/grant", { operationId: `cores_${run}`, items: { "item:rift_core": 10 } });
// The attainment quest (เควสบรรลุ): Lv200 and Class3 done, the awakening not yet; the secret set stays shut.
const att0 = (await call("GET", "/character/attainment")).body;
must(att0.steps.map((x: Msg) => x.done).join() === "true,true,false" && att0.ready === false, "attainment: two of three steps", att0);
must((await call("POST", "/character/attainment", { operationId: `attain_early_${run}` })).body.error === "NOT_ASCENDED", "attainment: refused before ascending");
const before = (await call("GET", "/character")).body.coins;
const ok = await claim(`asc_claim_${run}`, "a");
must(ok.status === 200 && ok.body.result.pathId === "ascend:stonekin:a" && ok.body.replayed === false, "claim", ok.body);
must(ok.body.coins === before - asc.coins, "paid coins", { before, after: ok.body.coins });
const again = await claim(`asc_claim_${run}`, "a");
must(again.body.replayed === true && again.body.coins === ok.body.coins, "retry replays, no second charge", again.body);
must((await claim(`asc_claim2_${run}`, "b")).body.error === "ALREADY_ASCENDED", "one ascension per character");
must((await call("POST", "/class/trial/start", { operationId: `asc_again_${run}`, branchId: "ascend:stonekin" })).body.error === "ALREADY_ASCENDED", "no trial after ascending");
const ch = (await call("GET", "/character")).body.character;
must(ch.ascensionId === "ascend:stonekin:a", "character ascended", ch.ascensionId);

// Next fight: the evolved passive instead of the race one, and the gauge. Buff skills on our side are
// real actions, so the gauge fills without ending the fight; at full the character awakens.
const p = await call("POST", "/practice/start", { operationId: `practice_${run}`, bossId: "boss:crystal_crab_lord" });
const b = battleCall(account, p.body.battleId);
const gen = (await b("POST", "/session")).sessionGeneration;
let v = await b("GET", "");
let me = v.state.units.find((u: Msg) => u.unitId === "player");
must(me.passiveIds.includes("skill:ascend_stonekin_a") && !me.passiveIds.includes("skill:race_stonekin_stone") && me.awakening?.gauge === 0, "evolved passive and an empty gauge", { passives: me.passiveIds, awakening: me.awakening });
const buffs = (me.skillIds as string[]).filter((id) => {
  const sk = content.skills.get(id);
  return sk !== undefined && (sk.targetRule === "self" || sk.targetRule === "all_allies" || sk.targetRule === "single_ally");
});
must(buffs.length > 0, "a buff skill to fill the gauge", me.skillIds);
const gauges: number[] = [];
let awakened = false;
for (let i = 0; i < 80 && v.state.status === "active" && !awakened; i++) {
  if (v.actor === "player") {
    me = v.state.units.find((u: Msg) => u.unitId === "player");
    let command: Msg = { type: "guard", actorId: "player" };
    if (me.awakening.gauge >= asc.gaugeMax) command = { type: "awaken", actorId: "player" };
    else {
      const ready = buffs.find((id) => (me.cooldowns[id] ?? 0) === 0 && me.mp >= (content.skills.get(id)?.mpCost ?? 0) * 2);
      if (ready !== undefined) command = { type: "skill", actorId: "player", skillId: ready, targetId: "player" };
    }
    const r = await b("POST", "/commands", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: v.state.stateVersion, command });
    must(r.status === "accepted", `command ${command.type}`, r);
    for (const e of r.events as Msg[]) {
      if (e.type === "AwakeningChanged" && e.change === "gauge") gauges.push(e.gauge);
      if (e.type === "AwakeningChanged" && e.change === "awakened") awakened = true;
    }
  } else {
    await sleep(AUTO_GAP_MS);
    await b("POST", "/commands", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: v.state.stateVersion, command: { type: "guard", actorId: v.actor } });
  }
  v = await b("GET", "");
}
out.gauge = gauges;
must(awakened, "awakened once the gauge was full", { gauges, status: v.state.status });
me = v.state.units.find((u: Msg) => u.unitId === "player");
must(me.awakening.used === true && me.awakening.turnsLeft === asc.awakenTurns, "awakening on for its turns", me.awakening);
must(v.state.units.filter((u: Msg) => u.side === "ally" && !u.ko).every((u: Msg) => (u.statuses as Msg[]).some((x) => x.statusId === "def_up")), "path A: the whole team got DEF up", null);

// Leave the practice fight, then switch the path for coins.
for (let i = 0; i < 40 && v.state.status === "active"; i++) {
  if (v.actor === "player") await b("POST", "/commands", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: v.state.stateVersion, command: { type: "flee", actorId: "player" } });
  else {
    await sleep(AUTO_GAP_MS);
    await b("POST", "/commands", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: v.state.stateVersion, command: { type: "guard", actorId: v.actor } });
  }
  v = await b("GET", "");
}
for (let i = 0; i < 50 && !v.settlement.settled; i++) {
  await sleep(200);
  v = await b("GET", "");
}
const sw = (operationId: string, expectedPath: "a" | "b", path: "a" | "b") => call("POST", "/town/ascend/switch", { operationId, expectedPath, path, expectedCoins: asc.pathSwitchCoins });
must((await sw(`asc_sw0_${run}`, "b", "a")).body.error === "CHANGED", "switch from the wrong path");
const s1 = await sw(`asc_sw1_${run}`, "a", "b");
must(s1.status === 200 && s1.body.result.pathId === "ascend:stonekin:b" && s1.body.coins === ok.body.coins - asc.pathSwitchCoins, "switch", s1.body);
must((await sw(`asc_sw1_${run}`, "a", "b")).body.replayed === true, "switch retry replays");
must((await call("GET", "/character")).body.character.ascensionId === "ascend:stonekin:b", "path B now");
// The attainment quest is done now: reporting in town opens the secret quests once.
must((await call("GET", "/character/secret-quests")).body.locked === true, "secret quests still shut");
must((await call("GET", "/character/attainment")).body.ready === true, "attainment ready");
const att = await call("POST", "/character/attainment", { operationId: `attain_${run}` });
must(att.status === 200 && att.body.replayed === false && att.body.view.locked === false && att.body.view.quests.length > 0, "attainment opens the secret quests", att.body);
must((await call("POST", "/character/attainment", { operationId: `attain_${run}` })).body.replayed === true, "attainment retry replays");
must((await call("POST", "/character/attainment", { operationId: `attain2_${run}` })).body.error === "ALREADY_OPEN", "attainment once");
out.secretQuests = att.body.view.quests.length;
out.claim = { pathId: ok.body.result.pathId, paid: ok.body.result.paid, switched: s1.body.result.pathId };
T.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
