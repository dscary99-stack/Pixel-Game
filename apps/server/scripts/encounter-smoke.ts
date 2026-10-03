// End-to-end Phase C check against `wrangler dev`: walk into the field, engage a visible pack,
// fight it to the end, come back to the same spot. Private fights (O05): the pack stays visible
// to the other player. Run `npm run db:migrate:local` and `npm run dev:server` first, then
// `npm run smoke:encounter`.
import { DIR_DELTA, exampleMapRegistry, findPath, inEngageRange, stepCostMs, PRODUCTION_RULES, type Direction, type TilePos } from "@pmrpg/shared";

const api = process.env.API ?? "http://127.0.0.1:8787";
const wsBase = api.replace(/^http/, "ws");
const run = Date.now().toString(36);
const acct = (n: string) => `acct:e${run}_${n}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const maps = exampleMapRegistry();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = any;

interface Client {
  sock: WebSocket;
  inbox: Msg[];
  seq: number;
  pos: TilePos;
  mapId: string;
  send(m: object): void;
  wait(pred: (m: Msg) => boolean, ms?: number, from?: number): Promise<Msg>;
}

async function connect(account: string, mapId: string, channel = 1): Promise<Client> {
  const sock = new WebSocket(`${wsBase}/world/${mapId}/${channel}?dev_account=${encodeURIComponent(account)}`);
  const c: Client = {
    sock,
    inbox: [],
    seq: 0,
    pos: { x: 0, y: 0 },
    mapId,
    send: (m) => sock.send(JSON.stringify(m)),
    async wait(pred, ms = 4000, from = 0) {
      for (let t = 0; t < ms; t += 25) {
        const hit = c.inbox.slice(from).find(pred);
        if (hit) return hit;
        await sleep(25);
      }
      throw new Error(`timeout on ${account}; last=${JSON.stringify(c.inbox.slice(-4))}`);
    },
  };
  sock.onmessage = (e) => c.inbox.push(JSON.parse(String(e.data)));
  const w = await c.wait((m) => m.t === "welcome" || m.t === "transfer");
  if (w.t === "transfer") {
    sock.close();
    return connect(account, w.mapId, w.channel);
  }
  c.pos = { x: w.self.x, y: w.self.y };
  c.mapId = w.mapId;
  return c;
}

/** Walk a path one acknowledged step at a time at the honest walking speed. */
async function walk(c: Client, path: Direction[]): Promise<Msg | null> {
  for (const dir of path) {
    const seq = ++c.seq;
    const from = c.inbox.length;
    c.send({ t: "step", seq, dir });
    const r = await c.wait((m) => (m.t === "ack" || m.t === "correct") && m.seq === seq, 4000, from);
    if (r.t === "correct") return r;
    c.pos = { x: r.x, y: r.y };
    await sleep(stepCostMs(PRODUCTION_RULES, dir) + 10);
  }
  return null;
}

async function toField(account: string): Promise<Client> {
  let c = await connect(account, "map:dawn_town");
  const town = maps.get("map:dawn_town")!;
  if (c.mapId === "map:dawn_town") {
    await walk(c, findPath(town, c.pos, { x: 23, y: 8 })!);
    const t = await c.wait((m) => m.t === "transfer");
    c.sock.close();
    c = await connect(account, t.mapId, t.channel);
  }
  return c;
}

/** Walk until within engage range of the pack (P10: next to it). */
async function approach(c: Client, pack: TilePos) {
  const field = maps.get(c.mapId)!;
  const steps: Direction[] = [];
  let q = { ...c.pos };
  for (const d of findPath(field, q, pack)!) {
    if (inEngageRange(PRODUCTION_RULES, q, pack)) break;
    steps.push(d);
    q = { x: q.x + DIR_DELTA[d][0], y: q.y + DIR_DELTA[d][1] };
  }
  await walk(c, steps);
}

const lastPacks = (c: Client) => c.inbox.filter((m) => m.t === "packs").at(-1)!.packs as Msg[];
const out: Record<string, unknown> = {};

// No hunting in town.
const T = await connect(acct("a"), "map:dawn_town");
T.send({ t: "engage", packId: "map:dawn_town#1:x:1" });
out.townEngage = (await T.wait((m) => m.t === "error")).code;
T.sock.close();
await sleep(300);

const A = await toField(acct("a"));
const B = await toField(acct("b"));
await A.wait((m) => m.t === "packs");
await B.wait((m) => m.t === "packs");
const packsA = lastPacks(A);
out.packsSeen = packsA.map((p) => `${p.spawnId} ${p.leader.speciesId} ${p.leader.element} Lv${p.leader.level} [${p.sizeRange}]`);
out.sameForBoth = JSON.stringify(packsA) === JSON.stringify(lastPacks(B));

const target = packsA.sort((p, q) => Math.abs(p.x - A.pos.x) + Math.abs(p.y - A.pos.y) - (Math.abs(q.x - A.pos.x) + Math.abs(q.y - A.pos.y)))[0];
A.send({ t: "engage", packId: target.packId });
out.fromFar = (await A.wait((m) => m.t === "error" && m.code === "TOO_FAR")).code;

// Walk next to the pack, then engage.
await approach(A, target);
const standAt = { ...A.pos };
let from = A.inbox.length;
A.send({ t: "engage", packId: target.packId });
const enc = await A.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
out.encounter = enc;
const battleId: string = enc.battleId;
out.hiddenForA = !(await A.wait((m) => m.t === "packs", 3000, from)).packs.some((q: Msg) => q.packId === target.packId);
out.stillVisibleForB = lastPacks(B).some((q) => q.packId === target.packId);

// B engages the same pack: B's own fight, not A's.
await approach(B, target);
from = B.inbox.length;
B.send({ t: "engage", packId: target.packId });
const encB = await B.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
out.bOwnFight = encB.t === "encounter" && encB.battleId !== battleId;

// Walking during the fight is refused; a double engage returns the same fight.
from = A.inbox.length;
A.send({ t: "step", seq: ++A.seq, dir: "N" });
out.stepInBattle = (await A.wait((m) => m.t === "correct", 3000, from)).reason;
A.send({ t: "engage", packId: target.packId });
out.doubleEngage = (await A.wait((m) => m.t === "encounter", 3000, from)).battleId === battleId;

// Reload mid-fight: the fight comes back.
A.sock.close();
await sleep(300);
const A2 = await connect(acct("a"), A.mapId);
out.reconnect = await A2.wait((m) => m.t === "encounter");
from = A2.inbox.length;
A2.send({ t: "resume" });
out.resumeTooEarly = (await A2.wait((m) => m.t === "error", 3000, from)).code;

// Fight to the end with Auto (the open page drives it; C14).
const H = { "content-type": "application/json", "x-dev-account": acct("a") };
const call = async (method: string, action: string, body?: unknown) =>
  (await fetch(`${api}/battles/${battleId}${action}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) })).json() as Promise<Msg>;
const gen = (await call("POST", "/session")).sessionGeneration;
let view = await call("GET", "");
out.enemies = view.state.units.filter((u: Msg) => u.side === "enemy").map((u: Msg) => `${u.speciesId} ${u.element}`);
out.leaderMatches = view.state.units.find((u: Msg) => u.unitId === "e1").speciesId === target.leader.speciesId &&
  view.state.units.find((u: Msg) => u.unitId === "e1").element === target.leader.element;
let n = 0;
while (view.state.status === "active" && n < 300) {
  const r = await call("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion });
  if (r.status !== "accepted") throw new Error(JSON.stringify(r));
  view = await call("GET", "");
  n++;
}
out.final = { status: view.state.status, autoSteps: n };
for (let i = 0; i < 50 && !(view.settlement.settled || view.settlement.failed > 0); i++) {
  await sleep(200);
  view = await call("GET", "");
}
out.settlement = view.settlement;
out.inventory = await (await fetch(`${api}/dev/inventory?battle=${battleId}`, { headers: H })).json();

// Back to walking from the same spot; the fought pack stays hidden for A.
from = A2.inbox.length;
A2.send({ t: "resume" });
await A2.wait((m) => m.t === "resumed", 3000, from);
const packsAfter = (await A2.wait((m) => m.t === "packs", 3000, from)).packs;
out.reloadKeptSpot = A2.pos.x === standAt.x && A2.pos.y === standAt.y;
out.foughtPackHidden = !packsAfter.some((q: Msg) => q.packId === target.packId);
A2.send({ t: "engage", packId: target.packId });
out.engageAgain = (await A2.wait((m) => m.t === "error", 3000, from)).code;
from = A2.inbox.length;
A2.send({ t: "step", seq: ++A2.seq, dir: "S" });
const after = await A2.wait((m) => m.t === "ack" || m.t === "correct", 3000, from);
out.walkAfter = { result: after.t, from: standAt, to: { x: after.x, y: after.y } };
for (const c of [A2, B]) c.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
