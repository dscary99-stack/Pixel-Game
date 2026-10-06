/**
 * Map Channel Durable Object: one object per map + channel (chapter 11 §1). Holds live presence,
 * validates every step, broadcasts what changed, and saves positions to D1.
 *
 * Encounters (Phase C, O05 decided 2026-10-03): the channel rolls visible packs per respawn cycle
 * and keeps them in its storage, so everyone sees the same roster and a reload never re-rolls it.
 * Engaging claims a private fight in D1, reserves the bag, and creates the Battle DO from exactly
 * that roster. Other players keep seeing and fighting the same pack.
 *
 * Uses the WebSocket Hibernation API. Each socket's attachment carries that player's presence, so
 * the channel can be rebuilt after the object sleeps without a separate presence table. The
 * Worker authenticates and passes the account in a header; this object is never reachable directly.
 */
import { DurableObject } from "cloudflare:workers";
import {
  DEV_FIXTURE_RULES,
  EXAMPLE_START_MAP,
  MapChannel,
  PRODUCTION_RULES,
  Rng,
  defaultCombatBag,
  exampleContentMaps,
  exampleMapRegistry,
  exampleSecretRewardRegistry,
  huntingAllowed,
  inEngageRange,
  packCycle,
  packEnemies,
  packInstanceId,
  companionSetups,
  autoHuntReadiness,
  NO_PARTY_BONUS,
  partyBonus,
  type PartyBonus,
  companionCombatProfile,
  deriveStats,
  gearBonuses,
  mapHasTargets,
  planAutoHunt,
  playerSetup,
  stopSpeciesPack,
  rollPack,
  seedRng,
  visiblePack,
  visibleBoss,
  bossLairId,
  bossAttemptId,
  newHuntSummary,
  addFightToSummary,
  isRareDrop,
  type HuntSummary,
  type PackMember,
  type AutoHuntSettings,
  type AutoStopReason,
  type BattleSetup,
  type Direction,
  type OriginMode,
  type MapDefinition,
  type Outgoing,
  type PackInstance,
  type Presence,
  type PublicBattleState,
  type RulesConfig,
  type WorldErrorCode,
  type WorldServerMessage,
} from "@pmrpg/shared";
import type { Env, RoomReply } from "./battle-do";
import { CharacterStore } from "./character-store";
import { JournalStore } from "./journal-store";
import { Economy } from "./economy";
import { EncounterStore } from "./encounter-store";
import { PartyStore } from "./party-store";
import { SecretProgressStore } from "./secret-progress-store";
import { WorldStore } from "./world-store";

/** What each hibernatable socket remembers. */
interface Attachment {
  mapId: string;
  channel: number;
  generation: number;
  presence: Presence;
  /** Auto Hunt on for this connection (C14: only while connected). */
  auto?: AutoState | null;
}

interface AutoState {
  settings: AutoHuntSettings;
  /** HP checked since the last fight ended. */
  checked: boolean;
  /** When the current fight was first seen over; the result shows for autoHuntResultPauseMs. */
  endedAt: number | null;
  /** The fight autopilot was switched on for (set again after a restart). */
  piloting: string | null;
}

const MAX_MESSAGE_BYTES = 256;
const huntKey = (accountId: string) => `hunt:${accountId}`;
export const mapObjectName = (mapId: string, channel: number) => `${mapId}#${channel}`;

export class MapChannelDurableObject extends DurableObject<Env> {
  private readonly rules: RulesConfig;
  private readonly maps = exampleMapRegistry();
  private readonly content = exampleContentMaps();
  private readonly store: WorldStore;
  private readonly encounters: EncounterStore;
  private readonly parties: PartyStore;
  private readonly economy: Economy;
  private readonly characters: CharacterStore;
  private readonly journal: JournalStore;
  private readonly secrets: SecretProgressStore;
  private channel: MapChannel | null = null;
  private packs: { cycle: number; list: PackInstance[] } | null = null;
  /** Accounts with an engage or resume in flight; a second tap waits for the first answer. */
  private readonly busy = new Set<string>();
  /** Auto Hunt routes (memory only; re-planned if the object restarts). */
  private readonly routes = new Map<string, { packId: string; path: Direction[] }>();
  private lastSaveAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.rules = env.ENVIRONMENT === "dev" ? DEV_FIXTURE_RULES : PRODUCTION_RULES;
    // Phase B ships EXAMPLE maps only; a versioned content bundle replaces this later.
    this.store = new WorldStore(env.DB, this.maps, EXAMPLE_START_MAP);
    this.encounters = new EncounterStore(env.DB);
    this.parties = new PartyStore(env.DB, this.rules);
    this.economy = new Economy(env.DB, this.rules);
    this.characters = new CharacterStore(env.DB, this.rules, this.content);
    this.journal = new JournalStore(env.DB, this.rules, this.content);
    const towns = [...this.maps.values()].filter((m) => m.kind === "town").map((m) => m.id);
    this.secrets = new SecretProgressStore(env.DB, this.rules, { species: this.content.species, equipment: this.content.equipment, rewards: exampleSecretRewardRegistry() }, towns);
  }

  /** Rebuild the channel from live sockets (after hibernation) or create it on first join. */
  private ensureChannel(mapId: string, channel: number): MapChannel {
    if (this.channel !== null) return this.channel;
    const map = this.maps.get(mapId);
    if (map === undefined) throw new Error(`unknown map ${mapId}`);
    const restored = this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment() as Attachment | null)
      .filter((a): a is Attachment => a !== null)
      .map((a) => a.presence);
    this.channel = new MapChannel(this.rules, map, channel, restored);
    return this.channel;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const accountId = request.headers.get("x-account");
    const mapId = request.headers.get("x-map");
    const channelNo = Number(request.headers.get("x-channel"));
    const name = decodeURIComponent(request.headers.get("x-name") ?? "%3F");
    if (accountId === null || mapId === null || !Number.isInteger(channelNo)) return new Response("bad request", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Same account live on another channel of this map: stop that connection first. It saves its
    // live position under its own generation, so the claim below starts from where they stand.
    const where = await this.store.where(accountId);
    if (where !== null && where.mapId === mapId && where.channel !== channelNo) {
      const other = this.env.MAP.get(this.env.MAP.idFromName(mapObjectName(where.mapId, where.channel)));
      await other.evict(accountId).catch(() => undefined);
    }

    const claim = await this.store.claim(accountId, mapId, channelNo);
    if (claim.status !== "joined") {
      // Not allowed here: tell the client where to go (or why not) and close. Never place them.
      server.accept();
      const msg: WorldServerMessage =
        claim.status === "wrong_map"
          ? { t: "transfer", mapId: claim.mapId, channel: claim.channel }
          : { t: "error", code: claim.status === "no_account" ? "NO_ACCOUNT" : "SESSION_REPLACED", message: claim.status };
      server.send(JSON.stringify(msg));
      server.close(1000, claim.status);
      return new Response(null, { status: 101, webSocket: client });
    }

    await this.journal.recordMap(accountId, mapId);
    const channel = this.ensureChannel(mapId, channelNo);
    const joined = channel.join(accountId, name, claim.pos, Date.now());
    if (!joined.ok) {
      server.accept();
      server.send(JSON.stringify({ t: "error", code: joined.code, message: joined.message } satisfies WorldServerMessage));
      server.close(1000, joined.code);
      return new Response(null, { status: 101, webSocket: client });
    }
    // Same channel reconnect: the old socket is replaced, not duplicated.
    for (const old of this.ctx.getWebSockets(accountId)) {
      // A new connection starts without Auto Hunt; the old one's autopilot stops with it.
      if ((old.deserializeAttachment() as Attachment | null)?.auto) await this.stopAuto(old, "DISCONNECTED");
      old.serializeAttachment(null);
      safeSend(old, { t: "kicked", reason: "REPLACED" });
      old.close(4001, "replaced");
    }
    this.ctx.acceptWebSocket(server, [accountId]);
    const attachment: Attachment = { mapId, channel: channelNo, generation: claim.generation, presence: joined.presence };
    server.serializeAttachment(attachment);
    this.deliver(accountId, joined.out);
    // Reconnecting in the middle of a fight puts the player straight back into it.
    const open = await this.encounters.openBattle(accountId);
    if (open !== null && (await this.battleStatus(accountId, open)) === "active") {
      this.setBattle(server, attachment, open);
      safeSend(server, { t: "encounter", battleId: open, resumed: true });
    }
    // Towns are rest points: HP/MP come back for free (chapter 03 §3), never during a fight.
    if (this.maps.get(mapId)?.kind === "town" && (await this.characters.rest(accountId))) safeSend(server, { t: "rested" });
    await this.sendPacks(accountId, mapId, channelNo);
    await this.ensureSaveAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a === null) return;
    const channel = this.ensureChannel(a.mapId, a.channel);
    const text = typeof message === "string" ? message : "";
    let raw: unknown = undefined;
    if (text.length <= MAX_MESSAGE_BYTES) {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = undefined;
      }
    }
    // Walking by hand takes over from Auto Hunt.
    if (a.auto && (raw as { t?: unknown } | undefined)?.t === "step") await this.stopAuto(ws, "PLAYER_STOPPED");
    const r = channel.handle(a.presence.accountId, raw, Date.now());
    if (r.kind === "intent") {
      const account = a.presence.accountId;
      // Stop always goes through, even while a fight is being started for this player.
      if (r.msg.t === "autoStop") return void (await this.stopAuto(ws, "PLAYER_STOPPED"));
      if (this.busy.has(account)) return;
      this.busy.add(account);
      try {
        if (r.msg.t === "engage") await this.engage(ws, this.att(ws) ?? a, r.msg.packId);
        else if (r.msg.t === "resume") await this.resume(ws, this.att(ws) ?? a);
        else await this.startAuto(ws, r.msg.settings);
      } finally {
        this.busy.delete(account);
      }
      return;
    }
    if (r.kind === "moved") ws.serializeAttachment({ ...(this.att(ws) ?? a), presence: r.presence } satisfies Attachment);
    this.deliver(a.presence.accountId, r.out);
    if (r.kind === "moved" && r.portal !== null) {
      const to = r.portal.to;
      // Destination channel number: keep the same number (channels are per-map; P11 prototype).
      const ok = await this.store.moveTo(a.presence.accountId, a.generation, a.mapId, to, a.channel);
      // Explore secret quests: a walk into a map counts (once per map per window; never blocks travel).
      if (ok) await this.secrets.creditVisit(a.presence.accountId, to.mapId).catch(() => undefined);
      ws.serializeAttachment(null);
      this.deliver(a.presence.accountId, channel.leave(a.presence.accountId).out);
      safeSend(ws, ok ? { t: "transfer", mapId: to.mapId, channel: a.channel } : { t: "kicked", reason: "REPLACED" });
      ws.close(1000, ok ? "transfer" : "replaced");
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.drop(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.drop(ws);
  }

  /** Another channel of this map is taking over the account (channel switch). */
  async evict(accountId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(accountId)) {
      const a = ws.deserializeAttachment() as Attachment | null;
      ws.serializeAttachment(null);
      if (a !== null) {
        const left = this.ensureChannel(a.mapId, a.channel).leave(accountId);
        this.deliver(accountId, left.out);
        const p = left.presence ?? a.presence;
        await this.store.save(accountId, a.generation, a.mapId, p.pos);
      }
      safeSend(ws, { t: "kicked", reason: "EVICTED" });
      ws.close(4002, "evicted");
    }
  }

  // ---------------------------------------------------------------- encounters

  /** This cycle's packs: loaded from storage if already rolled, else rolled once and stored. */
  private async currentPacks(map: MapDefinition, channel: number): Promise<PackInstance[]> {
    if (!huntingAllowed(map) || map.spawns.length === 0) return [];
    const cycle = packCycle(this.rules, Date.now());
    if (this.packs?.cycle === cycle) return this.packs.list;
    const key = `packs:${cycle}`;
    let list = await this.ctx.storage.get<PackInstance[]>(key);
    if (list === undefined) {
      // Server RNG, fresh per cycle; the roster is stored before anyone can see or fight it.
      const rng = new Rng(seedRng(crypto.randomUUID()));
      list = map.spawns.map((sp) => rollPack(sp, packInstanceId(map.id, channel, sp.id, cycle), rng, { rules: this.rules, species: this.content.species }));
      const old = await this.ctx.storage.list({ prefix: "packs:" });
      await this.ctx.storage.delete([...old.keys()]);
      await this.ctx.storage.put(key, list);
    }
    this.packs = { cycle, list };
    return list;
  }

  /** Send one player the packs they can engage (ones they already fought are left out). */
  private async sendPacks(accountId: string, mapId: string, channel: number): Promise<void> {
    const map = this.maps.get(mapId)!;
    const list = await this.currentPacks(map, channel);
    const fought = await this.encounters.fought(accountId, list.map((p) => p.packId));
    const packs = list.filter((p) => !fought.has(p.packId)).map((p) => visiblePack(p, this.content.species));
    // The map's boss is always there to challenge again (P17: no quota).
    const boss = visibleBoss(map, this.content.bosses, this.content.species);
    if (boss !== null) packs.push(boss);
    this.deliver(accountId, [{ to: "self", msg: { t: "packs", packs } }]);
  }

  /**
   * Start a private fight against a pack. `origin` is fixed here for the whole fight (chapter 08).
   * Returns null when the fight exists, else the refusal (sent to the player unless `quiet`).
   */
  private async engage(ws: WebSocket, a: Attachment, packId: string, origin: OriginMode = "manual", quiet = false): Promise<WorldErrorCode | null> {
    const account = a.presence.accountId;
    const presence = this.ensureChannel(a.mapId, a.channel).get(account);
    const map = this.maps.get(a.mapId)!;
    const fail = (code: WorldErrorCode, message: string): WorldErrorCode => {
      if (!quiet) safeSend(ws, { t: "error", code, message });
      return code;
    };
    if (presence === undefined) return fail("NOT_JOINED", "join first");
    if (!huntingAllowed(map)) return fail("NO_HUNT_HERE", "no hunting in towns");
    if (presence.battleId !== null) {
      safeSend(ws, { t: "encounter", battleId: presence.battleId, resumed: true });
      return null;
    }
    const loadout = await this.characters.loadout(account);
    if (loadout === null) return fail("NO_CHARACTER", "create a character first");
    const { character, instances, worn, equipmentIds } = loadout;
    // HP/MP carry over; a team that is all knocked out has to rest before the next fight.
    const alive = (hp: number | null) => hp === null || hp > 0;
    if (!alive(character.hp) && ![...instances.values()].some((i) => alive(i.hp))) return fail("NEED_REST", "everyone is knocked out; rest in town");
    // A boss lair (chapter 07 §5): started by hand only, every try a new private fight.
    const lair = packId === bossLairId(map.id) ? visibleBoss(map, this.content.bosses, this.content.species) : null;
    let pack: PackInstance | undefined;
    let claimKey = packId;
    let members: PackMember[];
    if (lair !== null) {
      if (origin !== "manual") return fail("NO_SUCH_PACK", "bosses are started by hand (C14)");
      if (!inEngageRange(this.rules, presence.pos, lair)) return fail("TOO_FAR", "walk next to the boss first");
      claimKey = bossAttemptId(map.id, await this.encounters.bossAttempt(account, packId));
      members = [{ speciesId: lair.leader.speciesId, element: lair.leader.element }];
    } else {
      pack = (await this.currentPacks(map, a.channel)).find((p) => p.packId === packId);
      if (pack === undefined) return fail("NO_SUCH_PACK", "that pack is gone; a new one appears next cycle");
      if (!inEngageRange(this.rules, presence.pos, pack.at)) return fail("TOO_FAR", "walk next to the pack first");
      if ((await this.encounters.fought(account, [packId])).has(packId)) return fail("NO_SUCH_PACK", "you already fought this pack");
      members = pack.members;
    }

    const { battleId, roster } = await this.encounters.claim(account, claimKey, members);
    const reservationId = `res:${battleId}`;
    // A retry after a crash reuses the bag already reserved; otherwise reserve a fresh default bag.
    const prior = await this.economy.reservedBag(reservationId);
    // A released reservation means this fight was cancelled before it started; the pack stays
    // hidden for this player until the next cycle (fought() counts it), never a second free start.
    if (prior !== null && prior.status !== "reserved" && prior.status !== "active") return fail("NO_SUCH_PACK", "that fight is over");
    let bag = prior?.bag;
    if (bag === undefined) {
      const kind = (id: string) => this.content.items.get(id)?.kind;
      bag = defaultCombatBag(this.rules, await this.economy.balances(account), kind);
      const reserved = await this.economy.reserve({
        reservationId,
        accountId: account,
        battleId,
        bag,
        companionIds: character.team.map((t) => t.instanceId),
        characterId: character.id,
        equipmentIds,
      });
      if (reserved.status === "rejected") {
        if (reserved.reason === "BATTLE_IN_PROGRESS") return fail("IN_BATTLE", "finish your other fight first");
        return fail("ENCOUNTER_REFUSED", reserved.reason);
      }
    }
    const setup: BattleSetup = {
      battleId,
      originMode: origin,
      seed: crypto.randomUUID(),
      player: playerSetup(account, character, worn),
      companions: companionSetups(character.team, instances),
      enemies: pack === undefined ? [] : packEnemies({ ...pack, members: roster }),
      ...(lair !== null ? { boss: { bossId: lair.bossId! } } : {}),
      bag,
      partyBonus: await this.partyBonusFor(account, a.mapId, a.channel),
      mapId: a.mapId,
    };
    const created = (await this.battle(battleId).handle(account, { kind: "create", setup, reservationId })) as RoomReply;
    if (!created.ok) return fail("ENCOUNTER_REFUSED", created.code);
    // Journal (chapter 09): every species met in this fight, boss adds included.
    const adds = lair === null ? [] : (this.content.bosses.get(lair.bossId!)?.adds ?? []);
    await this.journal.recordSeen(account, [...roster, ...adds]);

    this.setBattle(ws, this.att(ws) ?? a, battleId);
    await this.store.save(account, a.generation, a.mapId, presence.pos);
    safeSend(ws, { t: "encounter", battleId, resumed: false });
    await this.sendPacks(account, a.mapId, a.channel);
    return null;
  }

  /** Back from a fight: only once the Battle DO says it is over and D1 has the settlement. */
  private async resume(ws: WebSocket, a: Attachment): Promise<"active" | "settling" | "defeated" | "done"> {
    const account = a.presence.accountId;
    const presence = this.ensureChannel(a.mapId, a.channel).get(account);
    if (presence === undefined) return "done";
    if (presence.battleId !== null) {
      if ((await this.battleStatus(account, presence.battleId)) === "active") {
        safeSend(ws, { t: "error", code: "IN_BATTLE", message: "the fight is still going" });
        safeSend(ws, { t: "encounter", battleId: presence.battleId, resumed: true });
        return "active";
      }
      // Rewards and HP land in D1 before the player walks on: wait briefly for the settlement
      // (each view nudges the Battle DO's outbox), else ask the client to try again.
      const rid = `res:${presence.battleId}`;
      let r = await this.economy.reservation(rid);
      for (let i = 0; i < 10 && r?.status === "active"; i++) {
        await new Promise((done) => setTimeout(done, 200));
        await this.battleStatus(account, presence.battleId);
        r = await this.economy.reservation(rid);
      }
      if (r?.status === "active") {
        safeSend(ws, { t: "error", code: "SETTLING", message: "recording the fight; try again" });
        return "settling";
      }
      this.setBattle(ws, this.att(ws) ?? a, null);
      if (r?.outcome === "defeat") {
        if (this.att(ws)?.auto) await this.stopAuto(ws, "DEFEATED");
        // A wiped team goes back to the rest point (chapter 03 §3); arriving in town restores it.
        const town = this.maps.get(EXAMPLE_START_MAP)!;
        const ok = await this.store.moveTo(account, a.generation, a.mapId, { mapId: town.id, x: town.spawn.x, y: town.spawn.y }, a.channel);
        ws.serializeAttachment(null);
        this.deliver(account, this.ensureChannel(a.mapId, a.channel).leave(account).out);
        safeSend(ws, { t: "resumed" });
        safeSend(ws, ok ? { t: "transfer", mapId: town.id, channel: a.channel } : { t: "kicked", reason: "REPLACED" });
        ws.close(1000, ok ? "transfer" : "replaced");
        return "defeated";
      }
    }
    safeSend(ws, { t: "resumed" });
    await this.sendPacks(account, a.mapId, a.channel);
    return "done";
  }

  /**
   * Party bonus for a fight starting now (P02): partners on this map and channel (this object)
   * who started a fight within the activity window. Locked into the fight's setup.
   */
  private async partyBonusFor(account: string, mapId: string, channel: number): Promise<PartyBonus> {
    const here = this.ensureChannel(mapId, channel);
    const partners = (await this.parties.partners(account)).filter((id) => here.get(id) !== undefined);
    if (partners.length === 0) return NO_PARTY_BONUS;
    const since = new Date(Date.now() - this.rules.provisional.partyActivityWindowMs.value).toISOString();
    return partyBonus(this.rules, (await this.parties.recentlyFought(partners, since)).size);
  }

  // ---------------------------------------------------------------- Auto Hunt (C14, chapter 08)

  private att(ws: WebSocket): Attachment | null {
    return ws.deserializeAttachment() as Attachment | null;
  }

  private setAuto(ws: WebSocket, auto: AutoState | null): void {
    const a = this.att(ws);
    if (a !== null) ws.serializeAttachment({ ...a, auto } satisfies Attachment);
  }

  private async startAuto(ws: WebSocket, settings: AutoHuntSettings): Promise<void> {
    const a = this.att(ws);
    if (a === null) return;
    const map = this.maps.get(a.mapId)!;
    const refuse = (reason: AutoStopReason) => safeSend(ws, { t: "auto", on: false, reason });
    if (!huntingAllowed(map)) return refuse("NO_HUNT_HERE");
    if (!mapHasTargets(settings, map)) return refuse("NO_TARGETS");
    if ((await this.characters.loadout(a.presence.accountId)) === null) return refuse("NO_CHARACTER");
    this.routes.delete(a.presence.accountId);
    this.setAuto(ws, { settings, checked: false, endedAt: null, piloting: null });
    // The run's totals live in storage, not the attachment (attachments are small).
    await this.ctx.storage.put(huntKey(a.presence.accountId), newHuntSummary(Date.now()));
    safeSend(ws, { t: "auto", on: true });
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** Auto Hunt off; a fight in progress stays as it is and goes back to the player's hands. */
  private async stopAuto(ws: WebSocket, reason: AutoStopReason, extra: { detail?: string; packId?: string } = {}): Promise<void> {
    const a = this.att(ws);
    if (a === null || !a.auto) return;
    this.setAuto(ws, null);
    this.routes.delete(a.presence.accountId);
    const key = huntKey(a.presence.accountId);
    const summary = await this.ctx.storage.get<HuntSummary>(key);
    await this.ctx.storage.delete(key);
    safeSend(ws, { t: "auto", on: false, reason, ...extra, ...(summary === undefined ? {} : { summary: { ...summary, endedAt: Date.now() } }) });
    const battleId = this.ensureChannel(a.mapId, a.channel).get(a.presence.accountId)?.battleId ?? null;
    if (battleId !== null) await this.battle(battleId).handle(a.presence.accountId, { kind: "autopilot", on: false }).catch(() => undefined);
  }

  /** Add a finished fight to this run's summary (chapter 08); a fight already counted is skipped. */
  private async countHuntFight(account: string, battleId: string): Promise<void> {
    const key = huntKey(account);
    const sum = await this.ctx.storage.get<HuntSummary>(key);
    if (sum === undefined) return;
    const r = (await this.battle(battleId).handle(account, { kind: "view" })) as RoomReply;
    if (!r.ok) return;
    const state = (r.body as { state: PublicBattleState }).state;
    const tables = this.content.lootTables;
    const isRare = (speciesId: string, itemId: string) => {
      const table = tables.get(this.content.species.get(speciesId)?.lootTableId ?? "");
      return isRareDrop(this.rules, table, itemId);
    };
    const next = addFightToSummary(sum, state, this.content.items, isRare);
    if (next !== sum) await this.ctx.storage.put(key, next);
  }

  /** One Auto Hunt step for one connected player: watch the fight, check the team, walk, engage. */
  private async autoTick(ws: WebSocket): Promise<void> {
    const a = this.att(ws);
    if (a === null || !a.auto) return;
    const auto = a.auto;
    const account = a.presence.accountId;
    const channel = this.ensureChannel(a.mapId, a.channel);
    const presence = channel.get(account);
    if (presence === undefined) return;
    const map = this.maps.get(a.mapId)!;
    const now = Date.now();

    if (presence.battleId !== null) {
      const status = await this.battleStatus(account, presence.battleId);
      if (status === "active") {
        if (auto.piloting !== presence.battleId) {
          await this.battle(presence.battleId).handle(account, { kind: "autopilot", on: true, policy: { itemRules: auto.settings.itemRules, skills: auto.settings.skills } });
          this.setAuto(ws, { ...auto, piloting: presence.battleId });
        }
        return;
      }
      // Over: leave the result on screen briefly, then walk on (the same checks as a manual resume).
      if (auto.endedAt === null) {
        this.setAuto(ws, { ...auto, endedAt: now });
        return this.countHuntFight(account, presence.battleId);
      }
      if (now - auto.endedAt < this.rules.provisional.autoHuntResultPauseMs.value) return;
      const r = await this.resume(ws, a);
      if (r === "done") this.setAuto(ws, { ...auto, endedAt: null, checked: false, piloting: null });
      return;
    }

    if (!auto.checked) {
      const loadout = await this.characters.loadout(account);
      if (loadout === null) return this.stopAuto(ws, "NO_CHARACTER");
      const { character, instances, worn } = loadout;
      const vital = (s: { maxHp: number; maxMp: number }, hp: number | null, mp: number | null) => ({ hp: hp ?? s.maxHp, maxHp: s.maxHp, mp: mp ?? s.maxMp, maxMp: s.maxMp });
      const owned = auto.settings.itemRules.length > 0 ? await this.economy.balances(account) : {};
      const verdict = autoHuntReadiness(
        auto.settings,
        vital(deriveStats(character.level, character.primaryStats, gearBonuses(worn.defs, worn.affixes)), character.hp, character.mp),
        [...instances.values()].map((i) => {
          const prof = companionCombatProfile(this.rules, this.content.species.get(i.speciesId)!, i, character.level);
          return vital(deriveStats(prof.level, prof.primaryStats), i.hp, i.mp);
        }),
        owned,
      );
      if (verdict !== null) return this.stopAuto(ws, verdict.stop, verdict.detail === undefined ? {} : { detail: verdict.detail });
      this.setAuto(ws, { ...auto, checked: true });
    }

    const live = await this.currentPacks(map, a.channel);
    let route = this.routes.get(account);
    if (route !== undefined && !live.some((p) => p.packId === route!.packId)) route = undefined;
    if (route === undefined) {
      const fought = await this.encounters.fought(account, live.map((p) => p.packId));
      const visible = live.filter((p) => !fought.has(p.packId)).map((p) => visiblePack(p, this.content.species));
      const found = stopSpeciesPack(auto.settings, visible);
      if (found !== null) return this.stopAuto(ws, "FOUND_SPECIES", { detail: found.leader.speciesId, packId: found.packId });
      const plan = planAutoHunt(this.rules, map, presence.pos, visible, auto.settings);
      if (plan.kind === "wait") return;
      if (plan.kind === "unreachable") return this.stopAuto(ws, "NO_TARGETS");
      route = { packId: plan.packId, path: plan.kind === "walk" ? plan.path : [] };
      this.routes.set(account, route);
    }

    if (route.path.length === 0) {
      this.routes.delete(account);
      const code = await this.engage(ws, a, route.packId, "auto_hunt", true);
      if (code === null || code === "NO_SUCH_PACK" || code === "TOO_FAR") return; // fight on, or re-plan next tick
      if (code === "NEED_REST") return this.stopAuto(ws, "NEED_REST");
      if (code === "NO_CHARACTER") return this.stopAuto(ws, "NO_CHARACTER");
      return this.stopAuto(ws, "REFUSED", { detail: code });
    }
    const step = channel.autoStep(account, route.path[0]!, now);
    if (step.kind !== "moved") {
      // Too early is a wait; anything else means the route is stale.
      if (presence.readyAt - this.rules.provisional.moveBurstMs.value <= now) this.routes.delete(account);
      return;
    }
    route.path.shift();
    ws.serializeAttachment({ ...(this.att(ws) ?? a), presence: step.presence } satisfies Attachment);
    this.deliver(account, step.out);
  }

  private setBattle(ws: WebSocket, a: Attachment, battleId: string | null): void {
    const p = this.ensureChannel(a.mapId, a.channel).setBattle(a.presence.accountId, battleId) ?? { ...a.presence, battleId };
    ws.serializeAttachment({ ...a, presence: p } satisfies Attachment);
  }

  private battle(battleId: string) {
    return this.env.BATTLE.get(this.env.BATTLE.idFromName(battleId));
  }

  /** The fight's real status from its Battle DO; the client's word is never taken for it. */
  private async battleStatus(accountId: string, battleId: string): Promise<PublicBattleState["status"] | "missing"> {
    const r = (await this.battle(battleId).handle(accountId, { kind: "view" })) as RoomReply;
    return r.ok ? (r.body as { state: PublicBattleState }).state.status : "missing";
  }

  /**
   * Periodic position save for players who moved (P11 positionSaveIntervalMs); new packs each cycle;
   * and the Auto Hunt loop, one step per walk-step interval while anyone here is auto hunting.
   */
  override async alarm(): Promise<void> {
    const cycleBefore = this.packs?.cycle ?? null;
    const now = Date.now();
    if (now - this.lastSaveAt >= this.rules.provisional.positionSaveIntervalMs.value) {
      this.lastSaveAt = now;
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (a === null || !a.presence.dirty) continue;
        const live = this.channel?.get(a.presence.accountId) ?? a.presence;
        await this.store.save(live.accountId, a.generation, a.mapId, live.pos);
        live.dirty = false;
        ws.serializeAttachment({ ...a, presence: live } satisfies Attachment);
      }
    }
    let hunting = false;
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (!a?.auto) continue;
      hunting = true;
      const account = a.presence.accountId;
      if (this.busy.has(account)) continue;
      this.busy.add(account);
      try {
        this.ensureChannel(a.mapId, a.channel);
        await this.autoTick(ws);
      } catch {
        // A failed tick (D1 or Battle DO busy) just tries again next tick.
      } finally {
        this.busy.delete(account);
      }
    }
    // A new respawn cycle: everyone gets the new packs (including ones they fought last cycle).
    const sockets = this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Attachment | null).filter((x): x is Attachment => x !== null);
    const first = sockets[0];
    if (first !== undefined && cycleBefore !== packCycle(this.rules, Date.now())) {
      for (const s of sockets) await this.sendPacks(s.presence.accountId, s.mapId, s.channel);
    }
    if (hunting) await this.ctx.storage.setAlarm(Date.now() + this.rules.provisional.walkStepMs.value);
    else await this.ensureSaveAlarm();
  }

  private async drop(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a === null) return; // replaced, evicted or transferred: already handled
    // No offline farming (C14): a closed connection stops Auto Hunt and its fight's autopilot at
    // once (the grace period is O11, not decided); the fight waits for the player to come back.
    if (a.auto) await this.stopAuto(ws, "DISCONNECTED");
    ws.serializeAttachment(null);
    const channel = this.ensureChannel(a.mapId, a.channel);
    const left = channel.leave(a.presence.accountId);
    this.deliver(a.presence.accountId, left.out);
    const p = left.presence ?? a.presence;
    await this.store.save(p.accountId, a.generation, a.mapId, p.pos);
  }

  private async ensureSaveAlarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) return;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + this.rules.provisional.positionSaveIntervalMs.value);
    }
  }

  private deliver(accountId: string, out: Outgoing[]): void {
    for (const o of out) {
      const targets =
        o.to === "self"
          ? this.ctx.getWebSockets(accountId)
          : this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.presence.accountId !== accountId);
      for (const ws of targets) {
        if (ws.deserializeAttachment() === null) continue;
        safeSend(ws, o.msg);
      }
    }
  }
}

function safeSend(ws: WebSocket, msg: WorldServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket already closing; its close handler cleans up.
  }
}
