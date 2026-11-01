/**
 * Codex's world art (art/world/HANDOFF.md): animated bodies, weapon layers and shadows for the battle
 * scene and the map. Everything is read from the asset metadata; a unit Codex has not drawn yet keeps
 * its placeholder shape (callers check `battleBase` / `worldBase` first).
 *
 * Placement: origin [0.5,1] goes groundOffset below the standing point; the shadow sits on the
 * standing point. Body and weapon share one clock (same frame index), body drawn first.
 */
import Phaser from "phaser";
import { assetMeta, reducedMotion } from "./ui-kit";

export type ActorState = "idle" | "attack" | "cast" | "hurt" | "ko";
export type WeaponKind = "physical_melee" | "physical_ranged" | "magic" | "support";
export type Facing = "down" | "up" | "left" | "right";

const slug = (id: string, prefix: string) => id.replace(prefix, "");

/** The player's art race: its own if drawn, else human (the other 7 races are optional art). */
function playerRace(raceId: string | undefined, view: "battle" | "world"): string | null {
  for (const r of [slug(raceId ?? "race:human", "race:"), "human"]) if (assetMeta(`player_${r}_${view}_idle${view === "world" ? "_down" : ""}`)) return r;
  return null;
}

/** `mon_<slug>_battle` / `player_<race>_battle` when Codex drew its idle clip, else null. */
export function battleBase(u: { kind: string; speciesId: string | null; look?: { raceId: string } }): string | null {
  if (u.kind === "player") {
    const r = playerRace(u.look?.raceId, "battle");
    return r === null ? null : `player_${r}_battle`;
  }
  if (u.speciesId === null) return null;
  const b = `mon_${slug(u.speciesId, "species:")}_battle`;
  return assetMeta(`${b}_idle`) ? b : null;
}

/** World (map) art base: `mon_<slug>_world`, `player_<race>_world` or `npc_<slug>_world`. */
export function worldBase(kind: "monster" | "player" | "npc", id?: string): string | null {
  if (kind === "player") {
    const r = playerRace(id, "world");
    return r === null ? null : `player_${r}_world`;
  }
  const b = kind === "npc" ? `npc_${slug(id ?? "", "npc:")}_world` : `mon_${slug(id ?? "", "species:")}_world`;
  return assetMeta(`${b}_idle_down`) ? b : null;
}

/** The unit's frame height (64, bosses 128), for layout. */
export const artHeight = (base: string) => assetMeta(`${base}_idle`)?.frameHeight ?? assetMeta(`${base}_idle_down`)?.frameHeight ?? 64;

function playClip(s: Phaser.GameObjects.Sprite, key: string, clip: string) {
  const m = assetMeta(key);
  if (m === undefined) return false;
  const animKey = `${key}#${clip}`;
  if (reducedMotion || !s.scene.anims.exists(animKey)) {
    // Reduced motion: a still frame; a knocked-out unit shows where its fall ends.
    s.setTexture(key, clip === "ko" || m.holdLastFrame ? m.frameCount - 1 : (m.staticFrame ?? 0));
    return true;
  }
  s.play(animKey);
  return true;
}

/** One unit in a fight: shadow, body and (players) the weapon layer, facing right unless flipped. */
export class BattleActor {
  readonly body: Phaser.GameObjects.Sprite;
  readonly weapon: Phaser.GameObjects.Sprite | null;
  readonly shadow: Phaser.GameObjects.Image | null;
  readonly height: number;
  private state: ActorState = "idle";
  private readonly offset: number;

  constructor(
    scene: Phaser.Scene,
    private readonly base: string,
    private readonly weaponKind: WeaponKind | null,
    flip: boolean,
  ) {
    const idle = assetMeta(`${base}_idle`)!;
    this.offset = idle.groundOffset ?? 4;
    this.height = idle.frameHeight;
    const sh = idle.shadowAsset;
    this.shadow = sh !== undefined && assetMeta(sh) ? scene.add.image(0, 0, sh).setOrigin(0.5, 0.5).setAlpha(assetMeta(sh)!.renderAlpha ?? 0.28) : null;
    this.body = scene.add.sprite(0, 0, `${base}_idle`, 0).setOrigin(0.5, 1).setFlipX(flip);
    this.weapon = weaponKind !== null && assetMeta(`weapon_${weaponKind}_battle_idle`) ? scene.add.sprite(0, 0, `weapon_${weaponKind}_battle_idle`, 0).setOrigin(0.5, 1).setFlipX(flip) : null;
    this.body.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      // One-shot actions go back to idle; a fall holds its last frame (holdLastFrame).
      if (this.state !== "ko" && this.state !== "idle") this.play("idle");
    });
    this.play("idle");
  }

  /** Standing point (x, groundY); depth follows the ground line so lower rows draw in front. */
  place(x: number, groundY: number) {
    const d = 1 + groundY / 1000;
    this.shadow?.setPosition(x, groundY).setDepth(d - 0.0005);
    this.body.setPosition(x, groundY + this.offset).setDepth(d);
    this.weapon?.setPosition(x, groundY + this.offset).setDepth(d + 0.0002);
  }

  get current() {
    return this.state;
  }

  play(state: ActorState) {
    // A unit that fell stays down until it is revived (render sets idle again).
    if (this.state === "ko" && state !== "idle" && state !== "ko") return;
    this.state = state;
    // Bows draw with their own body pose (bodyAsset of the ranged weapon's attack).
    const bodyKey = state === "attack" && this.weaponKind === "physical_ranged" && assetMeta(`${this.base}_attack_physical_ranged`) ? `${this.base}_attack_physical_ranged` : `${this.base}_${state}`;
    if (!playClip(this.body, bodyKey, state)) playClip(this.body, `${this.base}_idle`, "idle");
    if (this.weapon !== null) playClip(this.weapon, `weapon_${this.weaponKind}_battle_${state}`, state);
  }

  setAlpha(a: number) {
    this.body.setAlpha(a);
    this.weapon?.setAlpha(a);
    this.shadow?.setAlpha(a * (assetMeta(this.shadow.texture.key)?.renderAlpha ?? 0.28));
  }

  setVisible(v: boolean) {
    this.body.setVisible(v);
    this.weapon?.setVisible(v);
    this.shadow?.setVisible(v);
  }
}

/** A walker on the map: four facings, idle and walk, with an optional weapon layer (players). */
export class WorldActor {
  readonly body: Phaser.GameObjects.Sprite;
  readonly weapon: Phaser.GameObjects.Sprite | null;
  readonly shadow: Phaser.GameObjects.Image | null;
  private facing: Facing = "down";
  private walking = false;
  private readonly offset: number;
  private readonly still: boolean;

  constructor(
    scene: Phaser.Scene,
    private readonly base: string,
    private readonly weaponKind: WeaponKind | null = null,
  ) {
    const idle = assetMeta(`${base}_idle_down`)!;
    this.offset = idle.groundOffset ?? 4;
    // NPCs only have one idle facing down.
    this.still = assetMeta(`${base}_walk_down`) === undefined;
    const sh = idle.shadowAsset;
    this.shadow = sh !== undefined && assetMeta(sh) ? scene.add.image(0, 0, sh).setAlpha(assetMeta(sh)!.renderAlpha ?? 0.28) : null;
    this.body = scene.add.sprite(0, 0, `${base}_idle_down`, 0).setOrigin(0.5, 1);
    this.weapon = weaponKind !== null && assetMeta(`weapon_${weaponKind}_world_idle_down`) ? scene.add.sprite(0, 0, `weapon_${weaponKind}_world_idle_down`, 0).setOrigin(0.5, 1) : null;
    this.apply();
  }

  /** Standing point (x, groundY); depth = ground line, shared with tree/wall tops (occlusion). */
  place(x: number, groundY: number) {
    this.shadow?.setPosition(x, groundY).setDepth(groundY - 0.5);
    this.body.setPosition(x, groundY + this.offset).setDepth(groundY);
    this.weapon?.setPosition(x, groundY + this.offset).setDepth(groundY + 0.1);
  }

  /** Moving by (dx, dy) picks the facing; (0, 0) stands still facing the same way. */
  move(dx: number, dy: number) {
    const walking = dx !== 0 || dy !== 0;
    const facing: Facing = !walking ? this.facing : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    if (walking === this.walking && facing === this.facing) return;
    this.walking = walking;
    this.facing = facing;
    this.apply();
  }

  private apply() {
    const f = this.still ? "down" : this.facing;
    const clip = this.walking && !this.still ? "walk" : "idle";
    playClip(this.body, `${this.base}_${clip}_${f}`, clip);
    if (this.weapon !== null) playClip(this.weapon, `weapon_${this.weaponKind}_world_${clip}_${f}`, clip);
  }

  setVisible(v: boolean) {
    this.body.setVisible(v);
    this.weapon?.setVisible(v);
    this.shadow?.setVisible(v);
    return this;
  }

  destroy() {
    this.body.destroy();
    this.weapon?.destroy();
    this.shadow?.destroy();
  }
}

/** Battle background for the fight's place: tower floors, the town training ground, else the field. */
export function battleBackground(scene: Phaser.Scene, place: "field" | "tower" | "practice") {
  const id = place === "tower" ? "rift_tower" : place === "practice" ? "town_practice" : "dawn_field";
  const k = `bg_${id}_battle`;
  if (!assetMeta(k)) return false;
  scene.add.image(0, 0, k).setOrigin(0, 0).setDepth(-10);
  const amb = assetMeta(`bg_${id}_ambient`);
  // Ambient sparkles repeat at the metadata placements, each a few frames apart; off for reduced motion.
  if (amb !== undefined && !reducedMotion && scene.anims.exists(`bg_${id}_ambient#ambient`)) {
    for (const p of amb.placements ?? []) {
      const s = scene.add.sprite(p.x, p.y, `bg_${id}_ambient`, 0).setOrigin(0, 0).setDepth(-9);
      s.play({ key: `bg_${id}_ambient#ambient`, startFrame: p.phaseOffset % amb.frameCount });
    }
  }
  return true;
}

/**
 * A map drawn with Codex's oblique tiles (art/world/HANDOFF.md "Tiles / occlusion"): each cell's kind
 * from the legend, its 4-bit same-kind neighbour mask (N1 E2 S4 W8, outside the map counts as the
 * same), an underlay under the base tile, and tree/wall tops as separate images whose depth is the
 * tile's bottom edge, so walkers sort in front of or behind them by their ground line.
 * Returns null when the map has no tileset (it keeps its placeholder squares).
 */
export function drawTileMap(scene: Phaser.Scene, mapId: string, tiles: readonly string[], T: number): { base: Phaser.GameObjects.Container; uppers: Phaser.GameObjects.Image[] } | null {
  const id = mapId.replace(/^map:/, "");
  const k = `tiles_${id}_base`;
  const m = assetMeta(k);
  if (m === undefined || m.legend === undefined || !scene.textures.exists(k)) return null;
  const legend = m.legend;
  const order = m.adjacency?.legendOrder ?? ["ground", "grass", "road", "wall", "tree", "water"];
  const byMask = new Map((m.tileEntries ?? []).map((e) => [`${e.kind}:${e.neighborMask}`, e]));
  const kindAt = (x: number, y: number) => (y < 0 || y >= tiles.length || x < 0 || x >= tiles[y]!.length ? null : (legend[tiles[y]![x]!] ?? null));
  const base = scene.add.container(0, 0).setDepth(0);
  const uppers: Phaser.GameObjects.Image[] = [];
  tiles.forEach((row, y) =>
    [...row].forEach((_, x) => {
      const kind = kindAt(x, y);
      if (kind === null) return;
      const same = (dx: number, dy: number) => {
        const o = kindAt(x + dx, y + dy);
        return o === null || o === kind;
      };
      const mask = (same(0, -1) ? 1 : 0) | (same(1, 0) ? 2 : 0) | (same(0, 1) ? 4 : 0) | (same(-1, 0) ? 8 : 0);
      const e = byMask.get(`${kind}:${mask}`);
      const index = e?.index ?? order.indexOf(kind) * 16 + mask;
      const under = e?.underlay === undefined ? undefined : m.adjacency?.underlayIndex[e.underlay];
      if (under !== undefined) base.add(scene.add.image(x * T, y * T, k, under).setOrigin(0, 0));
      base.add(scene.add.image(x * T, y * T, k, index).setOrigin(0, 0));
      if (kind === "tree" || kind === "wall") {
        const uk = `tiles_${id}_${kind}_upper`;
        const um = assetMeta(uk);
        if (um !== undefined && scene.textures.exists(uk)) {
          const [ox, oy] = um.tileOffset ?? [0, -T];
          uppers.push(scene.add.image(x * T + ox, y * T + oy, uk).setOrigin(0, 0).setDepth((y + 1) * T));
        }
      }
    }),
  );
  return { base, uppers };
}

/** The animated portal marker on its tile (decorative: walkability comes from the map data). */
export function portalSprite(scene: Phaser.Scene, x: number, bottomY: number) {
  if (!assetMeta("portal_world_idle") || !scene.textures.exists("portal_world_idle")) return null;
  const s = scene.add.sprite(x, bottomY, "portal_world_idle", 0).setOrigin(0.5, 1).setDepth(bottomY - 1);
  if (!reducedMotion && scene.anims.exists("portal_world_idle#idle")) s.play("portal_world_idle#idle");
  return s;
}
