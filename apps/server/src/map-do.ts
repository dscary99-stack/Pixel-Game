/**
 * Map Channel Durable Object: one object per map + channel (chapter 11 §1). Holds live presence,
 * validates every step, broadcasts what changed, and saves positions to D1.
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
  exampleMapRegistry,
  type Outgoing,
  type Presence,
  type RulesConfig,
  type WorldServerMessage,
} from "@pmrpg/shared";
import type { Env } from "./battle-do";
import { WorldStore } from "./world-store";

/** What each hibernatable socket remembers. */
interface Attachment {
  mapId: string;
  channel: number;
  generation: number;
  presence: Presence;
}

const MAX_MESSAGE_BYTES = 256;
export const mapObjectName = (mapId: string, channel: number) => `${mapId}#${channel}`;

export class MapChannelDurableObject extends DurableObject<Env> {
  private readonly rules: RulesConfig;
  private readonly maps = exampleMapRegistry();
  private readonly store: WorldStore;
  private channel: MapChannel | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.rules = env.ENVIRONMENT === "dev" ? DEV_FIXTURE_RULES : PRODUCTION_RULES;
    // Phase B ships EXAMPLE maps only; a versioned content bundle replaces this later.
    this.store = new WorldStore(env.DB, this.maps, EXAMPLE_START_MAP);
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
    const name = request.headers.get("x-name") ?? "?";
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
      old.serializeAttachment(null);
      safeSend(old, { t: "kicked", reason: "REPLACED" });
      old.close(4001, "replaced");
    }
    this.ctx.acceptWebSocket(server, [accountId]);
    server.serializeAttachment({ mapId, channel: channelNo, generation: claim.generation, presence: joined.presence } satisfies Attachment);
    this.deliver(accountId, joined.out);
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
    const r = channel.handle(a.presence.accountId, raw, Date.now());
    if (r.kind === "moved") ws.serializeAttachment({ ...a, presence: r.presence } satisfies Attachment);
    this.deliver(a.presence.accountId, r.out);
    if (r.kind === "moved" && r.portal !== null) {
      const to = r.portal.to;
      // Destination channel number: keep the same number (channels are per-map; P11 prototype).
      const ok = await this.store.moveTo(a.presence.accountId, a.generation, a.mapId, to, a.channel);
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

  /** Periodic position save for players who moved (P11 positionSaveIntervalMs). */
  override async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a === null || !a.presence.dirty) continue;
      const live = this.channel?.get(a.presence.accountId) ?? a.presence;
      await this.store.save(live.accountId, a.generation, a.mapId, live.pos);
      live.dirty = false;
      ws.serializeAttachment({ ...a, presence: live } satisfies Attachment);
    }
    await this.ensureSaveAlarm();
  }

  private async drop(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a === null) return; // replaced, evicted or transferred: already handled
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
