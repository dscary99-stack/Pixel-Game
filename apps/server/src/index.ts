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
 *   GET  /character                the caller's character, team and owned companions (404 NO_CHARACTER)
 *   GET  /character/secret-quests  { locked: true } until the set is unlocked (no count, no hints)
 *   POST /dev/secret-quests/reveal (dev only) reveal the caller's secret quests and return them
 *   POST /character                create the character (idempotent on operationId; one per account)
 *   GET  /party, POST /party, POST /party/join {partyId}, POST /party/leave   party (P02)
 *   POST /town/affix/reroll        roll one gear affix again for coins + material (operationId, equipmentId, slot, expectedAffixes, expectedCost)
 *   POST /character/equipment/affix/choose  keep the old or the new affix (operationId, equipmentId, rerollOperationId, keep)
 *   GET  /journal                  collection journal: species records, maps, Sigils, earned titles (chapter 09)
 *   PUT  /character/title          show an earned title or none ({ titleId })
 *   GET  /town/orders              this week's NPC orders with fills left (chapter 09)
 *   POST /town/order               fill an NPC order once (operationId, orderId)
 *   POST /town/gear/dispose        sell or salvage free, unworn, Sigil-free, unprotected pieces in town (operationId, mode, equipmentIds, expected)
 *   POST /character/companion/release  release a companion for nothing back (operationId, companionId; not in team, not protected)
 *   PUT  /character/protect        set or clear the protect flag ({ kind: equipment|companion, id, protected })
 *   PUT  /character/companion/nickname  name a companion or clear it ({ companionId, nickname|null })
 *   GET  /quests                   today's and this week's quest boards with progress (chapter 09)
 *   POST /quests/claim             claim a daily reward or the weekly main reward (periodId, slot)
 *   POST /town/craft               make a recipe 1–10 times (operationId, recipeId, times, expectedCoins)
 *   POST /town/buy                 buy from a town shop at the shown total (operationId, shopId, lines, expectedTotal)
 *   POST /town/rebirth             companion Rebirth at the town NPC (operationId, companionId, expectedStage)
 *   POST /town/rebirth/branch      switch a reached Rebirth stage's variant branch for coins (operationId, companionId, stage, expectedBranch, branch, expectedCost)
 *   POST /town/skill               train one companion skill a level (operationId, companionId, skillId, expectedLevel)
 *   PUT  /character/team           set the team (expectedVersion; ≤5, no duplicate species, outside fights)
 *   GET  /world/where              where the caller's character is saved (map + channel)
 *   GET  /world/:mapId/:channel    WebSocket into that Map Channel DO (walking, presence)
 *
 * Starting a battle (chapter 11 §3): the economy (D1) reserves the bag and companions first, then
 * the Battle DO is created from that reservation and queues activation in its own outbox. If the
 * create step never lands, the scheduled reconciler asks the DO and releases only a reservation
 * whose battle provably never started.
 */
import {
  DEV_FIXTURE_RULES,
  DEV_STARTER_COINS,
  DEV_STARTER_EQUIPMENT,
  DEV_STARTER_ITEMS,
  DEV_STARTER_SIGILS,
  EXAMPLE_START_MAP,
  PRODUCTION_RULES,
  devPlayer,
  exampleContentMaps,
  exampleShopRegistry,
  exampleRecipeRegistry,
  exampleNpcOrderRegistry,
  exampleMapRegistry,
  EXAMPLE_SECRET_QUEST_TEMPLATES,
  RaritySchema,
  RolledAffixSchema,
  type BattleSetup,
} from "@pmrpg/shared";
import { z } from "zod";
import { resolveAccount } from "./auth";
import type { Env, RoomOp, RoomReply } from "./battle-do";
import { CharacterStore } from "./character-store";
import { Economy } from "./economy";

import { mapObjectName } from "./map-do";
import { WorldStore } from "./world-store";
import { TownServices, type ServiceResult } from "./town-services";
import { PartyStore, type PartyResult } from "./party-store";
import { QuestStore } from "./quest-store";
import { JournalStore } from "./journal-store";
import { NpcOrderStore } from "./npc-order-store";
import { DisposalStore } from "./disposal-store";
import { SecretQuestStore, secretQuestKey } from "./secret-quest-store";

export { BattleDurableObject } from "./battle-do";
export { MapChannelDurableObject } from "./map-do";

const MAX_BODY_BYTES = 4096;
/** PROVISIONAL ops setting: a reservation still not activated after this long is checked. */
const RESERVATION_STALE_MS = 2 * 60_000;

const rulesFor = (env: Env) => (env.ENVIRONMENT === "dev" ? DEV_FIXTURE_RULES : PRODUCTION_RULES);
const economyFor = (env: Env) => new Economy(env.DB, rulesFor(env));
const CONTENT = { ...exampleContentMaps(), shops: exampleShopRegistry(), recipes: exampleRecipeRegistry() };
const secretQuestsFor = (env: Env) =>
  new SecretQuestStore(env.DB, rulesFor(env), EXAMPLE_SECRET_QUEST_TEMPLATES, { ...CONTENT, maps: exampleMapRegistry() }, secretQuestKey(env));
const charactersFor = (env: Env) => new CharacterStore(env.DB, rulesFor(env), CONTENT, undefined, secretQuestsFor(env));
const TOWNS = [...exampleMapRegistry().values()].filter((m) => m.kind === "town").map((m) => m.id);
const townFor = (env: Env) => new TownServices(env.DB, rulesFor(env), CONTENT, TOWNS);
const journalFor = (env: Env) => new JournalStore(env.DB, rulesFor(env), CONTENT);
const ordersFor = (env: Env) => new NpcOrderStore(env.DB, rulesFor(env), exampleNpcOrderRegistry());
const disposalFor = (env: Env) => new DisposalStore(env.DB, rulesFor(env), { equipment: CONTENT.equipment, affixPools: CONTENT.affixPools }, TOWNS);
const questsFor = (env: Env) => new QuestStore(env.DB, rulesFor(env), { ...CONTENT, maps: exampleMapRegistry() }, TOWNS);

/** DEV ONLY: dev accounts appear on first use with a starter bag and starter gear; real account creation waits for O11. */
async function devStarter(env: Env, accountId: string): Promise<void> {
  if (env.ENVIRONMENT !== "dev") return;
  await economyFor(env).devGrant(`devstarter:${accountId}`, accountId, DEV_STARTER_ITEMS);
  await charactersFor(env).devGrantEquipment(`devgear:${accountId}`, accountId, DEV_STARTER_EQUIPMENT);
  await economyFor(env).devGrant(`devsigils:${accountId}`, accountId, DEV_STARTER_SIGILS);
  await townFor(env).devGrantCoins(`devcoins:${accountId}`, accountId, DEV_STARTER_COINS);
}

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
    if (url.pathname === "/character" || url.pathname.startsWith("/character/") || url.pathname.startsWith("/town/") || url.pathname.startsWith("/quests") || url.pathname === "/journal") return characterRoute(request, env, url);
    if (url.pathname === "/party" || url.pathname.startsWith("/party/")) return partyRoute(request, env, url);
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
  await devStarter(env, accountId);

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
  const name = (await charactersFor(env).get(accountId))?.name ?? displayName(accountId);
  const headers = new Headers({ Upgrade: "websocket", "x-account": accountId, "x-map": mapId, "x-channel": String(channel), "x-name": encodeURIComponent(name) });
  const stub = env.MAP.get(env.MAP.idFromName(mapObjectName(mapId, channel)));
  return stub.fetch(new Request(request.url, { headers }));
}

/** Party (P02): see your party, start one, join by code, leave. */
async function partyRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const accountId = resolveAccount(request, env);
  if (accountId === null) return json(401, { error: "UNAUTHENTICATED" });
  const parties = new PartyStore(env.DB, rulesFor(env));
  let r: PartyResult;
  if (request.method === "GET" && url.pathname === "/party") r = { status: "ok", party: await parties.view(accountId) };
  else if (request.method === "POST" && url.pathname === "/party") r = await parties.create(accountId);
  else if (request.method === "POST" && url.pathname === "/party/join") r = await parties.join(accountId, (await readJson(request)) ?? null);
  else if (request.method === "POST" && url.pathname === "/party/leave") r = await parties.leave(accountId);
  else return json(404, { error: "NOT_FOUND" });
  if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
  return json(200, { party: r.party });
}

async function characterRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const accountId = resolveAccount(request, env);
  if (accountId === null) return json(401, { error: "UNAUTHENTICATED" });
  await devStarter(env, accountId);
  const store = charactersFor(env);
  if (request.method === "GET" && url.pathname === "/character") {
    const character = await store.get(accountId);
    if (character === null) return json(404, { error: "NO_CHARACTER" });
    return json(200, {
      character,
      companions: await store.companions(accountId),
      equipment: await store.equipment(accountId),
      coins: await townFor(env).coins(accountId),
      craftMastery: await townFor(env).craftMastery(accountId),
      titleId: await journalFor(env).title(accountId),
      bag: await economyFor(env).balances(accountId),
    });
  }
  if (request.method === "GET" && url.pathname === "/character/secret-quests") {
    const view = await secretQuestsFor(env).view(accountId);
    return view === null ? json(404, { error: "NO_CHARACTER" }) : json(200, view);
  }
  if (request.method === "GET" && url.pathname === "/journal") {
    const view = await journalFor(env).view(accountId);
    return view === null ? json(404, { error: "NO_CHARACTER" }) : json(200, view);
  }
  if (request.method === "GET" && url.pathname === "/town/orders") return json(200, await ordersFor(env).view(accountId));
  if (request.method === "GET" && url.pathname === "/quests") {
    const view = await questsFor(env).view(accountId);
    return view === null ? json(404, { error: "NO_CHARACTER" }) : json(200, view);
  }
  const body = await readJson(request);
  if (body === undefined) return json(400, { error: "INVALID_REQUEST" });
  if (request.method === "POST" && url.pathname === "/town/order") {
    const r = await ordersFor(env).fill(accountId, body);
    if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, { ...r, coins: await townFor(env).coins(accountId) });
  }
  if (request.method === "POST" && url.pathname === "/town/gear/dispose") {
    const r = await disposalFor(env).disposeGear(accountId, body);
    if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, { ...r, coins: await townFor(env).coins(accountId) });
  }
  if (request.method === "POST" && url.pathname === "/character/companion/release") {
    const r = await disposalFor(env).release(accountId, body);
    if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, r);
  }
  if (request.method === "PUT" && url.pathname === "/character/protect") {
    const r = await disposalFor(env).protect(accountId, body);
    if (!r.ok) return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, r);
  }
  if (request.method === "PUT" && url.pathname === "/character/companion/nickname") {
    const r = await disposalFor(env).nickname(accountId, body);
    if (!r.ok) return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, r);
  }
  if (request.method === "PUT" && url.pathname === "/character/title") {
    const r = await journalFor(env).setTitle(accountId, body);
    if (!r.ok) return json(r.code === "INVALID_REQUEST" ? 400 : r.code === "NO_CHARACTER" ? 404 : 409, { error: r.code, message: r.message });
    return json(200, r);
  }
  if (request.method === "POST" && url.pathname === "/quests/claim") {
    const r = await questsFor(env).claim(accountId, body);
    if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, { ...r, coins: await townFor(env).coins(accountId) });
  }
  if (request.method === "POST" && url.pathname === "/character") {
    const r = await store.create(accountId, body);
    if (r.status === "rejected") return json(r.reason === "CHARACTER_EXISTS" ? 409 : 400, { error: r.reason, message: r.message });
    return json(200, r);
  }
  if (request.method === "PUT" && url.pathname === "/character/team") {
    const r = await store.setTeam(accountId, body);
    if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, r);
  }
  if (request.method === "POST" && url.pathname === "/character/equipment/sigil") return serviceReply(env, accountId, await townFor(env).installSigil(accountId, body));
  if (request.method === "POST" && url.pathname === "/character/equipment/sigil/remove") return serviceReply(env, accountId, await townFor(env).removeSigil(accountId, body));
  if (request.method === "POST" && url.pathname === "/town/affix/reroll") return serviceReply(env, accountId, await townFor(env).rerollAffix(accountId, body));
  if (request.method === "POST" && url.pathname === "/character/equipment/affix/choose") return serviceReply(env, accountId, await townFor(env).chooseAffix(accountId, body));
  if (request.method === "POST" && url.pathname === "/town/craft") return serviceReply(env, accountId, await townFor(env).craft(accountId, body));
  if (request.method === "POST" && url.pathname === "/town/buy") return serviceReply(env, accountId, await townFor(env).buy(accountId, body));
  if (request.method === "POST" && url.pathname === "/town/sell") return serviceReply(env, accountId, await townFor(env).sell(accountId, body));
  if (request.method === "POST" && url.pathname === "/town/rebirth") return serviceReply(env, accountId, await townFor(env).rebirth(accountId, body));
  if (request.method === "POST" && url.pathname === "/town/rebirth/branch") return serviceReply(env, accountId, await townFor(env).changeRebirthBranch(accountId, body));
  if (request.method === "POST" && url.pathname === "/town/skill") return serviceReply(env, accountId, await townFor(env).trainSkill(accountId, body));
  if (request.method === "PUT" && url.pathname === "/character/stats") {
    const r = await store.allocate(accountId, body);
    if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, r);
  }
  if (request.method === "PUT" && url.pathname === "/character/equipment") {
    const r = await store.equip(accountId, body);
    if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
    return json(200, r);
  }
  return json(404, { error: "NOT_FOUND" });
}

/** A town service answer with the caller's fresh coin balance. */
async function serviceReply(env: Env, accountId: string, r: ServiceResult<unknown>): Promise<Response> {
  if (r.status === "rejected") return json(r.reason === "INVALID_REQUEST" ? 400 : 409, { error: r.reason, message: r.message });
  return json(200, { ...r, coins: await townFor(env).coins(accountId) });
}

/** Fallback name for a player who has not created a character: the account id without its prefix. */
export const displayName = (accountId: string) => accountId.replace(/^acct:/, "").slice(0, 16);

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
  // DEV ONLY: stands in for the Lv200 awakening quest (not built) so the set can be checked.
  if (request.method === "POST" && url.pathname === "/dev/secret-quests/reveal") {
    const view = await secretQuestsFor(env).devReveal(accountId);
    return view === null ? json(404, { error: "NO_CHARACTER" }) : json(200, view);
  }
  // DEV ONLY: a piece with set affixes, plus coins and items, so smokes can test rerolls.
  if (request.method === "POST" && url.pathname === "/dev/grant") {
    const parsed = DevGrantSchema.safeParse(await readJson(request));
    if (!parsed.success) return json(400, { error: "INVALID_REQUEST" });
    const g = parsed.data;
    if (g.piece !== undefined && !CONTENT.equipment.has(g.piece.definitionId)) return json(400, { error: "UNKNOWN_EQUIPMENT" });
    if (Object.keys(g.items).length > 0) await economyFor(env).devGrant(`${g.operationId}:items`, accountId, g.items);
    if (g.coins > 0) await townFor(env).devGrantCoins(`${g.operationId}:coins`, accountId, g.coins);
    if (g.piece !== undefined) await charactersFor(env).devGrantPiece(`${g.operationId}:piece`, accountId, g.piece);
    return json(200, { ok: true });
  }
  return json(404, { error: "NOT_FOUND" });
}

const DevGrantSchema = z
  .object({
    operationId: z.string().min(8).max(120),
    coins: z.number().int().min(0).max(1_000_000).default(0),
    items: z.record(z.string(), z.number().int().min(1).max(10_000)).default({}),
    piece: z.object({ definitionId: z.string(), rarity: RaritySchema, affixes: z.array(RolledAffixSchema).max(3) }).strict().optional(),
  })
  .strict();

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
    player: devPlayer(accountId, "Tester"),
    companions: [],
    enemies: [
      { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 1 },
      { unitId: "e2", speciesId: "species:ember_fox", element: "FIRE", row: "front", slot: 3 },
    ],
    bag: { "item:small_potion": 3, "item:armor_crab_capture": 2, "item:ember_fox_capture": 2 },
  };
}
