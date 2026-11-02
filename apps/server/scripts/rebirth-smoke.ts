// End-to-end companion Rebirth trial check against `wrangler dev` (rebirth.ts, P37): a Lv200 companion
// cannot be reborn before its trial (TRIAL_REQUIRED, nothing charged); the trial is refused for a
// companion outside the team; in town it is a training-ground fight against the tyrant at
// the R1 stat %, a retry resumes the same fight, and the class trial panel ignores it. Auto plays it until
// a try is won; GET /class/rebirth reads won only for a victory with that companion standing. Then the
// Rebirth pays once (a retry replays), the companion is R1 at Lv1, and a used trial opens nothing more.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:rebirth`.
import { PRODUCTION_RULES, SKILL_TREES, unspentPoints, type PrimaryStats } from "@pmrpg/shared";
import { autoToEnd, battleCall, connect, run, sleep, api, type Msg } from "./smoke-lib";

const account = `acct:rebirth${run}`;
const R = PRODUCTION_RULES.provisional;
const out: Record<string, unknown> = {};
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", "x-dev-account": account }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as Msg };
};
const must = (ok: boolean, what: string, detail?: unknown) => {
  if (!ok) throw new Error(`${what}: ${JSON.stringify(detail)}`);
};

must((await call("POST", "/character", { operationId: `op_${run}`, name: "จุติคู่ใจ", classId: "class:guardian", raceId: "race:human", element: "EARTH" })).status === 200, "create");
const T = await connect(account, "map:dawn_town");
// Lv100 (the R1 licence) with full trees (dev shortcut past the class trials), stats spent, Lv40 shop gear.
await call("POST", "/dev/level", { level: 100 });
must((await call("POST", "/dev/class", { class2Id: "class2:bastion", class3Id: "class3:aegis_sovereign" })).status === 200, "dev class");
for (const treeId of ["class:guardian", "class2:bastion", "class3:aegis_sovereign"]) {
  for (const n of SKILL_TREES.get(treeId)!.nodes) {
    for (let i = 0; i < n.maxLevel; i++) {
      const cv = (await call("GET", "/character")).body.character;
      if ((cv.skills[n.skillId] ?? 0) >= n.maxLevel) break;
      if ((await call("POST", "/character/skills/learn", { expectedVersion: cv.version, skillId: n.skillId })).status !== 200) break;
    }
  }
}
let c = (await call("GET", "/character")).body.character;
const st: PrimaryStats = { ...c.primaryStats };
const rhythm = ["STR", "VIT", "STR", "DEX", "VIT", "STR", "VIT", "AGI"] as const;
for (let i = 0, miss = 0; miss < rhythm.length; i++) {
  const k = rhythm[i % rhythm.length]!;
  st[k] += 1;
  if (st[k] > R.manualStatCap.value || unspentPoints(PRODUCTION_RULES, c.level, st) < 0) {
    st[k] -= 1;
    miss += 1;
  } else miss = 0;
}
must((await call("PUT", "/character/stats", { expectedVersion: c.version, stats: st })).status === 200, "allocate Lv100");
const wear: [string, string][] = [["equip:shop_sword_40", "MAIN_HAND"], ["equip:shop_armor_40", "ARMOR"], ["equip:shop_cap_40", "HEAD_TOP"], ["equip:shop_boots_40", "FEET"], ["equip:shop_shield_40", "OFF_HAND"]];
for (const [i, [definitionId]] of wear.entries()) await call("POST", "/dev/grant", { operationId: `piece_${run}_${i}`, piece: { definitionId, rarity: "COMMON", affixes: [] } });
for (const [definitionId, slot] of wear) {
  const bundle = (await call("GET", "/character")).body;
  const piece = bundle.equipment.find((e: Msg) => e.definitionId === definitionId);
  must((await call("PUT", "/character/equipment", { expectedVersion: bundle.character.version, slot, instanceId: piece.id })).status === 200, `wear ${definitionId}`);
}
// The Lv200 crab to be reborn, two Lv95 mates, and a Lv200 mole left out of the team.
const grant = async (op: string, speciesId: string, level: number) => {
  await call("POST", "/dev/grant", { operationId: op, companion: { speciesId, level } });
  return `mon:${op}:companion`;
};
const crab = await grant(`crab_${run}`, "species:armor_crab", 200);
const mates = [await grant(`fox_${run}`, "species:ember_fox", 95), await grant(`snail_${run}`, "species:lantern_snail", 95)];
const mole = await grant(`mole_${run}`, "species:supply_mole", 200);
c = (await call("GET", "/character")).body.character;
must((await call("PUT", "/character/team", { expectedVersion: c.version, companionIds: [crab, ...mates] })).status === 200, "team");
for (let i = 0; i * 1_000_000 < R.rebirthRequirements.value.coins[0]; i++) await call("POST", "/dev/grant", { operationId: `coins_${run}_${i}`, coins: 1_000_000 });
await call("POST", "/dev/grant", { operationId: `shells_${run}`, items: { "item:crab_shell": R.rebirthRequirements.value.speciesMaterial[0] } });

const rebirth = (operationId: string) => call("POST", "/town/rebirth", { operationId, companionId: crab, expectedStage: 0, branch: "A" });
const coins0 = (await call("GET", "/character")).body.coins;
out.early = (await rebirth(`rb_early_${run}`)).body.error;
must(out.early === "TRIAL_REQUIRED" && (await call("GET", "/character")).body.coins === coins0, "no Rebirth before the trial, nothing charged", out.early);
must((await call("POST", "/class/rebirth/start", { operationId: `rt_mole_${run}`, companionId: mole })).body.error === "NOT_IN_TEAM", "trial needs the companion in the team");

// The trial: the tyrant at the R1 stat %, Auto until a try is won with the crab standing.
let won: string | null = null;
const tries: string[] = [];
for (let n = 1; n <= 5 && won === null; n++) {
  const op = `rt_crab_${n}_${run}`;
  const s = await call("POST", "/class/rebirth/start", { operationId: op, companionId: crab });
  must(s.status === 200 && s.body.branchId === `rebirth:1:${crab}`, "trial start", s.body);
  if (n === 1) {
    const tv = await battleCall(account, s.body.battleId)("GET", "");
    must(tv.state.practice === true && tv.state.enemyStatPct === R.rebirthTrial.value.statPct[0] && tv.state.rebirthTrial?.stage === 1, "trial: tyrant at the R1 stat %", { pct: tv.state.enemyStatPct, t: tv.state.rebirthTrial });
    const again = await call("POST", "/class/rebirth/start", { operationId: op, companionId: crab });
    must(again.body.battleId === s.body.battleId && again.body.resumed === true, "a retry resumes the same fight", again.body);
    must((await call("GET", "/class")).body.trial === null, "class trial panel ignores it");
    must((await call("GET", "/class/rebirth")).body.trials[0]?.status === "started", "rebirth trials: started");
  }
  let end = await autoToEnd(account, s.body.battleId);
  for (let k = 0; k < 6 && end.state.status === "active"; k++) end = await autoToEnd(account, s.body.battleId);
  const standing = end.state.units.find((u: Msg) => u.instanceId === crab)?.ko === false;
  const met = end.state.status === "victory" && standing;
  tries.push(`${end.state.status} r${end.state.round} crab ${standing ? "up" : "down"}`);
  let tv = (await call("GET", "/class/rebirth")).body.trials.find((t: Msg) => t.operationId === op);
  for (let k = 0; k < 20 && tv?.status === "started"; k++) {
    await sleep(250);
    tv = (await call("GET", "/class/rebirth")).body.trials.find((t: Msg) => t.operationId === op);
  }
  must(tv?.status === (met ? "won" : "lost"), "won only with the crab standing", { tv, met });
  if (!met) must((await rebirth(`rb_lost_${n}_${run}`)).body.error === "TRIAL_REQUIRED", "a lost try opens nothing");
  if (met) won = op;
}
out.tries = tries;
must(won !== null, "won the Rebirth trial on Auto", tries);

const ok = await rebirth(`rb_${run}`);
must(ok.status === 200 && ok.body.result.stage === 1 && ok.body.replayed === false, "Rebirth", ok.body);
must(ok.body.coins === coins0 - R.rebirthRequirements.value.coins[0], "paid once", { coins0, after: ok.body.coins });
const again = await rebirth(`rb_${run}`);
must(again.body.replayed === true && again.body.coins === ok.body.coins, "retry replays, no second charge", again.body);
const pet = (await call("GET", "/character")).body.companions.find((x: Msg) => x.id === crab);
must(pet.rebirthStage === 1 && pet.currentLevel === 1, "crab is R1 at Lv1", pet);
must((await call("GET", "/class/rebirth")).body.trials.every((t: Msg) => t.stage === 1), "the used trial stays stage 1");
out.stage2 = (await call("POST", "/class/rebirth/start", { operationId: `rt_s2_${run}`, companionId: crab })).body.error;
must(out.stage2 === "LEVEL_TOO_LOW", "the next stage's trial waits for Lv200 again", out.stage2);
T.sock.close();
console.log(JSON.stringify({ ok: true, ...out }));
