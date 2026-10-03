/**
 * Worker entry: auth, routing, input limits (chapter 11 §1, §6). No game state lives here.
 *
 *   POST /battles/:id/dev-create   (dev only) create an EXAMPLE battle for the caller
 *   POST /battles/:id/session      claim a new session generation (reconnect)
 *   GET  /battles/:id              public state (no RNG)
 *   GET  /battles/:id/events?since=N
 *   POST /battles/:id/commands     CommandEnvelope
 *   POST /battles/:id/auto         Auto Battle step; the open client's heartbeat drives it
 *   GET  /dev/inventory?battle=ID  (dev only) the caller's D1 item balances and that battle's reservation
 *   POST /dev/reconcile            (dev only) run the reconciler now, ignoring reservation age
 *   GET  /world/where              where the caller's character is saved (map + channel)
 *   GET  /world/:mapId/:channel    WebSocket into that Map Channel DO (walking, presence)
 *
 * Starting a battle (chapter 11 §3): the economy (D1) reserves the bag and companions first, then
 * the Battle DO is created from that reservation and queues activation in its own outbox. If the
 * create step never lands, the scheduled reconciler asks the DO and releases only a reservation
 * whose battle provably never started.
 */
import { DEV_FIXTURE_RULES, EXAMPLE_START_MAP, PRODUCTION_RULES, exampleMapRegistry, type BattleSetup } from "@pmrpg/shared";
import { resolveAccount } from "./auth";
import type { Env, RoomOp, RoomReply } from "./battle-do";
import { Economy } from "./economy";

import { mapObjectName } from "./map-do";
import { WorldStore } from "./world-store";

export { BattleDurableObject } from "./battle-do";
export { MapChannelDurableObject } from "./map-do";

const MAX_BODY_BYTES = 4096;
/** PROVISIONAL ops setting: a reservation still not activated after this long is checked. */
const RESERVATION_STALE_MS = 2 * 60_000;

const economyFor = (env: Env) => new Economy(env.DB, env.ENVIRONMENT === "dev" ? DEV_FIXTURE_RULES : PRODUCTION_RULES);

/** Release reservations whose battle never started (the DO confirms and tombstones first). */
async function reconcile(env: Env, staleMs: number): Promise<{ checked: number; released: string[] }> {
  const economy = economyFor(env);
  const stale = await economy.staleReserved(new Date(Date.now() - staleMs).toISOString());
  const released: string[] = [];
  for (const r of stale) {
    const verdict = await env.BATTLE.get(env.BATTLE.idFromName(r.battleId)).probe();
    if (verdict !== "voided") continue; // started: activation is still in that battle's outbox
    const out = await economy.release(r.reservationId);
    if (out.status !== "rejected") released.push(r.reservationId);
  }
  return { checked: stale.length, released };
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await reconcile(env, RESERVATION_STALE_MS);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/dev/")) return devRoute(request, env, url);
    if (url.pathname.startsWith("/world/")) return worldRoute(request, env, url);
    const m = url.pathname.match(/^\/battles\/([a-z0-9_:-]{1,80})(?:\/([a-z-]+))?$/);
    if (m === null) return json(404, { error: "NOT_FOUND" });
    const battleId = m[1]!;
    const action = m[2] ?? "";

    const accountId = resolveAccount(request, env);
    if (accountId === null) return json(401, { error: "UNAUTHENTICATED" });

    let op: RoomOp;
    if (request.method === "GET" && action === "") op = { kind: "view" };
    else if (request.method === "GET" && action === "events") op = { kind: "events", cursor: Number(url.searchParams.get("since") ?? 0) || 0 };
    else if (request.method === "POST" && action === "session") op = { kind: "claim" };
    else if (request.method === "POST" && (action === "commands" || action === "auto" || action === "dev-create")) {
      const body = await readJson(request);
      if (body === undefined) return json(413, { error: "BODY_TOO_LARGE_OR_INVALID" });
      if (action === "dev-create") {
        if (env.ENVIRONMENT !== "dev") return json(404, { error: "NOT_FOUND" });
        const setup = devSetup(battleId, accountId);
        const economy = economyFor(env);
        // DEV ONLY: stock a new dev account once with the example bag (one battle's worth).
        await economy.devGrant(`devgrant:${accountId}`, accountId, setup.bag);
        const reservationId = `res:${battleId}`;
        const reserved = await economy.reserve({ reservationId, accountId, battleId, bag: setup.bag, companionIds: [] });
        if (reserved.status === "rejected") return json(409, { error: reserved.reason });
        op = { kind: "create", setup, reservationId };
      } else op = { kind: action === "commands" ? "command" : "auto", body };
    } else return json(405, { error: "METHOD_NOT_ALLOWED" });

    const stub = env.BATTLE.get(env.BATTLE.idFromName(battleId));
    const reply = (await stub.handle(accountId, op)) as RoomReply;
    return reply.ok ? json(200, reply.body) : json(409, { error: reply.code, message: reply.message });
  },
} satisfies ExportedHandler<Env>;

const MAPS = exampleMapRegistry();

async function worldRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const accountId = resolveAccount(request, env);
  if (accountId === null) return json(401, { error: "UNAUTHENTICATED" });
  const rules = env.ENVIRONMENT === "dev" ? DEV_FIXTURE_RULES : PRODUCTION_RULES;
  // Dev accounts appear on first use; real account creation waits for the auth provider (O11).
  if (env.ENVIRONMENT === "dev") await economyFor(env).devGrant(`devaccount:${accountId}`, accountId, {});

  if (request.method === "GET" && url.pathname === "/world/where") {
    const where = await new WorldStore(env.DB, MAPS, EXAMPLE_START_MAP).where(accountId);
    return json(200, where ?? { mapId: EXAMPLE_START_MAP, channel: 1 });
  }
  const m = url.pathname.match(/^\/world\/(map:[a-z0-9_]{1,60})\/([0-9]{1,2})$/);
  if (m === null || request.method !== "GET") return json(404, { error: "NOT_FOUND" });
  const mapId = m[1]!;
  const channel = Number(m[2]);
  if (!MAPS.has(mapId)) return json(404, { error: "UNKNOWN_MAP" });
  if (channel < 1 || channel > rules.provisional.channelsPerMap.value) return json(404, { error: "UNKNOWN_CHANNEL" });
  if (request.headers.get("Upgrade") !== "websocket") return json(426, { error: "EXPECTED_WEBSOCKET" });

  // Identity goes to the object in headers the Worker sets; anything the client sent is dropped.
  const headers = new Headers({ Upgrade: "websocket", "x-account": accountId, "x-map": mapId, "x-channel": String(channel), "x-name": displayName(accountId) });
  const stub = env.MAP.get(env.MAP.idFromName(mapObjectName(mapId, channel)));
  return stub.fetch(new Request(request.url, { headers }));
}

/** Placeholder until characters have names (Phase D): the account id without its prefix. */
const displayName = (accountId: string) => accountId.replace(/^acct:/, "").slice(0, 16);

async function devRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (env.ENVIRONMENT !== "dev") return json(404, { error: "NOT_FOUND" });
  const accountId = resolveAccount(request, env);
  if (accountId === null) return json(401, { error: "UNAUTHENTICATED" });
  if (request.method === "GET" && url.pathname === "/dev/inventory") {
    const economy = economyFor(env);
    const balances = await economy.balances(accountId);
    const battleId = url.searchParams.get("battle");
    const reservation = battleId === null ? null : await economy.reservation(`res:${battleId}`);
    return json(200, { balances, reservation });
  }
  if (request.method === "POST" && url.pathname === "/dev/reconcile") return json(200, await reconcile(env, 0));
  return json(404, { error: "NOT_FOUND" });
}

async function readJson(request: Request): Promise<unknown | undefined> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  if (text === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** EXAMPLE encounter for local dev. Real encounters come from the Map Channel DO (Phase B/C). */
function devSetup(battleId: string, accountId: string): BattleSetup {
  return {
    battleId,
    originMode: "manual",
    seed: crypto.randomUUID(),
    player: {
      accountId,
      name: "Tester",
      level: 10,
      element: "FIRE",
      primaryStats: { STR: 25, VIT: 18, INT: 10, DEX: 14, AGI: 14, SPI: 10 },
      gear: { PATK: 30 },
      skillIds: ["skill:player_power_strike"],
      basicAttackRange: "melee",
      row: "front",
      slot: 1,
    },
    companions: [],
    enemies: [
      { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 1 },
      { unitId: "e2", speciesId: "species:ember_fox", element: "FIRE", row: "front", slot: 3 },
    ],
    bag: { "item:small_potion": 3, "item:armor_crab_capture": 2, "item:ember_fox_capture": 2 },
  };
}
