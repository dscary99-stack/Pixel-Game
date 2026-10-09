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

export interface PlayerKit {
  skillIds: string[];
  passiveIds: string[];
  /** Actives not open yet, with the level that opens each. */
  locked: { skillId: string; level: number }[];
}

/** The kit at this level. An unknown class or race has nothing (the character schema refuses them). */
export function playerKit(classId: string, raceId: string, level: number): PlayerKit {
  const k = CLASS_KITS[classId];
  const race = RACE_PASSIVES[raceId];
  return {
    skillIds: (k?.actives ?? []).filter((a) => a.level <= level).map((a) => a.skillId),
    passiveIds: [...(k === undefined ? [] : [k.passiveId]), ...(race === undefined ? [] : [race])],
    locked: (k?.actives ?? []).filter((a) => a.level > level).map((a) => ({ ...a })),
  };
}
