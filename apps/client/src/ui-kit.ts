/**
 * The UI kit Codex drew for the GUI draft (ART_HANDOFF §11, art/ui/PROOF.md, art/ui/R2_HANDOFF.md):
 * 9-slice frames, rarity slots, bars, icons, item art and animated effects. `loadAssetRegistry` reads the
 * per-asset metadata once at start; scenes call `loadUiKit` in `preload` (Phaser keeps textures and
 * animations game-wide, so a second scene's load is a no-op) and build widgets with the helpers below.
 */
import Phaser from "phaser";

const V = "v001";
const BUTTONS = ["normal", "selected", "primary", "disabled", "danger"] as const;
const COMMANDS = ["attack", "skill", "guard", "potion", "revive", "capture", "flee", "ascend", "auto"] as const;
const MENUS = ["character", "companion", "inventory", "activities", "social"] as const;
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const BARS = ["track", "hp_ally", "hp_enemy", "mp", "exp", "ascend"] as const;
const BAR_HEIGHTS = [4, 6, 8] as const;

export type ButtonKind = (typeof BUTTONS)[number];
export type CommandIcon = (typeof COMMANDS)[number];
export type MenuIcon = (typeof MENUS)[number];
export type Rarity = (typeof RARITIES)[number];
export type BarKind = Exclude<(typeof BARS)[number], "track">;
export type BarHeight = (typeof BAR_HEIGHTS)[number];

/** One asset's metadata (ART_HANDOFF §6–7, art/ui/R2_HANDOFF.md): what the loader and players need. */
export interface AssetMeta {
  assetId: string;
  file: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  animations: { name: string; frames: number[]; fps: number; loop: boolean }[];
  staticFrame?: number;
  contentId?: string | null;
  contentGroup?: string | null;
}

/** Texture key = the file's stem without its version: `ui_status_stun`, `item_crab_shell`. */
export const textureKeyOf = (file: string) => file.split("/").pop()!.replace(/_v\d+\.png$/, "");
const registry = new Map<string, AssetMeta>();
/** Items, equipment and Sigils by content id (`item:crab_shell`, `equip:…`, `sigil:…`). */
const byContent = new Map<string, string>();

/**
 * Reads every manifest listed in /assets/metadata/index.json once, before any scene preloads, so the
 * kit is driven by Codex's metadata instead of a hardcoded list (new assets need no code change).
 */
export async function loadAssetRegistry(base = "/assets/metadata/") {
  if (registry.size > 0) return;
  const names = (await (await fetch(`${base}index.json`)).json()) as string[];
  const metas = await Promise.all(names.map(async (n) => (await (await fetch(base + n)).json()) as AssetMeta));
  for (const m of metas) {
    const k = textureKeyOf(m.file);
    registry.set(k, m);
    if (m.contentId && ["items", "equipment", "sigils"].includes(m.contentGroup ?? "")) byContent.set(m.contentId, k);
  }
}
export const assetMeta = (k: string) => registry.get(k);
/** Texture key of an item, piece of gear or Sigil's icon, if Codex drew one. */
export const contentIconKey = (contentId: string) => byContent.get(contentId);

/** Players who ask for less motion get each asset's static frame (R2_HANDOFF §4). */
export const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const key = (name: string) => `ui_${name}`;
/** Public URL of one kit image, for HTML windows that skin themselves with the same art. */
export const uiAssetUrl = (name: string) => `/assets/sprites/ui/ui_${name}_${V}.png`;
/** Texture keys, for scenes that place a kit image themselves. */
export const uiKey = {
  button: (k: ButtonKind) => key(`button_${k}`),
  command: (k: CommandIcon) => key(`command_${k}`),
  menu: (k: string) => key(`menu_${k}`),
  slot: (size: 48 | 64, r: Rarity) => key(`slot_${size}_${r}`),
  bar: (k: BarKind | "track", h: BarHeight) => key(`bar_${k}_h${h}`),
  window: (part: "background" | "frame" | "title") => key(`window_${part}`),
  lock: key("badge_lock"),
  status: (id: string) => key(`status_${id}`),
  element: (e: string, loop = false) => key(`element_${e.toLowerCase()}${loop ? "_loop" : ""}`),
  hit: (e: string) => key(`hit_${e.toLowerCase()}`),
  heal: key("heal_burst"),
  number: (kind: "damage" | "crit" | "heal" | "shield", ch: string) => key(`number_${kind}_${ch === "+" ? "plus" : ch === "-" ? "minus" : ch}`),
  popup: (k: "critical" | "dodge" | "miss") => key(`popup_${k}`),
  target: (k: "selected" | "turn_ally" | "turn_enemy", part: "back" | "front") => key(`target_${k}_${part}`),
  arrow: key("target_arrow"),
  ready: (k: "ascend" | "skill") => key(`ready_${k}`),
  ascendFull: (h: BarHeight) => key(`bar_ascend_full_h${h}`),
  classIcon: (id: string) => key(`class_${id.replace(/^class:/, "")}`),
  race: (id: string) => key(`race_${id.replace(/^race:/, "")}`),
  title: (part: "scene" | "sparkles") => key(`title_${part}`),
};

/** Loads every registered asset: sheets with more than one frame as spritesheets, the rest as images. */
export function loadUiKit(scene: Phaser.Scene) {
  for (const [k, m] of registry) {
    if (scene.textures.exists(k)) continue;
    if (m.frameCount > 1) scene.load.spritesheet(k, m.file, { frameWidth: m.frameWidth, frameHeight: m.frameHeight });
    else scene.load.image(k, m.file);
  }
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    for (const [k, m] of registry) {
      for (const a of m.animations) {
        const animKey = `${k}#${a.name}`;
        if (scene.anims.exists(animKey) || !scene.textures.exists(k)) continue;
        scene.anims.create({ key: animKey, frames: scene.anims.generateFrameNumbers(k, { frames: a.frames }), frameRate: a.fps, repeat: a.loop ? -1 : 0 });
      }
    }
  });
}

/**
 * A kit sprite at native size, top-left at x, y. Animated assets play their first (or named) clip;
 * with reduced motion, or a static asset, it shows the static frame.
 */
export function uiSprite(scene: Phaser.Scene, x: number, y: number, k: string, anim?: string): Phaser.GameObjects.Sprite {
  const m = registry.get(k);
  const s = scene.add.sprite(x, y, k, m?.staticFrame ?? 0).setOrigin(0, 0);
  const clip = anim === undefined ? m?.animations[0] : m?.animations.find((a) => a.name === anim);
  if (clip !== undefined && !reducedMotion && scene.anims.exists(`${k}#${clip.name}`)) s.play(`${k}#${clip.name}`);
  return s;
}

/**
 * The same asset for an HTML window: a span the size of one frame. Animated sheets step through their
 * frames with CSS (`pm-sprite` keyframes in character-ui), static ones show frame 0.
 */
export function htmlSprite(k: string, title?: string): HTMLSpanElement | null {
  const m = registry.get(k);
  if (m === undefined) return null;
  const span = document.createElement("span");
  span.className = "pm-sprite";
  if (title !== undefined) span.title = title;
  span.style.cssText = `width:${m.frameWidth}px;height:${m.frameHeight}px;background-image:url(${m.file})`;
  const clip = m.animations[0];
  if (clip !== undefined && !reducedMotion && m.frameCount > 1) {
    span.style.setProperty("--pm-end", `-${m.frameCount * m.frameWidth}px`);
    span.style.animation = `pm-sprite ${(m.frameCount / clip.fps).toFixed(3)}s steps(${m.frameCount}) ${clip.loop ? "infinite" : "1 forwards"}`;
  }
  return span;
}

/** Window frame, inner background or title strip (corners 16, metadata `nineSlice`); top-left at x, y. */
export function uiPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, part: "frame" | "background" | "title" = "frame") {
  return scene.add.nineslice(x, y, uiKey.window(part), undefined, w, h, 16, 16, 16, 16).setOrigin(0, 0);
}

const TEXT_COLOR: Record<ButtonKind, string> = { normal: "#f4f2fb", selected: "#f4f2fb", primary: "#fff4d6", disabled: "#8a84a8", danger: "#ffe1de" };

/**
 * A 48px-tall kit button (P10 touch height) with a label, and a 24px icon above it when given. Top-left at
 * x, y. `setKind` swaps the frame (selected for a toggle that is on, disabled while it does nothing).
 */
export class UiButton {
  readonly frame: Phaser.GameObjects.NineSlice;
  readonly text: Phaser.GameObjects.Text;
  readonly icon: Phaser.GameObjects.Sprite | null;
  private kind: ButtonKind;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    label: string,
    onClick: () => void,
    opts: { kind?: ButtonKind; icon?: string; h?: number; fontSize?: number; depth?: number; fixed?: boolean } = {},
  ) {
    const h = opts.h ?? 48;
    this.kind = opts.kind ?? "normal";
    this.frame = scene.add
      .nineslice(x, y, uiKey.button(this.kind), undefined, w, h, 16, 16, 16, 16)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    // The press is the button's alone: a map scene's tap-to-walk never sees it.
    this.frame.on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      onClick();
    });
    this.icon = opts.icon === undefined ? null : uiSprite(scene, x + w / 2, y + Math.min(16, h / 2 - 6), opts.icon).setOrigin(0.5);
    const withIcon = this.icon !== null;
    this.text = scene.add
      .text(x + w / 2, withIcon ? y + h - 4 : y + h / 2, label, {
        fontFamily: "sans-serif",
        fontSize: `${opts.fontSize ?? (withIcon ? 11 : 14)}px`,
        color: TEXT_COLOR[this.kind],
        align: "center",
      })
      .setOrigin(0.5, withIcon ? 1 : 0.5);
    if (opts.depth !== undefined) this.setDepth(opts.depth);
    if (opts.fixed === true) for (const o of this.parts()) o.setScrollFactor(0);
  }

  setKind(kind: ButtonKind) {
    if (kind === this.kind) return this;
    this.kind = kind;
    this.frame.setTexture(uiKey.button(kind));
    this.text.setColor(TEXT_COLOR[kind]);
    this.icon?.setAlpha(kind === "disabled" ? 0.45 : 1);
    return this;
  }
  /** Swaps the icon (e.g. a menu icon for its animated "something new" version). */
  setIcon(k: string) {
    const icon = this.icon;
    if (icon === null || icon.texture.key === k) return this;
    icon.stop().setTexture(k, assetMeta(k)?.staticFrame ?? 0);
    const clip = assetMeta(k)?.animations[0];
    if (clip !== undefined && !reducedMotion && icon.scene.anims.exists(`${k}#${clip.name}`)) icon.play(`${k}#${clip.name}`);
    return this;
  }
  setLabel(label: string) {
    this.text.setText(label);
    return this;
  }
  setDepth(d: number) {
    for (const o of this.parts()) o.setDepth(d);
    return this;
  }
  setVisible(v: boolean) {
    for (const o of this.parts()) o.setVisible(v);
    return this;
  }
  destroy() {
    for (const o of this.parts()) o.destroy();
  }
  parts(): (Phaser.GameObjects.NineSlice | Phaser.GameObjects.Text | Phaser.GameObjects.Sprite)[] {
    return this.icon === null ? [this.frame, this.text] : [this.frame, this.icon, this.text];
  }
}

/**
 * A value bar: the shared track and a coloured fill, both 3-sliced (1px caps) to any width. Following the
 * metadata `fillRule`, the fill spans 2 + floor((w - 2) × ratio) px and hides at zero. Left-centre at x, y.
 */
export class UiBar {
  private readonly track: Phaser.GameObjects.NineSlice;
  private readonly fill: Phaser.GameObjects.NineSlice;
  private w: number;
  private shown = true;
  private filled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, kind: BarKind, h: BarHeight = 4) {
    this.w = w;
    this.track = scene.add.nineslice(x, y, uiKey.bar("track", h), undefined, w, h, 1, 1, 0, 0).setOrigin(0, 0.5);
    this.fill = scene.add.nineslice(x, y, uiKey.bar(kind, h), undefined, w, h, 1, 1, 0, 0).setOrigin(0, 0.5);
  }

  set(value: number, max: number) {
    const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
    this.filled = ratio > 0;
    this.fill.setVisible(this.shown && this.filled);
    if (this.filled) this.fill.setSize(2 + Math.floor((this.w - 2) * ratio), this.fill.height);
    return this;
  }
  /** Screen-fixed (HUD) and drawn above the map. */
  fixed(depth: number) {
    for (const o of [this.track, this.fill]) o.setScrollFactor(0).setDepth(depth);
    return this;
  }
  setDepth(d: number) {
    this.track.setDepth(d);
    this.fill.setDepth(d);
    return this;
  }
  destroy() {
    this.track.destroy();
    this.fill.destroy();
  }
  setPosition(x: number, y: number) {
    this.track.setPosition(x, y);
    this.fill.setPosition(x, y);
    return this;
  }
  setVisible(v: boolean) {
    this.shown = v;
    this.track.setVisible(v);
    this.fill.setVisible(v && this.filled);
    return this;
  }
}
