/**
 * DOM overlays for character creation and the team screen. Plain HTML over the canvas because
 * Thai text input and lists are easier there than in Phaser. Placeholder styling; the real UI
 * comes with the art pass (chapter 10 §4).
 */
import {
  CLASS1_DEFINITIONS,
  PLAYER_ELEMENTS,
  RACE_DEFINITIONS,
  deriveStats,
  exampleContentMaps,
  type CharacterView,
  type Element,
} from "@pmrpg/shared";
import { ApiError, type CharacterApi, type CharacterBundle } from "./character-api";

const species = exampleContentMaps().species;

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
.pm-list li { display: flex; align-items: center; gap: 10px; padding: 8px; border-bottom: 1px solid #322b4d; }
.pm-list li.ko { opacity: 0.6; }
.pm-list input { width: 20px; height: 20px; }
.pm-dot { width: 14px; height: 14px; border-radius: 3px; flex: none; }
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

/** Max HP/MP for the HUD, from the shared stat formula (no gear yet). */
export function vitals(c: CharacterView) {
  const d = deriveStats(c.level, c.primaryStats);
  return { hp: c.hp ?? d.maxHp, maxHp: d.maxHp, mp: c.mp ?? d.maxMp, maxMp: d.maxMp };
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
      const maxHp = deriveStats(c.currentLevel, c.primaryStats).maxHp;
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
      const label = el("label", { for: `pm-${c.id}` }, `${sp?.name.th ?? c.speciesId} · ${ELEMENT_TH[c.element]} · Lv${c.currentLevel} · HP ${hp}/${maxHp}${hp <= 0 ? " (ล้ม พักในเมือง)" : ""}`);
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
