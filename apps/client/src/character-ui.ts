/**
 * DOM overlays for character creation and the team screen. Plain HTML over the canvas because
 * Thai text input and lists are easier there than in Phaser. Placeholder styling; the real UI
 * comes with the art pass (chapter 10 §4).
 */
import {
  type FrontierView,
  JOURNAL_TITLES,
  EXAMPLE_SECRET_QUEST_TEMPLATES,
  exampleSecretRewardRegistry,
  secretTitleRewardId,
  type SecretQuest,
  levelBand,
  type JournalSpecies,
  questGoalText,
  type QuestBoardView,
  type QuestReward,
  EXAMPLE_RECIPES,
  PROFESSIONS,
  PROFESSION_NAME_TH,
  RARITIES,
  craftQuote,
  masteryAfter,
  type Profession,
  type Recipe,
  EXAMPLE_SHOPS,
  gearBands,
  class2Branch,
  playerKit,
  STATUS_DEFINITIONS,
  type SkillDefinition,
  type ClassView,
  exampleMapRegistry,
  EFFECT_HIT_NAME_TH,
  EFFECT_RES_NAME_TH,
  type PartyView,
  rebirthCost,
  rebirthBranchChangeCost,
  rebirthVariantFor,
  companionKit,
  applyBond,
  bondBonusPercent,
  bondTier,
  BOND_STAT,
  BOND_TIER_NAMES,
  effectiveSkillLevel,
  skillLevelMods,
  skillLevelStep,
  type SkillLevelMods,
  type SkillLevelStep,
  skillTrainCost,
  speciesSkillSlots,
  trainedSkillLevel,
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
  wornBonuses,
  RARITY_NAME_TH,
  sellQuote,
  sigilCapacity,
  equipmentDisplayName,
  sigilFits,
  sigilRemovalCost,
  affixRerollCost,
  refineQuote,
  refinedBaseStats,
  type RefineQuote,
  disposeQuote,
  formationCells,
  NICKNAME_MAX,
  wornGear,
  PRODUCTION_RULES,
  type CharacterView,
  type Element,
  type EquipSlot,
  type EquipmentView,
  type EquipmentDefinition,
  type PrimaryStats,
  type SigilGroup,
  PRIMARY_STATS,
  expProgress,
  statRaiseCost,
  unspentPoints,
} from "@pmrpg/shared";
import { ApiError, type CharacterApi, type CharacterBundle } from "./character-api";

const maps = exampleMapRegistry();
const { species, equipment: equipmentDefs, items: itemDefs, sigils: sigilDefs, skills: skillDefs, bosses: bossDefs, affixPools } = exampleContentMaps();
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
.pm-list li.pm-skill-pet { display: block; }
.pm-branch { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; }
.pm-branch span { flex: 1 1 260px; }
.pm-list li.pm-skill-pet > div { font-weight: bold; margin-bottom: 4px; }
.pm-list li.pm-skill-pet li span { flex: 1 1 auto; }
.pm-list li.ko { opacity: 0.6; }
.pm-list input { width: 20px; height: 20px; }
.pm-dot { width: 14px; height: 14px; border-radius: 3px; flex: none; }
.pm-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.pm-slot { border: 1px solid #463f6b; border-radius: 6px; padding: 6px 8px; min-height: 44px; font-size: 13px; background: #1b1830; }
.pm-affix { display: block; color: #8fd1a8; font-size: 11px; }
.pm-r-COMMON { color: #ffffff; } .pm-r-UNCOMMON { color: #6fdc8c; } .pm-r-RARE { color: #6aa8ff; } .pm-r-EPIC { color: #c58bff; } .pm-r-LEGENDARY { color: #ffb648; }
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

export function overlay(): { root: HTMLDivElement; panel: HTMLDivElement; close: () => void } {
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

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
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
  const d = deriveStats(c.level, c.primaryStats, wornBonuses(equipment, equipmentDefs));
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
  STR: "STR",
  VIT: "VIT",
  INT: "INT",
  DEX: "DEX",
  AGI: "AGI",
  SPI: "SPI",
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
  EFFECT_HIT_PCT: `${EFFECT_HIT_NAME_TH}%`,
  EFFECT_RES_PCT: `${EFFECT_RES_NAME_TH}%`,
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

/** A piece's name coloured by rarity (icon-free; the rarity is also in the tooltip and affix line). */
function gearName(def: EquipmentDefinition, piece: EquipmentView): HTMLElement {
  const plus = piece.refineLevel > 0 ? `+${piece.refineLevel} ` : "";
  return el("span", { class: `pm-r-${piece.rarity}`, title: RARITY_NAME_TH[piece.rarity] }, plus + equipmentDisplayName(def, piece.sigils, sigilDefs));
}

/** "[หายาก] STR +2 · คริ% +1", or the rarity alone for a piece without affixes. */
const affixLine = (piece: EquipmentView) =>
  `[${RARITY_NAME_TH[piece.rarity]}]${piece.affixes.length === 0 ? "" : " " + piece.affixes.map((a) => `${STAT_TH[a.stat] ?? a.stat} +${a.value}`).join(" · ")}`;

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
      const gear = wornBonuses(bundle.equipment, equipmentDefs);
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
        if (def === undefined) box.append(document.createTextNode(piece === undefined ? "ว่าง" : piece.definitionId));
        else box.append(gearName(def, piece!), el("small", { class: "pm-affix" }, affixLine(piece!)));
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
        if (def === undefined) text.textContent = piece.definitionId;
        else
          text.append(
            gearName(def, piece),
            ` · Lv${def.requiredLevel}${def.handedness === "two_hand" ? " · สองมือ" : ""} · ${statLine(refinedBaseStats(def, piece.refineLevel))}`,
            el("small", { class: "pm-affix" }, affixLine(piece)),
          );
        if (piece.protected) text.prepend("🔒 ");
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
        if (def !== undefined) li.append(...disposeButtons(piece, def));
        list.append(li);
      }
      body.append(list);
      body.append(
        el(
          "div",
          { class: "pm-note" },
          "อุปกรณ์เป็นของตัวอย่าง (EXAMPLE) · อาวุธสองมือจะถอดของมือรองให้ · เปลี่ยนได้นอกไฟต์เท่านั้น · ขาย/ย่อยได้ในเมือง เฉพาะชิ้นที่ไม่ได้ใส่ ไม่มี Sigil และไม่ได้ล็อก 🔒",
        ),
      );
      drawSigils();
    };

    /** Lock toggle, sell and salvage for one bag piece; the price is shown before confirming. */
    const disposeButtons = (piece: EquipmentView, def: EquipmentDefinition): HTMLElement[] => {
      const lock = el("button", { type: "button", "data-protect": piece.id }, piece.protected ? "ปลดล็อก" : "ล็อก 🔒");
      lock.title = "ชิ้นที่ล็อกจะขายหรือย่อยไม่ได้";
      lock.addEventListener("click", () => void service(() => api.protect("equipment", piece.id, !piece.protected)));
      const pool = affixPools.get(def.affixPoolId);
      if (pool === undefined) return [lock];
      const blocked = piece.protected ? "ล็อกอยู่" : piece.sigils.length > 0 ? "ถอด Sigil ออกก่อน" : piece.pendingAffix ? "เลือกออปชันที่สุ่มค้างไว้ก่อน" : piece.lockState !== "free" ? "อยู่ในไฟต์" : null;
      const one = [{ def, pool, rarity: piece.rarity }];
      const sale = disposeQuote(RULES, "sell", one);
      const salvage = disposeQuote(RULES, "salvage", one);
      const mat = salvage.items.map((i) => `${itemDefs.get(i.itemId)?.name.th ?? i.itemId} ×${i.quantity}`).join(", ");
      const sell = el("button", { type: "button", "data-sell": piece.id }, `ขาย (+${sale.coins})`);
      const salv = el("button", { type: "button", "data-salvage": piece.id }, `ย่อย (${mat})`);
      for (const b of [sell, salv]) {
        b.disabled = blocked !== null;
        if (blocked !== null) b.title = blocked;
      }
      const name = `${pieceName(piece)} [${RARITY_NAME_TH[piece.rarity]}]${piece.affixes.length ? " " + affixLine(piece) : ""}`;
      sell.addEventListener("click", () => {
        if (!window.confirm(`ขาย ${name}\nได้ ${sale.coins} เหรียญ · ชิ้นนี้จะหายไปถาวร\nทำได้ในเมืองเท่านั้น`)) return;
        void service(() => api.disposeGear("sell", [piece.id], sale));
      });
      salv.addEventListener("click", () => {
        if (!window.confirm(`ย่อย ${name}\nได้ ${mat} · ชิ้นนี้จะหายไปถาวร\nทำได้ในเมืองเท่านั้น`)) return;
        void service(() => api.disposeGear("salvage", [piece.id], salvage));
      });
      return [lock, sell, salv];
    };

    const pieceName = (p: EquipmentView) => {
      const def = equipmentDefs.get(p.definitionId);
      return def === undefined ? p.definitionId : equipmentDisplayName(def, p.sigils, sigilDefs);
    };
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
          "Sigil ในอุปกรณ์ที่ใส่อยู่มีผลในไฟต์ · ใส่ซ้ำชื่อเดิมได้ · ถอดเสียเหรียญตามระดับของอุปกรณ์ ทำได้ในเมือง",
        ),
      );
      drawAffixes();
    };

    /** Reroll one affix (chapter 05 §3): cost shown first, then keep old or new. */
    const drawAffixes = () => {
      body.append(el("label", {}, "สุ่มออปชันใหม่"));
      const list = el("ul", { class: "pm-list", "data-section": "affixes" });
      for (const p of bundle.equipment) {
        const def = equipmentDefs.get(p.definitionId);
        const pool = def === undefined ? undefined : affixPools.get(def.affixPoolId);
        if (def === undefined || pool === undefined || p.affixes.length === 0) continue;
        const li = el("li", { "data-affixes": p.id });
        const label = el("span", { class: "pm-grow" });
        label.append(gearName(def, p), el("small", { class: "pm-affix" }, affixLine(p)));
        li.append(label);
        const pending = p.pendingAffix;
        if (pending !== undefined) {
          const old = p.affixes[pending.slot]!;
          const say = (a: { stat: string; value: number }) => `${STAT_TH[a.stat] ?? a.stat} +${a.value}`;
          li.append(el("span", { class: "pm-note" }, `ช่อง ${pending.slot + 1}: เดิม ${say(old)} → ใหม่ ${say(pending.affix)}`));
          const keepOld = el("button", { type: "button" }, "เก็บของเดิม");
          keepOld.addEventListener("click", () => void service(() => api.chooseAffix(p.id, pending.operationId, "old")));
          const keepNew = el("button", { type: "button" }, "ใช้ค่าใหม่");
          keepNew.addEventListener("click", () => void service(() => api.chooseAffix(p.id, pending.operationId, "new")));
          li.append(keepOld, keepNew);
        } else {
          const cost = affixRerollCost(RULES, def, pool);
          const have = bundle.bag[cost.itemId] ?? 0;
          const mat = itemDefs.get(cost.itemId)?.name.th ?? cost.itemId;
          p.affixes.forEach((a, i) => {
            const b = el("button", { type: "button" }, `สุ่มช่อง ${i + 1} (${cost.coins} เหรียญ + ${mat} ×${cost.quantity})`);
            b.disabled = bundle.coins < cost.coins || have < cost.quantity || p.lockState !== "free";
            if (b.disabled) b.title = `ต้องมี ${cost.coins} เหรียญ และ${mat} ${cost.quantity} ชิ้น`;
            b.addEventListener("click", () => {
              const msg = `สุ่มออปชันช่อง ${i + 1} ของ${pieceName(p)} ใหม่ (ตอนนี้ ${STAT_TH[a.stat] ?? a.stat} +${a.value})\nค่าสุ่ม ${cost.coins} เหรียญ + ${mat} ${cost.quantity} ชิ้น (มี ${bundle.coins} เหรียญ, ${have} ชิ้น)\nเสียทันทีแม้สุดท้ายเลือกเก็บของเดิม · ทำได้ในเมืองเท่านั้น`;
              if (!window.confirm(msg)) return;
              void service(() => api.rerollAffix(p.id, i, p.affixes, cost));
            });
            li.append(b);
          });
        }
        list.append(li);
      }
      if (list.childElementCount === 0) list.append(el("li", {}, "ยังไม่มีอุปกรณ์ที่มีออปชัน (ของระดับ ดี ขึ้นไปจากการดรอป)"));
      body.append(list);
    };
    draw();
  });
}

/**
 * Team screen: tick up to 5 companions. The server checks the limit, duplicate species and
 * ownership; the hints here only save a round trip. Resolves with the saved character, or null
 * when closed without saving.
 */
export function teamPanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterView | null> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    const max = 5;
    let bundle = start;
    let busy = false;
    const picked = new Set(bundle.character.team.map((t) => t.instanceId));
    // Where each picked companion stands, as "row:slot" (the player keeps front-centre).
    const CELLS = formationCells(RULES).map((c) => `${c.row}:${c.slot}`);
    const cellOf = new Map(bundle.character.team.map((t) => [t.instanceId, `${t.row}:${t.slot}`]));
    const cellName = (cell: string) => `${cell.startsWith("front") ? "หน้า" : "หลัง"} ช่อง ${Number(cell.split(":")[1]) + 1}`;
    /** A free cell for a newly picked companion: front first for tank/physical, back first otherwise. */
    const freeCell = (speciesId: string) => {
      const used = new Set([...picked].map((id) => cellOf.get(id)));
      const a = species.get(speciesId)?.archetype;
      const front = a === "tank" || a === "physical";
      return [...CELLS].sort((x, y) => (x.startsWith("front") === front ? 0 : 1) - (y.startsWith("front") === front ? 0 : 1)).find((c) => !used.has(c));
    };
    panel.append(el("h2", {}, "ทีมคู่ใจ"));
    const boxOf = bundle.character.companionBox;
    if (boxOf !== undefined) panel.append(el("div", { class: "pm-note", "data-companion-box": "" }, `คลังคู่ใจ (นอกทีม) ${boxOf.used}/${boxOf.capacity} ตัว · ของตัวละครนี้เท่านั้น ตัวละครอื่นในบัญชีไม่เห็น`));
    const count = el("div", { class: "pm-note" });
    const grid = el("div", { class: "pm-stats", "data-formation": "" });
    panel.append(count, grid);
    const list = el("ul", { class: "pm-list" });
    panel.append(list);
    const error = el("div", { class: "pm-error", role: "alert" });

    const shortName = (id: string) => {
      const c = bundle.companions.find((x) => x.id === id);
      return c === undefined ? "?" : (c.nickname ?? species.get(c.speciesId)?.name.th ?? c.speciesId);
    };
    const refresh = () => {
      count.textContent = `เลือกแล้ว ${picked.size}/${max} ตัว · ชนิดเดียวกันลงทีมได้ตัวเดียวแม้ต่างธาตุ · แถวหน้าใกล้ศัตรู โดนตีระยะประชิดก่อน`;
      const who = new Map([...picked].map((id) => [cellOf.get(id), shortName(id)]));
      const line = (row: "front" | "back") =>
        [0, 1, 2].map((slot) => (row === "front" && slot === 1 ? "[ผู้เล่น]" : `[${who.get(`${row}:${slot}`) ?? "ว่าง"}]`)).join(" ");
      grid.textContent = `แถวหน้า ${line("front")} · แถวหลัง ${line("back")}`;
      for (const sel of list.querySelectorAll<HTMLSelectElement>("select[data-cell]")) {
        const id = sel.dataset.cell!;
        sel.disabled = !picked.has(id);
        sel.value = picked.has(id) ? (cellOf.get(id) ?? "") : "";
      }
      const speciesPicked = new Map<string, string>();
      for (const c of bundle.companions) if (picked.has(c.id)) speciesPicked.set(c.speciesId, c.id);
      for (const box of list.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
        const c = bundle.companions.find((x) => x.id === box.value)!;
        const sameSpecies = speciesPicked.has(c.speciesId) && speciesPicked.get(c.speciesId) !== c.id;
        box.disabled = !box.checked && (picked.size >= max || sameSpecies);
      }
    };

    /** Name, lock or release, then a fresh copy (the ticks the player made stay). */
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
        for (const id of [...picked]) if (!bundle.companions.some((c) => c.id === id)) picked.delete(id);
        busy = false;
        draw();
      }
    };

    const draw = () => {
      list.replaceChildren();
      if (bundle.companions.length === 0) list.append(el("li", {}, "ยังไม่มีคู่ใจ ลองจับมอนสเตอร์ในทุ่งด้วยปุ่ม \"จับ\" ระหว่างสู้"));
      const inTeam = new Set(bundle.character.team.map((t) => t.instanceId));
      for (const c of bundle.companions) {
        const sp = species.get(c.speciesId);
        // What it fights with: its own level (no battle level cap, O01) and the growth stats there.
        const prof = sp === undefined ? { level: c.currentLevel, primaryStats: c.primaryStats } : companionCombatProfile(RULES, sp, c, bundle.character.level);
        const base = deriveStats(prof.level, prof.primaryStats);
        const maxHp = sp === undefined ? base.maxHp : applyBond(RULES, sp.archetype, c.bond, base).maxHp;
        const hp = c.hp ?? maxHp;
        const li = el("li", hp <= 0 ? { class: "ko", "data-companion": c.id } : { "data-companion": c.id });
        const box = el("input", { type: "checkbox", value: c.id, id: `pm-${c.id}` });
        box.checked = picked.has(c.id);
        box.addEventListener("change", () => {
          if (box.checked) {
            const cell = cellOf.get(c.id);
            const taken = [...picked].some((id) => cellOf.get(id) === cell);
            if (cell === undefined || taken) cellOf.set(c.id, freeCell(c.speciesId) ?? "");
            picked.add(c.id);
          } else picked.delete(c.id);
          refresh();
        });
        // Pick a cell; taking one another companion holds swaps the two.
        const cellSel = el("select", { "data-cell": c.id, "aria-label": "ตำแหน่ง" });
        cellSel.append(el("option", { value: "" }, "—"), ...CELLS.map((cell) => el("option", { value: cell }, cellName(cell))));
        cellSel.addEventListener("change", () => {
          const mine = cellOf.get(c.id);
          const other = [...picked].find((id) => id !== c.id && cellOf.get(id) === cellSel.value);
          if (other !== undefined && mine !== undefined) cellOf.set(other, mine);
          cellOf.set(c.id, cellSel.value);
          refresh();
        });
        const dot = el("span", { class: "pm-dot" });
        dot.style.background = ELEMENT_CSS[c.element];
        const bar = expProgress(RULES, "companion", c.xp);
        const exp = bar.need === null ? "EXP สูงสุด" : `EXP ${bar.into.toLocaleString()}/${bar.need.toLocaleString()}`;
        const name = c.nickname ? `${c.nickname} (${sp?.name.th ?? c.speciesId})` : (sp?.name.th ?? c.speciesId);
        const label = el("label", { for: `pm-${c.id}`, class: "pm-grow" }, `${c.protected ? "🔒 " : ""}${name}${c.rebirthStage > 0 ? ` ★R${c.rebirthStage}` : ""} · ${ELEMENT_TH[c.element]} · Lv${c.currentLevel}${prof.level < c.currentLevel ? ` (สู้เป็น Lv${prof.level})` : ""} (${exp}) · HP ${hp}/${maxHp}${hp <= 0 ? " (ล้ม พักในเมือง)" : ""} · Bond ${c.bond} ${BOND_TIER_NAMES[bondTier(RULES, c.bond)]} · ${PRIMARY_KEYS.map((k) => `${k} ${prof.primaryStats[k]}`).join(" ")}`);
        label.style.margin = "0";
        const rename = el("button", { type: "button", "data-rename": c.id }, "ตั้งชื่อ");
        rename.addEventListener("click", () => {
          const next = window.prompt(`ชื่อเล่นของ${sp?.name.th ?? c.speciesId} (ไม่เกิน ${NICKNAME_MAX} ตัวอักษร · เว้นว่างเพื่อลบชื่อ)`, c.nickname ?? "");
          if (next === null) return;
          void service(() => api.nickname(c.id, next.trim() === "" ? null : next));
        });
        const lock = el("button", { type: "button", "data-protect": c.id }, c.protected ? "ปลดล็อก" : "ล็อก 🔒");
        lock.title = "คู่ใจที่ล็อกจะปล่อยไม่ได้";
        lock.addEventListener("click", () => void service(() => api.protect("companion", c.id, !c.protected)));
        const release = el("button", { type: "button", "data-release": c.id }, "ปล่อย");
        const why = c.protected ? "ล็อกอยู่" : inTeam.has(c.id) ? "เอาออกจากทีมแล้วบันทึกก่อน" : c.lockState !== "free" ? "อยู่ในไฟต์" : null;
        release.disabled = why !== null;
        if (why !== null) release.title = why;
        release.addEventListener("click", () => {
          const msg = `ปล่อย ${name} Lv${c.currentLevel} ${ELEMENT_TH[c.element]}${c.rebirthStage > 0 ? ` ★R${c.rebirthStage}` : ""} · Bond ${c.bond}\nคู่ใจตัวนี้จะจากไปถาวร ไม่ได้อะไรคืน\nบันทึกในสมุดสะสม (เคยจับ/เคยชนะ) ยังอยู่`;
          if (!window.confirm(msg)) return;
          void service(() => api.releaseCompanion(c.id));
        });
        li.append(box, dot, label, cellSel, rename, lock, release);
        list.append(li);
      }
      refresh();
    };
    panel.append(error);
    panel.append(el("div", { class: "pm-note" }, "ชื่อเล่นซ้ำกันได้ · ปล่อยได้เฉพาะตัวที่ไม่อยู่ในทีม ไม่ได้ล็อก และไม่ได้อยู่ในไฟต์"));
    const actions = el("div", { class: "pm-actions" });
    const cancel = el("button", { type: "button" }, "ปิด");
    const save = el("button", { type: "button", class: "primary" }, "บันทึกทีม");
    actions.append(cancel, save);
    panel.append(actions);
    draw();

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
        const formation = ids.map((id) => {
          const [row, slot] = (cellOf.get(id) ?? "").split(":");
          return { instanceId: id, row: row as "front" | "back", slot: Number(slot) };
        });
        const r = await api.setTeam(bundle.character.version, ids, formation);
        close();
        resolve(r.character);
      } catch (e) {
        error.textContent =
          e instanceof ApiError && e.code === "COMPANION_BOX_FULL" ? "คลังคู่ใจเต็ม เอาออกจากทีมไม่ได้ ปล่อยตัวอื่นก่อน" : e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
        save.disabled = false;
      }
    });
  });
}

/**
 * Town shop: sell items to the NPC for coins (chapter 06: the coin source). Prices come from the
 * item's vendorPrice; the server checks the bag, the location and the price again.
 */
const SHOP = EXAMPLE_SHOPS[0]!;
const ARMORY = EXAMPLE_SHOPS.find((x) => x.gear !== undefined)!;
const WEAPON_KIND_TH: Record<string, string> = { physical_melee: "อาวุธประชิด", physical_ranged: "อาวุธระยะไกล (สองมือ)", magic: "อาวุธเวท (สองมือ)", support: "อาวุธซัพพอร์ต" };

/**
 * Town armory (Nut 2026-10-09): plain gear by level band, always ordinary with no random options.
 * The band at or below the character's level opens first; higher bands can be bought ahead.
 */
export function armoryPanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;
    const body = el("div");
    const note = el("div", { class: "pm-note" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(done);
    panel.append(el("h2", {}, ARMORY.name.th), body, note, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });
    const bands = gearBands(ARMORY, equipmentDefs);
    const mine = [...bands].reverse().find((b) => b.level <= bundle.character.level)?.level ?? bands[0]?.level ?? 1;
    let shown = mine;
    const buy = async (def: EquipmentDefinition, price: number) => {
      if (busy) return;
      if (!window.confirm(`ซื้อ${def.name.th} (Lv${def.requiredLevel}) ${price} เหรียญ?
เป็นของธรรมดา ไม่มีออปชัน`)) return;
      busy = true;
      error.textContent = "";
      try {
        await api.buyGear(`gear_${crypto.randomUUID().replace(/-/g, "")}`, ARMORY.id, def.id, 1, price);
        note.textContent = `ซื้อ${def.name.th}แล้ว (−${price} เหรียญ) อยู่ในกระเป๋าอุปกรณ์`;
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        draw();
      }
    };
    const draw = () => {
      body.replaceChildren();
      body.append(el("div", { class: "pm-stats" }, `เหรียญ ${bundle.coins.toLocaleString()} · เลเวลตัวละคร ${bundle.character.level}`));
      const tabs = el("div", { class: "pm-actions" });
      for (const b of bands) {
        const t = el("button", { type: "button", "data-band": String(b.level), ...(b.level === shown ? { class: "primary" } : {}) }, `Lv${b.level}+`);
        t.addEventListener("click", () => {
          shown = b.level;
          draw();
        });
        tabs.append(t);
      }
      body.append(tabs);
      const band = bands.find((b) => b.level === shown);
      const shelf = el("ul", { class: "pm-list" });
      for (const { def, price } of band?.pieces ?? []) {
        const li = el("li", { "data-gear": def.id });
        const kind = def.weaponKind !== undefined ? WEAPON_KIND_TH[def.weaponKind] ?? def.weaponKind : SLOT_TH[def.category as EquipSlot] ?? def.category;
        const owned = bundle.equipment.filter((e) => e.definitionId === def.id).length;
        li.append(el("span", { class: "pm-grow" }, `${def.name.th} · ${kind} · Lv${def.requiredLevel} · ${statLine(def.baseStats)} · ${price} เหรียญ${owned > 0 ? ` · มีแล้ว ${owned}` : ""}`));
        const b = el("button", { type: "button" }, `ซื้อ (−${price})`);
        b.disabled = bundle.coins < price;
        b.addEventListener("click", () => void buy(def, price));
        li.append(b);
        shelf.append(li);
      }
      body.append(shelf, el("div", { class: "pm-note" }, "ของร้านเป็นของธรรมดา ไม่มีออปชันสุ่ม ใส่ได้เมื่อถึงเลเวล · ราคาเป็นตัวอย่าง (P12)"));
    };
    draw();
  });
}

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
    panel.append(el("h2", {}, "ร้านค้า: ซื้อ / ขาย"), body, error, actions);
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

    // Buying (chapter 06): fixed prices shown before buying; the total goes with the request.
    const buy = async (itemId: string, quantity: number, total: number) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        await api.buy(SHOP.id, [{ itemId, quantity }], total);
        note.textContent = `ซื้อ ${itemDefs.get(itemId)?.name.th ?? itemId} ×${quantity} (−${total} เหรียญ)`;
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        draw();
      }
    };

    const note = el("div", { class: "pm-note" });
    const draw = () => {
      body.replaceChildren();
      body.append(el("div", { class: "pm-stats" }, `เหรียญ ${bundle.coins.toLocaleString()}`), note);
      body.append(el("h3", {}, SHOP.name.th));
      const shelf = el("ul", { class: "pm-list" });
      for (const l of SHOP.listings) {
        const def = itemDefs.get(l.itemId);
        const li = el("li", { "data-buy": l.itemId });
        li.append(el("span", { class: "pm-grow" }, `${def?.name.th ?? l.itemId} · ${l.price} เหรียญ · มี ${bundle.bag[l.itemId] ?? 0}`));
        for (const q of [1, 5]) {
          const b = el("button", { type: "button" }, `ซื้อ ${q} (−${l.price * q})`);
          b.disabled = bundle.coins < l.price * q;
          b.addEventListener("click", () => void buy(l.itemId, q, l.price * q));
          li.append(b);
        }
        shelf.append(li);
      }
      body.append(shelf, el("h3", {}, "ขายของ"));
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

/**
 * Crafting (chapter 05 §6, chapter 09): recipes per profession, what they take and what the player
 * has, the coins, the mastery it gives, and for gear the rarity odds and possible affixes, all
 * before confirming. The server checks everything again and rolls the gear.
 */
/**
 * Refining / ตีบวก (REFINEMENT_DESIGN v2.1). Before every attempt the player sees the chance, the
 * coins, the stones, the ward (never ticked for them) and exactly what a failure does. The server
 * rolls and answers with the receipt; the panel only shows it.
 */
export function refinePanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;
    let pickedId: string | null = null;
    let useWard = false;
    const body = el("div");
    const result = el("div", { class: "pm-stats", "data-refine-result": "" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(done);
    panel.append(el("h2", {}, "ตีบวก"), result, error, body, actions);
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });
    const itemName = (id: string) => itemDefs.get(id)?.name.th ?? id;
    const pct = (bp: number) => `${bp / 100}%`;

    const draw = () => {
      body.replaceChildren();
      body.append(el("div", { class: "pm-stats" }, `เหรียญ ${bundle.coins.toLocaleString()}`));
      const list = el("ul", { class: "pm-list", "data-section": "refine" });
      const pieces = bundle.equipment.filter((p) => (equipmentDefs.get(p.definitionId)?.refinableStats ?? []).length > 0);
      if (pieces.length === 0) list.append(el("li", {}, "ไม่มีอุปกรณ์ที่ตีบวกได้"));
      for (const p of pieces) {
        const def = equipmentDefs.get(p.definitionId)!;
        const li = el("li", { "data-refine-piece": p.id });
        const label = el("span", { class: "pm-grow" });
        label.append(gearName(def, p), ` · ${statLine(refinedBaseStats(def, p.refineLevel))}${p.slot ? " (ใส่อยู่)" : ""}`);
        li.append(label);
        const b = el("button", { type: "button" }, p.id === pickedId ? "เลือกอยู่" : "เลือก");
        b.disabled = p.id === pickedId;
        b.addEventListener("click", () => {
          pickedId = p.id;
          useWard = false;
          result.textContent = "";
          draw();
        });
        li.append(b);
        list.append(li);
      }
      body.append(list);
      const piece = bundle.equipment.find((p) => p.id === pickedId);
      if (piece !== undefined) drawDetail(piece);
      body.append(
        el(
          "div",
          { class: "pm-note" },
          "ตั้งแต่ +6 ขึ้นไป พลาดแล้วอุปกรณ์แตกถาวร ถ้าไม่ได้เลือกใช้ตราคุ้มครองการหลอม · ตราคราฟต์ได้ที่ช่างเครื่องประดับ (สร้างของ) · ไม่มีการันตีหรือสะสมโอกาส",
        ),
      );
    };

    const drawDetail = (piece: EquipmentView) => {
      const def = equipmentDefs.get(piece.definitionId)!;
      const box = el("div", { class: "pm-item-rule", "data-refine-detail": piece.id });
      const q = refineQuote(RULES, def, piece.refineLevel);
      if (!q.ok) {
        box.append(el("div", {}, q.reason === "MAX_LEVEL" ? `ตีบวกครบ +${piece.refineLevel} แล้ว` : "ชิ้นนี้ตีบวกไม่ได้"));
        body.append(box);
        return;
      }
      const quote = q.quote;
      const stones = bundle.bag[quote.stoneItemId] ?? 0;
      const wards = quote.wardItemId === null ? 0 : (bundle.bag[quote.wardItemId] ?? 0);
      if (wards === 0) useWard = false;
      const sigilsAtRisk = quote.risky && !useWard && piece.sigils.length > 0;
      const sigilNames = piece.sigils.map((s) => sigilDefs.get(s)?.name.th ?? s).join(", ");
      const now = statLine(refinedBaseStats(def, piece.refineLevel));
      const next = statLine(refinedBaseStats(def, quote.target));
      const failText = !quote.risky
        ? "ของอยู่ ค่าบวกคงเดิม"
        : useWard
          ? "ของอยู่ ค่าบวกคงเดิม (ตราถูกใช้ไป)"
          : `อุปกรณ์ชิ้นนี้ถูกทำลายถาวร${piece.slot ? " และถูกถอดออก" : ""}${sigilsAtRisk ? ` พร้อม Sigil ที่ติดอยู่ (${sigilNames})` : ""}`;
      const lines = [
        `+${quote.from} → +${quote.target} · โอกาสสำเร็จ ${pct(quote.successBp)}`,
        `ค่าตี ${quote.coins.toLocaleString()} เหรียญ (มี ${bundle.coins.toLocaleString()})`,
        `${itemName(quote.stoneItemId)} ×${quote.stones} (มี ${stones})`,
        `ค่าพลัง: ${now} → ${next}`,
      ];
      for (const t of lines) box.append(el("div", {}, t));
      if (quote.wardItemId !== null) {
        const wl = el("label", {});
        const cb = el("input", { type: "checkbox", "data-refine-ward": quote.wardItemId });
        cb.checked = useWard;
        cb.disabled = wards === 0;
        cb.addEventListener("change", () => {
          useWard = cb.checked;
          draw();
        });
        wl.append(cb, ` ใช้${itemName(quote.wardItemId)} (มี ${wards}) · ใช้หมดทั้งสำเร็จและพลาด ไม่เพิ่มโอกาส`);
        box.append(wl);
      }
      box.append(el("div", { class: quote.risky && !useWard ? "pm-error" : "pm-note" }, `ถ้าพลาด: ${failText}`));
      if (sigilsAtRisk) {
        // O16 (Nut 2026-10-07): Sigils are lost with a broken piece. Warn and point to removal.
        box.append(
          el(
            "div",
            { class: "pm-error", "data-refine-sigil-warning": "" },
            `⚠ ชิ้นนี้มี Sigil: ${sigilNames} ถ้าตีพลาด Sigil จะหายไปพร้อมอุปกรณ์ · ถอด Sigil ก่อนได้ที่ผู้อ่านตรา (เสียเหรียญ) หรือใช้ตราคุ้มครอง`,
          ),
        );
      }
      const go = el("button", { type: "button", class: "primary", "data-refine-go": piece.id }, `ตีบวก +${quote.target}`);
      const short = bundle.coins < quote.coins ? "เหรียญไม่พอ" : stones < quote.stones ? "หินไม่พอ" : piece.lockState !== "free" ? "อยู่ในไฟต์" : null;
      go.disabled = short !== null || busy;
      if (short !== null) go.title = short;
      go.addEventListener("click", () => {
        const ward = useWard ? quote.wardItemId : null;
        const msg = [
          `ตีบวก ${pieceLabel(def, piece)} +${quote.from} → +${quote.target}`,
          `โอกาสสำเร็จ ${pct(quote.successBp)}`,
          `จ่าย ${quote.coins.toLocaleString()} เหรียญ + ${itemName(quote.stoneItemId)} ×${quote.stones}${ward ? ` + ${itemName(ward)} ×1` : ""}`,
          `ถ้าพลาด: ${failText}`,
          ...(sigilsAtRisk ? [`⚠ Sigil ${sigilNames} จะหายไปด้วยถ้าพลาด ยืนยันจะตีโดยไม่ถอดใช่ไหม`] : []),
        ].join("\n");
        if (!window.confirm(msg)) return;
        void attempt(piece, quote, ward, sigilsAtRisk);
      });
      const actionsRow = el("div", { class: "pm-actions" });
      actionsRow.append(go);
      box.append(actionsRow);
      body.append(box);
    };

    const pieceLabel = (def: EquipmentDefinition, p: EquipmentView) => equipmentDisplayName(def, p.sigils, sigilDefs);

    const attempt = async (piece: EquipmentView, quote: RefineQuote, ward: string | null, acceptSigilLoss: boolean) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        const r = await api.refine(piece.id, piece.refineLevel, piece.version ?? 1, ward, { coins: quote.coins, stoneItemId: quote.stoneItemId, stones: quote.stones }, acceptSigilLoss);
        const x = r.result;
        result.textContent =
          x.outcome === "success"
            ? `สำเร็จ! ตอนนี้ +${x.target} (สุ่มได้ ${x.roll} < ${x.successBp})`
            : x.outcome === "kept"
              ? `พลาด ค่าบวกคงเดิม +${x.from} (สุ่มได้ ${x.roll}, ต้องต่ำกว่า ${x.successBp})`
              : `พลาด อุปกรณ์แตกแล้ว${x.sigilsLost.length ? ` พร้อม Sigil ${x.sigilsLost.length} ดวง` : ""} (สุ่มได้ ${x.roll}, ต้องต่ำกว่า ${x.successBp})`;
        result.setAttribute("data-refine-result", x.outcome);
        if (x.outcome === "destroyed") pickedId = null;
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        draw();
      }
    };
    draw();
  });
}

export function craftPanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;
    let prof: Profession = "armorsmith";
    let times = 1;
    const body = el("div");
    const note = el("div", { class: "pm-note", "data-craft-note": "" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(done);
    panel.append(el("h2", {}, "สร้างของ"), body, note, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });

    const weights = RULES.provisional.gearRarityWeights.value;
    const weightSum = RARITIES.reduce((s, r) => s + weights[r], 0);
    const odds = RARITIES.filter((r) => weights[r] > 0)
      .map((r) => `${RARITY_NAME_TH[r]} ${Math.round((weights[r] / weightSum) * 1000) / 10}%`)
      .join(" · ");

    const make = async (r: Recipe, n: number) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        const res = await api.craft(r.id, n, craftQuote(r, n).coins);
        const made = [
          ...res.result.items.map((i) => `${itemDefs.get(i.itemId)?.name.th ?? i.itemId} ×${i.quantity}`),
          ...res.result.equipment.map((e) => `${RARITY_NAME_TH[e.rarity]} ${equipmentDefs.get(e.definitionId)?.name.th ?? e.definitionId}${e.affixes.length > 0 ? ` (${e.affixes.map((a) => `${STAT_TH[a.stat] ?? a.stat} +${a.value}`).join(" · ")})` : ""}`),
        ];
        note.textContent = `ได้ ${made.join(", ")} · ความชำนาญ ${res.result.mastery.before} → ${res.result.mastery.after}`;
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        draw();
      }
    };

    const draw = () => {
      body.replaceChildren();
      const mastery = bundle.craftMastery ?? { weaponsmith: 0, armorsmith: 0, jeweler: 0, alchemist: 0, tamer: 0, tailor: 0 };
      body.append(el("div", { class: "pm-stats" }, `เหรียญ ${bundle.coins.toLocaleString()} · ${PROFESSION_NAME_TH[prof]} ความชำนาญ ${mastery[prof]}`));
      const tabs = el("div", { class: "pm-choices", role: "group" });
      for (const p of PROFESSIONS) {
        const count = EXAMPLE_RECIPES.filter((r) => r.profession === p).length;
        const b = el("button", { type: "button", "aria-pressed": String(p === prof), "data-prof": p }, `${PROFESSION_NAME_TH[p]} (${mastery[p]})`);
        b.disabled = count === 0;
        b.addEventListener("click", () => {
          prof = p;
          draw();
        });
        tabs.append(b);
      }
      const timesRow = el("div", { class: "pm-choices", role: "group" });
      for (const n of [1, 5, 10]) {
        const b = el("button", { type: "button", "aria-pressed": String(n === times), "data-times": String(n) }, `ทำ ×${n}`);
        b.addEventListener("click", () => {
          times = n;
          draw();
        });
        timesRow.append(b);
      }
      body.append(tabs, el("label", {}, "จำนวนครั้ง"), timesRow);
      const list = el("ul", { class: "pm-list" });
      const recipes = EXAMPLE_RECIPES.filter((r) => r.profession === prof);
      if (recipes.length === 0) list.append(el("li", {}, "อาชีพนี้ยังไม่มีสูตร (ยังไม่มีชุดแฟชั่น/ของคู่ใจ)"));
      for (const r of recipes) {
        const q = craftQuote(r, times);
        const li = el("li", { class: "pm-skill-pet", "data-recipe": r.id });
        li.append(el("div", {}, r.name.th));
        const need = q.inputs.map((i) => `${itemDefs.get(i.itemId)?.name.th ?? i.itemId} ${bundle.bag[i.itemId] ?? 0}/${i.quantity}`).join(" · ");
        li.append(el("span", { class: "pm-affix" }, `ใช้ ${need} · ${q.coins} เหรียญ`));
        const after = masteryAfter(r, mastery[prof], times);
        li.append(
          el(
            "span",
            { class: "pm-affix" },
            mastery[prof] < r.requiredMastery
              ? `ต้องมีความชำนาญ ${r.requiredMastery}`
              : after > mastery[prof]
                ? `ความชำนาญ +${after - mastery[prof]} (ได้ถึง ${r.masteryCap})`
                : `ความชำนาญถึงเพดานสูตรนี้แล้ว (${r.masteryCap}) ยังทำได้ไม่จำกัด`,
          ),
        );
        if (r.output.kind === "equipment") {
          const def = equipmentDefs.get(r.output.definitionId);
          const pool = def === undefined ? undefined : affixPools.get(def.affixPoolId);
          if (def !== undefined) {
            li.append(el("span", { class: "pm-affix" }, `ได้ ${def.name.th} ×${times} · ช่อง Sigil ${sigilCapacity(RULES, def)} · โอกาสระดับ: ${odds}`));
            if (pool !== undefined) li.append(el("span", { class: "pm-affix" }, `ออปชันที่อาจได้: ${pool.entries.map((e) => STAT_TH[e.stat] ?? e.stat).join(", ")}`));
          }
        } else {
          li.append(el("span", { class: "pm-affix" }, `ได้ ${itemDefs.get(r.output.itemId)?.name.th ?? r.output.itemId} ×${r.output.quantity * times}`));
        }
        const b = el("button", { type: "button", "data-make": r.id }, `สร้าง ×${times} (−${q.coins})`);
        b.disabled =
          bundle.coins < q.coins || mastery[prof] < r.requiredMastery || q.inputs.some((i) => (bundle.bag[i.itemId] ?? 0) < i.quantity);
        b.addEventListener("click", () => void make(r, times));
        li.append(b);
        list.append(li);
      }
      body.append(list, el("div", { class: "pm-note" }, "สร้างได้ในเมืองเท่านั้น · สร้างสำเร็จทุกครั้งถ้าวัตถุดิบครบ · สูตร/ตัวเลขเป็นตัวอย่าง (P12)"));
    };
    draw();
  });
}

/**
 * Daily / Weekly quests (chapter 09): today's 8 quests (rewards for 4), this week's quests and its
 * main reward, with progress the server counted and when each board resets. Deliveries ask first,
 * since they hand over the items.
 */
export function questPanel(api: CharacterApi): Promise<void> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let busy = false;
    const body = el("div");
    const note = el("div", { class: "pm-note", "data-quest-note": "" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(done);
    panel.append(el("h2", {}, "เควส"), body, note, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve();
    });
    const names = {
      species: (id: string) => species.get(id)?.name.th ?? id,
      item: (id: string) => itemDefs.get(id)?.name.th ?? id,
      map: (id: string) => maps.get(id)?.name.th ?? id,
      profession: (p: Profession) => PROFESSION_NAME_TH[p],
    };
    const rewardText = (r: QuestReward) =>
      [`${r.coins} เหรียญ`, r.exp > 0 ? `EXP ${r.exp}` : "", ...r.items.map((i) => `${names.item(i.itemId)} ×${i.quantity}`)].filter((x) => x !== "").join(" · ");
    const resetText = (iso: string) => new Date(iso).toLocaleString("th-TH", { weekday: "short", hour: "2-digit", minute: "2-digit" });

    const claim = async (periodId: string, slot: number | "main", confirmText?: string) => {
      if (busy) return;
      if (confirmText !== undefined && !window.confirm(confirmText)) return;
      busy = true;
      error.textContent = "";
      try {
        const r = await api.claimQuest(periodId, slot);
        note.textContent = `ได้รับ ${rewardText(r.result.reward)}${r.result.delivered === undefined ? "" : ` (ส่ง ${names.item(r.result.delivered.itemId)} ×${r.result.delivered.quantity})`}`;
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        busy = false;
        await load();
      }
    };

    const board = (v: QuestBoardView) => {
      const daily = v.cadence === "daily";
      const head = daily
        ? `รายวัน · รับรางวัลได้อีก ${v.claimsLeft} ครั้ง · รีเซ็ต ${resetText(v.period.endsAt)}`
        : `รายสัปดาห์ · ทำ ${v.needs} อย่างรับรางวัลใหญ่ · รีเซ็ต ${resetText(v.period.endsAt)}`;
      body.append(el("h3", {}, head), el("div", { class: "pm-note" }, `รางวัล${daily ? "ต่อเควส" : "ใหญ่"}: ${rewardText(v.reward)}`));
      const list = el("ul", { class: "pm-list", "data-board": v.cadence });
      v.goals.forEach((g, i) => {
        const li = el("li", { "data-quest": String(i) });
        li.append(el("span", { class: "pm-grow" }, `${questGoalText(g.goal, names)} · ${g.progress}/${g.goal.count}${g.claimed ? " · รับแล้ว" : g.done ? " · สำเร็จ" : ""}`));
        if (daily) {
          const b = el("button", { type: "button" }, g.claimed ? "รับแล้ว" : "รับรางวัล");
          b.disabled = g.claimed || !g.done || v.claimsLeft === 0;
          const ask = g.goal.kind === "deliver" ? `ส่ง ${names.item(g.goal.itemId)} ×${g.goal.count} (ของจะถูกใช้)?` : undefined;
          b.addEventListener("click", () => void claim(v.period.id, i, ask));
          li.append(b);
        }
        list.append(li);
      });
      body.append(list);
      if (!daily) {
        const doneCount = v.goals.filter((g) => g.done).length;
        const b = el("button", { type: "button", "data-quest": "main" }, v.claimsLeft === 0 ? "รับรางวัลใหญ่แล้ว" : `รับรางวัลใหญ่ (${doneCount}/${v.needs})`);
        b.disabled = v.claimsLeft === 0 || doneCount < (v.needs ?? 0);
        b.addEventListener("click", () => void claim(v.period.id, "main"));
        const row = el("div", { class: "pm-actions" });
        row.append(b);
        body.append(row);
      }
    };

    const load = async () => {
      try {
        const v = await api.quests();
        body.replaceChildren();
        board(v.daily);
        board(v.weekly);
        body.append(el("div", { class: "pm-note" }, "นับความคืบหน้าตั้งแต่เริ่มรอบ ไม่ต้องรับเควสก่อน · ล่าอัตโนมัตินับการล่า · เควสเป็นโบนัส ล่าต่อได้ไม่จำกัด · ตัวเลขเป็นค่าทดลอง (P13)"));
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      }
    };
    void load();
  });
}

/**
 * Collection / Journal (chapter 09): each species' records kept apart (met, defeated, caught
 * yourself, owned now, elements, raised, reborn, Bond), maps found, Sigils received / worn, and
 * cosmetic titles. Search by level band, element, role and map. Species info (capture item, drops'
 * Sigil) stays readable for unmet species too, since build info is never locked behind the journal.
 */
export function journalPanel(api: CharacterApi): Promise<void> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    const body = el("div");
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(done);
    panel.append(el("h2", {}, "สมุดบันทึก"), body, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve();
    });
    const filters = { band: "", element: "", role: "", map: "" };
    const ROLE_TH: Record<string, string> = { tank: "แทงก์", physical: "โจมตีกายภาพ", magic: "เวท", support: "ซัพพอร์ต", control: "ควบคุม" };
    const speciesMaps = new Map<string, string[]>();
    for (const m of maps.values()) for (const sp of m.spawns) for (const e of sp.entries) speciesMaps.set(e.speciesId, [...new Set([...(speciesMaps.get(e.speciesId) ?? []), m.id])]);
    for (const m of maps.values()) {
      const b = m.bossLair === undefined ? undefined : exampleContentMaps().bosses.get(m.bossLair.bossId);
      if (b !== undefined) speciesMaps.set(b.speciesId, [...new Set([...(speciesMaps.get(b.speciesId) ?? []), m.id])]);
    }

    let data: Awaited<ReturnType<CharacterApi["journal"]>> | null = null;
    const draw = () => {
      if (data === null) return;
      const j = data;
      body.replaceChildren();
      const records = new Map(j.species.map((s) => [s.speciesId, s]));
      const all = [...species.values()];
      const met = all.filter((s) => (records.get(s.id)?.seenElements.length ?? 0) > 0).length;
      body.append(
        el(
          "div",
          { class: "pm-stats" },
          `พบแล้ว ${met}/${all.length} ชนิด · แผนที่ ${j.maps.length}/${maps.size} · ตรา Sigil ที่ได้ ${Object.keys(j.sigilsReceived).length} แบบ · ใส่อยู่ ${j.sigilsWorn.length} แบบ`,
        ),
      );
      // Titles: cosmetic only.
      body.append(el("h3", {}, "ฉายา (แสดงหน้าชื่อ ไม่มีผลต่อพลัง)"));
      const tl = el("ul", { class: "pm-list", "data-section": "titles" });
      for (const t of JOURNAL_TITLES) {
        const earned = j.titles.includes(t.id);
        const li = el("li", { "data-title": t.id });
        li.append(el("span", { class: "pm-grow" }, `${earned ? "★" : "☆"} ${t.name.th} — ${t.how.th}`));
        const b = el("button", { type: "button" }, j.titleId === t.id ? "ถอด" : "ใช้");
        b.disabled = !earned;
        b.addEventListener("click", async () => {
          try {
            await api.setTitle(j.titleId === t.id ? null : t.id);
            data = await api.journal();
            draw();
          } catch (e) {
            error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
          }
        });
        li.append(b);
        tl.append(li);
      }
      body.append(tl);

      body.append(el("h3", {}, "มอนสเตอร์"));
      const bar = el("div", { class: "pm-choices" });
      const select = (key: keyof typeof filters, label: string, opts: { value: string; label: string }[]) => {
        const s = el("select", { "aria-label": label, "data-filter": key });
        s.append(el("option", { value: "" }, `${label}: ทั้งหมด`));
        for (const o of opts) {
          const op = el("option", { value: o.value }, o.label);
          if (o.value === filters[key]) op.selected = true;
          s.append(op);
        }
        s.addEventListener("change", () => {
          filters[key] = s.value;
          draw();
        });
        bar.append(s);
      };
      select("band", "เลเวล", [...new Set(all.map((s) => levelBand(s.fixedWildLevel)))].map((b) => ({ value: b, label: `Lv ${b}` })));
      select("element", "ธาตุ", (Object.keys(ELEMENT_TH) as Element[]).map((e) => ({ value: e, label: ELEMENT_TH[e] })));
      select("role", "บทบาท", [...new Set(all.map((s) => s.archetype))].map((r) => ({ value: r, label: ROLE_TH[r] ?? r })));
      select("map", "พื้นที่", [...maps.values()].filter((m) => m.kind !== "town").map((m) => ({ value: m.id, label: m.name.th })));
      body.append(bar);
      const list = el("ul", { class: "pm-list", "data-section": "species" });
      const shown = all.filter(
        (s) =>
          (filters.band === "" || levelBand(s.fixedWildLevel) === filters.band) &&
          (filters.element === "" || s.allowedElements.includes(filters.element as Element)) &&
          (filters.role === "" || s.archetype === filters.role) &&
          (filters.map === "" || (speciesMaps.get(s.id) ?? []).includes(filters.map)),
      );
      for (const s of shown) {
        const r: JournalSpecies | undefined = records.get(s.id);
        const metIt = (r?.seenElements.length ?? 0) > 0;
        const li = el("li", { class: "pm-skill-pet", "data-species": s.id });
        li.append(el("div", {}, `${metIt ? s.name.th : `${s.name.th} (ยังไม่พบ)`} · Lv${s.fixedWildLevel} · ${ROLE_TH[s.archetype] ?? s.archetype}${s.rank === "BOSS" ? " · บอส" : ""}`));
        li.append(
          el(
            "span",
            { class: "pm-affix" },
            `ธาตุที่มีได้ ${s.allowedElements.map((e) => ELEMENT_TH[e]).join("/")} · เครื่องจับ ${itemDefs.get(s.captureItemId)?.name.th ?? "-"} · พื้นที่ ${(speciesMaps.get(s.id) ?? []).map((m) => maps.get(m)?.name.th ?? m).join(", ") || "-"}`,
          ),
        );
        if (r !== undefined) {
          li.append(
            el(
              "span",
              { class: "pm-affix" },
              `พบในธาตุ ${r.seenElements.map((e) => ELEMENT_TH[e]).join("/") || "-"} · ชนะ ${r.defeated} · จับเอง ${r.capturedPersonally} (ธาตุ ${r.capturedElements.map((e) => ELEMENT_TH[e]).join("/") || "-"}) · มีอยู่ ${r.ownedNow}`,
            ),
          );
          if (r.ownedNow > 0) {
            li.append(el("span", { class: "pm-affix" }, `เลี้ยงสูงสุด Lv${r.raisedLevel} · จุติ ${r.rebirthStage} · Bond ${BOND_TIER_NAMES[r.bondTier] ?? r.bondTier}`));
          }
        }
        list.append(li);
      }
      if (shown.length === 0) list.append(el("li", {}, "ไม่มีชนิดที่ตรงกับตัวกรอง"));
      body.append(list);
      body.append(el("h3", {}, "แผนที่"));
      body.append(el("div", { class: "pm-note" }, [...maps.values()].map((m) => `${j.maps.includes(m.id) ? "✓" : "·"} ${m.name.th}`).join("  ")));
      body.append(el("h3", {}, "ตรา Sigil"));
      body.append(
        el(
          "div",
          { class: "pm-note" },
          [...sigilDefs.values()].map((sg) => `${sg.name.th}: ได้ ${j.sigilsReceived[sg.id] ?? 0}${j.sigilsWorn.includes(sg.id) ? " · ใส่อยู่" : ""}`).join("  ·  "),
        ),
      );
      body.append(el("div", { class: "pm-note" }, "นับการชนะ/จับตั้งแต่เปิดระบบบันทึก · ฉายาเป็นตัวอย่าง (P12)"));
    };
    api
      .journal()
      .then((j) => {
        data = j;
        draw();
      })
      .catch((e) => (error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e)));
  });
}

const secretRewards = exampleSecretRewardRegistry();
const secretTemplates = new Map(EXAMPLE_SECRET_QUEST_TEMPLATES.map((t) => [t.id, t]));

/** Display name of a title id (journal titles, and secret quest titles by their reward). */
export const titleName = (id: string | null | undefined) => {
  if (id == null) return null;
  const journal = JOURNAL_TITLES.find((t) => t.id === id)?.name.th;
  if (journal !== undefined) return journal;
  const reward = secretTitleRewardId(id);
  return reward === null ? null : (secretRewards.get(reward)?.name.th ?? null);
};

const SECRET_KIND_TH = { element: "ประจำธาตุ", race: "ประจำเผ่า", personal: "เฉพาะตัว" } as const;
const SECRET_REWARD_TH = { title: "ฉายา", fashion: "แฟชั่น", companion: "อสูร", gear: "อุปกรณ์" } as const;

/** A secret quest's text with its rolled values filled in (display only). */
function secretQuestText(q: SecretQuest): string {
  const t = secretTemplates.get(q.templateId)?.text.th ?? q.templateId;
  const p = q.params;
  const fill: Record<string, string | undefined> = {
    species: p.speciesId === undefined ? undefined : (species.get(p.speciesId)?.name.th ?? p.speciesId),
    element: p.element === undefined ? undefined : ELEMENT_TH[p.element],
    map: p.mapId === undefined ? undefined : (exampleMapRegistry().get(p.mapId)?.name.th ?? p.mapId),
    item: p.itemId === undefined ? undefined : (itemDefs.get(p.itemId)?.name.th ?? p.itemId),
    count: p.count.toLocaleString(),
    rounds: p.rounds?.toString(),
    hpPct: p.hpBelowPct?.toString(),
    bondTier: p.bondTier === undefined ? undefined : (BOND_TIER_NAMES[p.bondTier] ?? String(p.bondTier)),
    floor: p.floor?.toString(),
  };
  return t.replace(/\{(\w+)\}/g, (m, k: string) => fill[k] ?? m);
}

/**
 * Secret quests (Nut 2026-10-05). Locked: one line and nothing else, since the server says nothing
 * more (no count, no hints). Open: each quest with progress, deliver (in town) and claim buttons.
 */
export function secretQuestPanel(api: CharacterApi): Promise<void> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let busy = false;
    const body = el("div", { "data-secret": "" });
    const note = el("div", { class: "pm-note", "data-secret-note": "" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(done);
    panel.append(el("h2", {}, "เควสลับ"), body, note, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve();
    });
    const act = async (run: () => Promise<string>) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        note.textContent = await run();
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        busy = false;
        await load();
      }
    };
    const load = async () => {
      try {
        const [v, bundle] = await Promise.all([api.secretQuests(), api.get()]);
        body.replaceChildren();
        if (v.locked) {
          body.append(el("div", { class: "pm-stats", "data-secret-locked": "" }, "ยังไม่มีใครรู้ว่าเส้นทางของเจ้าซ่อนอะไรไว้… (เปิดหลังเควสบรรลุ)"));
          return;
        }
        const bag = bundle?.bag ?? {};
        const claimed = new Set(v.claimed ?? []);
        const list = el("ul", { class: "pm-list" });
        for (const q of v.quests) {
          const pr = v.progress?.[q.id];
          const n = pr?.progress ?? 0;
          const li = el("li", { class: "pm-skill-pet", "data-secret-quest": q.id });
          li.append(el("div", {}, `[${SECRET_KIND_TH[q.kind]}] ${secretQuestText(q)}`));
          li.append(el("span", { class: "pm-affix" }, `ความคืบหน้า ${n.toLocaleString()}/${q.params.count.toLocaleString()}${claimed.has(q.id) ? " · รับรางวัลแล้ว" : pr?.completed ? " · สำเร็จ!" : ""}`));
          if (q.rewards !== undefined) {
            li.append(el("span", { class: "pm-affix" }, `รางวัล: ${q.rewards.map((r) => `${SECRET_REWARD_TH[r.kind]} ${secretRewards.get(r.rewardId)?.name.th ?? r.rewardId}`).join(" · ")}`));
          }
          if (q.goal === "deliver" && q.params.itemId !== undefined && !pr?.completed) {
            const itemId = q.params.itemId;
            const give = Math.min(bag[itemId] ?? 0, q.params.count - n);
            const b = el("button", { type: "button", "data-secret-deliver": q.id }, `ส่ง ${itemDefs.get(itemId)?.name.th ?? itemId} ×${give}`);
            b.disabled = give <= 0;
            b.addEventListener("click", () => {
              if (!window.confirm(`ส่ง ${itemDefs.get(itemId)?.name.th ?? itemId} ×${give}? ของจะถูกใช้ไป`)) return;
              void act(async () => {
                await api.secretDeliver(q.id, give);
                return `ส่งแล้ว ${give} ชิ้น`;
              });
            });
            li.append(b);
          }
          if (pr?.completed && !claimed.has(q.id)) {
            const b = el("button", { type: "button", class: "primary", "data-secret-claim": q.id }, "รับรางวัล");
            b.addEventListener("click", () =>
              void act(async () => {
                const r = await api.secretClaim(q.id);
                return `ได้รับ ${r.result.rewards.map((x) => `${SECRET_REWARD_TH[x.kind as keyof typeof SECRET_REWARD_TH] ?? x.kind} ${secretRewards.get(x.rewardId)?.name.th ?? x.rewardId}`).join(" · ")}`;
              }),
            );
            li.append(b);
          }
          list.append(li);
        }
        body.append(list, el("div", { class: "pm-note" }, "นับเฉพาะไฟต์ที่ชนะโดยทำตามทุกเงื่อนไข · แวะแผนที่นับชั่วโมงละครั้ง · ส่งของได้ในเมือง · รางวัลเป็นของตัวละครนี้คนเดียว"));
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      }
    };
    void load();
  });
}

/**
 * NPC Orders (chapter 09): what each villager wants, the reward announced up front, and fills left
 * this week. Filling hands the materials over (asked first); the server checks town, bag and limit.
 */
export function ordersPanel(api: CharacterApi): Promise<void> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let busy = false;
    const body = el("div");
    const note = el("div", { class: "pm-note", "data-order-note": "" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    actions.append(done);
    panel.append(el("h2", {}, "งานสั่งจากชาวบ้าน"), body, note, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve();
    });
    const name = (id: string) => itemDefs.get(id)?.name.th ?? id;
    const load = async () => {
      try {
        const [v, bundle] = await Promise.all([api.orders(), api.get()]);
        const bag = bundle?.bag ?? {};
        body.replaceChildren();
        body.append(el("div", { class: "pm-stats" }, `รีเซ็ต ${new Date(v.endsAt).toLocaleString("th-TH", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · เหรียญ ${(bundle?.coins ?? 0).toLocaleString()}`));
        const list = el("ul", { class: "pm-list" });
        for (const { order, left } of v.orders) {
          const li = el("li", { class: "pm-skill-pet", "data-order": order.id });
          li.append(el("div", {}, `${order.npc.th}: ${order.note.th}`));
          li.append(el("span", { class: "pm-affix" }, `ต้องการ ${order.wants.map((w) => `${name(w.itemId)} ${bag[w.itemId] ?? 0}/${w.quantity}`).join(" · ")}`));
          li.append(el("span", { class: "pm-affix" }, `ให้ ${[`${order.reward.coins} เหรียญ`, ...order.reward.items.map((r) => `${name(r.itemId)} ×${r.quantity}`)].join(" · ")} · สัปดาห์นี้เหลือ ${left}/${order.weeklyLimit}`));
          const b = el("button", { type: "button", "data-fill": order.id }, "ส่งของ");
          b.disabled = left === 0 || order.wants.some((w) => (bag[w.itemId] ?? 0) < w.quantity);
          b.addEventListener("click", async () => {
            if (busy || !window.confirm(`ส่ง ${order.wants.map((w) => `${name(w.itemId)} ×${w.quantity}`).join(", ")} ให้${order.npc.th}?`)) return;
            busy = true;
            error.textContent = "";
            try {
              const r = await api.fillOrder(order.id);
              note.textContent = `ได้ ${[`${r.result.reward.coins} เหรียญ`, ...r.result.reward.items.map((x) => `${name(x.itemId)} ×${x.quantity}`)].join(" · ")}`;
            } catch (e) {
              error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
            } finally {
              busy = false;
              await load();
            }
          });
          li.append(b);
          list.append(li);
        }
        body.append(list, el("div", { class: "pm-note" }, "จำนวนต่อสัปดาห์มีจำกัด · ร้านปกติยังรับซื้อเหมือนเดิม · งานตัวอย่าง (P12)"));
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      }
    };
    void load();
  });
}

/**
 * Weekly tower NPC (town only; the server checks the stored position too). Shows the tower, whether
 * this week's entry is used, the current and best floor; Enter / Next floor / Leave. Resolves with the
 * floor fight to open, or null when closed. Everything is the server's answer; nothing is decided here.
 */
export function frontierPanel(api: CharacterApi): Promise<string | null> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let busy = false;
    // One id for this panel's "enter": a retried tap can never use a second entry.
    const enterOp = `frontier_${crypto.randomUUID().replace(/-/g, "")}`;
    const title = el("h2", { "data-frontier-title": "" }, "หอคอย");
    const body = el("div", { "data-frontier": "" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const leave = el("button", { type: "button", "data-frontier-leave": "" }, "ออกจากหอ");
    const enter = el("button", { type: "button", class: "primary", "data-frontier-enter": "" }, "เข้าหอคอย");
    const next = el("button", { type: "button", class: "primary", "data-frontier-next": "" }, "ชั้นถัดไป");
    const done = el("button", { type: "button" }, "ปิด");
    actions.append(leave, enter, next, done);
    panel.append(title, body, error, actions);
    const finish = (battleId: string | null) => {
      close();
      resolve(battleId);
    };
    done.addEventListener("click", () => finish(null));
    let view: FrontierView | null = null;
    const act = async (run: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        await run();
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        busy = false;
      }
    };
    enter.addEventListener("click", () =>
      act(async () => {
        if (!window.confirm("ใช้สิทธิ์เข้าหอคอยของสัปดาห์นี้? (เข้าได้สัปดาห์ละครั้ง)")) return;
        view = (await api.frontierEnter(enterOp)).view;
        draw();
      }),
    );
    next.addEventListener("click", () =>
      act(async () => {
        const run = view?.run;
        if (run == null) return;
        const r = await api.frontierStart(run.runId, run.floor);
        finish(r.battleId);
      }),
    );
    leave.addEventListener("click", () =>
      act(async () => {
        const run = view?.run;
        if (run == null) return;
        view = (await api.frontierLeave(run.runId)).view;
        draw();
      }),
    );
    const draw = () => {
      const v = view;
      if (v === null) return;
      title.textContent = v.name.th;
      body.replaceChildren();
      const run = v.run;
      const ends = new Date(v.endsAt).toLocaleString("th-TH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      body.append(el("div", { class: "pm-note" }, v.lore));
      body.append(
        el(
          "div",
          { class: "pm-stats", "data-frontier-status": "", style: "white-space: pre-line" },
          [
            `สิทธิ์เข้าสัปดาห์นี้: ${v.entryUsed ? "ใช้แล้ว" : "ยังไม่ใช้"} · รีเซ็ต ${ends}`,
            run === null ? `ยังไม่ได้เข้า · ${v.floors} ชั้น บอสทุก ${v.bossEvery} ชั้น` : `ชั้นปัจจุบัน: ${run.status === "open" ? `${run.floor}${run.nextIsBoss ? " (ชั้นบอส ★)" : ""}` : "-"} · ดีที่สุดสัปดาห์นี้: ${run.best}/${v.floors}`,
            run === null
              ? ""
              : run.status === "ended"
                ? run.endReason === "summit"
                  ? "ถึงยอดหอแล้ว! รอสัปดาห์หน้า"
                  : "แพ้แล้ว รอบนี้จบ · เข้าใหม่ได้สัปดาห์หน้า"
                : run.battleId !== null
                  ? `ไฟต์ชั้น ${run.floor} ยังค้างอยู่ (กด "ชั้นถัดไป" เพื่อกลับเข้าไป)`
                  : `${run.inside ? "อยู่ในหอ" : "ออกมาพักข้างนอก"} · HP/MP ติดตัวข้ามชั้น ฟื้น 30% ทุก 5 ชั้น`,
          ]
            .filter((x) => x !== "")
            .join("\n"),
        ),
      );
      // The next floor as content names it: the same for every player (fixed gimmicks).
      const nf = run?.next ?? null;
      if (nf !== null) {
        body.append(
          el(
            "div",
            { class: "pm-stats", "data-frontier-next-floor": "", style: "white-space: pre-line" },
            [
              `ชั้น ${nf.floor}: ${nf.name}${nf.guardianTitle !== null ? ` · ★ ${nf.guardianTitle}` : ""}`,
              `ลูกเล่น: ${nf.modifiers.map((m) => `${m.name} (${m.hint}${m.id === "mono_element" && nf.element !== null ? ` ${nf.element}` : ""})`).join(", ")}`,
              `ศัตรู ${nf.monsters} ตัว${nf.reinforcements > 0 ? ` · กำลังเสริม ${nf.reinforcements} ตัว (เข้าแทนตัวที่ล้มเมื่อจบรอบ)` : ""}`,
            ].join("\n"),
          ),
        );
      }
      body.append(el("div", { class: "pm-note" }, "จับมอนสเตอร์ในหอได้ตามปกติ (เริ่ม Lv1) รวมถึงกำลังเสริม · บอสทุก 10 ชั้นมีของหายาก · ค่าทั้งหมดเป็นตัวอย่าง (P12)"));
      enter.hidden = v.entryUsed;
      next.hidden = run === null || run.status !== "open";
      next.textContent = run?.battleId != null ? "กลับเข้าไฟต์" : `ชั้นถัดไป (${run?.floor ?? 1})`;
      leave.hidden = run === null || run.status !== "open" || run.battleId !== null || !run.inside;
    };
    const load = async (tries = 0) => {
      try {
        view = await api.frontier();
        draw();
        // A floor that just ended may still be recording; ask again shortly.
        if (view.run?.battleId != null && tries < 5) setTimeout(() => void load(tries + 1), 800);
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      }
    };
    void load();
  });
}

/**
 * Town training ground (P17): every field boss, fought with the current team at full HP and no items.
 * Nothing is earned or lost, and the fight can be left at any time. Resolves with the battle id to open.
 */
export function practicePanel(api: CharacterApi): Promise<string | null> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let busy = false;
    const body = el("ul", { class: "pm-list", "data-practice": "" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const done = el("button", { type: "button" }, "ปิด");
    const actions = el("div", { class: "pm-actions" });
    actions.append(done);
    panel.append(
      el("h2", {}, "ลานทดสอบ"),
      el("div", { class: "pm-note" }, "ลองทีมกับบอสประจำทุ่งได้ไม่จำกัด เริ่มด้วย HP/MP เต็ม ไม่พกไอเทม · ไม่ได้ EXP/ของ/Bond และจับไม่ได้ · HP ไม่ติดตัวออกมา · กดหนีเพื่อออกได้ทุกเมื่อ"),
      body,
      error,
      actions,
    );
    const finish = (battleId: string | null) => {
      close();
      resolve(battleId);
    };
    done.addEventListener("click", () => finish(null));
    const start = async (bossId: string) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        // A fresh id per tap: a retry of this request resumes the same fight on the server.
        const r = await api.practiceStart(`practice_${crypto.randomUUID().replace(/-/g, "")}`, bossId);
        finish(r.battleId);
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        busy = false;
      }
    };
    void api
      .practice()
      .then((v) => {
        for (const b of v.bosses) {
          const go = el("button", { type: "button", class: "primary", "data-practice-boss": b.bossId }, "ลองสู้");
          go.addEventListener("click", () => void start(b.bossId));
          const notes = [
            `Lv${b.level} · ${b.mapName}`,
            `${b.phases} ช่วง`,
            ...(b.adds > 0 ? [`ลูกน้อง ${b.adds}`] : []),
            ...(b.parts.length > 0 ? [`ชิ้นส่วน: ${b.parts.join(", ")}`] : []),
            ...(b.summons ? ["เรียกลูกน้องเพิ่มกลางไฟต์"] : []),
          ];
          const li = el("li", {});
          li.append(el("span", {}, `${b.name} (${notes.join(" · ")})`), go);
          body.append(li);
        }
      })
      .catch((e) => {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      });
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
const TARGET_TH: Record<SkillDefinition["targetRule"], string> = {
  single_enemy: "ศัตรู 1 ตัว",
  all_enemies: "ศัตรูทั้งหมด",
  enemy_row: "ศัตรูทั้งแถว",
  single_ally: "พวกเดียวกัน 1 ตัว",
  all_allies: "พวกเดียวกันทั้งหมด",
  self: "ตัวเอง",
  none: "",
};

/** One line on what a class skill does, from its definition (numbers as the kernel uses them). */
function skillBrief(sk: SkillDefinition): string {
  if (sk.kind === "passive") {
    const p = sk.passive;
    const trig = (p?.triggers ?? []).map((t) => `${PASSIVE_ON_TH[t.on] ?? t.on}${t.chancePct < 100 ? ` (${t.chancePct}%)` : ""}`);
    const mods = (p?.modifiers ?? []).map((m) =>
      m.kind === "guard_reduction" ? `ป้องกันแล้วรับดาเมจลดอีก ${m.reductionPct}%` : m.kind === "heal_low_hp" ? `ฮีลแรงขึ้น ${m.bonusPct}% กับเป้าหมาย HP ต่ำกว่า ${m.belowHpPct}%` : `ดาเมจ +${m.bonusPct}% กับเป้าหมายที่ติด${STATUS_DEFINITIONS[m.statusId].th}`,
    );
    return ["ติดตัว", ...trig.map((t) => `ทำงานเมื่อ${t}`), ...mods].join(" · ");
  }
  const parts = [`MP ${sk.mpCost}`, sk.cooldown > 0 ? `คูลดาวน์ ${sk.cooldown} ตา` : "", TARGET_TH[sk.targetRule]];
  for (const e of sk.effectSequence) {
    if (e.kind === "damage") parts.push(`${e.damageType === "physical" ? "ดาเมจกาย" : "ดาเมจเวท"} ×${e.coefficient}${e.element !== "NEUTRAL" ? ` ธาตุ${e.element}` : ""}`);
    if (e.kind === "heal") parts.push(`ฮีล ×${e.coefficient}${e.flat > 0 ? ` +${e.flat}` : ""}`);
    if (e.kind === "revive") parts.push(`ชุบชีวิต HP ${e.hpPct}%`);
    for (const a of ("statuses" in e ? e.statuses : undefined) ?? []) parts.push(`${STATUS_DEFINITIONS[a.statusId].th}${a.shieldPct !== undefined ? ` ${a.shieldPct}%` : ""} ${a.chancePct}% ${a.turns} ตา`);
  }
  return parts.filter(Boolean).join(" · ");
}

const PASSIVE_ON_TH: Partial<Record<string, string>> = {
  battle_start: "เริ่มไฟต์",
  turn_start: "เริ่มตา",
  used_skill: "ใช้สกิล",
  used_item: "ใช้ไอเทม",
  moved: "สลับตำแหน่ง",
  debuffed: "ถูกศัตรูติดสถานะ",
  kill: "ล้มศัตรู",
  ally_down: "พวกเดียวกันล้ม",
  hp_below: "HP ต่ำ",
  protected_ally: "รับแทนพวกเดียวกัน",
};

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
      const d = deriveStats(c.level, draft, wornBonuses(bundle.equipment, equipmentDefs));
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
      // Class1 kit, the Class2 branch once taken, and the race passive (player-kit.ts).
      const kit = playerKit(c.classId, c.raceId, c.level, c.class2Id);
      const skills = el("ul", { class: "pm-list", "data-class-skills": "" });
      const row = (id: string, note: string) => {
        const sk = skillDefs.get(id);
        skills.append(el("li", { "data-skill": id }, `${sk?.name.th ?? id}${note} — ${sk === undefined ? "" : skillBrief(sk)}`));
      };
      for (const id of kit.passiveIds) row(id, "");
      for (const id of kit.skillIds) row(id, "");
      for (const l of kit.locked) row(l.skillId, ` (เปิดที่ Lv${l.level})`);
      body.append(el("h3", {}, `สกิลอาชีพและเผ่า${class2Branch(c.class2Id) === undefined ? "" : ` (สาย${class2Branch(c.class2Id)!.name.th})`}`), skills, el("div", { class: "pm-note" }, "สกิลที่เปิดแล้วใช้ในไฟต์ได้ทันที (ทั้งสั่งเองและ Auto) · ชุดสกิลและตัวเลขเป็นตัวอย่าง (P16)"));
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
    panel.append(el("label", {}, "ของที่ให้ Auto ใช้ (ตัวละครเป็นคนใช้ ใช้ได้เมื่อถึงตาตัวละคร เลือกได้สูงสุด 5 ชนิด เรียงตามลำดับที่ใช้ก่อน)"));
    // Each kind has its own trigger (chapter 08): heal below HP %, mana below MP %, revive a fallen ally,
    // support (buff/cleanse) when the ally lacks the buff or carries a harmful status.
    const KIND_ORDER = ["heal", "mana", "revive", "support"] as const;
    const ruleItems = [...itemDefs.values()]
      .filter((d) => (KIND_ORDER as readonly string[]).includes(d.kind))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind as (typeof KIND_ORDER)[number]) - KIND_ORDER.indexOf(b.kind as (typeof KIND_ORDER)[number]));
    const pctChoices = [20, 30, 40, 50, 70].map((n) => ({ value: String(n), label: `${n}%` }));
    const ruleRows = ruleItems.map((d) => {
      const prev = saved.itemRules.find((r) => r.itemId === d.id);
      const row = el("div", { class: "pm-item-rule", "data-item": d.id });
      const on = el("input", { type: "checkbox", id: `pm-rule-${d.id}` });
      on.checked = prev !== undefined;
      const name = el("label", { for: on.id }, ` ${d.name.th}`);
      name.prepend(on);
      row.append(name);
      let target = () => "ally";
      let hpBelow = () => String(prev?.hpBelowPercent ?? 40);
      let mpBelow = () => String(prev?.mpBelowPercent ?? 30);
      if (d.kind === "heal") {
        row.append(el("div", { class: "pm-note" }, "ใช้กับ"));
        target = choices(row, [{ value: "ally", label: "เพื่อนที่ HP ต่ำสุด" }, { value: "self", label: "ตัวเองเท่านั้น" }], prev?.target ?? "ally");
        row.append(el("div", { class: "pm-note" }, "เมื่อ HP ต่ำกว่า"));
        hpBelow = choices(row, pctChoices, hpBelow());
      } else if (d.kind === "mana") {
        row.append(el("div", { class: "pm-note" }, "ใช้กับ"));
        target = choices(row, [{ value: "ally", label: "เพื่อนที่ MP ต่ำสุด" }, { value: "self", label: "ตัวเองเท่านั้น" }], prev?.target ?? "ally");
        row.append(el("div", { class: "pm-note" }, "เมื่อ MP ต่ำกว่า"));
        mpBelow = choices(row, pctChoices, mpBelow());
      } else if (d.kind === "revive") {
        row.append(el("div", { class: "pm-note" }, "ชุบเพื่อนที่ล้มทันทีที่ชุบได้ (ล้มครบ 1 ตาแล้ว)"));
      } else {
        row.append(el("div", { class: "pm-note" }, "ใช้กับ"));
        target = choices(row, [{ value: "ally", label: "เพื่อนที่ยังไม่มีผลนี้" }, { value: "self", label: "ตัวเองเท่านั้น" }], prev?.target ?? "ally");
        row.append(el("div", { class: "pm-note" }, "ใช้เมื่อยังไม่มีผลนี้อยู่ (ยาล้างพิษ: เมื่อติดสถานะร้าย)"));
      }
      row.append(el("div", { class: "pm-note" }, "ไม่เกินต่อไฟต์"));
      const max = choices(row, [1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: `${n} ชิ้น` })), String(prev?.maxPerFight ?? 3));
      panel.append(row);
      return () =>
        on.checked
          ? [{ itemId: d.id, target: target() as "ally" | "self", hpBelowPercent: Number(hpBelow()), mpBelowPercent: Number(mpBelow()), maxPerFight: Number(max()) }]
          : [];
    });
    // Skills Auto may use (chapter 08 rule engine): heal, cleanse, buff, debuff, then damage.
    const useSkills = el("input", { type: "checkbox", id: "pm-use-skills" });
    useSkills.checked = saved.skills.use;
    const useSkillsRow = el("label", { for: "pm-use-skills" });
    useSkillsRow.append(useSkills, document.createTextNode(" ให้ Auto ใช้สกิล (ฮีล → ล้างสถานะ → บัฟ → ดีบัฟ → โจมตี)"));
    panel.append(useSkillsRow);
    panel.append(el("label", {}, "เก็บ MP สำรองไว้อย่างน้อย"));
    const reserve = choices(panel, [0, 10, 20, 30, 50].map((n) => ({ value: String(n), label: `${n}%` })), String(saved.skills.mpReservePercent));
    panel.append(el("label", {}, "ใช้สกิลฮีลเมื่อ HP เพื่อนต่ำกว่า"));
    const healBelow = choices(panel, [30, 40, 50, 60, 70].map((n) => ({ value: String(n), label: `${n}%` })), String(saved.skills.healBelowPercent));
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
    const huntError = el("div", { class: "pm-error", role: "alert" });
    panel.append(huntError, actions);
    cancel.addEventListener("click", () => {
      close();
      resolve(null);
    });
    start.addEventListener("click", () => {
      if (ruleRows.flatMap((r) => r()).length > 5) {
        huntError.textContent = "เลือกของให้ Auto ใช้ได้สูงสุด 5 ชนิด";
        return;
      }
      const settings = AutoHuntSettingsSchema.parse({
        targetSpecies: targets(),
        stopOnSpecies: stops(),
        maxPackSize: Number(size()),
        stopBelowHpPercent: Number(hp()),
        stopBelowMpPercent: Number(mp()),
        stopBelowCompanionHpPercent: Number(compHp()),
        itemRules: ruleRows.flatMap((r) => r()),
        skills: { use: useSkills.checked, mpReservePercent: Number(reserve()), healBelowPercent: Number(healBelow()) },
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

/** The Auto item and skill rules saved with the Auto Hunt settings; manual Auto Battle uses the same ones. */
export function savedAutoPolicy(): Pick<AutoHuntSettings, "itemRules" | "skills"> {
  let saved: AutoHuntSettings;
  try {
    saved = AutoHuntSettingsSchema.parse(JSON.parse(localStorage.getItem("pm-auto-hunt") ?? "{}"));
  } catch {
    saved = AutoHuntSettingsSchema.parse({});
  }
  return { itemRules: saved.itemRules, skills: saved.skills };
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
      el("div", { class: "pm-note" }, `คู่ใจ Lv200 กลับเป็น Lv1 เส้นทางเติบโตเดิม + โบนัสสเตตัส (ขั้น 1/2/3 = +4/+7/+10% รวม) · ธาตุ Bond ประวัติ เลเวลสกิลคงเดิม · แต่ละขั้นเลือกสายสกิล A/B (R1 สกิล, R2 innate, R3 สกิล + ลวดลายมีเอฟเฟกต์) ใช้ได้เมื่อสู้ถึง Lv${RULES.provisional.rebirthVariantUnlockLevels.value.join("/")} · เปลี่ยนสายทีหลังได้ด้วยเหรียญ · ทำในเมือง นอกไฟต์`),
      body,
      error,
      actions,
    );
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });
    const run = async (key: string, prefix: string, call: (op: string) => Promise<unknown>) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      const op = ops.get(key) ?? `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      ops.set(key, op);
      try {
        await call(op);
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        draw();
      }
    };
    const skillName = (id: string) => skillDefs.get(id)?.name.th ?? id;
    const unlock = RULES.provisional.rebirthVariantUnlockLevels.value;
    const draw = () => {
      body.replaceChildren();
      const ul = el("ul", { class: "pm-list" });
      for (const c of bundle.companions) {
        const sp = species.get(c.speciesId);
        if (sp === undefined) continue;
        const li = el("li", { "data-companion": c.id, class: "pm-skill-pet" });
        const name = `${sp.name.th} ★R${c.rebirthStage} · Lv${c.currentLevel}`;
        li.append(el("div", {}, name));
        // Branches already taken: switching is a coin sink (Nut 2026-10-03).
        for (const v of sp.rebirthVariants ?? []) {
          if (v.stage > c.rebirthStage) continue;
          const now = c.rebirthChoices[String(v.stage) as "1" | "2" | "3"];
          if (now === undefined) continue;
          const other = v.options.find((o) => o.branch !== now)!;
          const price = rebirthBranchChangeCost(RULES, v.stage);
          const row = el("div", { class: "pm-branch", "data-stage": String(v.stage) });
          const sw = el("button", { type: "button" }, `เปลี่ยนเป็น ${other.branch} (${price.toLocaleString()} เหรียญ)`);
          sw.disabled = bundle.coins < price;
          sw.addEventListener("click", () =>
            void run(`${c.id}:branch:${v.stage}:${now}`, "branch", (op) => api.changeRebirthBranch(op, c.id, v.stage, now, other.branch, price)),
          );
          row.append(
            el("span", {}, `R${v.stage} สาย ${now}: ${skillName(v.options.find((o) => o.branch === now)!.skillId)} (ใช้ได้เมื่อสู้ Lv${unlock[v.stage - 1]}+) · อีกสาย: ${skillName(other.skillId)}`),
            sw,
          );
          li.append(row);
        }
        if (c.rebirthStage >= 3 && sp.rebirthCosmetic !== undefined) li.append(el("div", { class: "pm-note" }, `ลวดลาย R3: ${sp.rebirthCosmetic.name.th} (เอฟเฟกต์ ${sp.rebirthCosmetic.effect})`));
        const cost = rebirthCost(RULES, sp, c.rebirthStage, { lootTables, items: itemDefs });
        if (!cost.ok) {
          li.append(el("div", {}, "จุติครบแล้ว"));
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
        const text = `→ R${cost.nextStage} · ${cost.coins.toLocaleString()} เหรียญ + ${itemDefs.get(cost.materialItemId)?.name.th ?? cost.materialItemId} ${have}/${cost.materialQty}`;
        const next = el("div", { class: "pm-branch" });
        next.append(el("span", {}, `${text}${missing.length > 0 ? ` (${missing.join(", ")})` : ""}`));
        const variant = rebirthVariantFor(sp, cost.nextStage);
        const key = `${c.id}:${c.rebirthStage}`;
        // A stage with variants: pick one branch at the Rebirth (it can be switched later for coins).
        const options = variant === undefined ? [{ label: "จุติ", branch: undefined }] : variant.options.map((o) => ({ label: `จุติ สาย ${o.branch}: ${skillName(o.skillId)}`, branch: o.branch }));
        for (const o of options) {
          const go = el("button", { type: "button" }, o.label);
          go.disabled = missing.length > 0;
          go.addEventListener("click", () => void run(`${key}:${o.branch ?? "-"}`, "rebirth", (op) => api.rebirth(op, c.id, c.rebirthStage, o.branch)));
          next.append(go);
        }
        li.append(next);
        ul.append(li);
      }
      if (bundle.companions.length === 0) ul.append(el("li", {}, "ยังไม่มีคู่ใจ"));
      body.append(ul);
    };
    draw();
  });
}

/** One skill level step in Thai: what the next level adds. */
function stepText(x: SkillLevelStep): string {
  if (x.kind === "power") return `พลัง +${x.value}%`;
  if (x.kind === "mp_cost") return `MP ${x.value}`;
  if (x.kind === "cooldown") return `cooldown ${x.value} เทิร์น`;
  return `เป้าหมาย +${x.value}`;
}

/** Everything a skill has gained by its level, in Thai. */
function modsText(m: SkillLevelMods): string {
  const parts = [
    m.powerPercent > 0 ? `พลัง +${m.powerPercent}%` : "",
    m.mpCost < 0 ? `MP ${m.mpCost}` : "",
    m.cooldown < 0 ? `cooldown ${m.cooldown}` : "",
    m.extraTargets > 0 ? `เป้าหมาย +${m.extraTargets}` : "",
  ].filter((x) => x !== "");
  return parts.length === 0 ? "ยังไม่มีโบนัส" : parts.join(" ");
}

const BOND_STAT_TH = { maxHp: "HP", patk: "ATK", matk: "MATK", support: "พลังซัพพอร์ต", spd: "SPD" } as const;

/**
 * Companion skills and Bond (chapter 04 §5–§6). Shows every skill's trained level, the level it
 * works at in a fight, and what the next level costs; training happens at the town NPC only.
 * The server checks everything again and charges once.
 */
export function skillPanel(api: CharacterApi, start: CharacterBundle, inTown: boolean): Promise<void> {
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
      el("h2", {}, "สกิลและ Bond คู่ใจ"),
      el(
        "div",
        { class: "pm-note" },
        `ชนะไฟต์: คู่ใจทุกตัวในไฟต์ได้ความชำนาญ +${RULES.provisional.skillMasteryPerEnemy.value} ต่อศัตรูที่กำจัด/จับ และ Bond +${RULES.provisional.bondPerVictory.value} (ตัวที่ล้มในไฟต์ Bond −${RULES.provisional.bondLossOnFall.value}) · ฝึกสกิลที่ NPC ในเมือง (ความชำนาญ + เหรียญ + วัสดุ species) สำเร็จแน่นอน · แต่ละสกิลได้ของต่างกันต่อขั้น (พลัง/MP/cooldown/เป้าหมาย) และใช้ได้ไม่เกินที่เลเวลคู่ใจตอนสู้อนุญาต${inTown ? "" : " · ตอนนี้อยู่นอกเมือง ดูได้อย่างเดียว"}`,
      ),
      body,
      error,
      actions,
    );
    done.addEventListener("click", () => {
      close();
      resolve();
    });
    const train = async (companionId: string, skillId: string, level: number) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      const key = `${companionId}:${skillId}:${level}`;
      const op = ops.get(key) ?? `skill_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      ops.set(key, op);
      try {
        await api.trainSkill(op, companionId, skillId, level);
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        draw();
      }
    };
    const draw = () => {
      body.replaceChildren();
      const ul = el("ul", { class: "pm-list" });
      for (const c of bundle.companions) {
        const sp = species.get(c.speciesId);
        if (sp === undefined) continue;
        const fighting = companionCombatProfile(RULES, sp, c, bundle.character.level).level;
        const li = el("li", { "data-companion": c.id, class: "pm-skill-pet" });
        const bonus = bondBonusPercent(RULES, c.bond);
        li.append(
          el(
            "div",
            {},
            `${sp.name.th}${c.rebirthStage > 0 ? ` ★R${c.rebirthStage}` : ""} · Lv${c.currentLevel}${fighting < c.currentLevel ? ` (สู้เป็น Lv${fighting})` : ""} · Bond ${c.bond}/1000 ${BOND_TIER_NAMES[bondTier(RULES, c.bond)]}${bonus > 0 ? ` (${BOND_STAT_TH[BOND_STAT[sp.archetype]]} +${bonus}%)` : ""} · ความชำนาญ ${c.skillMastery}`,
          ),
        );
        const rows = el("ul", { class: "pm-list" });
        // The kit in a fight now, with any Rebirth variant that has unlocked (chapter 04 §7).
        const kit = companionKit(RULES, sp, c, fighting);
        speciesSkillSlots(sp).forEach((skillId, i) => {
          const inUse = kit[i]?.skillId ?? skillId;
          const def = skillDefs.get(inUse);
          const lv = trainedSkillLevel(c.trainedSkillLevels, skillId);
          const eff = effectiveSkillLevel(RULES, lv, fighting);
          const kind = i === 3 ? "ติดตัว" : def?.kind === "active" ? "ใช้งาน" : "ติดตัว";
          const row = el("li", { "data-skill": skillId });
          const power = def === undefined ? "" : def.kind === "active" ? ` · ${modsText(skillLevelMods(RULES, def, eff))}` : " · (ผลติดตัวยังไม่ทำงานในไฟต์)";
          const variantNote = inUse === skillId ? "" : ` (สาย R${kit[i]!.variantStage} แทน ${skillDefs.get(skillId)?.name.th ?? skillId})`;
          const head = `${def?.name.th ?? skillId}${variantNote} [${kind}] Lv${lv}${eff < lv ? ` (ใช้ได้ Lv${eff})` : ""}${power}`;
          const cost = skillTrainCost(RULES, sp, skillId, lv, { lootTables, items: itemDefs });
          if (!cost.ok) {
            row.append(el("span", {}, `${head} · สูงสุดแล้ว`));
            rows.append(row);
            return;
          }
          const have = bundle.bag[cost.materialItemId] ?? 0;
          const missing = [
            inTown ? "" : "ต้องอยู่ในเมือง",
            c.xp < cost.companionExp ? `คู่ใจต้อง Lv${cost.companionLevel}` : "",
            c.skillMastery < cost.mastery ? "ความชำนาญไม่พอ" : "",
            bundle.coins < cost.coins ? "เหรียญไม่พอ" : "",
            have < cost.materialQty ? "วัสดุไม่พอ" : "",
          ].filter((x) => x !== "");
          const go = el("button", { type: "button" }, `ฝึก → Lv${cost.nextLevel}`);
          go.disabled = missing.length > 0;
          go.addEventListener("click", () => void train(c.id, skillId, lv));
          row.append(
            el(
              "span",
              {},
              `${head} · Lv${cost.nextLevel}: ${def === undefined ? "" : stepText(skillLevelStep(RULES, def, cost.nextLevel))} ใช้ ความชำนาญ ${cost.mastery} + ${cost.coins.toLocaleString()} เหรียญ + ${itemDefs.get(cost.materialItemId)?.name.th ?? cost.materialItemId} ${have}/${cost.materialQty}${missing.length > 0 ? ` (${missing.join(", ")})` : ""}`,
            ),
            go,
          );
          rows.append(row);
        });
        li.append(rows);
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
        `สูงสุด ${RULES.confirmed.partyMaxMembers.value} คน · เพื่อนที่อยู่แผนที่และ channel เดียวกันและเพิ่งสู้ (ภายใน ${RULES.provisional.partyActivityWindowMs.value / 60_000} นาที) ให้ EXP +${RULES.provisional.partyExpPercentPerMember.value}% ต่อคน (สูงสุด ${RULES.provisional.partyExpPercentCap.value}%) และวัสดุทั่วไป +${RULES.provisional.partyMaterialDropPercentPerMember.value}% ต่อคน (สูงสุด ${RULES.provisional.partyMaterialDropPercentCap.value}%) · ไฟต์ยังเป็นของใครของมัน`,
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

const CLASS_REFUSAL_TH: Record<string, string> = {
  LEVEL_TOO_LOW: "เลเวลยังไม่ถึง",
  ALREADY_CHOSEN: "เลือกสายไปแล้ว",
};

/**
 * Class2 at ผู้ใหญ่พิมพ์ (class-change.ts, P16/P28): the two branches of this class with what each adds,
 * the trial (a practice boss fight that gives and takes nothing), and taking the branch after a win.
 * Resolves with a battle id to open, or null when closed.
 */
export function classPanel(api: CharacterApi): Promise<string | null> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let busy = false;
    const body = el("div", { "data-class": "" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const done = el("button", { type: "button" }, "ปิด");
    const actions = el("div", { class: "pm-actions" });
    actions.append(done);
    panel.append(el("h2", {}, "อาชีพขั้นสอง (Class2)"), body, error, actions);
    const finish = (battleId: string | null) => {
      close();
      resolve(battleId);
    };
    done.addEventListener("click", () => finish(null));
    const run = async (fn: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        await fn();
      } catch (e) {
        error.textContent = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      } finally {
        busy = false;
      }
    };
    const draw = (v: ClassView) => {
      body.replaceChildren();
      const boss = bossDefs.get(v.bossId)?.name.th ?? v.bossId;
      body.append(
        el(
          "div",
          { class: "pm-note" },
          `เปิดบททดสอบที่ Lv${v.trialLevel} · สู้${boss}ที่แรงขึ้นเป็น ${v.trialStatPct}% ด้วยทีมปัจจุบัน HP/MP เต็ม ไม่พกไอเทม ไม่ได้และไม่เสียอะไร หนีได้ทุกเมื่อ · ชนะแล้วรับสายที่เลือกไว้ได้ครั้งเดียว (ยังเปลี่ยนสายภายหลังไม่ได้) · ชื่อสาย สกิล และตัวเลขเป็นตัวอย่าง (P16/P28)`,
        ),
      );
      if (v.class2Id !== null) body.append(el("div", { class: "pm-stats", "data-class2": v.class2Id }, `สายของคุณ: ${class2Branch(v.class2Id)?.name.th ?? v.class2Id}`));
      const t = v.trial;
      if (t !== null && t.status === "won" && v.class2Id === null) {
        const claim = el("button", { type: "button", class: "primary", "data-class-claim": t.operationId }, `รับสาย${class2Branch(t.branchId)?.name.th ?? t.branchId}`);
        claim.addEventListener("click", () =>
          void run(async () => {
            await api.classClaim(t.operationId);
            draw(await api.classView());
          }),
        );
        body.append(el("div", { class: "pm-stats" }, "ผ่านบททดสอบแล้ว!"), claim);
      } else if (t !== null && t.status === "lost" && v.class2Id === null) {
        body.append(el("div", { class: "pm-note" }, `บททดสอบสาย${class2Branch(t.branchId)?.name.th ?? ""} ครั้งล่าสุดยังไม่ผ่าน ลองใหม่ได้`));
      }
      for (const b of v.branches) {
        const list = el("ul", { class: "pm-list", "data-class-branch": b.id });
        const row = (id: string, note: string) => {
          const sk = skillDefs.get(id);
          list.append(el("li", { "data-skill": id }, `${sk?.name.th ?? id}${note} — ${sk === undefined ? "" : skillBrief(sk)}`));
        };
        row(b.passiveId, "");
        for (const a of b.skills) row(a.skillId, ` (Lv${a.level})`);
        body.append(el("h3", {}, `${b.name.th} (${b.name.en})`), el("div", { class: "pm-note" }, b.summary), list);
        if (v.class2Id === null) {
          const go = el("button", { type: "button", class: "primary", "data-class-trial": b.id }, "เริ่มบททดสอบสายนี้");
          if (v.blocked !== null) {
            go.setAttribute("disabled", "");
            go.textContent = CLASS_REFUSAL_TH[v.blocked] ?? v.blocked;
          }
          go.addEventListener("click", () =>
            void run(async () => {
              // A fresh id per tap; a retry of this request resumes the same fight on the server.
              const r = await api.classTrialStart(`class_${crypto.randomUUID().replace(/-/g, "")}`, b.id);
              finish(r.battleId);
            }),
          );
          body.append(go);
        }
      }
    };
    void run(async () => draw(await api.classView()));
  });
}
