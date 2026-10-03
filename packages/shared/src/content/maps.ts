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
  },
];

/** Where a brand-new character starts. */
export const EXAMPLE_START_MAP = "map:dawn_town";

export const exampleMapRegistry = (): Map<string, MapDefinition> => new Map(EXAMPLE_MAPS.map((m) => [m.id, m]));
