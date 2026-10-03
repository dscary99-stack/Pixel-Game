// End-to-end Auto Hunt check (C14, chapter 08) against `wrangler dev`: the server walks the
// player to a pack, plays the fight, records it as `auto_hunt`, then walks on to the next pack;
// a hand step stops it, and closing the page stops it (no offline farming). Run
// `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:auto`.
import { api, battleCall, connect, run, sleep, toField, type Msg } from "./smoke-lib";

const account = `acct:h${run}`;
const out: Record<string, unknown> = {};

// Town: refused. No character: refused.
const T = await connect(account, "map:dawn_town");
T.send({ t: "autoHunt", settings: {} });
out.inTown = (await T.wait((m) => m.t === "auto")).reason;
T.sock.close();
await sleep(300);

let A = await toField(account);
let from = A.inbox.length;
A.send({ t: "autoHunt", settings: {} });
out.noCharacter = (await A.wait((m) => m.t === "auto", 4000, from)).reason;
const made = await fetch(`${api}/character`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-dev-account": account },
  body: JSON.stringify({ operationId: `op_${run}`, name: "นักล่า", classId: "class:striker", raceId: "race:human", element: "FIRE" }),
});
if (!made.ok) throw new Error(await made.text());

// Settings nobody on this map can match.
from = A.inbox.length;
A.send({ t: "autoHunt", settings: { targetSpecies: ["species:ember_fox"], maxPackSize: 1 } });
out.noTargets = (await A.wait((m) => m.t === "auto", 4000, from)).reason;

// Start: the server walks (autoMoved) and opens a fight by itself.
from = A.inbox.length;
const startPos = { ...A.pos };
A.send({ t: "autoHunt", settings: { stopBelowHpPercent: 0 } });
out.started = (await A.wait((m) => m.t === "auto", 4000, from)).on;
const enc = await A.wait((m) => m.t === "encounter", 30_000, from);
out.serverSteps = A.inbox.slice(from).filter((m) => m.t === "autoMoved").length;
out.walkedFrom = startPos;
const call = battleCall(account, enc.battleId);
let view = await call("GET", "");
out.originMode = view.state.originMode;
// No client commands: the server plays the fight.
for (let i = 0; i < 300 && view.state.status === "active"; i++) {
  await sleep(500);
  view = await call("GET", "");
}
out.fight1 = { status: view.state.status, autopilot: view.autopilot ?? null };
const events: Msg[] = (await call("GET", "/events?since=0")).events;
out.serverActions = events.filter((e) => e.type === "ActionResolved").length;
out.rewardOrigin = events.find((e) => e.type === "RewardEntitled")?.entitlement.originMode ?? null;

// After the result pause it walks on and starts the next fight.
const resumed = await A.wait((m) => m.t === "resumed", 15_000, from);
out.resumed = resumed.t;
const enc2 = await A.wait((m) => m.t === "encounter" && m.battleId !== enc.battleId, 40_000, from);
out.secondFight = enc2.battleId !== enc.battleId;

// Stop mid-fight: the fight stays, the player plays it from here.
from = A.inbox.length;
A.send({ t: "autoStop" });
out.stop = (await A.wait((m) => m.t === "auto", 4000, from)).reason;
await sleep(2500);
const v2 = await battleCall(account, enc2.battleId)("GET", "");
out.afterStop = { status: v2.state.status, autopilot: v2.autopilot };

// Finish that fight by hand (Auto on the page), then restart and disconnect.
const call2 = battleCall(account, enc2.battleId);
const gen = (await call2("POST", "/session")).sessionGeneration;
let v = await call2("GET", "");
for (let n = 0; v.state.status === "active" && n < 300; n++) {
  const r = await call2("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: v.state.stateVersion });
  if (r.status !== "accepted") throw new Error(JSON.stringify(r));
  v = await call2("GET", "");
}
from = A.inbox.length;
for (let i = 0; i < 10; i++) {
  A.send({ t: "resume" });
  const r = await A.wait((m) => m.t === "resumed" || (m.t === "error" && m.code === "SETTLING") || m.t === "transfer", 6000, from);
  if (r.t !== "error") break;
  from = A.inbox.length;
  await sleep(500);
}
if (A.inbox.slice(from).some((m) => m.t === "transfer")) {
  // Lost it: back in town (rested). Walk out to the field again for the rest.
  out.fight2 = "defeat: back in town";
  A.sock.close();
  await sleep(300);
  A = await toField(account);
} else out.fight2 = "won by hand";
from = A.inbox.length;
A.send({ t: "autoHunt", settings: { stopBelowHpPercent: 0 } });
await A.wait((m) => m.t === "auto" && m.on, 4000, from);
// A hand step stops it.
await sleep(600);
from = A.inbox.length;
A.send({ t: "step", seq: ++A.seq, dir: "S" });
out.handStep = (await A.wait((m) => m.t === "auto", 4000, from)).reason;
// Close the page while hunting: it stops there (no offline farming).
from = A.inbox.length;
A.send({ t: "autoHunt", settings: { stopBelowHpPercent: 0 } });
await A.wait((m) => m.t === "auto" && m.on, 4000, from);
A.sock.close();
await sleep(300);
const where = async () => (await fetch(`${api}/world/where?dev_account=${encodeURIComponent(account)}`)).json();
const at1 = await where();
await sleep(4000);
A = await connect(account, A.mapId);
out.offline = { noFightStarted: !A.inbox.some((m) => m.t === "encounter"), sameMap: JSON.stringify(at1) === JSON.stringify(await where()) };
A.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
