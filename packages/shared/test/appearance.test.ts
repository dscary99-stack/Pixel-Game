import { describe, expect, it } from "vitest";
import {
  APPEARANCE_KEYS,
  AppearanceSchema,
  CreateCharacterRequestSchema,
  DEFAULT_APPEARANCE,
  ELEMENT_TRIM,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  FACES,
  SKIN_TONES,
  appearanceOf,
  parsePlayerLook,
  recolorMap,
} from "../src";

describe("appearance (P38)", () => {
  it("offers 8 hair styles, 6 faces and colour ramps the same length as their key ramps", () => {
    expect(HAIR_STYLES).toHaveLength(8);
    expect(FACES).toHaveLength(6);
    for (const r of SKIN_TONES) expect(r.ramp).toHaveLength(APPEARANCE_KEYS.skin.length);
    for (const r of HAIR_COLORS) expect(r.ramp).toHaveLength(APPEARANCE_KEYS.hair.length);
    for (const r of EYE_COLORS) expect(r.ramp).toHaveLength(APPEARANCE_KEYS.eye.length);
    for (const r of Object.values(ELEMENT_TRIM)) expect(r).toHaveLength(APPEARANCE_KEYS.trim.length);
  });

  it("key colours are distinct, so one swap never catches another part", () => {
    const all = Object.values(APPEARANCE_KEYS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("the create request takes an optional appearance and refuses unknown parts", () => {
    const base = { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:human", element: "FIRE" };
    expect(CreateCharacterRequestSchema.safeParse(base).success).toBe(true);
    expect(CreateCharacterRequestSchema.safeParse({ ...base, appearance: { ...DEFAULT_APPEARANCE, hair: "hair:05" } }).success).toBe(true);
    expect(CreateCharacterRequestSchema.safeParse({ ...base, appearance: { ...DEFAULT_APPEARANCE, hair: "hair:99" } }).success).toBe(false);
    expect(AppearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, extra: 1 }).success).toBe(false);
  });

  it("stored or received looks fall back part by part to the default", () => {
    expect(appearanceOf(null)).toEqual(DEFAULT_APPEARANCE);
    expect(appearanceOf("not json")).toEqual(DEFAULT_APPEARANCE);
    expect(appearanceOf(JSON.stringify({ hair: "hair:03", face: "face:zz" }))).toEqual({ ...DEFAULT_APPEARANCE, hair: "hair:03" });
  });

  it("recolours only the parts asked for, and only colours that change", () => {
    const look = { ...DEFAULT_APPEARANCE, hairColor: "haircolor:05", skin: "skin:03" };
    const m = recolorMap(["hair", "skin"], look, "FIRE");
    expect(Object.keys(m)).toEqual([...APPEARANCE_KEYS.hair]);
    expect(m[APPEARANCE_KEYS.hair[0]]).toBe(HAIR_COLORS[4]!.ramp[0]);
    expect(Object.keys(recolorMap(["trim"], look, "WATER"))).toEqual([...APPEARANCE_KEYS.trim]);
  });

  it("the map look carries race, element and a cleaned appearance", () => {
    const look = parsePlayerLook(JSON.stringify({ raceId: "race:sylvan", element: "WIND", appearance: { hair: "hair:02", eye: "bad" } }));
    expect(look).toEqual({ raceId: "race:sylvan", element: "WIND", appearance: { ...DEFAULT_APPEARANCE, hair: "hair:02" } });
    expect(parsePlayerLook(JSON.stringify({ raceId: "Race <b>", element: "PLASMA" }))).toBeUndefined();
  });
});
