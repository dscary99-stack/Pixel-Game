/**
 * Battle preview scene. Placeholder shapes only: real pixel art and animation come from the art
 * pipeline (chapter 10) and are not part of Phase A. The scene draws what the transport reports;
 * it never computes damage, loot, capture or ownership itself (chapter 11 §1).
 */
import Phaser from "phaser";
import { DEV_FIXTURE_RULES, STATUS_DEFINITIONS, exampleContentMaps, type BattleCommand, type BattleEvent, type BattleUnit, type Element, type PublicBattleState } from "@pmrpg/shared";
import type { BattleTransport, Snapshot } from "./transport";
import { savedAutoPolicy } from "./character-ui";

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
    // The server holds Auto to one action per autoBattleActionMs, the same as Auto Hunt.
    this.time.addEvent({ delay: DEV_FIXTURE_RULES.provisional.autoBattleActionMs.value, loop: true, callback: () => void this.autoTick() });
    const onHide = () => {
      if (document.visibilityState !== "visible" && this.autoOn) this.toggleAuto();
    };
    document.addEventListener("visibilitychange", onHide);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => document.removeEventListener("visibilitychange", onHide));

    // While watching, read what the server did; the server paces the actions (Auto Hunt).
    this.time.addEvent({ delay: 400, loop: true, callback: () => void this.watchTick() });
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

  private button(x: number, y: number, label: string, fn: () => void) {
    // 84x48 touch target for mobile landscape (P10).
    const t = this.add
      .text(x, y, label, { fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff", backgroundColor: "#463f6b", padding: { x: 12, y: 14 }, fixedWidth: 84, align: "center" })
      .setInteractive({ useHandCursor: true });
    t.on("pointerdown", fn);
    return t;
  }

  private toggleAuto() {
    if (this.watching) return;
    this.autoOn = !this.autoOn;
    this.autoButton.setText(this.autoOn ? "Auto: เปิด" : "Auto: ปิด");
  }

  private async autoTick() {
    if (!this.autoOn || this.busy || this.snap?.state.status !== "active") return;
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
      const b = this.add
        .text(16 + i * 132, 410, `${sk?.name.th ?? id}${area}\n${sk?.mpCost ?? 0} MP`, { fontFamily: "sans-serif", fontSize: "12px", color: "#ffffff", backgroundColor: "#2f6b5a", padding: { x: 6, y: 6 }, fixedWidth: 124, align: "center" })
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
    if (rule === "single_ally" || rule === "all_allies") return sel !== undefined && sel.side === actor.side ? sel.unitId : actor.unitId;
    return sel !== undefined && sel.side !== actor.side ? sel.unitId : this.firstEnemy();
  }
  private async useSkill(actor: BattleUnit, skillId: string) {
    const target = this.skillTarget(actor, skillId);
    if (target === null) return this.pushLog("ไม่มีเป้าหมายสำหรับสกิลนี้");
    await this.send({ type: "skill", actorId: actor.unitId, skillId, targetId: target });
  }

  private async act(kind: "attack" | "skill" | "guard" | "item" | "capture") {
    if (this.watching) return this.pushLog("กำลังล่าอัตโนมัติ: กด หยุดล่า ก่อนสั่งเอง");
    if (this.busy || this.snap.state.status !== "active" || this.snap.actor === null) return;
    const actor = this.unit(this.snap.actor)!;
    const sel = this.selectedTarget === null ? undefined : this.unit(this.selectedTarget);
    const target = sel !== undefined && sel.side === "enemy" ? sel.unitId : this.firstEnemy();
    let cmd: BattleCommand | null = null;
    if (kind !== "skill") this.closeSkillMenu();
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
      case "capture": {
        const t = target ? this.unit(target) : undefined;
        if (t?.speciesId) cmd = { type: "capture", actorId: actor.unitId, targetId: t.unitId, itemId: `item:${t.speciesId.slice("species:".length)}_capture` };
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
    if (response?.status === "rejected") this.pushLog(`ปฏิเสธ: ${response.reasonCode} ${response.message ?? ""}`);
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
        return this.pushLog(`จับ ${this.name(e.targetId)}: ${e.success ? "สำเร็จ (ได้ Lv1)" : "ไม่สำเร็จ"} โอกาส ${(e.probability * 100).toFixed(0)}%`);
      case "EnemyDefeated":
        return this.pushLog(`${this.name(e.unitId)} ถูกกำจัด`);
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
      if (!v) {
        const body = this.add.rectangle(x, y, 48, 56, ELEMENT_COLOR[u.element]).setStrokeStyle(3, 0x0b0a12).setInteractive({ useHandCursor: true });
        body.on("pointerdown", () => {
          // Enemies for attacks and enemy skills; allies for heals, buffs and shields.
          if (!u.ko && !u.retired) this.selectedTarget = u.unitId;
          this.render(this.snap.state);
        });
        if (u.cosmetic !== undefined) this.drawCosmetic(body, u.cosmetic);
        const ring = this.add.rectangle(x, y, 60, 68).setStrokeStyle(2, 0xffffff).setVisible(false);
        this.add.rectangle(x, y + 36, 52, 6, 0x0b0a12);
        const hpBar = this.add.rectangle(x - 25, y + 36, 50, 4, 0x6be36b).setOrigin(0, 0.5);
        // Bottom-anchored so a second line (statuses) grows upwards.
        const label = this.add.text(x, y - 37, "", { fontFamily: "sans-serif", fontSize: "12px", color: "#ffffff", align: "center" }).setOrigin(0.5, 1);
        v = { body, hpBar, label, ring };
        this.views.set(u.unitId, v);
      }
      v.body.setPosition(x, y).setAlpha(u.ko || u.retired ? 0.25 : 1);
      v.ring.setPosition(x, y).setVisible(u.unitId === this.snap.actor || u.unitId === this.selectedTarget);
      v.ring.setStrokeStyle(2, u.unitId === this.snap.actor ? 0x7dff9b : 0xff6b6b);
      v.hpBar.setPosition(x - 25, y + 36).setSize(Math.max(0, 50 * (u.hp / u.stats.maxHp)), 4);
      const tags = (u.statuses ?? []).map((st) => `${STATUS_DEFINITIONS[st.statusId].th}${st.turnsLeft}`).join(" ");
      v.label.setPosition(x, y - 37).setText(`${u.name} Lv${u.level}${u.retired ? " (จับแล้ว)" : ""}${tags ? `\n${tags}` : ""}`);
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
    const party = state.partyBonus ? ` · ปาร์ตี้ ${state.partyBonus.partners} คน: EXP +${state.partyBonus.expPercent}% วัสดุ +${state.partyBonus.materialDropPercent}%` : "";
    this.turnText.setText(
      (state.status === "active" ? `รอบ ${state.round} · ตาของ ${actor?.name ?? "-"} · แตะศัตรูเพื่อเลือกเป้า` : `จบไฟต์: ${state.status}`) + party + bossLine,
    );
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
