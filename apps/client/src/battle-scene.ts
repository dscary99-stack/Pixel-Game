/**
 * Battle preview scene. Placeholder shapes only: real pixel art and animation come from the art
 * pipeline (chapter 10) and are not part of Phase A. The scene draws what the transport reports;
 * it never computes damage, loot, capture or ownership itself (chapter 11 §1).
 */
import Phaser from "phaser";
import { DEV_FIXTURE_RULES, ELITE_MODIFIER_TH, EXAMPLE_FRONTIER, FRONTIER_MODIFIER_TH, STATUS_DEFINITIONS, exampleContentMaps, type BattleCommand, type BattleEvent, type BattleUnit, type Element, type PublicBattleState } from "@pmrpg/shared";
import type { BattleTransport, Snapshot } from "./transport";
import { savedAutoPolicy } from "./character-ui";
import { capturePreview, pct2 } from "./capture-ui";
import { fleePreview, refusalTh, reviveRefusal, skillButtonLine } from "./command-ui";

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
  /**
   * Allies: under the HP bar. Enemies: beside the body (statuses, elite modifiers, reinforcement),
   * so ten enemies in two columns never stack text into the next cell.
   */
  sub: Phaser.GameObjects.Text;
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
  /** Party bonus, tower floor and boss phase: inside the field's top-left, wrapped clear of the enemy columns. */
  private infoText!: Phaser.GameObjects.Text;
  private autoOn = false;
  private busy = false;
  private autoButton!: Phaser.GameObjects.Text;

  constructor() {
    super("battle");
  }

  private onExit: (() => void) | null = null;
  /** Auto Hunt: the server plays this fight; the scene only shows it until the player takes over. */
  private watching = false;
  private onStopAuto: (() => void) | null = null;
  private cursor = 0;
  private watchUi: Phaser.GameObjects.GameObject[] = [];
  private exitButton: Phaser.GameObjects.Text | null = null;

  /**
   * `onExit` is set when the fight came from the world: once the fight is over a button takes the
   * player back to where they stood. Phaser reuses this scene object, so every field resets here.
   */
  init(data: { transport: BattleTransport; onExit?: () => void; watch?: boolean; onStopAuto?: () => void }) {
    this.transport = data.transport;
    this.onExit = data.onExit ?? null;
    this.watching = data.watch ?? false;
    this.onStopAuto = data.onStopAuto ?? null;
    this.cursor = 0;
    this.watchUi = [];
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
    this.infoText = this.add.text(12, 56, "", { fontFamily: "sans-serif", fontSize: "12px", color: "#f2c94c", wordWrap: { width: 520 } });
    this.logText = this.add.text(576, 456, "", { fontFamily: "sans-serif", fontSize: "12px", color: "#d8d4ea", wordWrap: { width: 374 } });

    const buttons: [string, () => void][] = [
      ["โจมตี", () => this.act("attack")],
      ["สกิล", () => this.act("skill")],
      ["ป้องกัน", () => this.act("guard")],
      ["ยา", () => this.act("item")],
      ["ชุบ", () => this.act("revive")],
      ["จับ", () => this.act("capture")],
      ["หนี", () => this.act("flee")],
    ];
    // Eight buttons and Auto left of the log: 62px wide, 48px tall (P10 touch target height).
    buttons.forEach(([label, fn], i) => this.button(16 + i * 68, 470, label, fn));
    this.autoButton = this.button(16 + buttons.length * 68, 470, "Auto: ปิด", () => this.toggleAuto(), 76);

    // Auto only runs while this page is open and visible (C14: no offline farming).
    // The server holds Auto to one action per autoBattleActionMs, the same as Auto Hunt.
    this.time.addEvent({ delay: DEV_FIXTURE_RULES.provisional.autoBattleActionMs.value, loop: true, callback: () => void this.autoTick() });
    const onHide = () => {
      if (document.visibilityState !== "visible" && this.autoOn) this.toggleAuto();
    };
    document.addEventListener("visibilitychange", onHide);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => document.removeEventListener("visibilitychange", onHide));

    // While watching, read what the server did; the server paces the actions (Auto Hunt).
    this.time.addEvent({ delay: 400, loop: true, callback: () => void this.watchTick() });
    // Party boss fights: follow teammates' turns, and have Auto stand in for one who left it waiting.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => void this.partyTick() });
    if (this.watching) this.showWatchUi();

    const { snapshot, events } = await this.transport.start();
    this.apply(snapshot, events);
  }

  /** Auto Hunt turned off (by the player or a stop reason): the player now controls this fight. */
  setWatch(on: boolean) {
    if (this.watching === on) return;
    this.watching = on;
    if (on) this.showWatchUi();
    else {
      this.watchUi.forEach((o) => o.destroy());
      this.watchUi = [];
      if (this.snap?.state.status === "active") this.pushLog("หยุดล่าอัตโนมัติแล้ว คุมเองต่อได้");
      if (this.snap !== undefined) this.render(this.snap.state);
    }
  }

  private showWatchUi() {
    const banner = this.add
      .text(W / 2, 430, "ล่าอัตโนมัติ: server กำลังสู้ให้", { fontFamily: "sans-serif", fontSize: "15px", color: "#0b0a12", backgroundColor: "#f2c94c", padding: { x: 10, y: 4 } })
      .setOrigin(0.5);
    const stop = this.button(W - 200, 20, "หยุดล่า (คุมเอง)", () => this.onStopAuto?.()).setFixedSize(184, 48).setBackgroundColor("#a33b3b");
    this.watchUi = [banner, stop];
  }

  private async watchTick() {
    if (!this.watching || this.busy || this.snap === undefined) return;
    this.busy = true;
    try {
      const { snapshot, events } = await this.transport.poll(this.cursor);
      this.apply(snapshot, events);
    } catch {
      // The next tick tries again.
    } finally {
      this.busy = false;
    }
  }

  private button(x: number, y: number, label: string, fn: () => void, width = 62) {
    // 48px tall touch targets for mobile landscape (P10).
    const t = this.add
      .text(x, y, label, { fontFamily: "sans-serif", fontSize: "15px", color: "#ffffff", backgroundColor: "#463f6b", padding: { x: 4, y: 14 }, fixedWidth: width, align: "center" })
      .setInteractive({ useHandCursor: true });
    t.on("pointerdown", fn);
    return t;
  }

  private toggleAuto() {
    if (this.watching) return;
    this.autoOn = !this.autoOn;
    this.autoButton.setText(this.autoOn ? "Auto: เปิด" : "Auto: ปิด");
  }

  /** Party boss fight (Nut 2026-10-07): is the unit whose turn it is one of ours? Solo fights: always. */
  private myTurn(): boolean {
    const s = this.snap?.state;
    if (s?.members === undefined || this.snap.actor === null) return true;
    const a = this.unit(this.snap.actor);
    return a !== undefined && (a.controllerId ?? s.ownerAccountId) === this.snap.you;
  }

  private async partyTick() {
    const s = this.snap?.state;
    if (s?.members === undefined || s.status !== "active" || this.busy || this.myTurn()) return;
    this.busy = true;
    try {
      // A teammate who left their turn waiting past P22's time: Auto plays it (the server checks the time).
      if (this.snap.standInAt != null && Date.now() >= this.snap.standInAt) {
        const { response, snapshot } = await this.transport.autoStep();
        if (response.status === "accepted") {
          this.pushLog(`${this.name(this.snap.actor ?? "")} ไม่ได้สั่ง: Auto เล่นแทน`);
          return this.apply(snapshot, response.events);
        }
      }
      const { snapshot, events } = await this.transport.poll(this.cursor);
      this.apply(snapshot, events);
    } catch {
      // The next tick tries again.
    } finally {
      this.busy = false;
    }
  }

  private async autoTick() {
    if (!this.autoOn || this.busy || this.snap?.state.status !== "active" || !this.myTurn()) return;
    this.busy = true;
    try {
      const { response, snapshot } = await this.transport.autoStep(savedAutoPolicy());
      // Early by a little: the next tick asks again.
      if (response.status === "rejected" && response.reasonCode === "TOO_FAST") return;
      this.apply(snapshot, response.status === "accepted" ? response.events : [], response);
    } finally {
      this.busy = false;
    }
  }

  /** The skill menu: one button per skill of the unit whose turn it is (name and MP). */
  private skillMenu: Phaser.GameObjects.Text[] = [];
  private closeSkillMenu() {
    for (const b of this.skillMenu) b.destroy();
    this.skillMenu = [];
  }
  private openSkillMenu(actor: BattleUnit) {
    this.closeSkillMenu();
    if (actor.skillIds.length === 0) return this.pushLog("ตัวนี้ยังไม่มีสกิลที่ใช้ได้");
    actor.skillIds.forEach((id, i) => {
      const sk = CONTENT.skills.get(id);
      const area = sk && ["all_enemies", "enemy_row", "all_allies"].includes(sk.targetRule) ? " (หมู่)" : "";
      // Cooldowns count the unit's own turns (O15): "ทุก N ตา", or how long until it is ready.
      const left = actor.cooldowns[id] ?? 0;
      const b = this.add
        .text(16 + i * 132, 410, `${sk?.name.th ?? id}${area}\n${skillButtonLine(sk, left)}`, { fontFamily: "sans-serif", fontSize: "12px", color: left > 0 ? "#b8b4c8" : "#ffffff", backgroundColor: left > 0 ? "#3a3a46" : "#2f6b5a", padding: { x: 6, y: 6 }, fixedWidth: 124, align: "center" })
        .setInteractive({ useHandCursor: true });
      b.on("pointerdown", () => {
        this.closeSkillMenu();
        void this.useSkill(actor, id);
      });
      this.skillMenu.push(b);
    });
  }
  /** Picks the target a skill needs: the selected enemy or ally if it fits, else a sensible default. */
  private skillTarget(actor: BattleUnit, skillId: string): string | null {
    const rule = CONTENT.skills.get(skillId)?.targetRule ?? "single_enemy";
    const sel = this.selectedTarget === null ? undefined : this.unit(this.selectedTarget);
    if (rule === "self") return actor.unitId;
    // Revive skills (O15): the selected fallen ally, else the first one.
    if (CONTENT.skills.get(skillId)?.effectSequence[0]?.kind === "revive") return sel !== undefined && sel.side === actor.side && sel.ko ? sel.unitId : this.firstFallen(actor.side);
    if (rule === "single_ally" || rule === "all_allies") return sel !== undefined && sel.side === actor.side ? sel.unitId : actor.unitId;
    return sel !== undefined && sel.side !== actor.side ? sel.unitId : this.firstEnemy();
  }
  private firstFallen(side: BattleUnit["side"]): string | null {
    return this.snap.state.units.find((u) => u.side === side && u.ko && !u.retired)?.unitId ?? null;
  }
  private async useSkill(actor: BattleUnit, skillId: string) {
    const target = this.skillTarget(actor, skillId);
    if (target === null) return this.pushLog("ไม่มีเป้าหมายสำหรับสกิลนี้");
    if (CONTENT.skills.get(skillId)?.effectSequence[0]?.kind === "revive") {
      const why = reviveRefusal(DEV_FIXTURE_RULES, this.snap.state, actor.unitId, target);
      if (why !== null) return this.pushLog(why);
    }
    await this.send({ type: "skill", actorId: actor.unitId, skillId, targetId: target });
  }

  /** The capture preview: the chance and how it was made, then confirm or cancel (O07 capture-v1). */
  private capturePanel: Phaser.GameObjects.Text[] = [];
  private closeCapturePreview() {
    for (const b of this.capturePanel) b.destroy();
    this.capturePanel = [];
  }
  private openCapturePreview(actorId: string, targetId: string) {
    // Capture is a manual command only (C15): Auto goes off before the player decides.
    if (this.autoOn) {
      this.toggleAuto();
      this.pushLog("ปิด Auto แล้ว: การจับต้องสั่งเอง");
    }
    const pv = capturePreview(DEV_FIXTURE_RULES, this.snap.state, CONTENT, actorId, targetId);
    const itemId = pv.itemId;
    this.showConfirm(pv.lines, pv.ok && itemId !== null, "ยืนยันจับ", () => void this.send({ type: "capture", actorId, targetId, itemId: itemId! }));
  }

  /** A preview panel with confirm/cancel, shared by capture and flee. */
  private showConfirm(lines: string[], ok: boolean, confirmLabel: string, onConfirm: () => void) {
    this.closeCapturePreview();
    this.closeSkillMenu();
    const text = this.add
      .text(16, 300, lines.join("\n"), { fontFamily: "sans-serif", fontSize: "12px", color: ok ? "#ffffff" : "#ffb3b3", backgroundColor: "#1d1a2e", padding: { x: 8, y: 6 }, lineSpacing: 5, wordWrap: { width: 520 } })
      .setDepth(20);
    this.capturePanel.push(text);
    const btn = (x: number, label: string, color: string, fn: () => void) => {
      const b = this.add
        .text(x, 410, label, { fontFamily: "sans-serif", fontSize: "13px", color: "#ffffff", backgroundColor: color, padding: { x: 10, y: 6 } })
        .setDepth(20)
        .setInteractive({ useHandCursor: true });
      b.on("pointerdown", fn);
      this.capturePanel.push(b);
    };
    if (ok)
      btn(16, confirmLabel, "#2f6b5a", () => {
        this.closeCapturePreview();
        onConfirm();
      });
    btn(ok ? 120 : 16, ok ? "ยกเลิก" : "ปิด", "#4a4560", () => this.closeCapturePreview());
  }

  private async act(kind: "attack" | "skill" | "guard" | "item" | "capture" | "flee" | "revive") {
    if (this.watching) return this.pushLog("กำลังล่าอัตโนมัติ: กด หยุดล่า ก่อนสั่งเอง");
    if (this.busy || this.snap.state.status !== "active" || this.snap.actor === null) return;
    if (!this.myTurn()) return this.pushLog(`ยังไม่ถึงตาเรา: ตาของ ${this.name(this.snap.actor)}`);
    const actor = this.unit(this.snap.actor)!;
    const sel = this.selectedTarget === null ? undefined : this.unit(this.selectedTarget);
    const target = sel !== undefined && sel.side === "enemy" ? sel.unitId : this.firstEnemy();
    let cmd: BattleCommand | null = null;
    if (kind !== "skill") this.closeSkillMenu();
    if (kind !== "capture" && kind !== "flee") this.closeCapturePreview();
    switch (kind) {
      case "attack":
        if (target) cmd = { type: "attack", actorId: actor.unitId, targetId: target };
        break;
      case "skill":
        return this.openSkillMenu(actor);
      case "guard":
        cmd = { type: "guard", actorId: actor.unitId };
        break;
      case "item":
        cmd = { type: "item", actorId: actor.unitId, itemId: "item:small_potion", targetId: actor.unitId };
        break;
      case "capture":
        if (target) return this.openCapturePreview(actor.unitId, target);
        break;
      case "flee": {
        // Flee chance from SPD and the monsters' flee values (O15); the server rolls.
        const pv = fleePreview(DEV_FIXTURE_RULES, this.snap.state, CONTENT.species, actor.unitId, (id) => this.name(id));
        return this.showConfirm(pv.lines, pv.ok, "ยืนยันหนี", () => void this.send({ type: "flee", actorId: actor.unitId }));
      }
      case "revive": {
        // Revive item on the selected fallen ally, else the first one (O15: from the round after it fell).
        const t = sel !== undefined && sel.side === "ally" && sel.ko ? sel.unitId : this.firstFallen("ally");
        if (t === null) return this.pushLog("ไม่มีพวกที่ล้มให้ชุบ");
        const why = reviveRefusal(DEV_FIXTURE_RULES, this.snap.state, actor.unitId, t);
        if (why !== null) return this.pushLog(why);
        cmd = { type: "item", actorId: actor.unitId, itemId: "item:phoenix_feather", targetId: t };
        break;
      }
    }
    if (cmd === null) return this.pushLog("ไม่มีเป้าหมาย/สกิลสำหรับคำสั่งนี้");
    await this.send(cmd);
  }

  private async send(cmd: BattleCommand) {
    if (this.busy) return;
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
    // A preview made for an older state is out of date (HP, statuses, bag may have moved).
    if (events.length > 0) this.closeCapturePreview();
    if (response?.status === "rejected") this.pushLog(`ปฏิเสธ: ${refusalTh(response.reasonCode, response.message)}`);
    for (const e of events) {
      // Polls can overlap with command responses: show each event once.
      if (e.seq <= this.cursor) continue;
      this.cursor = e.seq;
      this.describe(e);
    }
    this.render(snapshot.state);
  }

  private describe(e: BattleEvent) {
    switch (e.type) {
      case "RoundStarted":
        return this.pushLog(`— รอบ ${e.round} —`);
      case "BossPhaseChanged": {
        const ph = this.bossPhase(e.phase);
        return this.pushLog(`${this.name(e.unitId)} เข้าช่วง ${e.phase + 1}${ph ? `: ${ph.name.th}` : ""}`);
      }
      case "BossTelegraph": {
        const sk = CONTENT.skills.get(e.skillId)?.name.th ?? e.skillId;
        if (e.change === "announced") {
          this.popup(e.unitId, `เตรียม ${sk}!`, "#ff6b6b");
          return this.pushLog(`⚠ ${this.name(e.unitId)} เตรียมใช้ ${sk} ในรอบ ${e.firesRound}`);
        }
        return this.pushLog(e.change === "fired" ? `${this.name(e.unitId)} ใช้ ${sk}!` : `${sk} ของ ${this.name(e.unitId)} ถูกยกเลิก`);
      }
      case "EliteTrait": {
        const m = ELITE_MODIFIER_TH[e.modifier];
        const who = this.name(e.unitId);
        switch (e.change) {
          case "active":
            return this.pushLog(`★ ${who} ชั้นยอด: ${m.name} (${m.hint})`);
          case "enraged":
            this.popup(e.unitId, "คลั่ง!", "#ff6b6b");
            return this.pushLog(`${who} คลั่ง! โจมตีและความเร็วเพิ่ม`);
          case "broken":
            return this.pushLog(`${who} ล้มแล้ว ลูกฝูงเสียขวัญ (บัฟหาย)`);
          case "warned":
            this.popup(e.unitId, "เตรียมสวนเวท!", "#ff6b6b");
            return this.pushLog(`⚠ ${who} จะสวนเวทใส่ ${this.name(e.targetId ?? "")} ในตาถัดไป (ป้องกันหรือหยุดมันไว้)`);
          case "fired":
            return this.pushLog(`${who} สวนเวทใส่ ${this.name(e.targetId ?? "")}!`);
          case "cancelled":
            return this.pushLog(`การสวนเวทของ ${who} ถูกยกเลิก`);
        }
        return;
      }
      case "CaptureWindowOpened":
        this.popup(e.unitId, "จับได้แล้ว!", "#7dff9b");
        return this.pushLog(`${this.name(e.unitId)} อ่อนแรง: ใช้เครื่องจับได้แล้ว`);
      case "TurnStarted":
        // Bosses with several actions a round say which one this is (chapter 03 timeline).
        if (e.action !== undefined) return this.pushLog(`${this.name(e.unitId)} ลงมือครั้งที่ ${e.action}/${e.actionsThisRound}`);
        return;
      case "ActionResolved": {
        const via = e.skillId === null ? "" : ` [${CONTENT.skills.get(e.skillId)?.name.th ?? e.skillId}]`;
        if (e.damage !== null && e.targetId) {
          this.popup(e.targetId, e.hit ? `${e.damage}${e.crit ? "!" : ""}` : "พลาด", e.crit ? "#ffd84a" : "#ffffff");
          return this.pushLog(`${this.name(e.actorId)}${via} → ${this.name(e.targetId)}: ${e.hit ? e.damage : "พลาด"}${e.crit ? " (คริ)" : ""}`);
        }
        if (e.heal !== null && e.targetId) {
          this.popup(e.targetId, `+${e.heal}`, "#7dff9b");
          return this.pushLog(`${this.name(e.actorId)}${via} ฟื้น ${this.name(e.targetId)} +${e.heal}`);
        }
        if (e.action === "guard") return this.pushLog(`${this.name(e.actorId)} ป้องกัน`);
        if (e.action === "skill" && e.targetId) return this.pushLog(`${this.name(e.actorId)} ใช้${via} ใส่ ${this.name(e.targetId)}`);
        return;
      }
      case "CaptureResolved":
        return this.pushLog(`จับ ${this.name(e.targetId)}: ${e.success ? "สำเร็จ (ได้ Lv1)" : "ไม่สำเร็จ (เครื่องจับถูกใช้ไป 1 ชิ้น)"} โอกาส ${pct2(e.probability)}`);
      case "FleeResolved":
        return this.pushLog(`หนี: ${e.success ? "สำเร็จ" : "ไม่สำเร็จ (เสียตานี้)"} โอกาส ${pct2(e.chancePct / 100)}`);
      case "UnitRevived": {
        const via = CONTENT.skills.get(e.sourceId)?.name.th ?? CONTENT.items.get(e.sourceId)?.name.th ?? e.sourceId;
        this.popup(e.unitId, "ฟื้น!", "#7dff9b");
        return this.pushLog(`${this.name(e.byId)} ใช้${via} ชุบ ${this.name(e.unitId)} กลับมา HP ${e.hp} (ลงมือได้ตั้งแต่รอบหน้า)`);
      }
      case "EnemyDefeated":
        return this.pushLog(`${this.name(e.unitId)} ถูกกำจัด`);
      case "ReinforcementArrived":
        // Tower: a pre-rolled replacement takes the fallen enemy's cell (frontier.ts).
        this.popup(e.unitId, "กำลังเสริม!", "#ffb36b");
        return this.pushLog(`กำลังเสริม: ${CONTENT.species.get(e.speciesId)?.name.th ?? e.speciesId} เข้าแทน ${this.name(e.replaces)} (เหลือ ${e.left})`);
      case "RewardEntitled": {
        const r = e.entitlement;
        if (r.kind === "kill") {
          return this.pushLog(`สิทธิ์รางวัล: ${r.items.map((i) => `${lootName(i.itemId)}×${i.quantity}`).join(", ") || "ไม่มีของ"}${expText(r.exp)}`);
        }
        if (r.kind === "capture") {
          return this.pushLog(`สิทธิ์คู่ใจใหม่: ${CONTENT.species.get(r.speciesId)?.name.th ?? r.speciesId} Lv${r.level}${expText(r.exp)}`);
        }
        const parts = Object.entries(r.companions).map(([id, g]) => {
          const name = this.name(`ally:${id}`);
          return `${name} Bond ${g.bond >= 0 ? "+" : ""}${g.bond}${g.mastery > 0 ? ` ความชำนาญ +${g.mastery}` : ""}`;
        });
        return this.pushLog(`คู่ใจ: ${parts.join(", ")}`);
      }
      case "StatusChanged": {
        const th = STATUS_DEFINITIONS[e.statusId].th;
        const chance = e.chancePct === null ? "" : ` (โอกาส ${Math.round(e.chancePct)}%)`;
        const who = this.name(e.unitId);
        if (e.change === "applied" && STATUS_DEFINITIONS[e.statusId].instant !== undefined) {
          this.popup(e.unitId, th, "#ffd36b");
          return this.pushLog(`${who} โดน${th}${chance}`);
        }
        if (e.change === "applied" || e.change === "refreshed") {
          this.popup(e.unitId, th, STATUS_DEFINITIONS[e.statusId].harmful ? "#ff9b6b" : "#7dd3ff");
          return this.pushLog(`${who} ติด${th} ${e.turnsLeft} เทิร์น${e.stacks > 1 ? ` ×${e.stacks}` : ""}${chance}`);
        }
        if (e.change === "resisted") return this.pushLog(`${who} ต้าน${th}ได้${chance}`);
        if (e.change === "immune") return this.pushLog(`${who} ไม่ติด${th} (บอสกันการควบคุม)`);
        if (e.change === "blocked") return this.pushLog(`${who} ไม่ติด${th} (ถูกกันไว้)`);
        if (e.change === "expired") return this.pushLog(`${who} หมดผล${th}`);
        return this.pushLog(`${who} หาย${th}`);
      }
      case "StatusTick":
        this.popup(e.unitId, e.hp < 0 ? `${-e.hp}` : `+${e.hp}`, e.hp < 0 ? "#c58cff" : "#7dff9b");
        return this.pushLog(`${this.name(e.unitId)} ${STATUS_DEFINITIONS[e.statusId].th} ${e.hp < 0 ? e.hp : `+${e.hp}`}`);
      case "ActionRedirected":
        return this.pushLog(`${this.name(e.actorId)} ${STATUS_DEFINITIONS[e.statusId].th} หันไปทำใส่ ${this.name(e.toId)} แทน ${this.name(e.fromId)}`);
      case "ResourceChanged": {
        const label = { lifesteal: "ดูดเลือด", recoil: "สะท้อนกลับตัวเอง", restore_mp: "ฟื้น MP", leech: "ถูกดูดพลัง", mana_burn: "เผามานา", mp_regen: "ฟื้น MP", passive: "ได้จากความสามารถติดตัว" }[e.source];
        const parts = [e.hp !== 0 ? `HP ${e.hp > 0 ? "+" : ""}${e.hp}` : "", e.mp !== 0 ? `MP ${e.mp > 0 ? "+" : ""}${e.mp}` : ""].filter(Boolean).join(" ");
        return parts === "" ? undefined : this.pushLog(`${this.name(e.unitId)} ${label} ${parts}`);
      }
      case "PassiveTriggered": {
        const from = CONTENT.skills.get(e.sourceId)?.name.th ?? CONTENT.sigils.get(e.sourceId)?.name.th ?? e.sourceId;
        this.popup(e.unitId, from, "#ffe08a");
        return this.pushLog(`${this.name(e.unitId)} ${e.sourceId.startsWith("sigil:") ? "Sigil" : "ความสามารถติดตัว"} [${from}] ทำงาน`);
      }
      case "ShieldChanged":
        if (e.change === "gained") {
          this.popup(e.unitId, `โล่ ${e.amount}`, "#9fd8ff");
          return this.pushLog(`${this.name(e.unitId)} ได้โล่ ${e.amount}`);
        }
        this.popup(e.unitId, `โล่ −${e.amount}`, "#9fd8ff");
        return this.pushLog(`${this.name(e.unitId)} โล่รับ ${e.amount}${e.change === "broken" ? " (แตก)" : ` เหลือ ${e.shieldLeft}`}`);
      case "TurnSkipped":
        return this.pushLog(`${this.name(e.unitId)} ${STATUS_DEFINITIONS[e.statusId].th} ข้ามเทิร์น`);
      case "BattleEnded":
        return this.pushLog(`จบไฟต์: ${e.outcome}`);
      default:
        return;
    }
  }

  private bossPhase(index: number) {
    const b = this.snap.state.boss;
    return b === undefined ? undefined : CONTENT.bosses.get(b.bossId)?.phases[index];
  }

  private render(state: PublicBattleState) {
    for (const u of state.units) {
      const { x, y } = this.position(u);
      let v = this.views.get(u.unitId);
      // A tower enemy whose cell a reinforcement took: its body leaves the field.
      if (u.replacedBy !== undefined) {
        if (v !== undefined) for (const o of [v.body, v.hpBar, v.label, v.ring, v.sub]) o.setVisible(false);
        continue;
      }
      // Enemies are drawn a little shorter so a full row of five (tower floors: ten) stays readable.
      const enemy = u.side === "enemy";
      // Party boss fights: ten allies in two rows of five, drawn like the enemy rows.
      const partyFight = state.members !== undefined;
      const compact = enemy || partyFight;
      const bh = compact ? 36 : 56;
      if (!v) {
        const body = this.add.rectangle(x, y, 48, bh, ELEMENT_COLOR[u.element]).setStrokeStyle(3, 0x0b0a12).setInteractive({ useHandCursor: true });
        body.on("pointerdown", () => {
          // Enemies for attacks and enemy skills; allies for heals, buffs and shields.
          // A fallen ally can be picked too, as the target of a revive (O15).
          if ((!u.ko || u.side === "ally") && !u.retired) this.selectedTarget = u.unitId;
          this.render(this.snap.state);
        });
        if (u.cosmetic !== undefined) this.drawCosmetic(body, u.cosmetic);
        const ring = this.add.rectangle(x, y, 60, bh + 12).setStrokeStyle(2, 0xffffff).setVisible(false);
        this.add.rectangle(x, y + bh / 2 + 8, 52, 6, 0x0b0a12);
        const hpBar = this.add.rectangle(x - 25, y + bh / 2 + 8, 50, 4, 0x6be36b).setOrigin(0, 0.5);
        // Bottom-anchored so a second line (statuses) grows upwards.
        const label = this.add.text(x, y - bh / 2 - 9, "", { fontFamily: "sans-serif", fontSize: "12px", color: "#ffffff", align: "center" }).setOrigin(0.5, 1);
        const sub = enemy
          ? this.add.text(x + 30, y, "", { fontFamily: "sans-serif", fontSize: "10px", color: "#ffd84a", wordWrap: { width: u.row === "front" ? 96 : 140 } }).setOrigin(0, 0.5)
          : partyFight
            ? this.add.text(x - 30, y, "", { fontFamily: "sans-serif", fontSize: "10px", color: "#ffd84a", align: "right", wordWrap: { width: 80 } }).setOrigin(1, 0.5)
          : this.add.text(x, y + bh / 2 + 14, "", { fontFamily: "sans-serif", fontSize: "11px", color: "#ffd84a", align: "center" }).setOrigin(0.5, 0);
        v = { body, hpBar, label, ring, sub };
        this.views.set(u.unitId, v);
      }
      v.body.setPosition(x, y).setAlpha(u.ko || u.retired ? 0.25 : 1);
      v.ring.setPosition(x, y).setVisible(u.unitId === this.snap.actor || u.unitId === this.selectedTarget);
      v.ring.setStrokeStyle(2, u.unitId === this.snap.actor ? 0x7dff9b : 0xff6b6b);
      v.hpBar.setPosition(x - 25, y + bh / 2 + 8).setSize(Math.max(0, 50 * (u.hp / u.stats.maxHp)), 4);
      const tags = (u.statuses ?? []).map((st) => `${STATUS_DEFINITIONS[st.statusId].th}${st.turnsLeft}`).join(" ");
      // An elite leader says so, with its modifiers (chapter 07 §3), readable without colour.
      const elite = u.elite === undefined ? "" : `★ชั้นยอด\n${u.elite.modifiers.map((m) => ELITE_MODIFIER_TH[m].name).join(", ")}${u.elite.counterOn !== null ? " ⚠สวน!" : ""}`;
      // A tower reinforcement says so (it took a fallen enemy's cell this fight).
      const reinforcement = state.units.some((o) => o.replacedBy === u.unitId) ? "▲กำลังเสริม" : "";
      const name = `${u.name} Lv${u.level}${u.retired ? " (จับแล้ว)" : ""}`;
      if (enemy) {
        // One name line above; statuses and tags beside the body, inside this cell's band.
        v.sub.setPosition(x + 30, y).setText([tags, elite, reinforcement].filter(Boolean).join("\n"));
        v.label.setPosition(x, y - bh / 2 - 9).setText(name);
      } else if (partyFight) {
        // Statuses beside the body; our own units' names in gold so they stand out from teammates'.
        v.sub.setPosition(x - 30, y).setText([tags, elite].filter(Boolean).join("\n"));
        v.label.setPosition(x, y - bh / 2 - 9).setText(name).setColor((u.controllerId ?? state.ownerAccountId) === this.snap.you ? "#f2c94c" : "#ffffff");
      } else {
        v.sub.setPosition(x, y + bh / 2 + 14).setText([elite, reinforcement].filter(Boolean).join("\n"));
        v.label.setPosition(x, y - bh / 2 - 9).setText(`${name}${tags ? `\n${tags}` : ""}`);
      }
    }
    const actor = this.snap.actor ? this.unit(this.snap.actor) : undefined;
    // Boss fights: the phase, and a warned move with what answers it (chapter 07 §5, readable without colour).
    let bossLine = "";
    if (state.boss !== undefined && state.status === "active") {
      const ph = this.bossPhase(state.boss.phase);
      bossLine = `\nบอส ช่วง ${state.boss.phase + 1}${ph ? ` ${ph.name.th}` : ""}`;
      if (state.boss.telegraph !== null) {
        const sk = CONTENT.skills.get(state.boss.telegraph.skillId)?.name.th ?? state.boss.telegraph.skillId;
        bossLine += ` · ⚠ ${sk} รอบ ${state.boss.telegraph.firesRound}${ph?.telegraph ? `: ${ph.telegraph.hint.th}` : ""}`;
      }
    }
    // Weekly tower: the floor's name, gimmicks and reinforcements left, and a boss label on boss floors.
    let tower = "";
    if (state.frontier !== undefined) {
      const fd = EXAMPLE_FRONTIER.floors[state.frontier.floor - 1];
      const mods = (state.frontier.modifiers ?? []).map((m) => FRONTIER_MODIFIER_TH[m].name).join(", ");
      const left = state.frontier.reinforcementsLeft ?? 0;
      tower =
        `\n${EXAMPLE_FRONTIER.name.th} ชั้น ${state.frontier.floor} ${fd?.name.th ?? ""}${state.boss !== undefined ? ` · ★ ชั้นบอส${fd?.guardianTitle ? ` ${fd.guardianTitle.th}` : ""}` : ""}` +
        ` · ศัตรู ×${(state.frontier.statPct / 100).toFixed(2)}${mods ? ` · ลูกเล่น: ${mods}` : ""}${left > 0 ? ` · กำลังเสริมเหลือ ${left}` : ""}`;
    }
    const party = state.partyBonus ? `ปาร์ตี้ ${state.partyBonus.partners} คน: EXP +${state.partyBonus.expPercent}% วัสดุ +${state.partyBonus.materialDropPercent}%` : "";
    const waiting = state.members !== undefined && !this.myTurn() ? " (เพื่อน · รอเขาสั่ง)" : "";
    this.turnText.setText(
      state.status === "active" ? `รอบ ${state.round} · ตาของ ${actor?.name ?? "-"}${waiting} · แตะศัตรูเพื่อเลือกเป้า` : `จบไฟต์: ${state.status}`,
    );
    this.infoText.setText(`${party}${tower}${bossLine}`.replace(/^\n/, ""));
    if (state.status !== "active" && this.onExit !== null && this.exitButton === null && !this.watching) {
      const exit = this.onExit;
      this.exitButton = this.button(W - 200, 20, "กลับไปเดินต่อ", () => exit()).setFixedSize(184, 48).setBackgroundColor("#2f7a4a");
    }
  }

  /**
   * Stage-3 Rebirth look (placeholder art until the pixel pass): a pulsing glow in the species' colour
   * plus a small looping effect, drawn where the unit stands when the fight opens.
   */
  private drawCosmetic(body: Phaser.GameObjects.Rectangle, c: { effect: string; color: string }) {
    const color = Number.parseInt(c.color.slice(1), 16);
    // Same depth as the body but drawn just under it, so the field background stays behind both.
    const glow = this.add.ellipse(body.x, body.y + 4, 78, 86, color, 1);
    this.children.moveBelow(glow, body);
    this.tweens.add({ targets: glow, alpha: { from: 0.25, to: 0.6 }, scale: { from: 0.95, to: 1.08 }, duration: 900, yoyo: true, repeat: -1 });
    if (c.effect === "ripple" || c.effect === "aura") {
      const ring = this.add.ellipse(body.x, body.y + 28, 44, 14).setStrokeStyle(3, color);
      this.children.moveBelow(ring, body);
      this.tweens.add({ targets: ring, scaleX: 2, scaleY: 2, alpha: { from: 0.9, to: 0 }, duration: 1200, repeat: -1 });
    } else {
      for (let i = 0; i < 4; i++) {
        const dot = this.add.rectangle(body.x - 18 + i * 12, body.y + 20, 4, 4, color);
        this.tweens.add({ targets: dot, y: body.y - 36, alpha: { from: 1, to: 0 }, duration: 1000 + i * 150, delay: i * 200, repeat: -1 });
      }
    }
  }

  private position(u: BattleUnit) {
    // Party boss fights have 5 cells a row (P22): the same band, tighter.
    if (u.side === "ally") return this.snap.state.members !== undefined ? { x: u.row === "front" ? 360 : 230, y: 118 + u.slot * 76 } : { x: u.row === "front" ? 330 : 210, y: 150 + u.slot * 100 };
    // Five cells a row, spaced so ten enemies (tower floors) keep their names and bars apart.
    return { x: u.row === "front" ? 600 : 760, y: 118 + u.slot * 76 };
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
