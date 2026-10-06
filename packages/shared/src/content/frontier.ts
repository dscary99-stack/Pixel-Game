/**
 * EXAMPLE weekly tower (Nut 2026-10-06). Name, lore and guardians are a draft; Nut may pick another
 * name (alternatives: บันไดบรรพอสูร, หอทดสอบผู้ผูกตรา). Must not be published as is.
 */
import type { FrontierDefinition } from "../frontier";

export const EXAMPLE_FRONTIER: FrontierDefinition = {
  id: "frontier:rift_spire",
  version: 1,
  status: "draft",
  example: true,
  name: { th: "หอคอยรอยแยก", en: "Rift Spire" },
  lore: { th: "หอคอยที่งอกขึ้นจากรอยแยกของรอยแยกปฐมกาล ดึงมอนสเตอร์จากทุกแคว้นเข้ามาไว้ข้างใน" },
  townMapIds: ["map:dawn_town"],
  bossIds: ["boss:rift_spire_warden", "boss:rift_spire_tyrant"],
};
