/**
 * Worker entry: auth, routing, input limits (chapter 11 §1, §6). No game state lives here.
 *
 *   POST /battles/:id/dev-create   (dev only) create an EXAMPLE battle for the caller
 *   POST /battles/:id/session      claim a new session generation (reconnect)
 *   GET  /battles/:id              public state (no RNG)
 *   GET  /battles/:id/events?since=N
 *   POST /battles/:id/commands     CommandEnvelope
 *   POST /battles/:id/auto         Auto Battle step; the open client's heartbeat drives it
 */
import type { BattleSetup } from "@pmrpg/shared";
import { resolveAccount } from "./auth";
import type { Env, RoomOp, RoomReply } from "./battle-do";

export { BattleDurableObject } from "./battle-do";

const MAX_BODY_BYTES = 4096;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
        op = { kind: "create", setup: devSetup(battleId, accountId) };
      } else op = { kind: action === "commands" ? "command" : "auto", body };
    } else return json(405, { error: "METHOD_NOT_ALLOWED" });

    const stub = env.BATTLE.get(env.BATTLE.idFromName(battleId));
    const reply = (await stub.handle(accountId, op)) as RoomReply;
    return reply.ok ? json(200, reply.body) : json(409, { error: reply.code, message: reply.message });
  },
} satisfies ExportedHandler<Env>;

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
