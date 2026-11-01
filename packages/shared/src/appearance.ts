/**
 * How a player character looks (Nut 2026-11-01: pick hair, face and colours at creation; layered art,
 * "draft the structure before the images"). A look only: nothing here is ever read for numbers.
 *
 * Art is layered (docs/ART_HANDOFF.md §12): race body, face, hair back/front, weapon. Codex paints
 * each recolourable part with the KEY ramp below; the client swaps the key colours for the picked
 * ramp at load time, so one drawing serves every colour. Element shows as the outfit trim colour.
 *
 * PROVISIONAL (P38): the counts (8 hair styles, 6 faces, 6 skin tones, 10 hair colours, 8 eye colours)
 * and every colour value are Claude's draft, for Nut to change.
 */
import { z } from "zod";
import type { Element } from "./schemas";

export interface AppearancePart {
  id: string;
  name: { th: string };
}

/** A colour choice: a ramp from dark to light, same length as its key ramp. */
export interface ColorRamp extends AppearancePart {
  ramp: readonly string[];
}

const parts = (prefix: string, names: readonly string[]): AppearancePart[] => names.map((th, i) => ({ id: `${prefix}:${String(i + 1).padStart(2, "0")}`, name: { th } }));

export const HAIR_STYLES = parts("hair", ["สั้นยุ่ง", "สั้นเรียบ", "หางม้า", "ยาวตรง", "มัดสองข้าง", "ผมเปีย", "ปอยหน้าม้า", "หยักศก"]);
export const FACES = parts("face", ["ยิ้มสดใส", "นิ่งสุขุม", "ตาโต", "ตาคม", "ง่วงนิด", "มุ่งมั่น"]);

/** Key ramps Codex paints with (dark → light); each colour must appear only in its own part. */
export const APPEARANCE_KEYS = {
  skin: ["#8a4f3a", "#c98a6a", "#f2c4a0"],
  hair: ["#3a2a4a", "#6a4f7a", "#9a7fa8", "#cbb4d4"],
  eye: ["#1f3a5a", "#4f8ac0"],
  trim: ["#5a5a64", "#8a8a96", "#c0c0cc"],
} as const;

export const SKIN_TONES: ColorRamp[] = [
  { id: "skin:01", name: { th: "ขาวอมชมพู" }, ramp: ["#b06a5a", "#e8a898", "#ffd8cc"] },
  { id: "skin:02", name: { th: "ขาวเหลือง" }, ramp: ["#a8704a", "#e0ac80", "#fcd8b4"] },
  { id: "skin:03", name: { th: "สองสี" }, ramp: ["#8a4f3a", "#c98a6a", "#f2c4a0"] },
  { id: "skin:04", name: { th: "แทน" }, ramp: ["#6a3a28", "#a8684a", "#d89c74"] },
  { id: "skin:05", name: { th: "คล้ำ" }, ramp: ["#45261c", "#7a4a34", "#a8704e"] },
  { id: "skin:06", name: { th: "ซีดอมฟ้า" }, ramp: ["#6a6a8a", "#a8acc8", "#dce0f2"] },
];

export const HAIR_COLORS: ColorRamp[] = [
  { id: "haircolor:01", name: { th: "ดำ" }, ramp: ["#141420", "#2a2a3a", "#45455a", "#6a6a80"] },
  { id: "haircolor:02", name: { th: "น้ำตาลเข้ม" }, ramp: ["#2a1810", "#4a2c1c", "#6e4630", "#946448"] },
  { id: "haircolor:03", name: { th: "น้ำตาลทอง" }, ramp: ["#5a3418", "#8a5a2a", "#b88440", "#e0b064"] },
  { id: "haircolor:04", name: { th: "บลอนด์" }, ramp: ["#8a6a2a", "#c8a04a", "#ecd078", "#fff0b0"] },
  { id: "haircolor:05", name: { th: "แดง" }, ramp: ["#5a1414", "#962a20", "#c8503a", "#f08060"] },
  { id: "haircolor:06", name: { th: "ชมพู" }, ramp: ["#7a2a52", "#b8508a", "#e888b8", "#ffc0de"] },
  { id: "haircolor:07", name: { th: "ม่วง" }, ramp: ["#3a2a4a", "#6a4f7a", "#9a7fa8", "#cbb4d4"] },
  { id: "haircolor:08", name: { th: "ฟ้า" }, ramp: ["#1a3a6a", "#2f6aa8", "#5aa0dc", "#a0d4f8"] },
  { id: "haircolor:09", name: { th: "เขียวมิ้นต์" }, ramp: ["#1a5a4a", "#2f8a72", "#5ac0a0", "#a8ecd4"] },
  { id: "haircolor:10", name: { th: "เงิน" }, ramp: ["#5a5a6a", "#8a8a9a", "#bcbcca", "#eeeef6"] },
];

export const EYE_COLORS: ColorRamp[] = [
  { id: "eye:01", name: { th: "น้ำตาล" }, ramp: ["#3a2214", "#7a4a28"] },
  { id: "eye:02", name: { th: "ฟ้า" }, ramp: ["#1f3a5a", "#4f8ac0"] },
  { id: "eye:03", name: { th: "เขียว" }, ramp: ["#1a4a2a", "#3f9a5a"] },
  { id: "eye:04", name: { th: "ทอง" }, ramp: ["#6a4a10", "#d8a830"] },
  { id: "eye:05", name: { th: "แดง" }, ramp: ["#5a1010", "#c83a3a"] },
  { id: "eye:06", name: { th: "ม่วง" }, ramp: ["#3a1a5a", "#8a5ac8"] },
  { id: "eye:07", name: { th: "ดำ" }, ramp: ["#101018", "#3a3a4a"] },
  { id: "eye:08", name: { th: "เทาเงิน" }, ramp: ["#4a4a5a", "#a8a8b8"] },
];

/** Outfit trim by element: the player's element, shown on every race's clothes (no extra drawings). */
export const ELEMENT_TRIM: Record<Element, readonly string[]> = {
  FIRE: ["#8a2a1a", "#d85a2a", "#ffa060"],
  WATER: ["#1a3a7a", "#3a7ad0", "#8ac4ff"],
  EARTH: ["#5a3a1a", "#9a7040", "#d8b47a"],
  WIND: ["#1a5a3a", "#3aa86a", "#8ae0a8"],
  LIGHT: ["#8a6a10", "#e0c040", "#fff0a0"],
  SHADOW: ["#2a1a4a", "#6a4aa8", "#b090e8"],
  NEUTRAL: APPEARANCE_KEYS.trim,
};

const ids = (list: readonly AppearancePart[]) => list.map((p) => p.id) as [string, ...string[]];

export const AppearanceSchema = z
  .object({
    hair: z.enum(ids(HAIR_STYLES)),
    hairColor: z.enum(ids(HAIR_COLORS)),
    face: z.enum(ids(FACES)),
    skin: z.enum(ids(SKIN_TONES)),
    eye: z.enum(ids(EYE_COLORS)),
  })
  .strict();
export type Appearance = z.infer<typeof AppearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = { hair: "hair:01", hairColor: "haircolor:02", face: "face:01", skin: "skin:02", eye: "eye:01" };

/** A stored or received look; anything unknown falls back to the default part (old characters). */
export function appearanceOf(raw: unknown): Appearance {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const o = (raw ?? {}) as Partial<Record<keyof Appearance, unknown>>;
  const pick = <K extends keyof Appearance>(k: K, list: readonly AppearancePart[]): Appearance[K] => (typeof o[k] === "string" && list.some((p) => p.id === o[k]) ? (o[k] as Appearance[K]) : DEFAULT_APPEARANCE[k]);
  return { hair: pick("hair", HAIR_STYLES), hairColor: pick("hairColor", HAIR_COLORS), face: pick("face", FACES), skin: pick("skin", SKIN_TONES), eye: pick("eye", EYE_COLORS) };
}

/** key colour → picked colour, for one layer's recolourable parts. */
export function recolorMap(parts: readonly ("skin" | "hair" | "eye" | "trim")[], look: Appearance, element: Element): Record<string, string> {
  const target = {
    skin: SKIN_TONES.find((s) => s.id === look.skin)!.ramp,
    hair: HAIR_COLORS.find((s) => s.id === look.hairColor)!.ramp,
    eye: EYE_COLORS.find((s) => s.id === look.eye)!.ramp,
    trim: ELEMENT_TRIM[element],
  };
  const out: Record<string, string> = {};
  for (const p of parts) APPEARANCE_KEYS[p].forEach((k, i) => (k !== target[p][i] ? (out[k] = target[p][i]!) : undefined));
  return out;
}
