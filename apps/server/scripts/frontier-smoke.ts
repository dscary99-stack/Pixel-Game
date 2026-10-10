// End-to-end tower check against `wrangler dev` (chapter 07 §4, Nut 2026-10-06): enter the Rift Spire
// in town with this week's one entry, win floor 1 (10 monsters, its gimmick) and stand on floor 2, step
// out and come back, capture on a tower floor, jump (dev) to floor 10 for the guardian (filled to 10
// with escorts), jump to floor 31+ and see a reinforcement take a fallen enemy's cell, lose to end the
// run, and be refused at the door from the field. Run `npm run db:migrate:local` and `npm run dev:server` first, then
// `npm run smoke:frontier`.
import { AUTO_GAP_MS, api, autoToEnd, battleCall, connect, run, sleep, toField, type Msg } from "./smoke-lib";

const account = `acct:fr${run}`;
const H = { "content-type": "application/json", "x-dev-account": account };
const http = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};
const must = (ok: boolean, what: string, got?: unknown) => {
  if (!ok) throw new Error(`${what}: ${JSON.stringify(got)}`);
};
const out: Record<string, unknown> = {};

// 0. A character with dev gear strong enough to clear the early floors every time (the smoke checks
// the tower's flow, not the balance), standing in town.
const made = await http("POST", "/character", { operationId: `op_${run}`, name: "ปีนหอ", classId: "class:striker", raceId: "race:human", element: "FIRE" });
must(made.status === 200 || made.status === 201, "create", made.body);
await http("POST", "/dev/grant", {
  operationId: `devw_${run}`,
  items: { "item:supply_mole_capture": 10, "item:bell_bird_capture": 10 },
  piece: { definitionId: "equip:wooden_sword", rarity: "EPIC", affixes: [{ stat: "PATK", value: 3000 }, { stat: "SPD", value: 300 }] },
});
await http("POST", "/dev/grant", { operationId: `deva_${run}`, piece: { definitionId: "equip:cloth_tunic", rarity: "EPIC", affixes: [{ stat: "HP", value: 30000 }, { stat: "PDEF", value: 400 }, { stat: "MDEF", value: 400 }] } });
let bundle = (await http("GET", "/character")).body;
let version = bundle.character.version as number;
const strong = (def: string) => bundle.equipment.find((e: Msg) => e.definitionId === def && e.affixes.length > 0)?.id as string;
const equip = async (slot: string, instanceId: string | null) => {
  const r = await http("PUT", "/character/equipment", { expectedVersion: version, slot, instanceId });
  must(r.status === 200, `equip ${slot}`, r.body);
  version = r.body.character.version;
};
await equip("MAIN_HAND", strong("equip:wooden_sword"));
await equip("ARMOR", strong("equip:cloth_tunic"));
const T = await connect(account, "map:dawn_town");
await T.wait((m) => m.t === "rested");
T.sock.close();
await sleep(300);

/** Fight the run's next floor to the end (with `inFight` first), then read the tower again. */
async function climb(runId: string, floor: number, inFight: (battleId: string) => Promise<void> = async () => undefined) {
  const s = await http("POST", "/frontier/floor/start", { runId, floor });
  must(s.status === 200, `start floor ${floor}`, s.body);
  const start = await battleCall(account, s.body.battleId)("GET", "");
  await inFight(s.body.battleId);
  const view = await autoToEnd(account, s.body.battleId);
  const after = (await http("GET", "/frontier")).body;
  return { start: s.body, state0: start.state, end: view.state, after };
}

// 1. Enter in town: once a week, replay-safe, a second entry refused.
const first = await http("GET", "/frontier");
out.before = { weekId: first.body.weekId, endsAt: first.body.endsAt, entryUsed: first.body.entryUsed, floors: first.body.floors, bossEvery: first.body.bossEvery };
const enter = await http("POST", "/frontier/enter", { operationId: `fe_${run}` });
must(enter.status === 200 && enter.body.view.run?.floor === 1, "enter", enter.body);
const runId = enter.body.view.run.runId as string;
const replay = await http("POST", "/frontier/enter", { operationId: `fe_${run}` });
const second = await http("POST", "/frontier/enter", { operationId: `fe2_${run}` });
must(replay.body.replayed === true && replay.body.view.run.runId === runId, "enter replay", replay.body);
must(second.body.error === "ALREADY_ENTERED", "second entry", second.body);
out.enter = { status: enter.status, runId, replayed: replay.body.replayed, secondEntry: second.body.error };

// 2. Floor 1: win → floor 2; the tower's numbers are on the fight.
const f1 = await climb(runId, 1);
must(f1.end.status === "victory" && f1.after.run.floor === 2 && f1.after.run.best === 1, "floor 1", { end: f1.end.status, run: f1.after.run });
must(f1.state0.units.filter((u: Msg) => u.side === "enemy").length === 10, "10 monsters on floor 1", f1.state0.units.length);
must(Array.isArray(f1.state0.frontier.modifiers) && f1.state0.frontier.modifiers.length === 1, "floor 1 gimmick", f1.state0.frontier);
out.floor1 = {
  battleId: f1.start.battleId,
  frontier: f1.state0.frontier,
  name: enter.body.view.run.next?.name,
  next: enter.body.view.run.next,
  enemyCount: f1.state0.units.filter((u: Msg) => u.side === "enemy").length,
  enemies: f1.state0.units.filter((u: Msg) => u.side === "enemy").map((u: Msg) => `${u.speciesId} Lv${u.level} hp${u.stats.maxHp}${u.rank === "ELITE" ? " ELITE" : ""}`),
  outcome: f1.end.status,
  next: f1.after.run.floor,
  best: f1.after.run.best,
  vitals: f1.after.run.vitals.player,
};

// 3. Step out and come back: the run waits on floor 2.
const left = await http("POST", "/frontier/leave", { runId });
must(left.status === 200 && left.body.view.run.inside === false && left.body.view.run.floor === 2, "leave", left.body);
const back = await http("GET", "/frontier");
out.leaveResume = { inside: left.body.view.run.inside, floorAfterLeave: back.body.run.floor, entryStillUsed: back.body.entryUsed };

// 4. Capture on a tower floor: normal manual capture with the species' item (O07 dev rates).
let tries = 0;
const f2 = await climb(runId, 2, async (battleId) => {
  const call = battleCall(account, battleId);
  const gen = (await call("POST", "/session")).sessionGeneration;
  for (let i = 0; i < 10; i++) {
    const view = await call("GET", "");
    if (view.state.status !== "active") return;
    const enemy = view.state.units.find((u: Msg) => u.side === "enemy" && !u.ko && !u.retired);
    if (enemy === undefined) return;
    if (view.actor !== "player") {
      await sleep(AUTO_GAP_MS);
      await call("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion });
      continue;
    }
    tries++;
    const res = await call("POST", "/commands", {
      commandId: crypto.randomUUID(),
      sessionGeneration: gen,
      expectedStateVersion: view.state.stateVersion,
      command: { type: "capture", actorId: "player", targetId: enemy.unitId, itemId: `item:${enemy.speciesId.slice("species:".length)}_capture` },
    });
    if (res.events?.some((e: Msg) => e.type === "CaptureResolved" && e.success)) return;
  }
});
bundle = (await http("GET", "/character")).body;
const caught = f2.end.entitlements.filter((e: Msg) => e.kind === "capture").length;
must(caught > 0 && bundle.companions.length > 0, `capture on floor 2 (${tries} tries)`, f2.end.entitlements);
out.capture = { tries, caught, companion: bundle.companions.map((c: Msg) => `${c.speciesId} Lv${c.currentLevel}`), outcome: f2.end.status, next: f2.after.run.floor };

// 5. Dev jump to floor 10: the guardian floor with its adds and phases.
const jumped = await http("POST", "/dev/frontier/jump", { floor: 10 });
must(jumped.body.run.floor === 10 && jumped.body.run.nextIsBoss === true, "jump", jumped.body);
const f10 = await climb(runId, 10);
const guardian = f10.state0.units.find((u: Msg) => u.rank === "BOSS");
must(f10.start.boss === true && guardian !== undefined && f10.state0.boss !== undefined, "boss floor", f10.start);
must(f10.state0.units.filter((u: Msg) => u.side === "enemy").length === 10, "10 monsters on the boss floor", f10.state0.units.length);
out.bossFloor = {
  boss: f10.start.boss,
  frontier: f10.state0.frontier,
  phaseAtStart: f10.state0.boss,
  guardian: `${guardian.speciesId} Lv${guardian.level} hp${guardian.stats.maxHp} x${guardian.actionsPerRound} captureOpen=${guardian.captureWindowOpen}`,
  enemyCount: f10.state0.units.filter((u: Msg) => u.side === "enemy").length,
  enemies: f10.state0.units.filter((u: Msg) => u.side === "enemy").map((u: Msg) => `${u.unitId} ${u.speciesId} ${u.row}${u.slot}`),
  outcome: f10.end.status,
  after: { floor: f10.after.run.floor, best: f10.after.run.best, status: f10.after.run.status },
};

// 6. Reinforcements from floor 31: jump (dev) to a later floor, see a replacement take a fallen enemy's
// cell after a kill. If the guardian won, the dev reset gives the week's entry back for a new run first.
let climbId = runId;
if (f10.after.run.status !== "open") {
  await http("POST", "/dev/frontier/reset");
  const again = await http("POST", "/frontier/enter", { operationId: `fe5_${run}` });
  must(again.status === 200, "re-enter after dev reset", again.body);
  climbId = again.body.view.run.runId;
}
const jumped31 = await http("POST", "/dev/frontier/jump", { floor: 33 });
out.preview33 = jumped31.body.run.next;
must(jumped31.body.run.next.reinforcements > 0 && jumped31.body.run.next.modifiers.length === 1, "floor 33 preview", jumped31.body.run.next);
const f33 = await climb(climbId, 33);
const evs = await battleCall(account, f33.start.battleId)("GET", "/events?since=0");
const list: Msg[] = Array.isArray(evs) ? evs : (evs.events ?? []);
const arrivals = list.filter((e: Msg) => e.type === "ReinforcementArrived");
const firstArrival = arrivals[0];
must(firstArrival !== undefined, "a reinforcement arrived on floor 33", { status: f33.end.status, left: f33.end.frontier });
const replaced = f33.end.units.find((u: Msg) => u.unitId === firstArrival.replaces);
must(replaced?.replacedBy === firstArrival.unitId && (replaced.ko || replaced.retired), "the reinforcement took a fallen enemy's cell", replaced);
out.reinforcements = {
  floor: 33,
  frontier: f33.state0.frontier,
  queued: jumped31.body.run.next.reinforcements,
  arrived: arrivals.length,
  first: `${firstArrival.unitId} ${firstArrival.speciesId} → ${firstArrival.row}${firstArrival.slot} (replaces ${firstArrival.replaces}, left ${firstArrival.left})`,
  arrivedAfterKill: list.findIndex((e: Msg) => e.type === "EnemyDefeated" && e.unitId === firstArrival.replaces) < list.indexOf(firstArrival),
  kills: f33.end.entitlements.filter((e: Msg) => e.kind === "kill").length,
  outcome: f33.end.status,
};
const afterClimb = (await http("GET", "/frontier")).body.run;

// 7. A loss ends the run: plain gear high up the tower.
if (afterClimb.status === "open") {
  await equip("MAIN_HAND", null);
  await equip("ARMOR", null);
  await http("POST", "/dev/frontier/jump", { floor: 95 });
  const f95 = await climb(climbId, 95);
  out.loss = { floor: 95, frontier: f95.state0.frontier, outcome: f95.end.status, run: { status: f95.after.run.status, endReason: f95.after.run.endReason, best: f95.after.run.best } };
  must(f95.end.status === "defeat" && f95.after.run.status === "ended" && f95.after.run.endReason === "defeat", "loss", out.loss);
} else {
  out.loss = { floor: 33, run: { status: afterClimb.status, endReason: afterClimb.endReason } };
  must(afterClimb.endReason === "defeat", "loss on floor 33", afterClimb);
}
out.afterLoss = (await http("POST", "/frontier/floor/start", { runId: climbId, floor: (await http("GET", "/frontier")).body.run.floor })).body.error;
out.reenterAfterLoss = (await http("POST", "/frontier/enter", { operationId: `fe3_${run}` })).body.error;

// 8. The door is in town: from the field the entry is refused (dev reset gives the entry back first).
const F = await toField(account);
await F.wait((m) => m.t === "welcome" || m.t === "packs");
const reset = await http("POST", "/dev/frontier/reset");
const field = await http("POST", "/frontier/enter", { operationId: `fe4_${run}` });
must(reset.body.entryUsed === false && field.body.error === "NOT_IN_TOWN", "field entry", { reset: reset.body.entryUsed, field: field.body });
out.fieldEntry = { map: F.mapId, error: field.body.error };
F.sock.close();

console.log(JSON.stringify(out, null, 1));
process.exit(0);
