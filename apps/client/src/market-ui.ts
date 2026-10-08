/**
 * World Market and direct trade panels (Nut 2026-10-07). The client shows prices, the fee, the tax and
 * what a companion's new owner needs before anything is sent; the server checks everything again,
 * holds the thing in escrow and moves it. Placeholder styling like the other DOM panels.
 */
import {
  RARITY_NAME_TH,
  exampleContentMaps,
  marketFee,
  marketTax,
  PRODUCTION_RULES,
  tradeShapeIssue,
  TradeSideSchema,
  type AssetSnapshot,
  type MarketKind,
  type MarketListingView,
  type TradeKind,
  type TradeOfferView,
  type TradeSide,
} from "@pmrpg/shared";
import { ApiError, type CharacterApi, type CharacterBundle } from "./character-api";
import { ELEMENT_TH, el, overlay } from "./character-ui";

const { species, equipment: equipmentDefs, items: itemDefs } = exampleContentMaps();
const RULES = PRODUCTION_RULES;
const M = RULES.provisional.market.value;
const T = RULES.provisional.playerTrade.value;

/** Thai for the refusals a player can actually meet here (the code stays for support). */
const REASON_TH: Record<string, string> = {
  SAME_ACCOUNT: "ตัวละครในบัญชีเดียวกันซื้อขาย/เทรดกันไม่ได้ ใช้คลังของบัญชีแทน",
  NOT_STORABLE: "ของชิ้นนี้ห้ามฝากคลัง",
  NOT_IN_VAULT: "ในคลังไม่มีของนี้แล้ว (ตัวละครอื่นอาจหยิบไปก่อน)",
  VAULT_FULL: `คลังเต็ม (${RULES.provisional.vault.value.slots} ช่อง)`,
  NOT_IN_TOWN: "ต้องอยู่ในเมือง",
  IN_BATTLE: "ทำไม่ได้ระหว่างไฟต์",
  NOT_SELLABLE: "ของชิ้นนี้ห้ามขาย",
  NOT_TRADEABLE: "ของชิ้นนี้ห้ามเทรด",
  NOT_ENOUGH_COINS: "เหรียญไม่พอ",
  NOT_ENOUGH_ITEMS: "ของไม่พอ",
  PROTECTED: "ของ/คู่ใจถูกล็อกกันไว้ ปลดล็อกก่อน",
  WORN: "ถอดอุปกรณ์ก่อน",
  IN_TEAM: "เอาคู่ใจออกจากทีมก่อน",
  ASSET_LOCKED: "ของ/คู่ใจนี้วางขายหรือรอเทรดอยู่",
  OWN_LISTING: "ซื้อของตัวเองไม่ได้",
  COST_CHANGED: "ราคาหรือค่าวางขายเปลี่ยนแล้ว โหลดใหม่",
  CHANGED: "ของเปลี่ยนไปแล้ว โหลดใหม่",
  CHOICE_PENDING: "เลือกออปชันที่สุ่มใหม่ให้เสร็จก่อน",
  NOT_FOUND: "ไม่พบรายการนี้",
  NOT_OWNER: "ไม่ใช่ของคุณ",
  CLOSED: "รายการนี้ปิดไปแล้ว",
  EXPIRED: "หมดเวลาแล้ว",
  TOO_MANY_LISTINGS: `วางขายได้พร้อมกันสูงสุด ${M.maxActiveListings} รายการ`,
  TOO_MANY_OFFERS: `เปิดข้อเสนอได้พร้อมกันสูงสุด ${T.maxOpenOffers} รายการ`,
  LEVEL_INELIGIBLE: "เลเวลผู้รับต่ำเกินไปสำหรับคู่ใจตัวนี้ (O01)",
  NO_SUCH_PLAYER: "ไม่พบรหัสเทรดนี้",
  SELF_TRADE: "เทรดกับตัวเองไม่ได้",
  INVALID_TRADE: "รูปแบบเทรดไม่ถูกต้อง",
};
const errText = (e: unknown) => (e instanceof ApiError ? `${REASON_TH[e.code] ?? e.code}${REASON_TH[e.code] === undefined ? `: ${e.message}` : ""}` : String(e));

const timeLeft = (iso: string) => {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "หมดเวลา";
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `เหลือ ${h} ชม.` : `เหลือ ${Math.max(1, Math.floor(ms / 60_000))} นาที`;
};

/** One line for what is on offer, from the frozen snapshot. */
export function assetText(a: AssetSnapshot): string {
  if (a.kind === "item") return `${a.name} ×${a.quantity}`;
  if (a.kind === "equipment") {
    const extra = [a.affixes.length > 0 ? `ออปชัน ${a.affixes.length}` : "", a.sigils.length > 0 ? `Sigil ${a.sigils.length}` : ""].filter((s) => s !== "").join(" · ");
    return `${a.name}${a.refineLevel > 0 ? ` +${a.refineLevel}` : ""} [${RARITY_NAME_TH[a.rarity]}] Lv${a.requiredLevel}${extra === "" ? "" : ` · ${extra}`}`;
  }
  return `${a.name} Lv${a.level} ธาตุ${ELEMENT_TH[a.element]}${a.rebirthStage > 0 ? ` จุติ ${a.rebirthStage}` : ""} · ผู้รับต้อง Lv${a.minRecipientLevel}+ · Bond เริ่ม 0`;
}

const STATUS_TH = { active: "กำลังขาย", expired: "หมดเวลา (กดรับคืน)", sold: "ขายแล้ว", cancelled: "ถอนแล้ว", open: "รอตอบ", accepted: "ตกลงแล้ว", declined: "ถูกปฏิเสธ" } as const;

/** What the player owns that could go on the market or into a trade, with why not when it cannot. */
interface Owned {
  kind: MarketKind;
  id: string;
  label: string;
  /** Items: the stack size. */
  max: number;
  /** Why it cannot be listed / traded right now, or null. */
  sell: string | null;
  trade: string | null;
}
function owned(b: CharacterBundle): Owned[] {
  const team = new Set(b.character.team.map((t) => t.instanceId));
  const out: Owned[] = [];
  for (const [id, q] of Object.entries(b.bag)) {
    if (q <= 0) continue;
    const def = itemDefs.get(id);
    out.push({ kind: "item", id, label: `${def?.name.th ?? id} ×${q}`, max: q, sell: def?.noSell ? "ห้ามขาย" : null, trade: def?.noTrade ? "ห้ามเทรด" : null });
  }
  for (const p of b.equipment) {
    const def = equipmentDefs.get(p.definitionId);
    const busy = p.lockState === "in_escrow" ? "วางขาย/รอเทรดอยู่" : p.lockState !== "free" ? "อยู่ในไฟต์" : p.slot !== null ? "สวมอยู่" : p.protected ? "ล็อกกันไว้" : null;
    out.push({
      kind: "equipment",
      id: p.id,
      label: `${def?.name.th ?? p.definitionId}${p.refineLevel > 0 ? ` +${p.refineLevel}` : ""} [${RARITY_NAME_TH[p.rarity]}]`,
      max: 1,
      sell: busy ?? (p.noSell ? "ห้ามขาย" : null),
      trade: busy ?? (p.noTrade ? "ห้ามเทรด" : null),
    });
  }
  for (const c of b.companions) {
    const sp = species.get(c.speciesId);
    const busy = c.lockState === "in_escrow" ? "วางขาย/รอเทรดอยู่" : c.lockState !== "free" ? "อยู่ในไฟต์" : team.has(c.id) ? "อยู่ในทีม" : c.protected ? "ล็อกกันไว้" : null;
    out.push({
      kind: "companion",
      id: c.id,
      label: `${c.nickname ?? sp?.name.th ?? c.speciesId} Lv${c.currentLevel}`,
      max: 1,
      sell: busy ?? (c.noSell ? "ห้ามขาย" : null),
      trade: busy ?? (c.noTrade ? "ห้ามเทรด" : null),
    });
  }
  return out;
}

const KIND_TH: Record<MarketKind, string> = { item: "ไอเทม", equipment: "อุปกรณ์", companion: "คู่ใจ" };

function tabs(parent: HTMLElement, names: readonly string[], onPick: (i: number) => void): (i: number) => void {
  const row = el("div", { class: "pm-choices" });
  const buttons = names.map((n, i) => {
    const b = el("button", { type: "button", "data-tab": String(i) }, n);
    b.addEventListener("click", () => pick(i));
    row.append(b);
    return b;
  });
  const pick = (i: number) => {
    buttons.forEach((b, j) => b.setAttribute("aria-pressed", String(i === j)));
    onPick(i);
  };
  parent.append(row);
  return pick;
}

// ------------------------------------------------------------------ World Market

/**
 * `atNpc`: opened at the market NPC in town, where listing and taking back happen (Nut 2026-10-08);
 * anywhere else the panel browses and buys only.
 */
export function marketPanel(api: CharacterApi, start: CharacterBundle, atNpc: boolean): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;
    let tab = 0;
    const query = { kind: undefined as MarketKind | undefined, q: "", sort: "newest" as "newest" | "price_asc" | "price_desc", page: 0 };
    const head = el("div", { class: "pm-stats" });
    const body = el("div");
    const note = el("div", { class: "pm-note", role: "status" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    const actions = el("div", { class: "pm-actions" });
    actions.append(done);
    panel.append(
      el("h2", {}, "ตลาดโลก"),
      el("div", { class: "pm-note" }, `ค่าวางขาย ${M.listingFeeBps / 100}% (ขั้นต่ำ ${M.minListingFee}) จ่ายตอนวาง ไม่คืน · ภาษีเมื่อขายได้ ${M.saleTaxBps / 100}% · วางได้ ${M.listingHours} ชม. · สูงสุด ${M.maxActiveListings} รายการ · ซื้อได้ทุกที่ วางขายและถอนคืนที่นายท่าเรือบุญ`),
      head,
    );
    const pickTab = tabs(panel, ["ซื้อ", "วางขาย", "ของที่ฉันวาง"], (i) => {
      tab = i;
      void draw();
    });
    panel.append(body, note, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });

    const act = async (f: () => Promise<string>) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        note.textContent = await f();
      } catch (e) {
        error.textContent = errText(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        await draw();
      }
    };

    const listingRow = (l: MarketListingView) => {
      const li = el("li", { "data-listing": l.listingId });
      const proceeds = l.proceeds === undefined ? "" : ` · ได้ ${l.proceeds.toLocaleString()} ถ้าขายได้`;
      li.append(el("span", { class: "pm-grow" }, `${assetText(l.asset)} · ${l.price.toLocaleString()} เหรียญ · ${l.mine ? "ของฉัน" : l.sellerName} · ${l.status === "active" ? timeLeft(l.expiresAt) : STATUS_TH[l.status]}${proceeds}`));
      if (l.mine && (l.status === "active" || l.status === "expired")) {
        const b = el("button", { type: "button" }, l.status === "expired" ? "รับคืน" : "ถอนออก");
        b.disabled = !atNpc;
        b.title = atNpc ? "" : "ถอนคืนที่นายท่าเรือบุญในเมือง";
        b.addEventListener("click", () => void act(async () => (await api.marketCancel(l.listingId), `ได้คืน: ${assetText(l.asset)} (ค่าวางขายไม่คืน)`)));
        li.append(b);
      } else if (!l.mine && l.status === "active") {
        const b = el("button", { type: "button" }, `ซื้อ (−${l.price.toLocaleString()})`);
        b.disabled = bundle.coins < l.price || (l.asset.kind === "companion" && bundle.character.level < l.asset.minRecipientLevel);
        b.title = l.asset.kind === "companion" && bundle.character.level < l.asset.minRecipientLevel ? `ต้องเลเวล ${l.asset.minRecipientLevel}+` : "";
        b.addEventListener("click", () => void act(async () => (await api.marketBuy(l.listingId, l.price), `ซื้อแล้ว: ${assetText(l.asset)}`)));
        li.append(b);
      }
      return li;
    };

    const drawBrowse = async () => {
      const filters = el("div", { class: "pm-choices" });
      for (const k of [undefined, "item", "equipment", "companion"] as const) {
        const b = el("button", { type: "button", "aria-pressed": String(query.kind === k) }, k === undefined ? "ทั้งหมด" : KIND_TH[k]);
        b.addEventListener("click", () => {
          query.kind = k;
          query.page = 0;
          void draw();
        });
        filters.append(b);
      }
      const search = el("input", { type: "text", id: "pm-market-q", placeholder: "ค้นหาชื่อ", maxlength: "40" });
      search.value = query.q;
      const sort = el("select", { id: "pm-market-sort" });
      for (const [v, t] of [
        ["newest", "ล่าสุด"],
        ["price_asc", "ราคาต่ำ→สูง"],
        ["price_desc", "ราคาสูง→ต่ำ"],
      ] as const) sort.append(el("option", { value: v, ...(query.sort === v ? { selected: "" } : {}) }, t));
      const go = el("button", { type: "button" }, "ค้นหา");
      go.addEventListener("click", () => {
        query.q = search.value.trim();
        query.sort = sort.value as typeof query.sort;
        query.page = 0;
        void draw();
      });
      body.append(filters, el("div", { class: "pm-choices" }, ""), search, sort, go);
      const view = await api.market({ ...(query.kind ? { kind: query.kind } : {}), ...(query.q ? { q: query.q } : {}), sort: query.sort, page: query.page });
      const ul = el("ul", { class: "pm-list", "data-section": "market" });
      if (view.listings.length === 0) ul.append(el("li", {}, "ยังไม่มีของวางขาย"));
      for (const l of view.listings) ul.append(listingRow(l));
      body.append(ul);
      const pager = el("div", { class: "pm-actions" });
      const prev = el("button", { type: "button" }, "ก่อนหน้า");
      prev.disabled = query.page === 0;
      prev.addEventListener("click", () => ((query.page -= 1), void draw()));
      const next = el("button", { type: "button" }, "ถัดไป");
      next.disabled = !view.hasMore;
      next.addEventListener("click", () => ((query.page += 1), void draw()));
      pager.append(el("span", { class: "pm-note" }, `หน้า ${view.page + 1}`), prev, next);
      body.append(pager);
    };

    const drawSell = () => {
      if (!atNpc) return void body.append(el("p", {}, "วางขายได้ที่นายท่าเรือบุญในเมือง (ที่นี่ดูและซื้อได้อย่างเดียว)"));
      const ul = el("ul", { class: "pm-list", "data-section": "sell" });
      for (const o of owned(bundle)) {
        const li = el("li", { "data-own": o.id });
        li.append(el("span", { class: "pm-grow" }, `${KIND_TH[o.kind]}: ${o.label}${o.sell === null ? "" : ` · ${o.sell}`}`));
        if (o.sell === null) {
          const qty = el("input", { type: "number", min: "1", max: String(o.max), value: String(o.max), "aria-label": "จำนวน", style: "width:64px" });
          const price = el("input", { type: "number", min: String(M.minPrice), max: String(M.maxPrice), placeholder: "ราคารวม", "aria-label": "ราคารวม", style: "width:110px" });
          const fee = el("span", { class: "pm-note" });
          const b = el("button", { type: "button" }, "วางขาย");
          const update = () => {
            const p = Math.floor(Number(price.value));
            const ok = Number.isFinite(p) && p >= M.minPrice && p <= M.maxPrice;
            fee.textContent = ok ? `ค่าวาง ${marketFee(RULES, p)} · ขายได้รับ ${(p - marketTax(RULES, p)).toLocaleString()}` : "";
            b.disabled = !ok || bundle.coins < (ok ? marketFee(RULES, p) : 0);
          };
          price.addEventListener("input", update);
          update();
          b.addEventListener("click", () => {
            const p = Math.floor(Number(price.value));
            const q = o.kind === "item" ? Math.max(1, Math.min(o.max, Math.floor(Number(qty.value)))) : 1;
            void act(async () => {
              const r = await api.marketList(o.kind, o.id, q, p, marketFee(RULES, p));
              return `วางขายแล้ว (ค่าวาง ${r.result.fee}) · ${timeLeft(r.result.expiresAt)}`;
            });
          });
          if (o.kind === "item") li.append(qty);
          li.append(price, b, fee);
        }
        ul.append(li);
      }
      if (ul.childElementCount === 0) ul.append(el("li", {}, "ไม่มีของ"));
      body.append(el("div", { class: "pm-note" }, "วางขายได้ในเมืองเท่านั้น · ของที่วางจะถูกเก็บไว้กับตลาดจนขายได้หรือถอนออก · อุปกรณ์ที่ใส่ Sigil ไว้ ขาย Sigil ไปด้วย · คู่ใจที่ขาย Bond กลับเป็น 0 และชื่อเล่นหาย"), ul);
    };

    const drawMine = async () => {
      const view = await api.market({ page: 0 });
      const ul = el("ul", { class: "pm-list", "data-section": "mine" });
      if (view.mine.length === 0) ul.append(el("li", {}, "ยังไม่ได้วางขายอะไร"));
      for (const l of view.mine) ul.append(listingRow(l));
      body.append(ul);
    };

    const draw = async () => {
      head.textContent = `เหรียญ ${bundle.coins.toLocaleString()}`;
      body.replaceChildren();
      try {
        if (tab === 0) await drawBrowse();
        else if (tab === 1) drawSell();
        else await drawMine();
      } catch (e) {
        error.textContent = errText(e);
      }
    };
    pickTab(0);
  });
}

// ------------------------------------------------------------------ direct trade

const emptySide = (): TradeSide => TradeSideSchema.parse({});

export function tradePanel(api: CharacterApi, start: CharacterBundle): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;
    let tab = 0;
    let kind: TradeKind = "item";
    let give = emptySide();
    let want = emptySide();
    const head = el("div", { class: "pm-stats" });
    const body = el("div");
    const note = el("div", { class: "pm-note", role: "status" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    const actions = el("div", { class: "pm-actions" });
    actions.append(done);
    panel.append(
      el("h2", {}, "แลกเปลี่ยนกับผู้เล่น"),
      el("div", { class: "pm-note" }, `ไม่มีภาษี · ข้อเสนออยู่ได้ ${T.offerHours} ชม. · ของฝั่งเราถูกเก็บไว้จนอีกฝ่ายตอบหรือเรายกเลิก · ทำได้ในเมือง · ค่าทดลอง P24`),
      head,
    );
    const pickTab = tabs(panel, ["ข้อเสนอ", "เทรดไอเทม", "เทรดคู่ใจ"], (i) => {
      tab = i;
      if (i > 0) {
        const k: TradeKind = i === 1 ? "item" : "companion";
        if (k !== kind) {
          kind = k;
          give = emptySide();
          want = emptySide();
        }
      }
      void draw();
    });
    panel.append(body, note, error, actions);
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });

    const act = async (f: () => Promise<string>, after?: () => void) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        note.textContent = await f();
        after?.();
      } catch (e) {
        error.textContent = errText(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        await draw();
      }
    };

    const sideText = (s: TradeOfferView["give"]) => [...s.assets.map(assetText), ...(s.coins > 0 ? [`${s.coins.toLocaleString()} เหรียญ`] : [])].join(", ") || "(ไม่มี)";

    const drawOffers = async () => {
      const view = await api.trades();
      body.append(el("p", {}, "รหัสเทรดของคุณ (ให้อีกฝ่ายใส่): "), el("code", { "data-trade-code": view.myCode }, view.myCode));
      const offerRow = (o: TradeOfferView) => {
        const li = el("li", { "data-offer": o.offerId });
        const who = o.direction === "in" ? `จาก ${o.fromName}` : `ถึง ${o.toName}`;
        li.append(
          el("span", { class: "pm-grow" }, `${o.kind === "item" ? "ไอเทม" : "คู่ใจ"} ${who} · ${o.direction === "in" ? "เขาให้" : "เราให้"}: ${sideText(o.give)} · ${o.direction === "in" ? "เขาขอ" : "เราขอ"}: ${sideText(o.want)} · ${o.status === "open" ? timeLeft(o.expiresAt) : STATUS_TH[o.status]}`),
        );
        if (o.status === "open" && o.direction === "in") {
          const ok = el("button", { type: "button" }, "ตกลง");
          ok.addEventListener("click", () => void act(async () => (await api.tradeRespond("accept", o.offerId), "แลกเปลี่ยนสำเร็จ")));
          const no = el("button", { type: "button" }, "ปฏิเสธ");
          no.addEventListener("click", () => void act(async () => (await api.tradeRespond("decline", o.offerId), "ปฏิเสธแล้ว ของกลับไปที่ผู้เสนอ")));
          li.append(ok, no);
        } else if ((o.status === "open" || o.status === "expired") && o.direction === "out") {
          const b = el("button", { type: "button" }, o.status === "expired" ? "รับคืน" : "ยกเลิก");
          b.addEventListener("click", () => void act(async () => (await api.tradeRespond("cancel", o.offerId), "ยกเลิกแล้ว ของกลับมาแล้ว")));
          li.append(b);
        }
        return li;
      };
      const open = el("ul", { class: "pm-list", "data-section": "open" });
      if (view.open.length === 0) open.append(el("li", {}, "ไม่มีข้อเสนอที่รออยู่"));
      for (const o of view.open) open.append(offerRow(o));
      const recent = el("ul", { class: "pm-list", "data-section": "recent" });
      for (const o of view.recent) recent.append(offerRow(o));
      body.append(el("h3", {}, "รออยู่"), open, ...(view.recent.length > 0 ? [el("h3", {}, "ล่าสุด"), recent] : []));
      body.append(el("div", { class: "pm-note" }, "รหัสของ/คู่ใจของคุณ (ให้อีกฝ่ายใส่ในช่อง \"ขอ\"): " + owned(bundle).filter((o) => o.kind !== "item").map((o) => `${o.label} = ${o.id}`).join(" · ")));
    };

    const drawCompose = () => {
      const mine = owned(bundle).filter((o) => (kind === "item" ? o.kind !== "companion" : o.kind === "companion"));
      body.append(el("h3", {}, "เราให้"));
      const ul = el("ul", { class: "pm-list", "data-section": "give" });
      for (const o of mine) {
        const li = el("li", { "data-own": o.id });
        li.append(el("span", { class: "pm-grow" }, `${o.label}${o.trade === null ? "" : ` · ${o.trade}`}`));
        if (o.trade === null) {
          const chosen = o.kind === "item" ? (give.items.find((l) => l.itemId === o.id)?.quantity ?? 0) : (o.kind === "equipment" ? give.equipmentIds : give.companionIds).includes(o.id) ? 1 : 0;
          if (o.kind === "item") {
            const q = el("input", { type: "number", min: "0", max: String(o.max), value: String(chosen), "aria-label": "จำนวน", style: "width:64px" });
            q.addEventListener("change", () => {
              const n = Math.max(0, Math.min(o.max, Math.floor(Number(q.value) || 0)));
              give.items = [...give.items.filter((l) => l.itemId !== o.id), ...(n > 0 ? [{ itemId: o.id, quantity: n }] : [])];
            });
            li.append(q);
          } else {
            const box = el("input", { type: "checkbox", "aria-label": "เลือก" });
            box.checked = chosen === 1;
            box.addEventListener("change", () => {
              const key = o.kind === "equipment" ? "equipmentIds" : "companionIds";
              give[key] = box.checked ? [...give[key], o.id] : give[key].filter((x) => x !== o.id);
            });
            li.append(box);
          }
        }
        ul.append(li);
      }
      if (mine.length === 0) ul.append(el("li", {}, "ไม่มีของที่เทรดได้"));
      const giveCoins = el("input", { type: "number", min: "0", value: String(give.coins), id: "pm-give-coins", style: "width:120px" });
      giveCoins.addEventListener("change", () => (give.coins = Math.max(0, Math.floor(Number(giveCoins.value) || 0))));
      body.append(ul, el("label", { for: "pm-give-coins" }, "เหรียญที่ให้"), giveCoins);

      body.append(el("h3", {}, "เราขอ"));
      const wantCoins = el("input", { type: "number", min: "0", value: String(want.coins), id: "pm-want-coins", style: "width:120px" });
      wantCoins.addEventListener("change", () => (want.coins = Math.max(0, Math.floor(Number(wantCoins.value) || 0))));
      body.append(el("label", { for: "pm-want-coins" }, "เหรียญที่ขอ"), wantCoins);
      if (kind === "item") {
        const pick = el("select", { id: "pm-want-item" });
        pick.append(el("option", { value: "" }, "เลือกไอเทมที่ขอ"));
        for (const d of [...itemDefs.values()].filter((d) => !d.noTrade).sort((a, b) => a.name.th.localeCompare(b.name.th, "th"))) pick.append(el("option", { value: d.id }, d.name.th));
        const q = el("input", { type: "number", min: "1", value: "1", "aria-label": "จำนวน", style: "width:64px" });
        const add = el("button", { type: "button" }, "เพิ่ม");
        add.addEventListener("click", () => {
          const n = Math.max(1, Math.floor(Number(q.value) || 1));
          if (pick.value === "") return;
          want.items = [...want.items.filter((l) => l.itemId !== pick.value), { itemId: pick.value, quantity: n }];
          void draw();
        });
        body.append(el("div", { class: "pm-choices" }, ""), pick, q, add);
      }
      const ids = el("input", { type: "text", id: "pm-want-ids", placeholder: kind === "item" ? "รหัสอุปกรณ์ของอีกฝ่าย คั่นด้วย ," : "รหัสคู่ใจของอีกฝ่าย คั่นด้วย ,", value: (kind === "item" ? want.equipmentIds : want.companionIds).join(", ") });
      ids.addEventListener("change", () => {
        const list = [...new Set(ids.value.split(",").map((s) => s.trim()).filter((s) => s !== ""))];
        if (kind === "item") want.equipmentIds = list;
        else want.companionIds = list;
      });
      body.append(el("label", { for: "pm-want-ids" }, kind === "item" ? "อุปกรณ์ที่ขอ (อีกฝ่ายดูรหัสได้ในแท็บข้อเสนอ)" : "คู่ใจที่ขอ (อีกฝ่ายดูรหัสได้ในแท็บข้อเสนอ)"), ids);
      if (want.items.length > 0) {
        const wl = el("ul", { class: "pm-list", "data-section": "want" });
        for (const l of want.items) {
          const li = el("li", {}, "");
          li.append(el("span", { class: "pm-grow" }, `${itemDefs.get(l.itemId)?.name.th ?? l.itemId} ×${l.quantity}`));
          const rm = el("button", { type: "button" }, "เอาออก");
          rm.addEventListener("click", () => ((want.items = want.items.filter((x) => x.itemId !== l.itemId)), void draw()));
          li.append(rm);
          wl.append(li);
        }
        body.append(wl);
      }

      const code = el("input", { type: "text", id: "pm-trade-to", placeholder: "รหัสเทรดของอีกฝ่าย เช่น ABCD-2345", maxlength: "9" });
      const send = el("button", { type: "button" }, "ส่งข้อเสนอ");
      send.addEventListener("click", () => {
        const issue = tradeShapeIssue(RULES, kind, give, want);
        if (issue !== null) return void (error.textContent = `รูปแบบเทรดไม่ถูกต้อง: ${issue}`);
        void act(
          async () => {
            const r = await api.tradeOffer(kind, code.value, give, want);
            return `ส่งข้อเสนอแล้ว · ${timeLeft(r.result.expiresAt)}`;
          },
          () => {
            give = emptySide();
            want = emptySide();
          },
        );
      });
      body.append(el("label", { for: "pm-trade-to" }, "ส่งถึง"), code, send);
      body.append(
        el(
          "div",
          { class: "pm-note" },
          kind === "item"
            ? `ฝั่งละไม่เกิน ${T.maxItemLines} รายการไอเทม และ ${T.maxEquipment} ชิ้นอุปกรณ์ · อุปกรณ์ที่ใส่ Sigil ไว้ ส่ง Sigil ไปด้วย`
            : `ฝั่งละไม่เกิน ${T.maxCompanions} ตัว · คู่ใจที่ย้ายเจ้าของ Bond กลับเป็น 0 ชื่อเล่นหาย และผู้รับต้องมีเลเวลถึงขั้นต่ำของตัวนั้น (คู่ใจสูงกว่าผู้รับได้ไม่เกิน 30 เลเวล, O01)`,
        ),
      );
    };

    const draw = async () => {
      head.textContent = `เหรียญ ${bundle.coins.toLocaleString()}`;
      body.replaceChildren();
      try {
        if (tab === 0) await drawOffers();
        else drawCompose();
      } catch (e) {
        error.textContent = errText(e);
      }
    };
    pickTab(0);
  });
}

// ------------------------------------------------------------------ account vault

/**
 * Account vault shared by every character of this login (Nut 2026-10-08). `atNpc`: opened at the vault
 * NPC in town, where things go in and out; anywhere else it only shows what is inside.
 */
export function vaultPanel(api: CharacterApi, start: CharacterBundle, atNpc: boolean): Promise<CharacterBundle> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    let bundle = start;
    let busy = false;
    const head = el("div", { class: "pm-stats" });
    const body = el("div");
    const note = el("div", { class: "pm-note", role: "status" });
    const error = el("div", { class: "pm-error", role: "alert" });
    const done = el("button", { type: "button", class: "primary" }, "ปิด");
    const actions = el("div", { class: "pm-actions" });
    actions.append(done);
    panel.append(
      el("h2", {}, "คลังของบัญชี"),
      el("div", { class: "pm-note" }, `ใช้ร่วมกันทุกตัวละครในบัญชีนี้ · ${RULES.provisional.vault.value.slots} ช่อง (ไอเทมชนิดละ 1 ช่อง อุปกรณ์ชิ้นละ 1 ช่อง เหรียญไม่กินช่อง) · ฝาก/ถอนที่ผู้ใหญ่พิมพ์ในเมือง · คู่ใจยังฝากไม่ได้`),
      head,
      body,
      note,
      error,
      actions,
    );
    done.addEventListener("click", () => {
      close();
      resolve(bundle);
    });
    const act = async (f: () => Promise<string>) => {
      if (busy) return;
      busy = true;
      error.textContent = "";
      try {
        note.textContent = await f();
      } catch (e) {
        error.textContent = errText(e);
      } finally {
        bundle = (await api.get().catch(() => null)) ?? bundle;
        busy = false;
        await draw();
      }
    };
    const qtyBox = (max: number) => el("input", { type: "number", min: "1", max: String(max), value: String(max), "aria-label": "จำนวน", style: "width:64px" });
    const clamp = (box: HTMLInputElement, max: number) => Math.max(1, Math.min(max, Math.floor(Number(box.value) || 1)));

    const draw = async () => {
      body.replaceChildren();
      try {
        const v = await api.vault();
        head.textContent = `ในคลัง ${v.usedSlots}/${v.slots} ช่อง · เหรียญในคลัง ${v.coins.toLocaleString()} · เหรียญติดตัว ${bundle.coins.toLocaleString()}`;
        if (!atNpc) body.append(el("p", {}, "ดูได้ทุกที่ ฝาก/ถอนที่ผู้ใหญ่พิมพ์ในเมือง"));
        if (!v.shared) body.append(el("div", { class: "pm-note" }, "ตัวละครทดสอบนี้ไม่ได้อยู่ในบัญชีเข้าสู่ระบบ คลังจึงใช้ได้ตัวเดียว"));

        // Coins in / out.
        const coinRow = el("div", { class: "pm-choices" });
        const amount = el("input", { type: "number", min: "1", placeholder: "จำนวนเหรียญ", "aria-label": "จำนวนเหรียญ", style: "width:140px" });
        const cin = el("button", { type: "button" }, "ฝากเหรียญ");
        const cout = el("button", { type: "button" }, "ถอนเหรียญ");
        cin.disabled = cout.disabled = !atNpc;
        const n = () => Math.max(0, Math.floor(Number(amount.value) || 0));
        cin.addEventListener("click", () => void act(async () => (await api.vaultDeposit({ coins: n() }), `ฝาก ${n().toLocaleString()} เหรียญแล้ว`)));
        cout.addEventListener("click", () => void act(async () => (await api.vaultWithdraw({ coins: n() }), `ถอน ${n().toLocaleString()} เหรียญแล้ว`)));
        coinRow.append(amount, cin, cout);
        body.append(coinRow);

        // What is inside.
        const inside = el("ul", { class: "pm-list", "data-section": "vault" });
        for (const it of v.items) {
          const li = el("li", { "data-vault-item": it.itemId });
          li.append(el("span", { class: "pm-grow" }, `${it.name} ×${it.quantity}`));
          const q = qtyBox(it.quantity);
          const b = el("button", { type: "button" }, "ถอน");
          b.disabled = !atNpc;
          b.addEventListener("click", () => void act(async () => (await api.vaultWithdraw({ items: [{ itemId: it.itemId, quantity: clamp(q, it.quantity) }] }), `ถอน ${it.name} ×${clamp(q, it.quantity)}`)));
          li.append(q, b);
          inside.append(li);
        }
        for (const p of v.equipment) {
          const li = el("li", { "data-vault-piece": p.equipmentId });
          li.append(el("span", { class: "pm-grow" }, assetText(p)));
          const b = el("button", { type: "button" }, "ถอน");
          b.disabled = !atNpc;
          b.addEventListener("click", () => void act(async () => (await api.vaultWithdraw({ equipmentIds: [p.equipmentId] }), `ถอน ${p.name}`)));
          li.append(b);
          inside.append(li);
        }
        if (v.items.length + v.equipment.length === 0) inside.append(el("li", {}, "คลังว่าง"));
        body.append(el("h3", {}, "ในคลัง"), inside);

        // What this character carries.
        const carried = el("ul", { class: "pm-list", "data-section": "carried" });
        for (const [id, q] of Object.entries(bundle.bag)) {
          if (q <= 0) continue;
          const def = itemDefs.get(id);
          const li = el("li", { "data-item": id });
          li.append(el("span", { class: "pm-grow" }, `${def?.name.th ?? id} ×${q}${def?.noStore ? " · ห้ามฝากคลัง" : ""}`));
          if (!def?.noStore) {
            const box = qtyBox(q);
            const b = el("button", { type: "button" }, "ฝาก");
            b.disabled = !atNpc;
            b.addEventListener("click", () => void act(async () => (await api.vaultDeposit({ items: [{ itemId: id, quantity: clamp(box, q) }] }), `ฝาก ${def?.name.th ?? id} ×${clamp(box, q)}`)));
            li.append(box, b);
          }
          carried.append(li);
        }
        for (const p of bundle.equipment) {
          const def = equipmentDefs.get(p.definitionId);
          const why = p.noStore ? "ห้ามฝากคลัง" : p.slot !== null ? "สวมอยู่" : p.lockState !== "free" ? "วางขาย/รอเทรด/อยู่ในไฟต์" : null;
          const li = el("li", { "data-piece": p.id });
          li.append(el("span", { class: "pm-grow" }, `${def?.name.th ?? p.definitionId}${p.refineLevel > 0 ? ` +${p.refineLevel}` : ""} [${RARITY_NAME_TH[p.rarity]}]${why === null ? "" : ` · ${why}`}`));
          if (why === null) {
            const b = el("button", { type: "button" }, "ฝาก");
            b.disabled = !atNpc;
            b.addEventListener("click", () => void act(async () => (await api.vaultDeposit({ equipmentIds: [p.id] }), `ฝาก ${def?.name.th ?? p.definitionId}`)));
            li.append(b);
          }
          carried.append(li);
        }
        body.append(el("h3", {}, "ติดตัวตัวละครนี้"), carried);
      } catch (e) {
        error.textContent = errText(e);
      }
    };
    void draw();
  });
}
