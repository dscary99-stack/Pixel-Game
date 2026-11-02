/**
 * Character creation: pick hair, face and colours (appearance.ts) with a live preview that stacks the
 * same layers the game draws (actor-art `playerLayers`), recoloured the same way, playing idle.
 * Layers Codex has not drawn yet are left out of the preview (a note says so).
 */
import { DEFAULT_APPEARANCE, EYE_COLORS, FACES, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type Appearance, type AppearancePart, type ColorRamp, type Element } from "@pmrpg/shared";
import { playerLayers } from "./actor-art";
import { assetMeta, reducedMotion } from "./ui-kit";

const images = new Map<string, Promise<HTMLImageElement>>();
function image(url: string) {
  let p = images.get(url);
  if (p === undefined) {
    p = new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = url;
    });
    images.set(url, p);
  }
  return p;
}

/** The sheet with key colours swapped, as a canvas (same swap as actor-art `recolored`). */
async function recoloredSheet(url: string, swaps: Record<string, string>): Promise<CanvasImageSource> {
  const img = await image(url);
  const entries = Object.entries(swaps);
  if (entries.length === 0) return img;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const table = new Map(entries.map(([a, b]) => [Number.parseInt(a.slice(1), 16), Number.parseInt(b.slice(1), 16)]));
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const to = table.get((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    if (to === undefined) continue;
    d[i] = (to >> 16) & 255;
    d[i + 1] = (to >> 8) & 255;
    d[i + 2] = to & 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

const el = (tag: string, attrs: Record<string, string> = {}, text?: string) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * The appearance part of the create form. `look()` gives race and element as picked so far; call
 * `refresh()` when they change. Returns the picked appearance.
 */
export function appearancePicker(parent: HTMLElement, look: () => { raceId: string; element: Element }): { get(): Appearance; refresh(): void } {
  const picked: Appearance = { ...DEFAULT_APPEARANCE };
  const row = el("div", { class: "pm-look" });
  const SCALE = 2;
  const canvas = el("canvas", { width: String(64 * SCALE), height: String(64 * SCALE), class: "pm-look-preview", "aria-label": "ตัวอย่างรูปลักษณ์" }) as HTMLCanvasElement;
  const side = el("div", { class: "pm-look-parts" });
  const note = el("div", { class: "pm-note" });
  row.append(canvas, side);
  parent.append(row, note);

  let frames: { sheet: CanvasImageSource; w: number; h: number; count: number; dx: number; dy: number }[] = [];
  let fps = 6;
  let token = 0;
  const refresh = async () => {
    const t = ++token;
    const { raceId, element } = look();
    const specs = playerLayers("battle", { raceId, element, appearance: picked });
    const body = specs.find((s) => !s.head);
    const head = body === undefined ? undefined : assetMeta(`${body.prefix}_idle`)?.headOffset;
    const drawn = specs.filter((s) => assetMeta(`${s.prefix}_idle`) !== undefined);
    const missing = specs.filter((s) => s.prefix.startsWith("hair_") || s.prefix.startsWith("face_")).some((s) => assetMeta(`${s.prefix}_idle`) === undefined);
    const raceDrawn = body !== undefined && body.prefix.startsWith(`player_${raceId.replace("race:", "")}_`);
    note.textContent = [missing ? "ภาพผมและหน้ายังรอ Codex วาด ตัวอย่างตอนนี้ยังไม่เปลี่ยนตามที่เลือก แต่ระบบบันทึกค่าไว้แล้ว" : "", raceDrawn ? "" : "เผ่านี้ยังไม่มีภาพ แสดงเป็นมนุษย์ไปก่อน"].filter(Boolean).join(" · ");
    const out = await Promise.all(
      drawn.map(async (s) => {
        const m = assetMeta(`${s.prefix}_idle`)!;
        const [dx, dy] = s.head ? (head ?? [0, 0]) : [0, 0];
        return { sheet: await recoloredSheet(m.file, s.recolor), w: m.frameWidth, h: m.frameHeight, count: m.frameCount, dx, dy };
      }),
    ).catch(() => []);
    if (t !== token) return;
    frames = out;
    fps = (body && assetMeta(`${body.prefix}_idle`)?.animations[0]?.fps) || 6;
  };
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  let f = 0;
  const draw = () => {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const l of frames) {
      const i = reducedMotion ? 0 : f % l.count;
      ctx.drawImage(l.sheet, i * l.w, 0, l.w, l.h, l.dx * SCALE, l.dy * SCALE, l.w * SCALE, l.h * SCALE);
    }
    f++;
    setTimeout(draw, 1000 / fps);
  };

  const group = (label: string, list: readonly AppearancePart[], key: keyof Appearance) => {
    side.append(el("label", {}, label));
    const box = el("div", { class: "pm-choices", role: "group", "aria-label": label });
    const buttons = list.map((p) => {
      const ramp = (p as ColorRamp).ramp;
      const b = el("button", { type: "button", "aria-pressed": String(picked[key] === p.id), title: p.name.th }, ramp === undefined ? p.name.th : "");
      if (ramp !== undefined) {
        b.className = "pm-swatch";
        b.setAttribute("aria-label", p.name.th);
        b.style.background = `linear-gradient(135deg, ${ramp[ramp.length - 1]} 0 45%, ${ramp[Math.floor(ramp.length / 2)]} 45% 75%, ${ramp[0]} 75%)`;
      }
      b.addEventListener("click", () => {
        (picked as Record<string, string>)[key] = p.id;
        buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        void refresh();
      });
      box.append(b);
      return b;
    });
    side.append(box);
  };
  // Only styles Codex has drawn (art comes a few at a time, ART_HANDOFF §12); none drawn yet = all.
  const drawn = (list: readonly AppearancePart[], key: (n: string) => string[]) => {
    const have = list.filter((p) => key(p.id.split(":")[1]!).some((k) => assetMeta(k) !== undefined));
    return have.length > 0 ? have : list;
  };
  const hairs = drawn(HAIR_STYLES, (n) => [`hair_${n}_front_battle_idle`, `hair_${n}_back_battle_idle`]);
  const faces = drawn(FACES, (n) => [`face_${n}_battle_idle`]);
  if (!hairs.some((p) => p.id === picked.hair)) picked.hair = hairs[0]!.id as Appearance["hair"];
  if (!faces.some((p) => p.id === picked.face)) picked.face = faces[0]!.id as Appearance["face"];
  group("ทรงผม", hairs, "hair");
  group("สีผม", HAIR_COLORS, "hairColor");
  group("หน้า", faces, "face");
  group("สีผิว", SKIN_TONES, "skin");
  group("สีตา", EYE_COLORS, "eye");
  void refresh().then(draw);
  return { get: () => ({ ...picked }), refresh: () => void refresh() };
}
