/**
 * Walking scene for the Phase B slice. Placeholder shapes only; tiles, sprites, y-sorting and
 * occlusion come with the art proof (chapter 10). The client predicts its own step so walking
 * feels immediate, but the server decides: a `correct` message snaps the player back.
 */
import Phaser from "phaser";
import {
  DEV_FIXTURE_RULES,
  ELITE_MODIFIER_TH,
  TILE_LEGEND,
  exampleContentMaps,
  expProgress,
  unspentPoints,
  exampleMapRegistry,
  findPath,
  inEngageRange,
  portalAt,
  stepCostMs,
  tryStep,
  type AutoStopReason,
  type HuntSummary,
  type Direction,
  type MapDefinition,
  type NpcPlacement,
  type NpcService,
  type PublicPlayer,
  type TileChar,
  type TilePos,
  type VisiblePack,
  type WorldServerMessage,
} from "@pmrpg/shared";
import { ELEMENT_COLOR, type BattleScene } from "./battle-scene";
import type { CharacterApi, CharacterBundle } from "./character-api";
import { autoHuntPanel, armoryPanel, practicePanel, craftPanel, refinePanel, frontierPanel, journalPanel, ordersPanel, questPanel, titleName, equipmentPanel, partyPanel, rebirthPanel, secretQuestPanel, shopPanel, skillPanel, statsPanel, teamPanel, vitals } from "./character-ui";
import { mailPanel, marketPanel, tradePanel, vaultPanel } from "./market-ui";
import type { WorldTransport } from "./world-transport";

const W = 960;
const H = 540;
const rules = DEV_FIXTURE_RULES;
const TILE = rules.provisional.worldTileSizePx.value;

const NPC_SERVICE_TH: Record<Exclude<NpcService, "talk">, string> = {
  shop: "ร้าน ซื้อ/ขาย",
  craft: "สร้างของ",
  refine: "ตีบวก",
  orders: "งานสั่ง",
  frontier: "หอคอยรอยแยก",
  rebirth: "จุติคู่ใจ",
  skills: "สกิลคู่ใจ / Bond",
  equipment: "อุปกรณ์ / Sigil",
  quests: "เควสรายวัน/สัปดาห์",
  party: "ปาร์ตี้",
  team: "ทีมคู่ใจ",
  journal: "สมุดบันทึก / ฉายา",
  market: "ตลาดโลก",
  trade: "แลกเปลี่ยนกับผู้เล่น",
  vault: "คลังของบัญชี",
  practice: "ลานทดสอบ (ลองสู้บอส)",
  armory: "ร้านอุปกรณ์",
};

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

/** Why Auto Hunt stopped, in the player's words. */
const AUTO_STOP_TEXT: Record<AutoStopReason, string> = {
  PLAYER_STOPPED: "หยุดล่าอัตโนมัติแล้ว",
  FOUND_SPECIES: "เจอมอนสเตอร์ที่ตั้งไว้ให้หยุด",
  LOW_HP: "HP ต่ำกว่าที่ตั้งไว้ หยุดล่าอัตโนมัติ",
  LOW_MP: "MP ต่ำกว่าที่ตั้งไว้ หยุดล่าอัตโนมัติ",
  COMPANION_LOW_HP: "HP คู่ใจต่ำกว่าที่ตั้งไว้ หยุดล่าอัตโนมัติ",
  ITEMS_OUT: "ยาที่ตั้งให้ใช้หมดแล้ว หยุดล่าอัตโนมัติ",
  NEED_REST: "ทุกคนในทีมล้มอยู่ กลับไปพักในหมู่บ้านก่อน",
  DEFEATED: "แพ้ไฟต์ กลับไปพักที่หมู่บ้าน",
  NO_TARGETS: "ไม่มีฝูงที่ตรงกับที่ตั้งไว้ในแผนที่นี้",
  DISCONNECTED: "หลุดการเชื่อมต่อ หยุดล่าอัตโนมัติ",
  NO_HUNT_HERE: "ล่าอัตโนมัติได้เฉพาะในทุ่ง",
  NO_CHARACTER: "ต้องสร้างตัวละครก่อน",
  REFUSED: "server ไม่ให้เริ่มไฟต์",
};

const FACE_OFFSET: Record<PublicPlayer["facing"], [number, number]> = { N: [0, -12], S: [0, 12], E: [10, 0], W: [-10, 0] };

export class WorldScene extends Phaser.Scene {
  private transport!: WorldTransport;
  /** Server mode only: the stored character (Phase D). Null in the local preview. */
  private api: CharacterApi | null = null;
  private bundle: CharacterBundle | null = null;
  private panelOpen = false;
  private npcMenu: Phaser.GameObjects.Container | null = null;
  private readonly maps = exampleMapRegistry();
  private readonly species = exampleContentMaps().species;
  private packs = new Map<string, PackView>();
  /** Walking to this pack; engage once next to it. */
  private pendingEngage: string | null = null;
  /** A private fight is open; walking waits until the server says it is over. */
  private inBattle = false;
  /** Auto Hunt is on: the server walks and fights; the player's own steps stop it. */
  private autoOn = false;
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
  /** The last Auto Hunt run's totals (chapter 08); tap to close. */
  private huntBox!: Phaser.GameObjects.Text;
  private readonly itemDefs = exampleContentMaps().items;
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
    this.notice = this.add.text(W / 2, H - 90, "", { ...style, fontSize: "15px" }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
    this.huntBox = this.add
      .text(W / 2, H / 2, "", { ...style, fontSize: "14px", backgroundColor: "#1d1a2bee", padding: { x: 14, y: 12 } })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(110)
      .setVisible(false)
      .setInteractive()
      .on("pointerdown", (_p: Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        this.huntBox.setVisible(false);
      });
    this.add
      .text(W - 8, 8, `ลูกศร/WASD เดิน · คลิกเพื่อเดินไป · คลิกฝูงมอนสเตอร์เพื่อสู้ · 1/2 เปลี่ยน channel${this.api ? " · C สเตตัส · T ทีม · E อุปกรณ์ · B ร้าน / F สร้างของ / O งานสั่ง / G หอคอย / R จุติคู่ใจ (ในเมือง) · K สกิล/Bond · H ล่าอัตโนมัติ · P ปาร์ตี้ · Q เควส · J สมุด · L เควสลับ · M ตลาด · V คลัง" : ""}`, style)
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
    kb.on("keydown-B", () => void this.openShop());
    kb.on("keydown-F", () => void this.openCraft());
    kb.on("keydown-C", () => void this.openStats());
    kb.on("keydown-H", () => void this.toggleAutoHunt());
    kb.on("keydown-R", () => void this.openRebirth());
    kb.on("keydown-P", () => void this.openParty());
    kb.on("keydown-K", () => void this.openSkills());
    kb.on("keydown-Q", () => void this.openQuests());
    kb.on("keydown-J", () => void this.openJournal());
    kb.on("keydown-O", () => void this.openOrders());
    kb.on("keydown-G", () => void this.openFrontier());
    kb.on("keydown-L", () => void this.openSecretQuests());
    kb.on("keydown-M", () => void this.openMarket());
    kb.on("keydown-V", () => void this.openVault());
    kb.on("keydown-N", () => void this.openMail());
    kb.on("keydown-Y", () => void this.openPractice());
    kb.on("keydown-U", () => void this.openArmory());
    if (this.api !== null) {
      const button = (x: number, label: string, open: () => Promise<void>) =>
        this.add
          .text(x, H - 8, label, { ...style, backgroundColor: "#463f6b", padding: { x: 10, y: 10 } })
          .setOrigin(0, 1)
          .setScrollFactor(0)
          .setDepth(100)
          .setInteractive({ useHandCursor: true })
          .on("pointerdown", (_p: Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
            e.stopPropagation();
            void open();
          });
      // Left to right along the bottom; a button that would run off the edge starts a row above.
      const entries: [string, () => Promise<void>][] = [
        ["ทีมคู่ใจ (T)", () => this.openTeam()],
        ["อุปกรณ์ (E)", () => this.openEquipment()],
        ["ร้าน (B)", () => this.openShop()],
        ["อุปกรณ์ร้าน (U)", () => this.openArmory()],
        ["สร้างของ (F)", () => this.openCraft()],
        ["งานสั่ง (O)", () => this.openOrders()],
        ["หอคอย (G)", () => this.openFrontier()],
        ["สเตตัส (C)", () => this.openStats()],
        ["ล่าอัตโนมัติ (H)", () => this.toggleAutoHunt()],
        ["จุติ (R)", () => this.openRebirth()],
        ["ปาร์ตี้ (P)", () => this.openParty()],
        ["สกิล (K)", () => this.openSkills()],
        ["เควส (Q)", () => this.openQuests()],
        ["สมุด (J)", () => this.openJournal()],
        ["เควสลับ (L)", () => this.openSecretQuests()],
        ["ตลาด (M)", () => this.openMarket()],
        ["คลัง (V)", () => this.openVault()],
        ["จดหมาย (N)", () => this.openMail()],
        ["ลานทดสอบ (Y)", () => this.openPractice()],
      ];
      let x = 8;
      let lift = 0;
      for (const [label, open] of entries) {
        const b = button(x, label, open);
        if (x > 8 && x + b.width > W - 8) {
          x = 8;
          lift += b.height + 6;
        }
        b.setPosition(x, H - 8 - lift);
        x += b.width + 6;
      }
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
      case "autoMoved":
        // A step the server took for us (Auto Hunt).
        if (this.selfSid !== null) this.movePlayer(this.selfSid, { x: m.x, y: m.y }, m.facing, true);
        break;
      case "auto":
        this.autoOn = m.on;
        this.path = [];
        this.pendingEngage = null;
        if (m.on) {
          this.huntBox.setVisible(false);
          this.flash("เริ่มล่าอัตโนมัติ (กด H หรือเดินเองเพื่อหยุด)");
        } else {
          if (m.summary !== undefined) this.showHuntSummary(m.summary);
          const found = m.reason === "FOUND_SPECIES" && m.detail ? ` (${this.species.get(m.detail)?.name.th ?? m.detail})` : "";
          const extra = m.reason === "REFUSED" && m.detail ? ` (${m.detail})` : (m.reason === "LOW_HP" || m.reason === "COMPANION_LOW_HP") && m.detail ? ` (HP ${m.detail})` : m.reason === "LOW_MP" && m.detail ? ` (MP ${m.detail})` : "";
          this.flash(`${AUTO_STOP_TEXT[m.reason ?? "PLAYER_STOPPED"]}${found}${extra}`);
          // A fight in progress goes back to the player's hands.
          if (this.scene.isActive("battle")) (this.scene.get("battle") as BattleScene).setWatch(false);
        }
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
        // Auto Hunt walks on by itself: close the finished fight it was showing.
        if (this.scene.isActive("battle")) {
          this.scene.stop("battle");
          this.scene.wake();
        }
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
    // Town people: a marker with a name; clicking one says who they are and opens their service (tapMove).
    for (const n of map.npcs ?? []) {
      const [nx, ny] = center(n.at);
      layer.add(this.add.ellipse(nx, ny + 9, 22, 8, 0x000000, 0.35));
      layer.add(this.add.rectangle(nx, ny, 18, 24, n.services.includes("frontier") ? 0xb06bf2 : 0x5fd1a4).setStrokeStyle(2, 0x1b1830));
      layer.add(
        this.add
          .text(nx, ny - 15, n.name.th, { fontFamily: "sans-serif", fontSize: "10px", color: "#e8fff4", align: "center", backgroundColor: "#00000077", padding: { x: 2, y: 1 } })
          .setOrigin(0.5, 1),
      );
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
      // Bosses stand out (bigger, red outline); they never leave the map (P17: try again any time).
      const boss = p.rank === "BOSS";
      const body = this.add
        .rectangle(px, py, boss ? 34 : 24, boss ? 30 : 20, color)
        .setStrokeStyle(boss ? 3 : 2, boss ? 0xff4a4a : p.rank === "ELITE" ? 0xffd84a : 0x1b1830)
        .setDepth(9);
      const shadow = this.add.ellipse(px, py + 12, 26, 8, 0x000000, 0.35).setDepth(8);
      const [min, max] = p.sizeRange;
      const name = this.species.get(p.leader.speciesId)?.name.th ?? p.leader.speciesId;
      // Elites show their modifiers before engaging (chapter 07 §3).
      const rank = boss ? "บอส " : p.rank === "ELITE" ? "★ชั้นยอด " : "";
      const mods = p.leader.elite === undefined ? "" : `\n${p.leader.elite.map((m) => ELITE_MODIFIER_TH[m].name).join(", ")}`;
      const label = this.add
        .text(px, py - (boss ? 19 : 14), `${rank}${name} Lv${p.leader.level} · ${min === max ? min : `${min}–${max}`} ตัว${mods}`, {
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
      watch: this.autoOn,
      onStopAuto: () => this.transport.autoStop(),
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
    const where =
      m === null ? "กำลังเชื่อมต่อ…" : `${m.name.th} · channel ${this.channelNo} · ผู้เล่นที่เห็น ${this.players.size} คน${this.autoOn ? " · ล่าอัตโนมัติ: เปิด" : ""}`;
    const c = this.bundle?.character;
    if (c === undefined) return void this.hud.setText(where);
    const v = vitals(c, this.bundle?.equipment ?? []);
    const xp = expProgress(rules, "player", c.xp);
    const points = unspentPoints(rules, c.level, c.primaryStats);
    const title = titleName(this.bundle?.titleId);
    this.hud.setText(`${where}\n${title === null ? "" : `[${title}] `}${c.name} Lv${c.level} (EXP ${xp.need === null ? "MAX" : `${xp.into}/${xp.need}`})${points > 0 ? ` · แต้มว่าง ${points}` : ""} · HP ${v.hp}/${v.maxHp} · MP ${v.mp}/${v.maxMp} · ทีม ${c.team.length}/5 · เหรียญ ${this.bundle?.coins ?? 0}`);
  }

  private async reloadCharacter() {
    if (this.api === null) return;
    const before = this.bundle?.character.level;
    this.bundle = (await this.api.get()) ?? this.bundle;
    const after = this.bundle?.character.level;
    if (before !== undefined && after !== undefined && after > before) {
      this.flash(`เลเวลอัป! Lv${after} · ได้แต้มสเตตัส +${(after - before) * rules.provisional.statPointsPerLevel.value} (กด C)`);
    }
    this.refreshHud();
  }

  /** Auto Hunt (C14): settings, then the server walks and fights until something stops it. */
  private async toggleAutoHunt() {
    if (this.api === null) return this.flash("ล่าอัตโนมัติต้องต่อ server (?server)");
    if (this.autoOn) return this.transport.autoStop();
    if (this.panelOpen) return;
    if (this.inBattle) return this.flash("เริ่มล่าอัตโนมัติได้นอกไฟต์");
    if (this.map === null || this.map.kind === "town") return this.flash(AUTO_STOP_TEXT.NO_HUNT_HERE);
    const speciesIds = [...new Set(this.map.spawns.flatMap((s) => s.entries.map((e) => e.speciesId)))];
    this.panelOpen = true;
    this.path = [];
    this.input.keyboard!.enabled = false;
    try {
      const settings = await autoHuntPanel(speciesIds);
      if (settings !== null) this.transport.autoHunt(settings);
    } finally {
      this.input.keyboard!.enabled = true;
      this.input.keyboard!.resetKeys();
      this.panelOpen = false;
    }
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

  /** Stat points (P03). Not during a fight. */
  private openStats() {
    return this.withPanel("ลงแต้มได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      await statsPanel(api, bundle);
    });
  }

  /** NPC shop; only in town (the server checks the stored position too). */
  /** Town armory: plain gear by level band; only in town (the server checks the stored position too). */
  private async openArmory() {
    if (this.map !== null && this.map.kind !== "town") return this.flash("ร้านอุปกรณ์อยู่ในเมือง");
    return this.withPanel("ซื้อของได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      await armoryPanel(api, bundle);
    });
  }

  private async openShop() {
    if (this.map !== null && this.map.kind !== "town") return this.flash("ร้านอยู่ในเมือง");
    return this.withPanel("ขายของได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      await shopPanel(api, bundle);
    });
  }

  /** Secret quests: view anywhere; handing items in needs a town (the server checks). */
  private openSecretQuests() {
    return this.withPanel("ดูเควสลับได้นอกไฟต์", async (api) => {
      await secretQuestPanel(api);
    });
  }

  /** NPC orders; only in town (the server checks the stored position too). */
  private async openOrders() {
    if (this.map !== null && this.map.kind !== "town") return this.flash("งานสั่งอยู่ในเมือง");
    return this.withPanel("ส่งของได้นอกไฟต์เท่านั้น", async (api) => {
      await ordersPanel(api);
    });
  }

  /**
   * Weekly tower NPC; only in town (the server checks the stored position too). "Next floor" closes the
   * panel and opens that floor's fight; back from it, the panel opens again with the result.
   */
  private async openFrontier() {
    if (this.map !== null && this.map.kind !== "town") return this.flash("หอคอยอยู่ในเมือง");
    let battleId: string | null = null;
    await this.withPanel("หอคอย: จบไฟต์นี้ก่อน", async (api) => {
      battleId = await frontierPanel(api);
    });
    if (battleId !== null) this.startTowerBattle(battleId);
  }

  /** Town training ground (P17): pick a field boss and try the team on it; nothing is earned or lost. */
  private async openPractice() {
    if (this.map !== null && this.map.kind !== "town") return this.flash("ลานทดสอบอยู่ในเมือง");
    let battleId: string | null = null;
    await this.withPanel("ลานทดสอบ: จบไฟต์นี้ก่อน", async (api) => {
      battleId = await practicePanel(api);
    });
    if (battleId !== null) this.startHttpBattle(battleId, "เข้าลานทดสอบ!", () => void this.openPractice());
  }

  /** A tower floor fight: started over HTTP, so coming back reopens the tower instead of asking the map. */
  private startTowerBattle(battleId: string) {
    this.startHttpBattle(battleId, "เข้าไฟต์ในหอคอย!", () => void this.openFrontier());
  }

  /** A fight started over HTTP (tower, training ground): coming back reopens its panel instead of asking the map. */
  private startHttpBattle(battleId: string, flash: string, reopen: () => void) {
    this.path = [];
    this.pendingEngage = null;
    this.inBattle = true;
    if (this.scene.isActive("battle")) return;
    this.flash(flash);
    this.scene.launch("battle", {
      transport: this.transport.battle(battleId),
      watch: false,
      onStopAuto: () => undefined,
      onExit: () => {
        this.scene.stop("battle");
        this.scene.wake();
        this.inBattle = false;
        void this.reloadCharacter();
        reopen();
      },
    });
    this.scene.sleep();
  }

  /** Crafting; only in town (the server checks the stored position too). */
  private async openRefine() {
    if (this.map !== null && this.map.kind !== "town") return this.flash("ตีบวกได้ในเมือง");
    return this.withPanel("ตีบวกได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      await refinePanel(api, bundle);
    });
  }

  private async openCraft() {
    if (this.map !== null && this.map.kind !== "town") return this.flash("สร้างของได้ในเมือง");
    return this.withPanel("สร้างของได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      await craftPanel(api, bundle);
    });
  }

  /** Journal: read-only (titles are cosmetic), allowed anywhere. */
  private async openJournal() {
    if (this.api === null || this.panelOpen) return;
    const api = this.api;
    this.panelOpen = true;
    this.input.keyboard!.enabled = false;
    try {
      await journalPanel(api);
    } finally {
      this.input.keyboard!.enabled = true;
      this.input.keyboard!.resetKeys();
      this.panelOpen = false;
    }
    await this.reloadCharacter();
  }

  /** Quests: allowed anywhere, also during fights and Auto Hunt (claims change no fight). */
  private async openQuests() {
    if (this.api === null || this.panelOpen) return;
    const api = this.api;
    this.panelOpen = true;
    this.input.keyboard!.enabled = false;
    try {
      await questPanel(api);
    } finally {
      this.input.keyboard!.enabled = true;
      this.input.keyboard!.resetKeys();
      this.panelOpen = false;
    }
    await this.reloadCharacter();
  }

  /**
   * World Market: browse and buy anywhere (M); list and take back only when opened at the harbour NPC
   * in town (Nut 2026-10-08; the server checks the town).
   */
  private async openMarket(atNpc = false) {
    return this.withPanel("ตลาดเปิดนอกไฟต์เท่านั้น", async (api, bundle) => {
      await marketPanel(api, bundle, atNpc && this.map?.kind === "town");
    });
  }

  /** Account vault: look anywhere (V); put in and take out at the NPC in town (the server checks the town). */
  private async openVault(atNpc = false) {
    return this.withPanel("ดูคลังได้นอกไฟต์", async (api, bundle) => {
      await vaultPanel(api, bundle, atNpc && this.map?.kind === "town");
    });
  }

  /** Mailbox (N): letters from the game; claim anywhere outside a fight. */
  private async openMail() {
    return this.withPanel("เปิดกล่องจดหมายได้นอกไฟต์", async (api, bundle) => {
      await mailPanel(api, bundle);
    });
  }

  /** Direct trade with another player by their trade code; in town (the server checks). */
  private async openTrade() {
    return this.withPanel("แลกเปลี่ยนได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      await tradePanel(api, bundle);
    });
  }

  /** Party: allowed anywhere, also during Auto Hunt (it changes no fight in progress). */
  private async openParty() {
    if (this.api === null || this.panelOpen) return;
    const api = this.api;
    this.panelOpen = true;
    this.input.keyboard!.enabled = false;
    try {
      await partyPanel(api);
    } finally {
      this.input.keyboard!.enabled = true;
      this.input.keyboard!.resetKeys();
      this.panelOpen = false;
    }
  }

  /** Companion Rebirth NPC; only in town (the server checks the stored position too). */
  private async openRebirth() {
    if (this.map !== null && this.map.kind !== "town") return this.flash("จุติคู่ใจได้ในเมือง");
    return this.withPanel("จุติคู่ใจได้นอกไฟต์เท่านั้น", async (api, bundle) => {
      await rebirthPanel(api, bundle);
    });
  }

  /** Companion skills and Bond; training is at the town NPC (the server checks the stored position too). */
  private async openSkills() {
    return this.withPanel("ดูสกิลได้นอกไฟต์", async (api, bundle) => {
      await skillPanel(api, bundle, this.map === null || this.map.kind === "town");
    });
  }

  /** Opens a DOM panel with fresh character data; walking input pauses while it is open. */
  private async withPanel(inFight: string, show: (api: CharacterApi, bundle: CharacterBundle) => Promise<void>) {
    if (this.api === null || this.panelOpen) return;
    if (this.inBattle) return this.flash(inFight);
    if (this.autoOn) return this.flash("หยุดล่าอัตโนมัติก่อน (H)");
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

  private showHuntSummary(sum: HuntSummary) {
    const name = (id: string) => this.itemDefs.get(id)?.name.th ?? id;
    const list = (r: Record<string, number>) => Object.entries(r).map(([id, n]) => `${name(id)} ×${n}`).join(", ") || "-";
    const secs = Math.max(0, Math.round(((sum.endedAt ?? Date.now()) - sum.startedAt) / 1000));
    this.huntBox
      .setText(
        [
          "สรุปการล่าอัตโนมัติ",
          `เวลา ${Math.floor(secs / 60)} นาที ${secs % 60} วินาที · ${sum.fights} ไฟต์ (ชนะ ${sum.wins}${sum.defeats > 0 ? `, แพ้ ${sum.defeats}` : ""})`,
          `EXP ${sum.exp} · EXP คู่ใจ ${sum.companionExp}`,
          `เหรียญที่ได้จริง ${sum.coins} · มูลค่าขาย NPC (ประมาณ) ${sum.npcValue}`,
          `ของที่ได้: ${list(sum.items)}`,
          `ของที่ใช้ไป: ${list(sum.consumed)}`,
          ...(sum.rare.length > 0 ? [`ของหายาก: ${sum.rare.map(name).join(", ")}`] : []),
          "(แตะเพื่อปิด)",
        ].join("\n"),
      )
      .setVisible(true);
  }

  /** A town NPC: they say their line, then open their service (or offer a choice when they have several). */
  private talkTo(n: NpcPlacement) {
    this.flash(`${n.name.th} (${n.role.th}): ${n.line.th}`);
    const open: Record<Exclude<NpcService, "talk">, () => Promise<void>> = {
      shop: () => this.openShop(),
      craft: () => this.openCraft(),
      refine: () => this.openRefine(),
      orders: () => this.openOrders(),
      frontier: () => this.openFrontier(),
      rebirth: () => this.openRebirth(),
      skills: () => this.openSkills(),
      equipment: () => this.openEquipment(),
      quests: () => this.openQuests(),
      party: () => this.openParty(),
      team: () => this.openTeam(),
      journal: () => this.openJournal(),
      market: () => this.openMarket(true),
      trade: () => this.openTrade(),
      vault: () => this.openVault(true),
      practice: () => this.openPractice(),
      armory: () => this.openArmory(),
    };
    const services = n.services.filter((s): s is Exclude<NpcService, "talk"> => s !== "talk");
    if (this.api === null || services.length === 0) return;
    if (services.length === 1) return void open[services[0]!]();
    this.npcMenu?.destroy();
    const menu = this.add.container(W / 2, H / 2).setScrollFactor(0).setDepth(120);
    const close = () => {
      menu.destroy();
      this.npcMenu = null;
    };
    const title = this.add.text(0, -24 * services.length - 16, n.name.th, { fontFamily: "sans-serif", fontSize: "15px", color: "#f2c94c" }).setOrigin(0.5, 1);
    menu.add(title);
    [...services.map((s) => [NPC_SERVICE_TH[s], () => void open[s]()] as const), ["ปิด", () => {}] as const].forEach(([label, fn], i) => {
      const b = this.add
        .text(0, -24 * services.length + i * 44, label, { fontFamily: "sans-serif", fontSize: "14px", color: "#ffffff", backgroundColor: "#463f6b", padding: { x: 10, y: 10 }, fixedWidth: 200, align: "center" })
        .setOrigin(0.5, 0)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", (_p: Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          close();
          fn();
        });
      menu.add(b);
    });
    this.npcMenu = menu;
  }

  private flash(text: string) {
    this.notice.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.notice);
    this.tweens.add({ targets: this.notice, alpha: 0, delay: 2200, duration: 600 });
  }

  // ---------------------------------------------------------------- input

  private tapMove(p: Pointer) {
    const self = this.selfView();
    if (this.map === null || self === null || this.stopped || this.panelOpen) return;
    if (this.autoOn) return this.flash("กำลังล่าอัตโนมัติ: กด H หรือปุ่มลูกศรเพื่อหยุด");
    // A tap outside an NPC's menu closes it.
    if (this.npcMenu !== null) {
      this.npcMenu.destroy();
      this.npcMenu = null;
      return;
    }
    const target = { x: Math.floor(p.worldX / TILE), y: Math.floor(p.worldY / TILE) };
    const npc = this.map.npcs?.find((n) => n.at.x === target.x && n.at.y === target.y);
    if (npc !== undefined && this.map.kind === "town") return this.talkTo(npc);
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
    if (this.autoOn) {
      // Walking by hand takes over: ask the server to stop (it also stops on a manual step).
      if (this.heldDirection() !== null && time >= this.readyAt) {
        this.readyAt = time + 500;
        this.transport.autoStop();
      }
      return;
    }
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
