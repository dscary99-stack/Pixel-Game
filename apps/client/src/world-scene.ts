/**
 * Walking scene for the Phase B slice. Placeholder shapes only; tiles, sprites, y-sorting and
 * occlusion come with the art proof (chapter 10). The client predicts its own step so walking
 * feels immediate, but the server decides: a `correct` message snaps the player back.
 */
import Phaser from "phaser";
import {
  DEV_FIXTURE_RULES,
  TILE_LEGEND,
  exampleContentMaps,
  exampleMapRegistry,
  findPath,
  inEngageRange,
  portalAt,
  stepCostMs,
  tryStep,
  type Direction,
  type MapDefinition,
  type PublicPlayer,
  type TileChar,
  type TilePos,
  type VisiblePack,
  type WorldServerMessage,
} from "@pmrpg/shared";
import { ELEMENT_COLOR } from "./battle-scene";
import type { CharacterApi, CharacterBundle } from "./character-api";
import { equipmentPanel, teamPanel, vitals } from "./character-ui";
import type { WorldTransport } from "./world-transport";

const W = 960;
const H = 540;
const rules = DEV_FIXTURE_RULES;
const TILE = rules.provisional.worldTileSizePx.value;

const TILE_COLOR: Record<(typeof TILE_LEGEND)[TileChar]["kind"], number> = {
  ground: 0x8a7650,
  grass: 0x5d9a4a,
  road: 0xc9b07a,
  wall: 0x4a4458,
  tree: 0x2f6a35,
  water: 0x3a74b8,
};

interface PlayerView {
  body: Phaser.GameObjects.Rectangle;
  nose: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  pos: TilePos;
}

interface PackView {
  pack: VisiblePack;
  objects: Phaser.GameObjects.GameObject[];
}

const FACE_OFFSET: Record<PublicPlayer["facing"], [number, number]> = { N: [0, -12], S: [0, 12], E: [10, 0], W: [-10, 0] };

export class WorldScene extends Phaser.Scene {
  private transport!: WorldTransport;
  /** Server mode only: the stored character (Phase D). Null in the local preview. */
  private api: CharacterApi | null = null;
  private bundle: CharacterBundle | null = null;
  private panelOpen = false;
  private readonly maps = exampleMapRegistry();
  private readonly species = exampleContentMaps().species;
  private packs = new Map<string, PackView>();
  /** Walking to this pack; engage once next to it. */
  private pendingEngage: string | null = null;
  /** A private fight is open; walking waits until the server says it is over. */
  private inBattle = false;
  private map: MapDefinition | null = null;
  private channelNo = 1;
  private layer: Phaser.GameObjects.Container | null = null;
  private players = new Map<string, PlayerView>();
  private selfSid: string | null = null;
  private seq = 0;
  private readyAt = 0;
  private path: Direction[] = [];
  private nextConnect: { mapId: string; channel: number } | null = null;
  private stopped = false;
  private hud!: Phaser.GameObjects.Text;
  private notice!: Phaser.GameObjects.Text;
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;

  constructor() {
    super("world");
  }

  init(data: { transport: WorldTransport; api: CharacterApi | null; bundle: CharacterBundle | null }) {
    this.transport = data.transport;
    this.api = data.api;
    this.bundle = data.bundle;
  }

  create() {
    this.cameras.main.setBackgroundColor("#14121c");
    const style = { fontFamily: "sans-serif", fontSize: "13px", color: "#ffffff", backgroundColor: "#00000099", padding: { x: 8, y: 6 } };
    this.add.text(8, 8, this.transport.label, { ...style, color: "#f2c94c" }).setScrollFactor(0).setDepth(100);
    this.hud = this.add.text(8, 40, "", style).setScrollFactor(0).setDepth(100);
    this.notice = this.add.text(W / 2, H - 40, "", { ...style, fontSize: "15px" }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
    this.add
      .text(W - 8, 8, `ลูกศร/WASD เดิน · คลิกเพื่อเดินไป · คลิกฝูงมอนสเตอร์เพื่อสู้ · 1/2 เปลี่ยน channel${this.api ? " · T ทีม · E อุปกรณ์" : ""}`, style)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D }) as typeof this.keys;
    kb.on("keydown-ONE", () => this.switchChannel(1));
    kb.on("keydown-TWO", () => this.switchChannel(2));
    kb.on("keydown-T", () => void this.openTeam());
    kb.on("keydown-E", () => void this.openEquipment());
    if (this.api !== null) {
      const button = (x: number, label: string, open: () => Promise<void>) =>
        this.add
          .text(x, 100, label, { ...style, backgroundColor: "#463f6b", padding: { x: 12, y: 10 } })
          .setScrollFactor(0)
          .setDepth(100)
          .setInteractive({ useHandCursor: true })
          .on("pointerdown", (_p: Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
            e.stopPropagation();
            void open();
          });
      const team = button(8, "ทีมคู่ใจ (T)", () => this.openTeam());
      button(team.x + team.width + 8, "อุปกรณ์ (E)", () => this.openEquipment());
    }
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.tapMove(p));

    void this.connect(null, null);
  }

  // ---------------------------------------------------------------- connection

  private async connect(mapId: string | null, channel: number | null) {
    this.path = [];
    this.nextConnect = null;
    await this.transport.connect(
      mapId,
      channel,
      (m) => this.onMessage(m),
      () => {
        if (this.nextConnect !== null) void this.connect(this.nextConnect.mapId, this.nextConnect.channel);
      },
    );
  }

  private switchChannel(n: number) {
    if (this.map === null || n === this.channelNo || this.stopped) return;
    // connect() closes the current socket first; its close event then finds nothing queued.
    void this.connect(this.map.id, n);
  }

  private onMessage(m: WorldServerMessage) {
    switch (m.t) {
      case "welcome":
        this.enterMap(m.mapId, m.channel, m.self, m.others);
        break;
      case "joined":
        this.addPlayer(m.player, false);
        break;
      case "left":
        this.removePlayer(m.sid);
        break;
      case "moved":
        this.movePlayer(m.sid, { x: m.x, y: m.y }, m.facing, true);
        break;
      case "ack":
        break;
      case "correct": {
        // Server decided otherwise: snap back and drop the queued path.
        this.path = [];
        if (this.selfSid !== null) this.movePlayer(this.selfSid, { x: m.x, y: m.y }, null, false);
        if (m.reason !== "STALE_SEQ") this.flash(`server ปฏิเสธการเดิน: ${m.reason}`);
        break;
      }
      case "transfer":
        this.nextConnect = { mapId: m.mapId, channel: m.channel };
        this.flash(`กำลังไป ${this.maps.get(m.mapId)?.name.th ?? m.mapId}…`);
        break;
      case "packs":
        this.showPacks(m.packs);
        break;
      case "encounter":
        this.startBattle(m.battleId, m.resumed);
        break;
      case "resumed":
        this.inBattle = false;
        this.flash("กลับมาที่เดิมแล้ว");
        void this.reloadCharacter();
        break;
      case "rested":
        this.flash("พักในเมือง: HP/MP ฟื้นเต็มแล้ว");
        void this.reloadCharacter();
        break;
      case "kicked":
        this.stopped = true;
        this.flash(m.reason === "REPLACED" ? "บัญชีนี้เชื่อมต่อจากที่อื่นแล้ว (หน้านี้หยุดควบคุม)" : "ย้ายไป channel อื่นแล้ว");
        break;
      case "error":
        if (m.code === "SETTLING") {
          // The server is still recording the fight's rewards; ask again in a moment.
          this.time.delayedCall(600, () => this.transport.resume());
          break;
        }
        if (m.code === "NEED_REST") {
          this.pendingEngage = null;
          this.flash("ทุกคนในทีมล้มอยู่ กลับไปพักในหมู่บ้านก่อน");
          break;
        }
        if (m.code === "TOO_FAR" || m.code === "NO_SUCH_PACK" || m.code === "NO_HUNT_HERE") this.pendingEngage = null;
        this.flash(`${m.code}: ${m.message}`);
        break;
      case "pong":
        break;
    }
    this.refreshHud();
  }

  // ---------------------------------------------------------------- drawing

  private enterMap(mapId: string, channel: number, self: PublicPlayer, others: PublicPlayer[]) {
    const map = this.maps.get(mapId);
    if (map === undefined) return this.flash(`ไม่รู้จักแผนที่ ${mapId}`);
    this.map = map;
    this.channelNo = channel;
    this.layer?.destroy(true);
    for (const v of this.players.values()) [v.body, v.nose, v.label].forEach((o) => o.destroy());
    this.players.clear();
    this.showPacks([]);
    this.pendingEngage = null;
    this.seq = 0;
    this.readyAt = 0;

    const layer = this.add.container(0, 0).setDepth(0);
    map.tiles.forEach((row, y) =>
      [...row].forEach((c, x) => {
        const kind = TILE_LEGEND[c as TileChar].kind;
        layer.add(this.add.rectangle(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE - 1, TILE - 1, TILE_COLOR[kind]));
      }),
    );
    for (const p of map.portals) {
      layer.add(this.add.rectangle(p.at.x * TILE + TILE / 2, p.at.y * TILE + TILE / 2, TILE - 4, TILE - 4, 0xb06bf2, 0.75));
    }
    const labelled = new Set<string>();
    for (const p of map.portals) {
      if (labelled.has(p.label)) continue;
      labelled.add(p.label);
      // Keep edge labels inside the map.
      const w = map.tiles[0]!.length;
      const originX = p.at.x <= 1 ? 0 : p.at.x >= w - 2 ? 1 : 0.5;
      const x = p.at.x * TILE + (originX === 0 ? 0 : originX === 1 ? TILE : TILE / 2);
      layer.add(this.add.text(x, p.at.y * TILE - 6, `→ ${p.label}`, { fontFamily: "sans-serif", fontSize: "12px", color: "#ffffff" }).setOrigin(originX, 1));
    }
    this.layer = layer;

    const w = map.tiles[0]!.length * TILE;
    const h = map.tiles.length * TILE;
    this.cameras.main.setBounds(Math.min(0, (w - W) / 2), Math.min(0, (h - H) / 2), Math.max(w, W), Math.max(h, H));
    this.selfSid = self.sid;
    this.addPlayer(self, true);
    for (const o of others) this.addPlayer(o, false);
    this.cameras.main.startFollow(this.players.get(self.sid)!.body, true, 0.2, 0.2);
    this.flash(`${map.name.th} · channel ${channel}`);
  }

  private addPlayer(p: PublicPlayer, self: boolean) {
    if (this.players.has(p.sid)) return this.movePlayer(p.sid, { x: p.x, y: p.y }, p.facing, false);
    const [px, py] = center(p);
    const body = this.add.rectangle(px, py, 22, 28, self ? 0xf2c94c : 0x7ab8f2).setStrokeStyle(2, 0x1b1830).setDepth(10);
    const [fx, fy] = FACE_OFFSET[p.facing];
    const nose = this.add.rectangle(px + fx, py + fy, 6, 6, 0x1b1830).setDepth(11);
    const label = this.add
      .text(px, py - 22, p.name, { fontFamily: "sans-serif", fontSize: "11px", color: self ? "#f2c94c" : "#ffffff", backgroundColor: "#00000088", padding: { x: 3, y: 1 } })
      .setOrigin(0.5, 1)
      .setDepth(12);
    this.players.set(p.sid, { body, nose, label, pos: { x: p.x, y: p.y } });
  }

  private removePlayer(sid: string) {
    const v = this.players.get(sid);
    if (v === undefined) return;
    [v.body, v.nose, v.label].forEach((o) => o.destroy());
    this.players.delete(sid);
  }

  private movePlayer(sid: string, pos: TilePos, facing: PublicPlayer["facing"] | null, animate: boolean, ms = rules.provisional.walkStepMs.value) {
    const v = this.players.get(sid);
    if (v === undefined) return;
    v.pos = pos;
    const [px, py] = center(pos);
    const [fx, fy] = facing === null ? [v.nose.x - v.body.x, v.nose.y - v.body.y] : FACE_OFFSET[facing];
    const targets: [Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text, number, number][] = [
      [v.body, px, py],
      [v.nose, px + fx, py + fy],
      [v.label, px, py - 22],
    ];
    for (const [obj, x, y] of targets) {
      this.tweens.killTweensOf(obj);
      if (animate) this.tweens.add({ targets: obj, x, y, duration: ms });
      else obj.setPosition(x, y);
    }
    // y-sorting placeholder: lower on screen draws in front.
    v.body.setDepth(10 + pos.y / 1000);
  }

  /** Everyone in the channel sees the same packs; ones this player already fought are left out. */
  private showPacks(packs: VisiblePack[]) {
    for (const v of this.packs.values()) v.objects.forEach((o) => o.destroy());
    this.packs.clear();
    for (const p of packs) {
      const [px, py] = center(p);
      const color = ELEMENT_COLOR[p.leader.element];
      const body = this.add.rectangle(px, py, 24, 20, color).setStrokeStyle(2, p.rank === "ELITE" ? 0xffd84a : 0x1b1830).setDepth(9);
      const shadow = this.add.ellipse(px, py + 12, 26, 8, 0x000000, 0.35).setDepth(8);
      const [min, max] = p.sizeRange;
      const name = this.species.get(p.leader.speciesId)?.name.th ?? p.leader.speciesId;
      const label = this.add
        .text(px, py - 14, `${name} Lv${p.leader.level} · ${min === max ? min : `${min}–${max}`} ตัว`, {
          fontFamily: "sans-serif",
          fontSize: "11px",
          color: "#ffd0c0",
          backgroundColor: "#00000088",
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(12);
      this.tweens.add({ targets: body, y: py - 3, duration: 500, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      this.packs.set(p.packId, { pack: p, objects: [body, shadow, label] });
    }
    if (this.pendingEngage !== null && !this.packs.has(this.pendingEngage)) this.pendingEngage = null;
  }

  private startBattle(battleId: string, resumed: boolean) {
    this.path = [];
    this.pendingEngage = null;
    this.inBattle = true;
    // A repeat (double tap, reconnect) while the fight is on screen changes nothing.
    if (this.scene.isActive("battle")) return;
    this.flash(resumed ? "กลับเข้าไฟต์ที่ค้างอยู่" : "เข้าไฟต์!");
    this.scene.launch("battle", {
      transport: this.transport.battle(battleId),
      onExit: () => {
        this.scene.stop("battle");
        this.scene.wake();
        // The server checks the fight really ended; until it says "resumed" the player stays put.
        this.transport.resume();
      },
    });
    this.scene.sleep();
  }

  private refreshHud() {
    const m = this.map;
    const where = m === null ? "กำลังเชื่อมต่อ…" : `${m.name.th} · channel ${this.channelNo} · ผู้เล่นที่เห็น ${this.players.size} คน`;
    const c = this.bundle?.character;
    if (c === undefined) return void this.hud.setText(where);
    const v = vitals(c, this.bundle?.equipment ?? []);
    this.hud.setText(`${where}\n${c.name} Lv${c.level} · HP ${v.hp}/${v.maxHp} · MP ${v.mp}/${v.maxMp} · ทีม ${c.team.length}/5`);
  }

  private async reloadCharacter() {
    if (this.api === null) return;
    this.bundle = (await this.api.get()) ?? this.bundle;
    this.refreshHud();
  }

  /** Team screen. Not during a fight (P15). */
  private openTeam() {
    return this.withPanel("เปลี่ยนทีมได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      const saved = await teamPanel(api, bundle);
      if (saved !== null) this.flash(`บันทึกทีมแล้ว (${saved.team.length} ตัว)`);
    });
  }

  /** Equipment screen. Not during a fight (P15). */
  private openEquipment() {
    return this.withPanel("เปลี่ยนอุปกรณ์ได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      await equipmentPanel(api, bundle);
    });
  }

  /** Opens a DOM panel with fresh character data; walking input pauses while it is open. */
  private async withPanel(inFight: string, show: (api: CharacterApi, bundle: CharacterBundle) => Promise<void>) {
    if (this.api === null || this.panelOpen) return;
    if (this.inBattle) return this.flash(inFight);
    this.panelOpen = true;
    this.path = [];
    this.input.keyboard!.enabled = false;
    try {
      await this.reloadCharacter();
      if (this.bundle === null) return;
      await show(this.api, this.bundle);
      await this.reloadCharacter();
    } finally {
      this.input.keyboard!.enabled = true;
      this.input.keyboard!.resetKeys();
      this.panelOpen = false;
    }
  }

  private flash(text: string) {
    this.notice.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.notice);
    this.tweens.add({ targets: this.notice, alpha: 0, delay: 2200, duration: 600 });
  }

  // ---------------------------------------------------------------- input

  private tapMove(p: Pointer) {
    const self = this.selfView();
    if (this.map === null || self === null || this.stopped) return;
    const target = { x: Math.floor(p.worldX / TILE), y: Math.floor(p.worldY / TILE) };
    const pack = [...this.packs.values()].find((v) => v.pack.x === target.x && v.pack.y === target.y)?.pack;
    this.pendingEngage = pack?.packId ?? null;
    if (pack !== undefined && inEngageRange(rules, self.pos, pack)) {
      this.path = [];
      return;
    }
    const path = findPath(this.map, self.pos, target);
    if (path === null) return this.flash("ไปตรงนั้นไม่ได้");
    this.path = path;
  }

  private heldDirection(): Direction | null {
    const k = this.keys;
    const up = k.up.isDown || k.w.isDown;
    const down = k.down.isDown || k.s.isDown;
    const left = k.left.isDown || k.a.isDown;
    const right = k.right.isDown || k.d.isDown;
    const v = up && !down ? "N" : down && !up ? "S" : "";
    const h = right && !left ? "E" : left && !right ? "W" : "";
    const d = `${v}${h}`;
    return d === "" ? null : (d as Direction);
  }

  private selfView(): PlayerView | null {
    return this.selfSid === null ? null : (this.players.get(this.selfSid) ?? null);
  }

  override update(time: number) {
    const self = this.selfView();
    if (this.map === null || self === null || this.stopped || this.nextConnect !== null || this.inBattle || this.panelOpen) return;
    const engaging = this.pendingEngage === null ? undefined : this.packs.get(this.pendingEngage)?.pack;
    if (engaging !== undefined && inEngageRange(rules, self.pos, engaging)) {
      // Next to the pack: ask the server for the fight. It checks range and the pack itself.
      this.path = [];
      this.pendingEngage = null;
      this.transport.engage(engaging.packId);
      return;
    }
    if (time < this.readyAt) return;
    const held = this.heldDirection();
    if (held !== null) {
      this.path = [];
      this.pendingEngage = null;
    }
    let dir = held ?? this.path.shift() ?? null;
    if (dir === null) return;
    // Predict with the same rule the server uses; a blocked diagonal slides along one axis.
    let r = tryStep(rules, this.map, self.pos, dir, this.readyAt, time);
    if (!r.ok && held !== null && dir.length === 2) {
      for (const axis of [dir[0], dir[1]] as Direction[]) {
        const alt = tryStep(rules, this.map, self.pos, axis, this.readyAt, time);
        if (alt.ok) {
          dir = axis;
          r = alt;
          break;
        }
      }
    }
    if (!r.ok) {
      this.path = [];
      return;
    }
    const cost = stepCostMs(rules, dir);
    this.readyAt = Math.max(this.readyAt, time) + cost;
    this.transport.step(++this.seq, dir);
    const facing = dir.length === 2 ? (dir.endsWith("E") ? "E" : "W") : (dir as PublicPlayer["facing"]);
    this.movePlayer(this.selfSid!, r.pos, facing, true, cost);
    if (portalAt(this.map, r.pos.x, r.pos.y) !== null) this.path = [];
  }
}

type Pointer = Phaser.Input.Pointer;

const center = (p: TilePos): [number, number] => [p.x * TILE + TILE / 2, p.y * TILE + TILE / 2];
