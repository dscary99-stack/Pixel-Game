/**
 * Battle preview scene. Placeholder shapes only: real pixel art and animation come from the art
 * pipeline (chapter 10) and are not part of Phase A. The scene draws what the transport reports;
 * it never computes damage, loot, capture or ownership itself (chapter 11 §1).
 */
import Phaser from "phaser";
import { exampleContentMaps, type BattleCommand, type BattleEvent, type BattleUnit, type Element, type PublicBattleState } from "@pmrpg/shared";
import type { BattleTransport, Snapshot } from "./transport";

const CONTENT = exampleContentMaps();
/** Display name for a loot line: item or equipment, falling back to the id. */
const lootName = (id: string) => (CONTENT.items.get(id) ?? CONTENT.equipment.get(id))?.name.th ?? id;

const expText = (exp: number | undefined) => (exp ? ` · EXP +${exp}` : "");

const W = 960;
const H = 540;

export const ELEMENT_COLOR: Record<Element, number> = {
  FIRE: 0xf26b3a,
  WATER: 0x3a8ef2,
  EARTH: 0xb08a4a,
  WIND: 0x5fd18b,
  LIGHT: 0xf2df6b,
  SHADOW: 0x8a5fd1,
  NEUTRAL: 0xc8c8d0,
};

interface UnitView {
  body: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Rectangle;
}

export class BattleScene extends Phaser.Scene {
  private transport!: BattleTransport;
  private snap!: Snapshot;
  private views = new Map<string, UnitView>();
  private selectedTarget: string | null = null;
  private log: string[] = [];
  private logText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private autoOn = false;
  private busy = false;
  private autoButton!: Phaser.GameObjects.Text;

  constructor() {
    super("battle");
  }

  private onExit: (() => void) | null = null;
  private exitButton: Phaser.GameObjects.Text | null = null;

  /**
   * `onExit` is set when the fight came from the world: once the fight is over a button takes the
   * player back to where they stood. Phaser reuses this scene object, so every field resets here.
   */
  init(data: { transport: BattleTransport; onExit?: () => void }) {
    this.transport = data.transport;
    this.onExit = data.onExit ?? null;
    this.exitButton = null;
    this.views = new Map();
    this.selectedTarget = null;
    this.log = [];
    this.autoOn = false;
    this.busy = false;
  }

  async create() {
    this.cameras.main.setBackgroundColor("#1d1a2b");
    this.add.rectangle(W / 2, 250, W, 400, 0x2a2540).setStrokeStyle(2, 0x0b0a12);
    this.add.text(12, 8, this.transport.label, { fontFamily: "sans-serif", fontSize: "13px", color: "#f2c94c" });
    this.turnText = this.add.text(12, 28, "", { fontFamily: "sans-serif", fontSize: "15px", color: "#ffffff" });
    this.logText = this.add.text(560, 456, "", { fontFamily: "sans-serif", fontSize: "12px", color: "#d8d4ea", wordWrap: { width: 390 } });

    const buttons: [string, () => void][] = [
      ["โจมตี", () => this.act("attack")],
      ["สกิล", () => this.act("skill")],
      ["ป้องกัน", () => this.act("guard")],
      ["ยา", () => this.act("item")],
      ["จับ", () => this.act("capture")],
    ];
    buttons.forEach(([label, fn], i) => this.button(16 + i * 92, 470, label, fn));
    this.autoButton = this.button(16 + 5 * 92, 470, "Auto: ปิด", () => this.toggleAuto());

    // Auto only runs while this page is open and visible (C14: no offline farming).
    this.time.addEvent({ delay: 650, loop: true, callback: () => void this.autoTick() });
    const onHide = () => {
      if (document.visibilityState !== "visible" && this.autoOn) this.toggleAuto();
    };
    document.addEventListener("visibilitychange", onHide);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => document.removeEventListener("visibilitychange", onHide));

    const { snapshot, events } = await this.transport.start();
    this.apply(snapshot, events);
  }

  private button(x: number, y: number, label: string, fn: () => void) {
    // 84x48 touch target for mobile landscape (P10).
    const t = this.add
      .text(x, y, label, { fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff", backgroundColor: "#463f6b", padding: { x: 12, y: 14 }, fixedWidth: 84, align: "center" })
      .setInteractive({ useHandCursor: true });
    t.on("pointerdown", fn);
    return t;
  }

  private toggleAuto() {
    this.autoOn = !this.autoOn;
    this.autoButton.setText(this.autoOn ? "Auto: เปิด" : "Auto: ปิด");
  }

  private async autoTick() {
    if (!this.autoOn || this.busy || this.snap?.state.status !== "active") return;
    this.busy = true;
    try {
      const { response, snapshot } = await this.transport.autoStep();
      this.apply(snapshot, response.status === "accepted" ? response.events : [], response);
    } finally {
      this.busy = false;
    }
  }

  private async act(kind: "attack" | "skill" | "guard" | "item" | "capture") {
    if (this.busy || this.snap.state.status !== "active" || this.snap.actor === null) return;
    const actor = this.unit(this.snap.actor)!;
    const target = this.selectedTarget ?? this.firstEnemy();
    let cmd: BattleCommand | null = null;
    switch (kind) {
      case "attack":
        if (target) cmd = { type: "attack", actorId: actor.unitId, targetId: target };
        break;
      case "skill":
        if (target && actor.skillIds[0]) cmd = { type: "skill", actorId: actor.unitId, skillId: actor.skillIds[0], targetId: target };
        break;
      case "guard":
        cmd = { type: "guard", actorId: actor.unitId };
        break;
      case "item":
        cmd = { type: "item", actorId: actor.unitId, itemId: "item:small_potion", targetId: actor.unitId };
        break;
      case "capture": {
        const t = target ? this.unit(target) : undefined;
        if (t?.speciesId) cmd = { type: "capture", actorId: actor.unitId, targetId: t.unitId, itemId: `item:${t.speciesId.slice("species:".length)}_capture` };
        break;
      }
    }
    if (cmd === null) return this.pushLog("ไม่มีเป้าหมาย/สกิลสำหรับคำสั่งนี้");
    this.busy = true;
    try {
      const { response, snapshot } = await this.transport.send(cmd);
      this.apply(snapshot, response.status === "accepted" ? response.events : [], response);
    } finally {
      this.busy = false;
    }
  }

  private apply(snapshot: Snapshot, events: BattleEvent[], response?: { status: string; reasonCode?: string; message?: string }) {
    this.snap = snapshot;
    if (response?.status === "rejected") this.pushLog(`ปฏิเสธ: ${response.reasonCode} ${response.message ?? ""}`);
    for (const e of events) this.describe(e);
    this.render(snapshot.state);
  }

  private describe(e: BattleEvent) {
    switch (e.type) {
      case "RoundStarted":
        return this.pushLog(`— รอบ ${e.round} —`);
      case "ActionResolved":
        if (e.damage !== null && e.targetId) {
          this.popup(e.targetId, e.hit ? `${e.damage}${e.crit ? "!" : ""}` : "พลาด", e.crit ? "#ffd84a" : "#ffffff");
          return this.pushLog(`${this.name(e.actorId)} → ${this.name(e.targetId)}: ${e.hit ? e.damage : "พลาด"}${e.crit ? " (คริ)" : ""}`);
        }
        if (e.heal !== null && e.targetId) {
          this.popup(e.targetId, `+${e.heal}`, "#7dff9b");
          return this.pushLog(`${this.name(e.actorId)} ฟื้น ${this.name(e.targetId)} +${e.heal}`);
        }
        if (e.action === "guard") return this.pushLog(`${this.name(e.actorId)} ป้องกัน`);
        return;
      case "CaptureResolved":
        return this.pushLog(`จับ ${this.name(e.targetId)}: ${e.success ? "สำเร็จ (ได้ Lv1)" : "ไม่สำเร็จ"} โอกาส ${(e.probability * 100).toFixed(0)}%`);
      case "EnemyDefeated":
        return this.pushLog(`${this.name(e.unitId)} ถูกกำจัด`);
      case "RewardEntitled":
        return e.entitlement.kind === "kill"
          ? this.pushLog(`สิทธิ์รางวัล: ${e.entitlement.items.map((i) => `${lootName(i.itemId)}×${i.quantity}`).join(", ") || "ไม่มีของ"}${expText(e.entitlement.exp)}`)
          : this.pushLog(`สิทธิ์คู่ใจใหม่: ${CONTENT.species.get(e.entitlement.speciesId)?.name.th ?? e.entitlement.speciesId} Lv${e.entitlement.level}${expText(e.entitlement.exp)}`);
      case "BattleEnded":
        return this.pushLog(`จบไฟต์: ${e.outcome}`);
      default:
        return;
    }
  }

  private render(state: PublicBattleState) {
    for (const u of state.units) {
      const { x, y } = this.position(u);
      let v = this.views.get(u.unitId);
      if (!v) {
        const body = this.add.rectangle(x, y, 48, 56, ELEMENT_COLOR[u.element]).setStrokeStyle(3, 0x0b0a12).setInteractive({ useHandCursor: true });
        body.on("pointerdown", () => {
          if (u.side === "enemy") this.selectedTarget = u.unitId;
          this.render(this.snap.state);
        });
        const ring = this.add.rectangle(x, y, 60, 68).setStrokeStyle(2, 0xffffff).setVisible(false);
        this.add.rectangle(x, y + 36, 52, 6, 0x0b0a12);
        const hpBar = this.add.rectangle(x - 25, y + 36, 50, 4, 0x6be36b).setOrigin(0, 0.5);
        const label = this.add.text(x, y - 44, "", { fontFamily: "sans-serif", fontSize: "12px", color: "#ffffff" }).setOrigin(0.5);
        v = { body, hpBar, label, ring };
        this.views.set(u.unitId, v);
      }
      v.body.setPosition(x, y).setAlpha(u.ko || u.retired ? 0.25 : 1);
      v.ring.setPosition(x, y).setVisible(u.unitId === this.snap.actor || u.unitId === this.selectedTarget);
      v.ring.setStrokeStyle(2, u.unitId === this.snap.actor ? 0x7dff9b : 0xff6b6b);
      v.hpBar.setPosition(x - 25, y + 36).setSize(Math.max(0, 50 * (u.hp / u.stats.maxHp)), 4);
      v.label.setPosition(x, y - 44).setText(`${u.name} Lv${u.level}${u.retired ? " (จับแล้ว)" : ""}`);
    }
    const actor = this.snap.actor ? this.unit(this.snap.actor) : undefined;
    this.turnText.setText(
      state.status === "active" ? `รอบ ${state.round} · ตาของ ${actor?.name ?? "-"} · แตะศัตรูเพื่อเลือกเป้า` : `จบไฟต์: ${state.status}`,
    );
    if (state.status !== "active" && this.onExit !== null && this.exitButton === null) {
      const exit = this.onExit;
      this.exitButton = this.button(W - 200, 20, "กลับไปเดินต่อ", () => exit()).setFixedSize(184, 48).setBackgroundColor("#2f7a4a");
    }
  }

  private position(u: BattleUnit) {
    if (u.side === "ally") return { x: u.row === "front" ? 330 : 210, y: 150 + u.slot * 100 };
    return { x: u.row === "front" ? 620 : 760, y: 90 + u.slot * 76 };
  }

  private popup(unitId: string, text: string, color: string) {
    const u = this.unit(unitId);
    if (!u) return;
    const { x, y } = this.position(u);
    const t = this.add.text(x, y - 20, text, { fontFamily: "sans-serif", fontSize: "18px", color, stroke: "#000000", strokeThickness: 4 }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  private pushLog(line: string) {
    this.log.push(line);
    this.log = this.log.slice(-5);
    this.logText?.setText(this.log.join("\n"));
  }

  private unit(id: string) {
    return this.snap.state.units.find((u) => u.unitId === id);
  }
  private name(id: string) {
    return this.unit(id)?.name ?? id;
  }
  private firstEnemy() {
    return this.snap.state.units.find((u) => u.side === "enemy" && !u.ko && !u.retired)?.unitId ?? null;
  }
}

export const GAME_SIZE = { width: W, height: H };
