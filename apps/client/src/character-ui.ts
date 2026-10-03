/**
 * DOM overlays for character creation and the team screen. Plain HTML over the canvas because
 * Thai text input and lists are easier there than in Phaser. Placeholder styling; the real UI
 * comes with the art pass (chapter 10 §4).
 */
import {
  exampleMapRegistry,
  type PartyView,
  rebirthCost,
  expForLevel,
  PRIMARY_KEYS,
  companionCombatProfile,
  AutoHuntSettingsSchema,
  type AutoHuntSettings,
  CLASS1_DEFINITIONS,
  PLAYER_ELEMENTS,
  RACE_DEFINITIONS,
  EQUIP_SLOTS,
  SLOT_FOR_CATEGORY,
  deriveStats,
  exampleContentMaps,
  gearBonuses,
  sellQuote,
  sigilCapacity,
  sigilFits,
  sigilRemovalCost,
  wornGear,
  PRODUCTION_RULES,
  type CharacterView,
  type Element,
  type EquipSlot,
  type EquipmentView,
  type PrimaryStats,
  type SigilGroup,
  PRIMARY_STATS,
  expProgress,
  statRaiseCost,
  unspentPoints,
} from "@pmrpg/shared";
import { ApiError, type CharacterApi, type CharacterBundle } from "./character-api";

const maps = exampleMapRegistry();
const { species, equipment: equipmentDefs, items: itemDefs, sigils: sigilDefs } = exampleContentMaps();
/** Display only: the client shows socket counts and prices, the server applies its own rules. */
const RULES = PRODUCTION_RULES;

export const ELEMENT_TH: Record<Element, string> = {
  FIRE: "ไฟ",
  WATER: "น้ำ",
  EARTH: "ดิน",
  WIND: "ลม",
  LIGHT: "แสง",
  SHADOW: "เงา",
  NEUTRAL: "ไร้ธาตุ",
};

const CSS = `
.pm-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  background: #0b0a12cc; z-index: 10; font-family: sans-serif; color: #fff; padding: 16px; box-sizing: border-box; }
.pm-panel { background: #241f36; border: 2px solid #463f6b; border-radius: 8px; padding: 18px 20px; width: min(560px, 100%);
  max-height: 100%; overflow: auto; box-sizing: border-box; }
.pm-panel h2 { margin: 0 0 12px; font-size: 20px; color: #f2c94c; }
.pm-panel label { display: block; margin: 12px 0 6px; font-size: 14px; color: #d8d4ea; }
.pm-panel input[type=text] { width: 100%; box-sizing: border-box; padding: 10px; font-size: 16px; border-radius: 6px;
  border: 1px solid #463f6b; background: #14121c; color: #fff; }
.pm-choices { display: flex; flex-wrap: wrap; gap: 6px; }
.pm-choices button, .pm-actions button { min-height: 40px; padding: 8px 12px; font-size: 14px; border-radius: 6px;
  border: 1px solid #463f6b; background: #322b4d; color: #fff; cursor: pointer; }
.pm-choices button[aria-pressed=true] { background: #f2c94c; color: #1b1830; border-color: #f2c94c; }
.pm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.pm-actions .primary { background: #2f7a4a; border-color: #2f7a4a; }
.pm-error { color: #ff8a8a; min-height: 18px; margin-top: 10px; font-size: 14px; }
.pm-note { color: #a9a3c4; font-size: 12px; margin-top: 6px; }
.pm-list { list-style: none; padding: 0; margin: 0; }
.pm-item-rule { border: 1px solid #322b4d; border-radius: 6px; padding: 8px; margin: 6px 0; }
.pm-list li { display: flex; align-items: center; gap: 10px; padding: 8px; border-bottom: 1px solid #322b4d; }
.pm-list li.ko { opacity: 0.6; }
.pm-list input { width: 20px; height: 20px; }
.pm-dot { width: 14px; height: 14px; border-radius: 3px; flex: none; }
.pm-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.pm-slot { border: 1px solid #463f6b; border-radius: 6px; padding: 6px 8px; min-height: 44px; font-size: 13px; background: #1b1830; }
.pm-slot b { display: block; font-size: 11px; color: #a9a3c4; font-weight: normal; }
.pm-slot button { margin-top: 4px; min-height: 30px; padding: 2px 8px; font-size: 12px; border-radius: 4px; border: 1px solid #463f6b; background: #322b4d; color: #fff; cursor: pointer; }
.pm-stats { font-size: 13px; color: #d8d4ea; margin: 10px 0; line-height: 1.6; }
.pm-list li .pm-grow { flex: 1 1 220px; }
.pm-list[data-section=sigils] li { flex-wrap: wrap; }
.pm-list li button { min-height: 34px; padding: 4px 10px; font-size: 13px; border-radius: 6px; border: 1px solid #463f6b; background: #2f7a4a; color: #fff; cursor: pointer; }
.pm-list li button:disabled { background: #322b4d; opacity: 0.6; cursor: default; }
`;

const ELEMENT_CSS: Record<Element, string> = {
  FIRE: "#f26b3a",
  WATER: "#3a8ef2",
  EARTH: "#b08a4a",
  WIND: "#5fd18b",
  LIGHT: "#f2df6b",
  SHADOW: "#8a5fd1",
  NEUTRAL: "#c8c8d0",
};

function overlay(): { root: HTMLDivElement; panel: HTMLDivElement; close: () => void } {
  if (document.getElementById("pm-style") === null) {
    const style = document.createElement("style");
    style.id = "pm-style";
    style.textContent = CSS;
    document.head.append(style);
  }
  const root = document.createElement("div");
  root.className = "pm-overlay";
  const panel = document.createElement("div");
  panel.className = "pm-panel";
  root.append(panel);
  document.body.append(root);
  return { root, panel, close: () => root.remove() };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A row of toggle buttons; returns a getter for the picked value. */
function choices(parent: HTMLElement, items: { value: string; label: string }[], initial: string): () => string {
  const box = el("div", { class: "pm-choices", role: "group" });
  let picked = initial;
  const buttons = items.map((it) => {
    const b = el("button", { type: "button", "aria-pressed": String(it.value === initial), "data-value": it.value }, it.label);
    b.addEventListener("click", () => {
      picked = it.value;
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    box.append(b);
    return b;
  });
  parent.append(box);
  return () => picked;
}

/**
 * New-character form. Resolves with the stored character once the server accepts it. The
 * operation id is kept for the whole form, so a retried submit cannot make a second character.
 */
export function createCharacterForm(api: CharacterApi): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    const operationId = `create_${crypto.randomUUID().replace(/-/g, "")}`;
    panel.append(el("h2", {}, "สร้างตัวละคร"));
    panel.append(el("label", { for: "pm-name" }, "ชื่อ (2–16 ตัวอักษร)"));
    const name = el("input", { id: "pm-name", type: "text", maxlength: "16", autocomplete: "off" });
    panel.append(name);
    panel.append(el("label", {}, "อาชีพเริ่มต้น (Class 1)"));
    const cls = choices(panel, CLASS1_DEFINITIONS.map((c) => ({ value: c.id, label: c.name.th })), CLASS1_DEFINITIONS[0]!.id);
    panel.append(el("label", {}, "เผ่า"));
    const race = choices(panel, RACE_DEFINITIONS.map((r) => ({ value: r.id, label: r.name.th })), RACE_DEFINITIONS[0]!.id);
    panel.append(el("label", {}, "ธาตุ"));
    const element = choices(panel, PLAYER_ELEMENTS.map((e) => ({ value: e, label: ELEMENT_TH[e] })), PLAYER_ELEMENTS[0]);
    panel.append(el("div", { class: "pm-note" }, "รายชื่ออาชีพและเผ่าเป็นแบบร่าง (P16) ยังไม่มีสกิลหรือ passive เฉพาะ ทุกค่าสเตตัสเริ่มที่ 10"));
    const error = el("div", { class: "pm-error", role: "alert" });
    panel.append(error);
    const actions = el("div", { class: "pm-actions" });
    const submit = el("button", { type: "button", class: "primary" }, "เริ่มผจญภัย");
    actions.append(submit);
    panel.append(actions);
    name.focus();

    const send = async () => {
      submit.disabled = true;
      error.textContent = "";
      try {
        await api.create({ name: name.value, classId: cls(), raceId: race(), element: element() as Element }, operationId);
        const bundle = await api.get();
        if (bundle === null) throw new Error("character not found after create");
        close();
        resolve(bundle);
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
        submit.disabled = false;
      }
    };
    submit.addEventListener("click", () => void send());
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void send();
    });
  });
}

/** Max HP/MP for the HUD, from the shared stat formula with worn gear. */
export function vitals(c: CharacterView, equipment: readonly EquipmentView[] = []) {
  const d = deriveStats(c.level, c.primaryStats, gearBonuses(wornGear(equipment, equipmentDefs).defs));
  return { hp: c.hp ?? d.maxHp, maxHp: d.maxHp, mp: c.mp ?? d.maxMp, maxMp: d.maxMp };
}

export const SLOT_TH: Record<EquipSlot, string> = {
  HEAD_TOP: "หมวก",
  HEAD_MID: "หน้า/ตา",
  HEAD_LOW: "ปาก",
  ARMS: "แขน",
  ARMOR: "เสื้อเกราะ",
  FEET: "รองเท้า",
  MAIN_HAND: "มือหลัก",
  OFF_HAND: "มือรอง",
  ACCESSORY_1: "เครื่องประดับ 1",
  ACCESSORY_2: "เครื่องประดับ 2",
  BACK: "หลัง",
  AURA: "ออร่า",
};

const STAT_TH: Record<string, string> = {
  HP: "HP",
  MP: "MP",
  PATK: "โจมตีกาย",
  MATK: "โจมตีเวท",
  SUPPORT: "พลังเสริม",
  PDEF: "ป้องกันกาย",
  MDEF: "ป้องกันเวท",
  SPD: "ความเร็ว",
  ACCURACY_PCT: "แม่นยำ%",
  EVASION_PCT: "หลบ%",
  CRIT_PCT: "คริ%",
  CRIT_DAMAGE: "แรงคริ",
};

const GROUP_TH: Record<SigilGroup, string> = {
  HEADGEAR: "หมวกทั้ง 3 ช่อง",
  ARMS: "แขน",
  ARMOR: "เสื้อเกราะ",
  FEET: "รองเท้า",
  WEAPON_PHYSICAL_MELEE: "อาวุธกายระยะใกล้",
  WEAPON_PHYSICAL_RANGED: "อาวุธกายระยะไกล",
  WEAPON_MAGIC: "อาวุธเวท",
  WEAPON_SUPPORT: "อาวุธสนับสนุน",
  WEAPON_PHYSICAL: "อาวุธกาย",
  WEAPON_ANY: "อาวุธทุกแบบ",
  SHIELD: "โล่",
  OFFHAND_OTHER: "ของมือรอง",
  ACCESSORY: "เครื่องประดับ",
  BACK: "หลัง",
  AURA: "ออร่า",
};

const statLine = (stats: Record<string, number | undefined>) =>
  Object.entries(stats)
    .filter(([, v]) => v !== undefined && v !== 0)
    .map(([k, v]) => `${STAT_TH[k] ?? k} +${v}`)
    .join(" · ");

/**
 * Equipment screen: 12 slots and the bag. Every change is one server request (the server checks
 * slot, level, two-hand and ownership); the screen redraws from the reply. Resolves with the last
 * bundle when closed.
 */
export function equipmentPanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;

    /** A Sigil action, then a fresh copy of everything it touched. */
    const service = async (call: () => Promise<unknown>) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        await call();
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        draw();
      }
    };

    const send = async (slot: EquipSlot, instanceId: string | null) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        const r = await api.equip(bundle.character.version, slot, instanceId);
        bundle = { ...bundle, character: r.character, equipment: r.equipment };
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
        // A stale version means something else changed the character; load the fresh copy.
        if (e instanceof ApiError && e.code === "STALE_VERSION") bundle = (await api.get()) ?? bundle;
      } finally {
        busy = false;
        draw();
      }
    };

    const body = el("div");
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(done);
    panel.append(el("h2", {}, "อุปกรณ์"), body, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });

    const draw = () => {
      body.replaceChildren();
      const c = bundle.character;
      const worn = new Map(bundle.equipment.filter((e) => e.slot !== null).map((e) => [e.slot!, e]));
      const gear = gearBonuses(wornGear(bundle.equipment, equipmentDefs).defs);
      const d = deriveStats(c.level, c.primaryStats, gear);
      body.append(
        el(
          "div",
          { class: "pm-stats" },
          `${c.name} Lv${c.level} · HP ${d.maxHp} · MP ${d.maxMp} · โจมตีกาย ${d.patk} · โจมตีเวท ${d.matk} · ป้องกันกาย ${d.pdef} · ป้องกันเวท ${d.mdef} · ความเร็ว ${d.spd}`,
        ),
      );
      const slots = el("div", { class: "pm-slots" });
      for (const slot of EQUIP_SLOTS) {
        const box = el("div", { class: "pm-slot", "data-slot": slot });
        box.append(el("b", {}, SLOT_TH[slot]));
        const piece = worn.get(slot);
        const def = piece === undefined ? undefined : equipmentDefs.get(piece.definitionId);
        box.append(document.createTextNode(def?.name.th ?? (piece === undefined ? "ว่าง" : piece.definitionId)));
        if (piece !== undefined) {
          const off = el("button", { type: "button" }, "ถอด");
          off.addEventListener("click", () => void send(slot, null));
          box.append(el("br"), off);
        }
        slots.append(box);
      }
      body.append(slots);

      body.append(el("label", {}, "กระเป๋าอุปกรณ์"));
      const list = el("ul", { class: "pm-list" });
      const bag = bundle.equipment.filter((e) => e.slot === null);
      if (bag.length === 0) list.append(el("li", {}, "ไม่มีอุปกรณ์ที่ยังไม่ได้ใส่ ล่ามอนสเตอร์เพื่อหาของดรอป"));
      for (const piece of bag) {
        const def = equipmentDefs.get(piece.definitionId);
        const li = el("li", { "data-piece": piece.definitionId });
        const text = el("span", { class: "pm-grow" });
        text.textContent = def === undefined ? piece.definitionId : `${def.name.th} · Lv${def.requiredLevel}${def.handedness === "two_hand" ? " · สองมือ" : ""} · ${statLine(def.baseStats)}`;
        li.append(text);
        const targets = def === undefined ? [] : def.handedness === "two_hand" ? (["MAIN_HAND"] as const) : SLOT_FOR_CATEGORY[def.category];
        for (const slot of targets) {
          const b = el("button", { type: "button" }, targets.length > 1 ? `ใส่${SLOT_TH[slot]}` : "ใส่");
          // Hints only; the server decides.
          if (def !== undefined && c.level < def.requiredLevel) {
            b.disabled = true;
            b.title = `ต้อง Lv${def.requiredLevel}`;
          }
          b.addEventListener("click", () => void send(slot, piece.id));
          li.append(b);
        }
        list.append(li);
      }
      body.append(list);
      body.append(el("div", { class: "pm-note" }, "อุปกรณ์เป็นของตัวอย่าง (EXAMPLE) · อาวุธสองมือจะถอดของมือรองให้ · เปลี่ยนได้นอกไฟต์เท่านั้น"));
      drawSigils();
    };

    const pieceName = (p: EquipmentView) => equipmentDefs.get(p.definitionId)?.name.th ?? p.definitionId;
    const drawSigils = () => {
      body.append(el("label", {}, `ตรา Sigil · เหรียญ ${bundle.coins.toLocaleString()}`));
      const list = el("ul", { class: "pm-list", "data-section": "sigils" });
      // Installed Sigils, per piece that has sockets.
      for (const p of bundle.equipment) {
        const def = equipmentDefs.get(p.definitionId);
        if (def === undefined) continue;
        const cap = sigilCapacity(RULES, def);
        if (cap === 0) continue;
        const li = el("li", { "data-sockets": p.definitionId });
        const names = p.sigils.map((s) => sigilDefs.get(s)?.name.th ?? s);
        li.append(el("span", { class: "pm-grow" }, `${pieceName(p)}${p.slot ? " (ใส่อยู่)" : ""} · ช่อง ${p.sigils.length}/${cap}${names.length ? ` · ${names.join(", ")}` : ""}`));
        const cost = sigilRemovalCost(RULES, def);
        p.sigils.forEach((s, i) => {
          const b = el("button", { type: "button" }, `ถอดช่อง ${i + 1} (${cost} เหรียญ)`);
          b.disabled = bundle.coins < cost;
          if (b.disabled) b.title = `ต้องมี ${cost} เหรียญ`;
          b.addEventListener("click", () => {
            // The cost is shown before confirming (chapter 05 §4); the server refuses a different price.
            if (!window.confirm(`ถอด${sigilDefs.get(s)?.name.th ?? s} ออกจาก${pieceName(p)}\nค่าถอด ${cost} เหรียญ (มี ${bundle.coins}) · ตรากลับเข้ากระเป๋า ไม่แตก\nถอดได้ในเมืองเท่านั้น`)) return;
            void service(() => api.removeSigil(p.id, i, cost));
          });
          li.append(b);
        });
        list.append(li);
      }
      // Sigils in the bag, with the pieces they fit that still have a free socket.
      for (const [itemId, qty] of Object.entries(bundle.bag)) {
        const it = itemDefs.get(itemId);
        const sg = it?.kind === "sigil" && it.sigilId ? sigilDefs.get(it.sigilId) : undefined;
        if (sg === undefined || qty <= 0) continue;
        const li = el("li", { "data-sigil": itemId });
        li.append(el("span", { class: "pm-grow" }, `${sg.name.th} ×${qty} · ใส่ได้กับ${sg.equipGroups.map((g) => GROUP_TH[g]).join("/")}`));
        const targets = bundle.equipment.filter((p) => {
          const def = equipmentDefs.get(p.definitionId);
          return def !== undefined && sigilFits(def, sg) && p.sigils.length < sigilCapacity(RULES, def);
        });
        if (targets.length === 0) li.append(el("span", { class: "pm-note" }, "ไม่มีอุปกรณ์ที่ใส่ได้/ช่องเต็ม"));
        for (const p of targets) {
          const b = el("button", { type: "button" }, `ใส่${pieceName(p)}`);
          b.addEventListener("click", () => void service(() => api.installSigil(p.id, itemId)));
          li.append(b);
        }
        list.append(li);
      }
      if (list.childElementCount === 0) list.append(el("li", {}, "ยังไม่มีอุปกรณ์ที่มีช่อง Sigil"));
      body.append(list);
      body.append(
        el(
          "div",
          { class: "pm-note" },
          "ผลของ Sigil ยังไม่ทำงาน (ยังไม่มีระบบ effect) ใส่แล้วตัวเลขยังไม่เปลี่ยน · ใส่ซ้ำชื่อเดิมได้ · ถอดเสียเหรียญตามระดับของอุปกรณ์ ทำได้ในเมือง",
        ),
      );
    };
    draw();
  });
}

/**
 * Team screen: tick up to 5 companions. The server checks the limit, duplicate species and
 * ownership; the hints here only save a round trip. Resolves with the saved character, or null
 * when closed without saving.
 */
export function teamPanel(api: CharacterApi, bundle: CharacterBundle): Promise<CharacterView | null> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    const max = 5;
    const picked = new Set(bundle.character.team.map((t) => t.instanceId));
    panel.append(el("h2", {}, "ทีมคู่ใจ"));
    const count = el("div", { class: "pm-note" });
    panel.append(count);
    const list = el("ul", { class: "pm-list" });
    panel.append(list);
    if (bundle.companions.length === 0) list.append(el("li", {}, "ยังไม่มีคู่ใจ ลองจับมอนสเตอร์ในทุ่งด้วยปุ่ม \"จับ\" ระหว่างสู้"));
    const error = el("div", { class: "pm-error", role: "alert" });

    const refresh = () => {
      count.textContent = `เลือกแล้ว ${picked.size}/${max} ตัว · ชนิดเดียวกันลงทีมได้ตัวเดียวแม้ต่างธาตุ`;
      const speciesPicked = new Map<string, string>();
      for (const c of bundle.companions) if (picked.has(c.id)) speciesPicked.set(c.speciesId, c.id);
      for (const box of list.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
        const c = bundle.companions.find((x) => x.id === box.value)!;
        const sameSpecies = speciesPicked.has(c.speciesId) && speciesPicked.get(c.speciesId) !== c.id;
        box.disabled = !box.checked && (picked.size >= max || sameSpecies);
      }
    };

    for (const c of bundle.companions) {
      const sp = species.get(c.speciesId);
      // What it fights with: effective level (≤ character Lv + gap) and the growth stats there.
      const prof = sp === undefined ? { level: c.currentLevel, primaryStats: c.primaryStats } : companionCombatProfile(RULES, sp, c, bundle.character.level);
      const maxHp = deriveStats(prof.level, prof.primaryStats).maxHp;
      const hp = c.hp ?? maxHp;
      const li = el("li", hp <= 0 ? { class: "ko" } : {});
      const box = el("input", { type: "checkbox", value: c.id, id: `pm-${c.id}` });
      box.checked = picked.has(c.id);
      box.addEventListener("change", () => {
        if (box.checked) picked.add(c.id);
        else picked.delete(c.id);
        refresh();
      });
      const dot = el("span", { class: "pm-dot" });
      dot.style.background = ELEMENT_CSS[c.element];
      const bar = expProgress(RULES, "companion", c.xp);
      const exp = bar.need === null ? "EXP สูงสุด" : `EXP ${bar.into.toLocaleString()}/${bar.need.toLocaleString()}`;
      const label = el("label", { for: `pm-${c.id}` }, `${sp?.name.th ?? c.speciesId}${c.rebirthStage > 0 ? ` ★R${c.rebirthStage}` : ""} · ${ELEMENT_TH[c.element]} · Lv${c.currentLevel}${prof.level < c.currentLevel ? ` (สู้เป็น Lv${prof.level})` : ""} (${exp}) · HP ${hp}/${maxHp}${hp <= 0 ? " (ล้ม พักในเมือง)" : ""} · ${PRIMARY_KEYS.map((k) => `${k} ${prof.primaryStats[k]}`).join(" ")}`);
      label.style.margin = "0";
      li.append(box, dot, label);
      list.append(li);
    }
    panel.append(error);
    const actions = el("div", { class: "pm-actions" });
    const cancel = el("button", { type: "button" }, "ปิด");
    const save = el("button", { type: "button", class: "primary" }, "บันทึกทีม");
    actions.append(cancel, save);
    panel.append(actions);
    refresh();

    cancel.addEventListener("click", () => {
      close();
      resolve(null);
    });
    save.addEventListener("click", async () => {
      save.disabled = true;
      error.textContent = "";
      try {
        // Keep the order the companions were listed in, so the formation is predictable.
        const ids = bundle.companions.filter((c) => picked.has(c.id)).map((c) => c.id);
        const r = await api.setTeam(bundle.character.version, ids);
        close();
        resolve(r.character);
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
        save.disabled = false;
      }
    });
  });
}

/**
 * Town shop: sell items to the NPC for coins (chapter 06: the coin source). Prices come from the
 * item's vendorPrice; the server checks the bag, the location and the price again.
 */
export function shopPanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;
    const body = el("div");
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const sellAll = el("button", { type: "button" }, "ขายวัสดุทั้งหมด");
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(sellAll, done);
    panel.append(el("h2", {}, "ร้านรับซื้อของ"), body, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });

    const sellable = () =>
      Object.entries(bundle.bag)
        .filter(([id, q]) => q > 0 && (itemDefs.get(id)?.vendorPrice ?? 0) > 0)
        .map(([id, q]) => ({ def: itemDefs.get(id)!, quantity: q }));

    const sell = async (lines: { itemId: string; quantity: number }[]) => {
      if (busy || lines.length === 0) return;
      busy = true;
      error.textContent = "";
      try {
        const r = await api.sell(lines);
        error.textContent = "";
        note.textContent = `ขายได้ ${r.result.total} เหรียญ`;
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        draw();
      }
    };
    sellAll.addEventListener("click", () =>
      void sell(sellable().filter((s) => s.def.kind === "material").map((s) => ({ itemId: s.def.id, quantity: s.quantity }))),
    );

    const note = el("div", { class: "pm-note" });
    const draw = () => {
      body.replaceChildren();
      body.append(el("div", { class: "pm-stats" }, `เหรียญ ${bundle.coins.toLocaleString()}`), note);
      const list = el("ul", { class: "pm-list" });
      const rows = sellable();
      if (rows.length === 0) list.append(el("li", {}, "ไม่มีของที่ร้านรับซื้อ (เครื่องจับและตรา Sigil ร้านไม่รับ)"));
      for (const { def, quantity } of rows) {
        const li = el("li", { "data-item": def.id });
        li.append(el("span", { class: "pm-grow" }, `${def.name.th} ×${quantity} · ชิ้นละ ${def.vendorPrice}`));
        const one = el("button", { type: "button" }, `ขาย 1 (+${def.vendorPrice})`);
        one.addEventListener("click", () => void sell([{ itemId: def.id, quantity: 1 }]));
        const quote = sellQuote([{ itemId: def.id, quantity }], itemDefs);
        const all = el("button", { type: "button" }, `ขายหมด (+${quote.ok ? quote.total : 0})`);
        all.addEventListener("click", () => void sell([{ itemId: def.id, quantity }]));
        li.append(one, all);
        list.append(li);
      }
      body.append(list);
      body.append(el("div", { class: "pm-note" }, "\"เหรียญ\" เป็นชื่อชั่วคราว · ราคาเป็นค่าทดลอง (P12) · ขายได้ในเมืองเท่านั้น"));
      sellAll.disabled = !rows.some((r) => r.def.kind === "material");
    };
    draw();
  });
}

const STAT_NAMES: Record<keyof PrimaryStats, string> = {
  STR: "STR พลังกาย",
  VIT: "VIT ความทนทาน",
  INT: "INT ปัญญา",
  DEX: "DEX ความแม่น",
  AGI: "AGI ความว่องไว",
  SPI: "SPI จิตวิญญาณ",
};

/**
 * Stat points (P03): +3 per level, cost 1/2/3 per point by band, cap 150, never down. The preview
 * uses the shared formulas; the server checks the same rules and the version.
 */
export function statsPanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let draft: PrimaryStats = { ...start.character.primaryStats };
    const body = el("div");
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const reset = el("button", { type: "button" }, "ล้างที่เลือก");
    const cancel = el("button", { type: "button" }, "ปิด");
    const save = el("button", { type: "button", class: "primary" }, "ยืนยันลงแต้ม");
    actions.append(reset, cancel, save);
    panel.append(el("h2", {}, "สเตตัส"), body, error, actions);
    cancel.addEventListener("click", () => {
      close();
      resolve(bundle);
    });
    reset.addEventListener("click", () => {
      draft = { ...bundle.character.primaryStats };
      draw();
    });
    save.addEventListener("click", async () => {
      save.disabled = true;
      error.textContent = "";
      try {
        const r = await api.allocate(bundle.character.version, draft);
        bundle = { ...bundle, character: r.character };
        draft = { ...r.character.primaryStats };
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
        if (e instanceof ApiError && e.code === "STALE_VERSION") {
          bundle = (await api.get()) ?? bundle;
          draft = { ...bundle.character.primaryStats };
        }
      }
      draw();
    });

    const draw = () => {
      body.replaceChildren();
      const c = bundle.character;
      const xp = expProgress(RULES, "player", c.xp);
      const left = unspentPoints(RULES, c.level, draft);
      const d = deriveStats(c.level, draft, gearBonuses(wornGear(bundle.equipment, equipmentDefs).defs));
      body.append(
        el("div", { class: "pm-stats" }, `${c.name} Lv${c.level} · EXP ${xp.need === null ? "สูงสุด" : `${xp.into.toLocaleString()}/${xp.need.toLocaleString()}`} · EXP สะสม ${c.xp.toLocaleString()}`),
        el("div", { class: "pm-stats", "data-points": String(left) }, `แต้มว่าง ${left}`),
      );
      const list = el("ul", { class: "pm-list" });
      for (const k of PRIMARY_STATS) {
        const li = el("li", { "data-stat": k });
        const next = draft[k] + 1;
        const cost = next > RULES.provisional.manualStatCap.value ? null : statRaiseCost(RULES, draft[k], next);
        const changed = draft[k] !== c.primaryStats[k] ? ` (+${draft[k] - c.primaryStats[k]})` : "";
        li.append(el("span", { class: "pm-grow" }, `${STAT_NAMES[k]} ${draft[k]}${changed}${cost === null ? " · เต็ม" : ` · แต้มถัดไปใช้ ${cost}`}`));
        const minus = el("button", { type: "button" }, "−");
        minus.disabled = draft[k] <= c.primaryStats[k];
        minus.addEventListener("click", () => {
          draft = { ...draft, [k]: draft[k] - 1 };
          draw();
        });
        const plus = el("button", { type: "button" }, "+");
        plus.disabled = cost === null || cost > left;
        plus.addEventListener("click", () => {
          draft = { ...draft, [k]: next };
          draw();
        });
        li.append(minus, plus);
        list.append(li);
      }
      body.append(list);
      body.append(
        el(
          "div",
          { class: "pm-stats" },
          `ผลหลังลงแต้ม: HP ${d.maxHp} · MP ${d.maxMp} · โจมตีกาย ${d.patk} · โจมตีเวท ${d.matk} · พลังเสริม ${d.support} · ป้องกันกาย ${d.pdef} · ป้องกันเวท ${d.mdef} · ความเร็ว ${d.spd} · แม่นยำ ${d.accuracyPct.toFixed(1)}% · หลบ ${d.evasionPct.toFixed(1)}% · คริ ${d.critPct.toFixed(1)}%`,
        ),
        el("div", { class: "pm-note" }, "ได้ 3 แต้มต่อเลเวล · ค่า 11–60 ใช้ 1 แต้ม, 61–100 ใช้ 2, 101–150 ใช้ 3 · ลดค่าที่ลงแล้วไม่ได้ · สูตร EXP เป็นค่าชั่วคราว"),
      );
      const dirty = PRIMARY_STATS.some((k) => draft[k] !== c.primaryStats[k]);
      save.disabled = !dirty;
      reset.disabled = !dirty;
    };
    draw();
  });
}

/**
 * Auto Hunt settings (chapter 08, PROVISIONAL). `speciesIds` are the species this map's packs can
 * be led by. Resolves with the settings to send, or null when closed. The last settings are kept
 * in this browser only (a convenience; the server validates every field).
 */
export function autoHuntPanel(speciesIds: readonly string[]): Promise<AutoHuntSettings | null> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let saved: AutoHuntSettings;
    try {
      saved = AutoHuntSettingsSchema.parse(JSON.parse(localStorage.getItem("pm-auto-hunt") ?? "{}"));
    } catch {
      saved = AutoHuntSettingsSchema.parse({});
    }
    panel.append(el("h2", {}, "ล่าอัตโนมัติ"));
    panel.append(
      el("div", { class: "pm-note" }, "เดินหาฝูงในแผนที่นี้แล้วสู้แบบ Auto ต่อเนื่อง ขณะเปิดเกมและเชื่อมต่ออยู่เท่านั้น · ของดรอป ×0.70 (EXP เท่าเดิม) · ไม่จับมอนให้อัตโนมัติ"),
    );
    const list = (title: string, picked: readonly string[], section: string) => {
      panel.append(el("label", {}, title));
      const ul = el("ul", { class: "pm-list", "data-section": section });
      for (const id of speciesIds) {
        const li = el("li");
        const box = el("input", { type: "checkbox", value: id, id: `pm-${section}-${id}` });
        box.checked = picked.includes(id);
        const label = el("label", { for: box.id }, species.get(id)?.name.th ?? id);
        label.style.margin = "0";
        li.append(box, label);
        ul.append(li);
      }
      panel.append(ul);
      return () => [...ul.querySelectorAll<HTMLInputElement>("input:checked")].map((b) => b.value);
    };
    const targets = list("สู้เฉพาะฝูงที่มีหัวฝูงเป็น (ไม่เลือก = ทุกชนิด)", saved.targetSpecies, "targets");
    const stops = list("หยุดและแจ้งเมื่อเห็นฝูงที่หัวฝูงเป็น (ไว้กดจับเอง)", saved.stopOnSpecies, "stops");
    panel.append(el("label", {}, "ขนาดฝูงสูงสุด"));
    const size = choices(panel, [1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: `${n} ตัว` })), String(saved.maxPackSize));
    const pct = (n: number) => ({ value: String(n), label: n === 0 ? "ไม่หยุด" : `${n}%` });
    panel.append(el("label", {}, "หยุดเมื่อ HP ตัวละครต่ำกว่า (ตรวจก่อนเริ่มฝูงถัดไป)"));
    const hp = choices(panel, [0, 20, 30, 50, 70].map(pct), String(saved.stopBelowHpPercent));
    panel.append(el("label", {}, "หยุดเมื่อ MP ตัวละครต่ำกว่า"));
    const mp = choices(panel, [0, 10, 20, 30, 50].map(pct), String(saved.stopBelowMpPercent));
    panel.append(el("label", {}, "หยุดเมื่อ HP คู่ใจตัวใดตัวหนึ่งต่ำกว่า"));
    const compHp = choices(panel, [0, 20, 30, 50, 70].map(pct), String(saved.stopBelowCompanionHpPercent));
    // Items Auto may use (chapter 08: allowed items, when, and how many per fight).
    panel.append(el("label", {}, "ยาที่ให้ Auto ใช้ (ตัวละครเป็นคนใช้ ใช้ได้เมื่อถึงตาตัวละคร)"));
    const healItems = [...itemDefs.values()].filter((d) => d.kind === "heal");
    const ruleRows = healItems.map((d) => {
      const prev = saved.itemRules.find((r) => r.itemId === d.id);
      const row = el("div", { class: "pm-item-rule", "data-item": d.id });
      const on = el("input", { type: "checkbox", id: `pm-rule-${d.id}` });
      on.checked = prev !== undefined;
      const name = el("label", { for: on.id }, ` ${d.name.th}`);
      name.prepend(on);
      row.append(name);
      row.append(el("div", { class: "pm-note" }, "ใช้กับ"));
      const target = choices(row, [{ value: "ally", label: "เพื่อนที่ HP ต่ำสุด" }, { value: "self", label: "ตัวเองเท่านั้น" }], prev?.target ?? "ally");
      row.append(el("div", { class: "pm-note" }, "เมื่อ HP ต่ำกว่า"));
      const below = choices(row, [20, 30, 40, 50, 70].map((n) => ({ value: String(n), label: `${n}%` })), String(prev?.hpBelowPercent ?? 40));
      row.append(el("div", { class: "pm-note" }, "ไม่เกินต่อไฟต์"));
      const max = choices(row, [1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: `${n} ชิ้น` })), String(prev?.maxPerFight ?? 3));
      panel.append(row);
      return () =>
        on.checked ? [{ itemId: d.id, target: target() as "ally" | "self", hpBelowPercent: Number(below()), maxPerFight: Number(max()) }] : [];
    });
    const itemsOut = el("input", { type: "checkbox", id: "pm-items-out" });
    itemsOut.checked = saved.stopWhenItemsOut;
    const itemsOutRow = el("label", { for: "pm-items-out" });
    itemsOutRow.append(itemsOut, document.createTextNode(" หยุดเมื่อยาที่เลือกหมด"));
    panel.append(itemsOutRow);
    const elite = el("input", { type: "checkbox", id: "pm-elite" });
    elite.checked = saved.allowElite;
    const eliteRow = el("label", { for: "pm-elite" });
    eliteRow.append(elite, document.createTextNode(" สู้ฝูง Elite ด้วย"));
    panel.append(eliteRow);
    const actions = el("div", { class: "pm-actions" });
    const cancel = el("button", { type: "button" }, "ปิด");
    const start = el("button", { type: "button", class: "primary" }, "เริ่มล่า");
    actions.append(cancel, start);
    panel.append(actions);
    cancel.addEventListener("click", () => {
      close();
      resolve(null);
    });
    start.addEventListener("click", () => {
      const settings = AutoHuntSettingsSchema.parse({
        targetSpecies: targets(),
        stopOnSpecies: stops(),
        maxPackSize: Number(size()),
        stopBelowHpPercent: Number(hp()),
        stopBelowMpPercent: Number(mp()),
        stopBelowCompanionHpPercent: Number(compHp()),
        itemRules: ruleRows.flatMap((r) => r()),
        stopWhenItemsOut: itemsOut.checked,
        allowElite: elite.checked,
      });
      try {
        localStorage.setItem("pm-auto-hunt", JSON.stringify(settings));
      } catch {
        // Storage blocked: settings just are not remembered.
      }
      close();
      resolve(settings);
    });
  });
}

/** The Auto item rules saved with the Auto Hunt settings; manual Auto Battle uses the same ones. */
export function savedAutoPolicy(): { itemRules: AutoHuntSettings["itemRules"] } {
  try {
    return { itemRules: AutoHuntSettingsSchema.parse(JSON.parse(localStorage.getItem("pm-auto-hunt") ?? "{}")).itemRules };
  } catch {
    return { itemRules: [] };
  }
}

/**
 * Companion Rebirth at the town NPC (chapter 04 §7). Shows each companion's next stage, what it
 * costs and what is missing; the server checks everything again and charges once.
 */
export function rebirthPanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;
    const ops = new Map<string, string>();
    const { lootTables } = exampleContentMaps();
    const body = el("div");
    const error = el("div", { class: "pm-error", role: "alert" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    const actions = el("div", { class: "pm-actions" });
    actions.append(done);
    panel.append(
      el("h2", {}, "จุติคู่ใจ (Rebirth)"),
      el("div", { class: "pm-note" }, "คู่ใจ Lv200 กลับเป็น Lv1 เส้นทางเติบโตเดิม + โบนัสสเตตัส (ขั้น 1/2/3 = +4/+7/+10% รวม) · ธาตุ Bond ประวัติคงเดิม · ทำในเมือง นอกไฟต์"),
      body,
      error,
      actions,
    );
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });
    const draw = () => {
      body.replaceChildren();
      const ul = el("ul", { class: "pm-list" });
      for (const c of bundle.companions) {
        const sp = species.get(c.speciesId);
        if (sp === undefined) continue;
        const li = el("li", { "data-companion": c.id });
        const cost = rebirthCost(RULES, sp, c.rebirthStage, { lootTables, items: itemDefs });
        const name = `${sp.name.th} ★R${c.rebirthStage} · Lv${c.currentLevel}`;
        if (!cost.ok) {
          li.append(el("span", {}, `${name} · จุติครบแล้ว`));
          ul.append(li);
          continue;
        }
        const have = bundle.bag[cost.materialItemId] ?? 0;
        const missing = [
          c.xp < cost.companionExp ? `คู่ใจต้อง Lv${cost.companionLevel}` : "",
          bundle.character.xp < expForLevel(RULES, "player", cost.playerLevel) ? `ตัวละครต้อง Lv${cost.playerLevel}` : "",
          bundle.coins < cost.coins ? "เหรียญไม่พอ" : "",
          have < cost.materialQty ? "วัสดุไม่พอ" : "",
        ].filter((x) => x !== "");
        const text = `${name} → R${cost.nextStage} · ${cost.coins.toLocaleString()} เหรียญ + ${itemDefs.get(cost.materialItemId)?.name.th ?? cost.materialItemId} ${have}/${cost.materialQty}`;
        const go = el("button", { type: "button" }, "จุติ");
        go.disabled = missing.length > 0;
        go.addEventListener("click", async () => {
          if (busy) return;
          busy = true;
          error.textContent = "";
          const key = `${c.id}:${c.rebirthStage}`;
          const op = ops.get(key) ?? `rebirth_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
          ops.set(key, op);
          try {
            await api.rebirth(op, c.id, c.rebirthStage);
          } catch (e) {
            error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
          } finally {
            bundle = (await api.get().catch(() => null)) ?? bundle;
            busy = false;
            draw();
          }
        });
        li.append(el("span", {}, `${text}${missing.length > 0 ? ` (${missing.join(", ")})` : ""}`), go);
        ul.append(li);
      }
      if (bundle.companions.length === 0) ul.append(el("li", {}, "ยังไม่มีคู่ใจ"));
      body.append(ul);
    };
    draw();
  });
}

/**
 * Party (P02): start one and share its code, join by code, or leave. The bonus is counted by the
 * server when each fight starts: partners on the same map and channel who fought recently.
 */
export function partyPanel(api: CharacterApi): Promise<void> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    const body = el("div");
    const error = el("div", { class: "pm-error", role: "alert" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    const actions = el("div", { class: "pm-actions" });
    actions.append(done);
    panel.append(
      el("h2", {}, "ปาร์ตี้"),
      el(
        "div",
        { class: "pm-note" },
        `สูงสุด ${RULES.provisional.partyMaxMembers.value} คน · เพื่อนที่อยู่แผนที่และ channel เดียวกันและเพิ่งสู้ (ภายใน ${RULES.provisional.partyActivityWindowMs.value / 60_000} นาที) ให้ EXP +${RULES.provisional.partyExpPercentPerMember.value}% ต่อคน (สูงสุด ${RULES.provisional.partyExpPercentCap.value}%) และวัสดุทั่วไป +${RULES.provisional.partyMaterialDropPercentPerMember.value}% ต่อคน (สูงสุด ${RULES.provisional.partyMaterialDropPercentCap.value}%) · ไฟต์ยังเป็นของใครของมัน`,
      ),
      body,
      error,
      actions,
    );
    done.addEventListener("click", () => {
      close();
      resolve();
    });
    const run = async (f: () => Promise<{ party: PartyView | null }>) => {
      error.textContent = "";
      try {
        draw((await f()).party);
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      }
    };
    const draw = (party: PartyView | null) => {
      body.replaceChildren();
      if (party === null) {
        const create = el("button", { type: "button" }, "ตั้งปาร์ตี้");
        create.addEventListener("click", () => void run(() => api.createParty()));
        const code = el("input", { id: "pm-party-code", placeholder: "รหัสปาร์ตี้ เช่น pt_ab12cd34ef", maxlength: "13" });
        const join = el("button", { type: "button" }, "เข้าร่วม");
        join.addEventListener("click", () => void run(() => api.joinParty(code.value.trim())));
        body.append(el("p", {}, "ยังไม่มีปาร์ตี้"), create, el("label", { for: "pm-party-code" }, "หรือเข้าร่วมด้วยรหัส"), code, join);
        return;
      }
      const ul = el("ul", { class: "pm-list" });
      for (const m of party.members) ul.append(el("li", { "data-member": m.accountId }, `${m.name} · ${m.mapId === null ? "-" : `${maps.get(m.mapId)?.name.th ?? m.mapId} ch${m.channel}`}`));
      const leave = el("button", { type: "button" }, "ออกจากปาร์ตี้");
      leave.addEventListener("click", () => void run(() => api.leaveParty()));
      body.append(el("p", {}, "รหัสปาร์ตี้ (ให้เพื่อนใส่): "), el("code", { "data-party-code": party.partyId }, party.partyId), ul, leave);
    };
    void run(() => api.party());
  });
}
