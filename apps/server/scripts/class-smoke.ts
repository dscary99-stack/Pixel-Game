// End-to-end Class2 check against `wrangler dev` (class-change.ts, P16/P28): below Lv50 the trial is
// refused; at Lv50+ in town it starts a practice boss fight with the trial stat %, a retry resumes it,
// a lost or fled try cannot be claimed, a won one gives the branch once (a retry answers the same),
// and afterwards the trial is refused and the branch's skills are in the next fight.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:class`.
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

// A Lv60 striker with its points in STR/VIT, Lv40 shop gear and three Lv45 companions (dev helpers).
await call("POST", "/dev/level", { level: 60 });
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

// The next fight carries the branch: practice the boss and look at the player unit.
const p = await call("POST", "/practice/start", { operationId: `practice_${run}`, bossId: "boss:crystal_crab_lord" });
const pv = await battleCall(account, p.body.battleId)("GET", "");
const me = pv.state.units.find((u: Msg) => u.unitId === "player");
must(me.skillIds.includes("skill:c2_breaker_shatter") && me.skillIds.includes("skill:c2_breaker_wave"), "branch actives in the fight", me.skillIds);
out.kit = me.skillIds;
T.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
