/**
 * How the world scene talks to a Map Channel. The scene sends step intents and draws what comes back.
 *
 * - ServerWorldTransport: WebSocket to the Worker + Map Channel Durable Object (authoritative).
 * - LocalWorldTransport: runs the shared MapChannel in the browser so the scene can be developed
 *   without a server. NOT authoritative; nothing it says is saved.
 */
import {
  DEV_FIXTURE_RULES,
  EXAMPLE_START_MAP,
  MapChannel,
  exampleMapRegistry,
  type Direction,
  type WorldClientMessage,
  type WorldServerMessage,
} from "@pmrpg/shared";

export interface WorldTransport {
  readonly label: string;
  /** Connect to a map/channel; `onMessage` receives every server message until `close()`. */
  connect(mapId: string | null, channel: number | null, onMessage: (m: WorldServerMessage) => void, onClose: (reason: string) => void): Promise<void>;
  step(seq: number, dir: Direction): void;
  close(): void;
}

export class ServerWorldTransport implements WorldTransport {
  readonly label: string;
  private ws: WebSocket | null = null;

  constructor(
    private readonly base: string,
    private readonly devAccount: string,
  ) {
    this.label = `SERVER · ${devAccount}`;
  }

  async connect(mapId: string | null, channel: number | null, onMessage: (m: WorldServerMessage) => void, onClose: (reason: string) => void) {
    this.close();
    const q = `dev_account=${encodeURIComponent(this.devAccount)}`;
    if (mapId === null || channel === null) {
      const where = (await (await fetch(`${this.base}/world/where?${q}`)).json()) as { mapId: string; channel: number };
      mapId = where.mapId;
      channel = channel ?? where.channel;
    }
    const http = this.base === "" ? location.origin : this.base;
    const url = `${http.replace(/^http/, "ws")}/world/${mapId}/${channel}?${q}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    // Messages from a socket we already replaced (channel switch) are ignored.
    ws.onmessage = (e) => {
      if (this.ws === ws) onMessage(JSON.parse(String(e.data)) as WorldServerMessage);
    };
    ws.onclose = (e) => {
      if (this.ws === ws) this.ws = null;
      onClose(e.reason || String(e.code));
    };
  }

  step(seq: number, dir: Direction) {
    this.send({ t: "step", seq, dir });
  }

  private send(m: WorldClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "client");
  }
}

export class LocalWorldTransport implements WorldTransport {
  readonly label = "LOCAL PREVIEW · ไม่บันทึก ไม่ใช่ผลจาก server";
  private readonly maps = exampleMapRegistry();
  private channel: MapChannel | null = null;
  private onMessage: (m: WorldServerMessage) => void = () => undefined;
  private onClose: (reason: string) => void = () => undefined;
  private pos: { x: number; y: number } | null = null;
  private wander: ReturnType<typeof setInterval> | null = null;

  async connect(mapId: string | null, channel: number | null, onMessage: (m: WorldServerMessage) => void, onClose: (reason: string) => void) {
    this.close();
    this.onMessage = onMessage;
    this.onClose = onClose;
    const map = this.maps.get(mapId ?? EXAMPLE_START_MAP)!;
    this.channel = new MapChannel(DEV_FIXTURE_RULES, map, channel ?? 1);
    // A wandering stand-in so the preview shows "another player". Not a real player.
    this.channel.join("npc", "ตัวอย่าง", map.spawn, Date.now());
    const joined = this.channel.join("me", "ฉัน", this.pos ?? map.spawn, Date.now());
    this.pos = null;
    if (joined.ok) joined.out.filter((o) => o.to === "self").forEach((o) => queueMicrotask(() => this.onMessage(o.msg)));
    let seq = 0;
    const dirs: Direction[] = ["E", "E", "W", "W", "N", "S"];
    this.wander = setInterval(() => {
      const r = this.channel?.handle("npc", { t: "step", seq: ++seq, dir: dirs[seq % dirs.length]! }, Date.now());
      r?.out.filter((o) => o.to === "others").forEach((o) => this.onMessage(o.msg));
    }, 600);
  }

  step(seq: number, dir: Direction) {
    const ch = this.channel;
    if (ch === null) return;
    const r = ch.handle("me", { t: "step", seq, dir }, Date.now());
    r.out.filter((o) => o.to === "self").forEach((o) => queueMicrotask(() => this.onMessage(o.msg)));
    if (r.kind === "moved" && r.portal !== null) {
      const to = r.portal.to;
      this.pos = { x: to.x, y: to.y };
      queueMicrotask(() => this.onMessage({ t: "transfer", mapId: to.mapId, channel: ch.channel }));
      queueMicrotask(() => this.onClose("transfer"));
    }
  }

  close() {
    if (this.wander !== null) clearInterval(this.wander);
    this.wander = null;
    this.channel = null;
  }
}
