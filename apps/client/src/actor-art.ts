/**
 * Codex's world art (art/world/HANDOFF.md): animated bodies, layers and shadows for the battle scene
 * and the map. Everything is read from the asset metadata; a unit Codex has not drawn yet keeps its
 * placeholder shape (callers check `battleBase` / `worldBase` first).
 *
 * Placement: origin [0.5,1] goes groundOffset below the standing point; the shadow sits on the
 * standing point. Layers share one clock (same frame index) and draw in list order.
 *
 * Players are layered (ART_HANDOFF §12): hair back, race body, face, hair front, weapon. A layer
 * Codex has not drawn yet is skipped; recolourable parts are painted in appearance.ts key colours
 * and swapped for the picked ones (`recolored`), so one drawing serves every colour.
 */
import Phaser from "phaser";
import { DEFAULT_APPEARANCE, recolorMap, type Appearance, type Element } from "@pmrpg/shared";
import { assetMeta, reducedMotion } from "./ui-kit";

export type ActorState = "idle" | "attack" | "cast" | "hurt" | "ko";
export type WeaponKind = "physical_melee" | "physical_ranged" | "magic" | "support";
export type Facing = "down" | "up" | "left" | "right";
type View = "battle" | "world";

const slug = (id: string, prefix: string) => id.replace(prefix, "");

/** One art layer: key prefix (`hair_01_front_battle`), colour swaps, and whether it rides the head. */
export interface LayerSpec {
  prefix: string;
  recolor: Record<string, string>;
  head: boolean;
}

/** The player's art race: its own if drawn, else human (the other 7 races are optional art). */
function playerRace(raceId: string | undefined, view: View): string | null {
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

/**
 * A player's layers, back to front. The body takes skin + element trim, the face skin + eyes, the
 * hair its colour. Layers not drawn yet drop out when played (no idle clip).
 */
export function playerLayers(view: View, look: { raceId?: string; element?: Element; appearance?: Appearance; weaponKind?: WeaponKind | null }): LayerSpec[] {
  const race = playerRace(look.raceId, view);
  if (race === null) return [];
  const a = look.appearance ?? DEFAULT_APPEARANCE;
  const el = look.element ?? "NEUTRAL";
  const hair = slug(a.hair, "hair:");
  const face = slug(a.face, "face:");
  const hairMap = recolorMap(["hair"], a, el);
  return [
    { prefix: `hair_${hair}_back_${view}`, recolor: hairMap, head: true },
    { prefix: `player_${race}_${view}`, recolor: recolorMap(["skin", "trim"], a, el), head: false },
    { prefix: `face_${face}_${view}`, recolor: recolorMap(["skin", "eye"], a, el), head: true },
    { prefix: `hair_${hair}_front_${view}`, recolor: hairMap, head: true },
    ...(look.weaponKind ? [{ prefix: `weapon_${look.weaponKind}_${view}`, recolor: {}, head: false }] : []),
  ];
}

/** The unit's frame height (64, bosses 128), for layout. */
export const artHeight = (base: string) => assetMeta(`${base}_idle`)?.frameHeight ?? assetMeta(`${base}_idle_down`)?.frameHeight ?? 64;

const hex = (c: string) => Number.parseInt(c.slice(1), 16);

/**
 * The texture `key` with key colours swapped (exact RGB match, opaque pixels), cached by its swaps;
 * the same frames and clips as the original. No swaps (or no such texture): `key` itself.
 */
export function recolored(scene: Phaser.Scene, key: string, swaps: Record<string, string>): string {
  const entries = Object.entries(swaps);
  const m = assetMeta(key);
  if (entries.length === 0 || m === undefined || !scene.textures.exists(key)) return key;
  const out = `${key}~${entries.map(([a, b]) => `${a.slice(1)}${b.slice(1)}`).join("")}`;
  if (scene.textures.exists(out)) return out;
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const table = new Map(entries.map(([a, b]) => [hex(a), hex(b)]));
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const to = table.get((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    if (to === undefined) continue;
    d[i] = (to >> 16) & 255;
    d[i + 1] = (to >> 8) & 255;
    d[i + 2] = to & 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = scene.textures.addCanvas(out, canvas)!;
  for (let f = 0; f < m.frameCount; f++) tex.add(f, 0, (f % (canvas.width / m.frameWidth)) * m.frameWidth, Math.floor(f / (canvas.width / m.frameWidth)) * m.frameHeight, m.frameWidth, m.frameHeight);
  for (const a of m.animations) {
    if (!scene.anims.exists(`${out}#${a.name}`)) scene.anims.create({ key: `${out}#${a.name}`, frames: a.frames.map((frame) => ({ key: out, frame })), frameRate: a.fps, repeat: a.loop ? -1 : 0 });
  }
  return out;
}

/** Plays `clip` of asset `key` (recoloured), or its still frame for reduced motion. False: no such art. */
function playClip(s: Phaser.GameObjects.Sprite, key: string, clip: string, swaps: Record<string, string> = {}) {
  const m = assetMeta(key);
  if (m === undefined || !s.scene.textures.exists(key)) return false;
  const tk = recolored(s.scene, key, swaps);
  const animKey = `${tk}#${clip}`;
  if (reducedMotion || !s.scene.anims.exists(animKey)) {
    // Reduced motion: a still frame; a knocked-out unit shows where its fall ends.
    s.setTexture(tk, clip === "ko" || m.holdLastFrame ? m.frameCount - 1 : (m.staticFrame ?? 0));
    return true;
  }
  s.play(animKey);
  return true;
}

/** Shared by battle and map walkers: a stack of layer sprites on one standing point. */
class LayeredActor {
  readonly sprites: { spec: LayerSpec; sprite: Phaser.GameObjects.Sprite }[];
  readonly shadow: Phaser.GameObjects.Image | null;
  protected readonly offset: number;
  /** Face/hair shift for this race's head (body metadata `headOffset`, relative to human). */
  private readonly headOffset: [number, number];

  constructor(scene: Phaser.Scene, specs: readonly LayerSpec[], idleKey: (prefix: string) => string, flip = false) {
    const body = specs.find((s) => !s.head)!;
    const idle = assetMeta(idleKey(body.prefix))!;
    this.offset = idle.groundOffset ?? 4;
    this.headOffset = idle.headOffset ?? [0, 0];
    const sh = idle.shadowAsset;
    this.shadow = sh !== undefined && assetMeta(sh) ? scene.add.image(0, 0, sh).setOrigin(0.5, 0.5).setAlpha(assetMeta(sh)!.renderAlpha ?? 0.28) : null;
    // Only layers Codex has drawn (an idle clip exists); the body is always there.
    this.sprites = specs
      .filter((s) => assetMeta(idleKey(s.prefix)) !== undefined)
      .map((spec) => ({ spec, sprite: scene.add.sprite(0, 0, idleKey(spec.prefix), 0).setOrigin(0.5, 1).setFlipX(flip) }));
  }

  get body() {
    return this.sprites.find((l) => !l.spec.head)!.sprite;
  }

  protected placeAt(x: number, groundY: number, depth: number) {
    this.shadow?.setPosition(x, groundY).setDepth(depth - 0.001);
    this.sprites.forEach(({ spec, sprite }, i) => {
      const [hx, hy] = spec.head ? this.headOffset : [0, 0];
      sprite.setPosition(x + (sprite.flipX ? -hx : hx), groundY + this.offset + hy).setDepth(depth + i * 0.0001);
    });
  }

  setVisible(v: boolean) {
    for (const l of this.sprites) l.sprite.setVisible(v);
    this.shadow?.setVisible(v);
    return this;
  }

  destroy() {
    for (const l of this.sprites) l.sprite.destroy();
    this.shadow?.destroy();
  }
}

/** One unit in a fight: shadow and layers, facing right unless flipped. */
export class BattleActor extends LayeredActor {
  readonly height: number;
  private state: ActorState = "idle";

  /** `base` alone for monsters; players pass their layers (`playerLayers("battle", …)`). */
  constructor(
    scene: Phaser.Scene,
    base: string | readonly LayerSpec[],
    private readonly weaponKind: WeaponKind | null,
    flip: boolean,
  ) {
    super(scene, typeof base === "string" ? [{ prefix: base, recolor: {}, head: false }] : base, (p) => `${p}_idle`, flip);
    this.height = this.body.height;
    this.body.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      // One-shot actions go back to idle; a fall holds its last frame (holdLastFrame).
      if (this.state !== "ko" && this.state !== "idle") this.play("idle");
    });
    this.play("idle");
  }

  /** Standing point (x, groundY); depth follows the ground line so lower rows draw in front. */
  place(x: number, groundY: number) {
    this.placeAt(x, groundY, 1 + groundY / 1000);
  }

  get current() {
    return this.state;
  }

  play(state: ActorState) {
    // A unit that fell stays down until it is revived (render sets idle again).
    if (this.state === "ko" && state !== "idle" && state !== "ko") return;
    this.state = state;
    // Bows draw with their own pose (`<prefix>_attack_physical_ranged`) on every layer that has one.
    const variant = state === "attack" && this.weaponKind === "physical_ranged" ? "_physical_ranged" : "";
    for (const { spec, sprite } of this.sprites) {
      const own = `${spec.prefix}_${state}${variant}`;
      const key = assetMeta(own) !== undefined ? own : `${spec.prefix}_${state}`;
      if (!playClip(sprite, key, state, spec.recolor)) playClip(sprite, `${spec.prefix}_idle`, "idle", spec.recolor);
    }
  }

  setAlpha(a: number) {
    for (const l of this.sprites) l.sprite.setAlpha(a);
    this.shadow?.setAlpha(a * (assetMeta(this.shadow.texture.key)?.renderAlpha ?? 0.28));
  }
}

/** A walker on the map: four facings, idle and walk; players are layered like in fights. */
export class WorldActor extends LayeredActor {
  private facing: Facing = "down";
  private walking = false;
  private readonly still: boolean;

  /** `base` alone for monsters and NPCs; players pass `playerLayers("world", …)`. */
  constructor(scene: Phaser.Scene, base: string | readonly LayerSpec[]) {
    const specs = typeof base === "string" ? [{ prefix: base, recolor: {}, head: false }] : base;
    super(scene, specs, (p) => `${p}_idle_down`);
    // NPCs only have one idle facing down.
    this.still = assetMeta(`${specs.find((s) => !s.head)!.prefix}_walk_down`) === undefined;
    this.apply();
  }

  /** Standing point (x, groundY); depth = ground line, shared with tree/wall tops (occlusion). */
  place(x: number, groundY: number) {
    this.placeAt(x, groundY, groundY);
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
    for (const { spec, sprite } of this.sprites) playClip(sprite, `${spec.prefix}_${clip}_${f}`, clip, spec.recolor);
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
