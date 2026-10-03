/**
 * EXAMPLE maps for the Phase B walking slice. Two small areas joined by portals, enough to prove
 * walking, collision, channels and scene changes. Layout and names are illustration (chapter 00
 * EXAMPLE); the real town and the first hunting fields come from the content plan (chapter 13 §2).
 */
import type { MapDefinition } from "../world/map";

const meta = { version: 1, status: "draft", example: true } as const;

export const EXAMPLE_MAPS: MapDefinition[] = [
  {
    id: "map:dawn_town",
    ...meta,
    name: { th: "หมู่บ้านรุ่งอรุณ", en: "Dawn Village" },
    kind: "town",
    tiles: [
      "########################",
      "#,,,,,,,,,,====,,,,,,,,#",
      "#,TT,,,,,,,====,,,,,TT,#",
      "#,TT,,####,====,####,,,#",
      "#,,,,,#..#,====,#..#,,,#",
      "#,,,,,#..#,====,#..#,,,#",
      "#,,,,,##=#,====,#=##,,,#",
      "#=======================",
      "#=======================",
      "#,,,,,,,,,,====,,,,,,,,#",
      "#,~~~~,,,,,====,,,,,,,,#",
      "#,~~~~,,,,,====,,,,TT,,#",
      "#,,,,,,,,,,====,,,,TT,,#",
      "#,TT,,,,,,,====,,,,,,,,#",
      "#,,,,,,,,,,====,,,,,,,,#",
      "########################",
    ],
    spawn: { x: 12, y: 8 },
    portals: [
      { at: { x: 23, y: 7 }, to: { mapId: "map:dawn_field", x: 1, y: 7 }, label: "ทุ่งรุ่งอรุณ" },
      { at: { x: 23, y: 8 }, to: { mapId: "map:dawn_field", x: 1, y: 8 }, label: "ทุ่งรุ่งอรุณ" },
    ],
    spawns: [],
  },
  {
    id: "map:dawn_field",
    ...meta,
    name: { th: "ทุ่งรุ่งอรุณ", en: "Dawn Field" },
    kind: "field",
    tiles: [
      "############################",
      "#,,,,TT,,,,,,,,,,,,,TT,,,,,#",
      "#,,,,TT,,,,,~~~~,,,,TT,,,,,#",
      "#,,,,,,,,,,~~~~~~,,,,,,,,,,#",
      "#,,TT,,,,,,~~~~~~,,,,,,TT,,#",
      "#,,TT,,,,,,,~~~~,,,,,,,TT,,#",
      "#,,,,,,,,,,,,,,,,,,,,,,,,,,#",
      "=====,,,,,,,,,TT,,,,,,,,,,,#",
      "=====,,,,,,,,,TT,,,,,,,,,,,#",
      "#,,,,,,,,,,,,,,,,,,,,,,,,,,#",
      "#,,TT,,,,,,,,,,,,,,,,,TT,,,#",
      "#,,TT,,,,,~~,,,,,,,,,,TT,,,#",
      "#,,,,,,,,,~~,,,,TT,,,,,,,,,#",
      "#,,,,,,,,,,,,,,,TT,,,,,,,,,#",
      "#,,,,TT,,,,,,,,,,,,,,,TT,,,#",
      "#,,,,TT,,,,,,,,,,,,,,,TT,,,#",
      "#,,,,,,,,,,,,,,,,,,,,,,,,,,#",
      "############################",
    ],
    spawn: { x: 3, y: 8 },
    portals: [
      { at: { x: 0, y: 7 }, to: { mapId: "map:dawn_town", x: 22, y: 7 }, label: "หมู่บ้านรุ่งอรุณ" },
      { at: { x: 0, y: 8 }, to: { mapId: "map:dawn_town", x: 22, y: 8 }, label: "หมู่บ้านรุ่งอรุณ" },
    ],
    // Small packs (1–2) suit the Lv10 dev character; chapter 07 §3 size bands go up to 9–10.
    spawns: [
      {
        id: "pond_crabs",
        at: { x: 9, y: 6 },
        rank: "NORMAL",
        packSize: [1, 2],
        entries: [
          { speciesId: "species:armor_crab", weight: 3, elementWeights: { WATER: 2, EARTH: 1 }, groupRules: { min: 1, max: 2 } },
          { speciesId: "species:lantern_snail", weight: 1, elementWeights: { WATER: 1, LIGHT: 1 }, groupRules: { min: 1, max: 1 } },
        ],
      },
      {
        id: "meadow_foxes",
        at: { x: 19, y: 9 },
        rank: "NORMAL",
        packSize: [1, 2],
        entries: [{ speciesId: "species:ember_fox", weight: 1, elementWeights: { FIRE: 3, WIND: 2, SHADOW: 1 }, groupRules: { min: 1, max: 2 } }],
      },
      {
        id: "south_snails",
        at: { x: 8, y: 14 },
        rank: "NORMAL",
        packSize: [1, 1],
        entries: [{ speciesId: "species:lantern_snail", weight: 1, elementWeights: { WATER: 1, LIGHT: 1 }, groupRules: { min: 1, max: 1 } }],
      },
    ],
  },
];

/** Where a brand-new character starts. */
export const EXAMPLE_START_MAP = "map:dawn_town";

export const exampleMapRegistry = (): Map<string, MapDefinition> => new Map(EXAMPLE_MAPS.map((m) => [m.id, m]));
