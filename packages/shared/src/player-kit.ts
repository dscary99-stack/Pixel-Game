/**
 * What a character fights with (chapter 02, P16 draft): the Class1 kit opens by character level, and
 * the race passive is there from Lv1. Every skill of the kit that is open is in use (6 active slots in
 * chapter 02; a Class1 kit has 4, so there is no loadout to choose yet). Unlock levels are EXAMPLE.
 */
export interface ClassKit {
  /** The class passive (from Lv1). */
  passiveId: string;
  /** Actives in the order they open. */
  actives: readonly { skillId: string; level: number }[];
}

const kit = (passiveId: string, ...actives: [string, number][]): ClassKit => ({ passiveId, actives: actives.map(([skillId, level]) => ({ skillId, level })) });

export const CLASS_KITS: Readonly<Record<string, ClassKit>> = {
  "class:guardian": kit("skill:guardian_heart", ["skill:guardian_shield_bash", 1], ["skill:guardian_provoke", 1], ["skill:guardian_cover", 8], ["skill:guardian_bulwark", 20]),
  "class:striker": kit("skill:striker_fighting_blood", ["skill:striker_heavy_slash", 1], ["skill:striker_cleave", 1], ["skill:striker_armor_break", 8], ["skill:striker_all_in", 20]),
  "class:ranger": kit("skill:ranger_hunter_eye", ["skill:ranger_marking_shot", 1], ["skill:ranger_arrow_rain", 1], ["skill:ranger_vital_shot", 8], ["skill:ranger_finisher", 20]),
  "class:arcanist": kit("skill:arcanist_mana_flow", ["skill:arcanist_arcane_bolt", 1], ["skill:arcanist_storm", 1], ["skill:arcanist_flame_lick", 8], ["skill:arcanist_seal", 20]),
  "class:warden": kit("skill:warden_grace", ["skill:warden_mend", 1], ["skill:warden_soothing_wind", 1], ["skill:warden_purify", 8], ["skill:player_rally", 20]),
  "class:binder": kit("skill:binder_bond_link", ["skill:binder_joint_strike", 1], ["skill:binder_rouse", 1], ["skill:binder_quicken", 8], ["skill:binder_bond_guard", 20]),
  "class:rogue": kit("skill:rogue_opportunist", ["skill:rogue_bleeding_stab", 1], ["skill:rogue_shadow_veil", 1], ["skill:rogue_shadow_blade", 8], ["skill:rogue_throat_cut", 20]),
  "class:alchemist": kit("skill:alchemist_brewer", ["skill:alchemist_acid_flask", 1], ["skill:alchemist_flask_burst", 1], ["skill:alchemist_quick_remedy", 8], ["skill:alchemist_toxic_cloud", 20]),
  "class:bard": kit("skill:bard_rhythm", ["skill:bard_war_song", 1], ["skill:bard_shrill_note", 1], ["skill:bard_ward_song", 8], ["skill:bard_lullaby", 20]),
};

export const RACE_PASSIVES: Readonly<Record<string, string>> = {
  "race:human": "skill:race_human_grit",
  "race:sylvan": "skill:race_sylvan_bloom",
  "race:stonekin": "skill:race_stonekin_stone",
  "race:wildkin": "skill:race_wildkin_instinct",
  "race:runeborn": "skill:race_runeborn_flow",
  "race:tideborn": "skill:race_tideborn_tide",
  "race:skyborn": "skill:race_skyborn_wind",
  "race:veilborn": "skill:race_veilborn_shade",
};

/**
 * Class2 branches (chapter 02 table, P16 draft): two per Class1, one picked after the trial at Lv50.
 * A branch adds its passive and two actives (Class1 4 + Class2 2 = the 6 active slots); the second
 * active opens 10 levels later. EXAMPLE names and levels (STATUS A142).
 */
export interface Class2Branch {
  id: string;
  classId: string;
  name: { th: string; en: string };
  /** The chapter 02 line: what the branch does and what it gives up. */
  summary: string;
  passiveId: string;
  actives: readonly { skillId: string; level: number }[];
}

const branch = (id: string, classId: string, th: string, en: string, summary: string, passiveId: string, a1: string, a2: string): Class2Branch => ({
  id,
  classId,
  name: { th, en },
  summary,
  passiveId,
  actives: [
    { skillId: a1, level: 50 },
    { skillId: a2, level: 60 },
  ],
});

export const CLASS2_BRANCHES: readonly Class2Branch[] = [
  branch("class2:bastion", "class:guardian", "ปราการ", "Bastion", "โล่หลายเป้าหมายและรับแทน มีจำนวนครั้ง", "skill:c2_bastion_layers", "skill:c2_bastion_wall", "skill:c2_bastion_stand_in"),
  branch("class2:sentinel", "class:guardian", "ผู้เฝ้ารบ", "Sentinel", "ตั้งรับแล้วสวน ใช้จังหวะก่อนเร่งดาเมจ", "skill:c2_sentinel_riposte", "skill:c2_sentinel_stance", "skill:c2_sentinel_payback"),
  branch("class2:breaker", "class:striker", "ผู้ทะลวง", "Breaker", "เปิดช่วงเกราะอ่อนให้ทีม ขาดการสนับสนุนด้านอื่น", "skill:c2_breaker_crack", "skill:c2_breaker_shatter", "skill:c2_breaker_wave"),
  branch("class2:berserker", "class:striker", "นักรบคลั่ง", "Berserker", "ใช้ HP เป็นต้นทุน แรงขึ้นเมื่อเลือดน้อย", "skill:c2_berserker_blood", "skill:c2_berserker_blood_slash", "skill:c2_berserker_fury"),
  branch("class2:sharpshooter", "class:ranger", "มือยิงแม่น", "Sharpshooter", "เล็งเป้าหมายเดี่ยว แลก action เตรียมตัว", "skill:c2_sharp_steady", "skill:c2_sharp_aim", "skill:c2_sharp_piercer"),
  branch("class2:trapper", "class:ranger", "นักวางกับดัก", "Trapper", "กับดักทำงานตามเหตุการณ์ ไม่ต้องเดินในฉากสู้", "skill:c2_trapper_snare", "skill:c2_trapper_root_trap", "skill:c2_trapper_spike_field"),
  branch("class2:elementalist", "class:arcanist", "ผู้ชำนาญธาตุ", "Elementalist", "วางธาตุแล้วต่อปฏิกิริยา แลก MP", "skill:c2_elemental_attune", "skill:c2_elemental_torrent", "skill:c2_elemental_thunder"),
  branch("class2:spellweaver", "class:arcanist", "ผู้ถักเวท", "Spellweaver", "เตรียมเวทไว้รอบถัดไป มีสัญญาณให้เห็น", "skill:c2_weaver_loom", "skill:c2_weaver_thread", "skill:c2_weaver_star_net"),
  branch("class2:lifekeeper", "class:warden", "ผู้รักษาชีวิต", "Lifekeeper", "ฮีลต่อเนื่องและกระจาย ดาเมจต่ำ", "skill:c2_life_wellspring", "skill:c2_life_rain", "skill:c2_life_stream"),
  branch("class2:spiritkeeper", "class:warden", "ผู้พิทักษ์วิญญาณ", "Spiritkeeper", "ป้องกันล้มและชุบ มีต้นทุน ไม่ชุบวน", "skill:c2_spirit_vigil", "skill:c2_spirit_ward", "skill:c2_spirit_recall"),
  branch("class2:beast_marshal", "class:binder", "ผู้บัญชาการคู่ใจ", "Beast Marshal", "แลก action ตัวเองให้คู่ใจลงมือทันที", "skill:c2_marshal_command", "skill:c2_marshal_charge", "skill:c2_marshal_pack"),
  branch("class2:soul_linker", "class:binder", "ผู้เชื่อมสายสัมพันธ์", "Soul Linker", "เชื่อมสมาชิกแบ่งการคุ้มกัน ไม่เพิ่มช่องคู่ใจ", "skill:c2_linker_thread", "skill:c2_linker_share", "skill:c2_linker_bind"),
  branch("class2:assassin", "class:rogue", "นักสังหาร", "Assassin", "เปิดจุดอ่อนและเจาะแนวหลัง ไม่ล่องหนจนบอสทำอะไรไม่ได้", "skill:c2_assassin_vanish", "skill:c2_assassin_shadow_strike", "skill:c2_assassin_death_mark"),
  branch("class2:saboteur", "class:rogue", "ผู้ก่อกวน", "Saboteur", "ทำลายบัฟและก่อกวน ไม่เพิ่ม loot", "skill:c2_saboteur_meddle", "skill:c2_saboteur_unravel", "skill:c2_saboteur_flashbang"),
  branch("class2:apothecary", "class:alchemist", "นักปรุงโอสถ", "Apothecary", "ผสมรักษาและต้านสถานะ ไม่ผูกขาดงานคราฟต์", "skill:c2_apothecary_dose", "skill:c2_apothecary_purge", "skill:c2_apothecary_tonic"),
  branch("class2:transmuter", "class:alchemist", "ผู้แปรสสาร", "Transmuter", "สารตั้งต้นและปฏิกิริยาสนาม (น้ำมันเจอไฟ)", "skill:c2_transmuter_catalyst", "skill:c2_transmuter_oil", "skill:c2_transmuter_ignite"),
  branch("class2:minstrel", "class:bard", "นักบรรเลง", "Minstrel", "เพลงหลักหนุนทั้งทีม ไม่เพิ่ม EXP/drop", "skill:c2_minstrel_tempo", "skill:c2_minstrel_anthem", "skill:c2_minstrel_refrain"),
  branch("class2:dirgesinger", "class:bard", "ผู้ขับบทโศก", "Dirgesinger", "บทเพลงกดดันศัตรู มีโอกาสถูกต้าน", "skill:c2_dirge_lament", "skill:c2_dirge_weight", "skill:c2_dirge_last_verse"),
];

export const class2Branch = (id: string | null | undefined): Class2Branch | undefined => (id == null ? undefined : CLASS2_BRANCHES.find((b) => b.id === id));
export const class2BranchesOf = (classId: string): Class2Branch[] => CLASS2_BRANCHES.filter((b) => b.classId === classId);

export interface PlayerKit {
  skillIds: string[];
  passiveIds: string[];
  /** Actives not open yet, with the level that opens each. */
  locked: { skillId: string; level: number }[];
}

/**
 * The kit at this level. An unknown class or race has nothing (the character schema refuses them);
 * a Class2 branch counts only when it belongs to the character's Class1.
 */
export function playerKit(classId: string, raceId: string, level: number, class2Id?: string | null): PlayerKit {
  const k = CLASS_KITS[classId];
  const race = RACE_PASSIVES[raceId];
  const b = class2Branch(class2Id);
  const c2 = b?.classId === classId ? b : undefined;
  const actives = [...(k?.actives ?? []), ...(c2?.actives ?? [])];
  return {
    skillIds: actives.filter((a) => a.level <= level).map((a) => a.skillId),
    passiveIds: [...(k === undefined ? [] : [k.passiveId]), ...(c2 === undefined ? [] : [c2.passiveId]), ...(race === undefined ? [] : [race])],
    locked: actives.filter((a) => a.level > level).map((a) => ({ ...a })),
  };
}
