// Shared helpers for the smoke scripts that walk and fight against `wrangler dev`.
import { DIR_DELTA, exampleMapRegistry, findPath, inEngageRange, stepCostMs, PRODUCTION_RULES, type Direction, type TilePos } from "@pmrpg/shared";

export const api = process.env.API ?? "http://127.0.0.1:8787";
const wsBase = api.replace(/^http/, "ws");
export const run = Date.now().toString(36);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const maps = exampleMapRegistry();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = any;

export interface Client {
  sock: WebSocket;
  inbox: Msg[];
  seq: number;
  pos: TilePos;
  mapId: string;
  send(m: object): void;
  wait(pred: (m: Msg) => boolean, ms?: number, from?: number): Promise<Msg>;
}

export async function connect(account: string, mapId: string, channel = 1): Promise<Client> {
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
export async function walk(c: Client, path: Direction[]): Promise<Msg | null> {
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

export async function toField(account: string): Promise<Client> {
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
export async function approach(c: Client, pack: TilePos) {
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

export const lastPacks = (c: Client) => c.inbox.filter((m) => m.t === "packs").at(-1)!.packs as Msg[];

/** Calls a battle route as `account`. */
export const battleCall = (account: string, battleId: string) => async (method: string, action: string, body?: unknown) =>
  (await fetch(`${api}/battles/${battleId}${action}`, {
    method,
    headers: { "content-type": "application/json", "x-dev-account": account },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })).json() as Promise<Msg>;

/** Runs Auto to the end of the fight and waits for its settlement to reach D1. */
export async function autoToEnd(account: string, battleId: string): Promise<Msg> {
  const call = battleCall(account, battleId);
  const gen = (await call("POST", "/session")).sessionGeneration;
  let view = await call("GET", "");
  for (let n = 0; view.state.status === "active" && n < 300; n++) {
    const r = await call("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion });
    if (r.status !== "accepted") throw new Error(JSON.stringify(r));
    view = await call("GET", "");
  }
  for (let i = 0; i < 50 && !(view.settlement.settled || view.settlement.failed > 0); i++) {
    await sleep(200);
    view = await call("GET", "");
  }
  return view;
}
