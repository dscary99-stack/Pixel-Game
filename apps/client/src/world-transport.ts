/**
 * How the world scene talks to a Map Channel. The scene sends step intents and draws what comes back.
 *
 * - ServerWorldTransport: WebSocket to the Worker + Map Channel Durable Object (authoritative).
 * - LocalWorldTransport: runs the shared MapChannel in the browser so the scene can be developed
 *   without a server. NOT authoritative; nothing it says is saved.
 */
import { authHeaders, identityLabel, socketQuery, type Identity } from "./identity";
import {
  DEV_FIXTURE_RULES,
  EXAMPLE_START_MAP,
  MapChannel,
  Rng,
  devPlayer,
  exampleContentMaps,
  exampleMapRegistry,
  inEngageRange,
  packCycle,
  packEnemies,
  packInstanceId,
  rollPack,
  seedRng,
  visiblePack,
  type AutoHuntSettings,
  type Direction,
  type PackInstance,
  type WorldClientMessage,
  type WorldServerMessage,
} from "@pmrpg/shared";
import { HttpTransport, LocalPreviewTransport, type BattleTransport } from "./transport";

export interface WorldTransport {
  readonly label: string;
  /** Connect to a map/channel; `onMessage` receives every server message until `close()`. */
  connect(mapId: string | null, channel: number | null, onMessage: (m: WorldServerMessage) => void, onClose: (reason: string) => void): Promise<void>;
  step(seq: number, dir: Direction): void;
  /** Ask for a private fight with a visible pack (O05). The answer is an `encounter` or an `error`. */
  engage(packId: string): void;
  /** Back from a fight: the server checks the fight really ended before letting the player walk. */
  resume(): void;
  /** Start Auto Hunt (C14): the server walks and fights until it says `auto` off. */
  autoHunt(settings: AutoHuntSettings): void;
  autoStop(): void;
  /** How the battle scene talks to the fight the server just started. */
  battle(battleId: string): BattleTransport;
  close(): void;
}

export class ServerWorldTransport implements WorldTransport {
  readonly label: string;
  private ws: WebSocket | null = null;

  constructor(
    private readonly base: string,
    private readonly identity: Identity,
  ) {
    this.label = `SERVER · ${identityLabel(identity)}`;
  }

  async connect(mapId: string | null, channel: number | null, onMessage: (m: WorldServerMessage) => void, onClose: (reason: string) => void) {
    this.close();
    const q = socketQuery(this.identity);
    if (mapId === null || channel === null) {
      const where = (await (await fetch(`${this.base}/world/where`, { headers: authHeaders(this.identity) })).json()) as { mapId: string; channel: number };
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

  engage(packId: string) {
    this.send({ t: "engage", packId });
  }

  resume() {
    this.send({ t: "resume" });
  }

  autoHunt(settings: AutoHuntSettings) {
    this.send({ t: "autoHunt", settings });
  }

  autoStop() {
    this.send({ t: "autoStop" });
  }

  battle(battleId: string): BattleTransport {
    return new HttpTransport(this.base, battleId, this.identity, true);
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
  private packs: PackInstance[] = [];
  private readonly fought = new Set<string>();
  private fight: { battleId: string; transport: LocalPreviewTransport } | null = null;
  private readonly content = exampleContentMaps();

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
    // Packs rolled in the browser: preview only, the real roll is on the server.
    const rng = new Rng(seedRng(crypto.randomUUID()));
    const cycle = packCycle(DEV_FIXTURE_RULES, Date.now());
    this.packs = map.spawns.map((sp) => rollPack(sp, packInstanceId(map.id, this.channel!.channel, sp.id, cycle), rng, { rules: DEV_FIXTURE_RULES, species: this.content.species }));
    queueMicrotask(() => this.sendPacks());
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

  engage(packId: string) {
    const me = this.channel?.get("me");
    const pack = this.packs.find((p) => p.packId === packId && !this.fought.has(p.packId));
    if (me === undefined) return;
    if (pack === undefined) return this.emit({ t: "error", code: "NO_SUCH_PACK", message: "that pack is gone" });
    if (!inEngageRange(DEV_FIXTURE_RULES, me.pos, pack.at)) return this.emit({ t: "error", code: "TOO_FAR", message: "walk next to the pack first" });
    const battleId = `battle:local_${crypto.randomUUID().slice(0, 8)}`;
    const transport = new LocalPreviewTransport({
      battleId,
      originMode: "manual",
      seed: battleId,
      player: devPlayer("acct:preview", "ฉัน"),
      companions: [],
      enemies: packEnemies(pack),
      bag: { "item:small_potion": 5, "item:phoenix_feather": 2, "item:ember_fox_capture": 3, "item:armor_crab_capture": 3, "item:lantern_snail_capture": 3 },
    });
    this.fought.add(pack.packId);
    this.fight = { battleId, transport };
    this.channel!.setBattle("me", battleId);
    this.emit({ t: "encounter", battleId, resumed: false });
  }

  resume() {
    this.fight = null;
    this.channel?.setBattle("me", null);
    this.emit({ t: "resumed" });
    this.sendPacks();
  }

  autoHunt() {
    // Auto Hunt is server-driven; the preview has no server.
    this.emit({ t: "auto", on: false, reason: "REFUSED", detail: "local preview" });
  }

  autoStop() {
    this.emit({ t: "auto", on: false, reason: "PLAYER_STOPPED" });
  }

  battle(battleId: string): BattleTransport {
    if (this.fight?.battleId !== battleId) throw new Error(`no local fight ${battleId}`);
    return this.fight.transport;
  }

  private sendPacks() {
    const packs = this.packs.filter((p) => !this.fought.has(p.packId)).map((p) => visiblePack(p, this.content.species));
    this.emit({ t: "packs", packs });
  }

  private emit(m: WorldServerMessage) {
    queueMicrotask(() => this.onMessage(m));
  }

  close() {
    if (this.wander !== null) clearInterval(this.wander);
    this.wander = null;
    this.channel = null;
  }
}
