/**
 * The UI kit Codex drew for the GUI draft (ART_HANDOFF §11, art/ui/PROOF.md): 9-slice window and button
 * frames, rarity slots, value bars and 24px icons under /assets/sprites/ui/. Scenes call `loadUiKit` in
 * `preload` (Phaser keeps textures game-wide, so a second scene's load is a no-op) and build widgets with
 * the helpers below. Corner sizes come from the per-asset metadata in /assets/metadata/.
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

const key = (name: string) => `ui_${name}`;
/** Public URL of one kit image, for HTML windows that skin themselves with the same art. */
export const uiAssetUrl = (name: string) => `/assets/sprites/ui/ui_${name}_${V}.png`;
/** Texture keys, for scenes that place a kit image themselves. */
export const uiKey = {
  button: (k: ButtonKind) => key(`button_${k}`),
  command: (k: CommandIcon) => key(`command_${k}`),
  menu: (k: MenuIcon) => key(`menu_${k}`),
  slot: (size: 48 | 64, r: Rarity) => key(`slot_${size}_${r}`),
  bar: (k: BarKind | "track", h: BarHeight) => key(`bar_${k}_h${h}`),
  window: (part: "background" | "frame" | "title") => key(`window_${part}`),
  lock: key("badge_lock"),
};

export function loadUiKit(scene: Phaser.Scene) {
  const add = (name: string) => {
    if (!scene.textures.exists(key(name))) scene.load.image(key(name), uiAssetUrl(name));
  };
  for (const b of BUTTONS) add(`button_${b}`);
  for (const c of COMMANDS) add(`command_${c}`);
  for (const m of MENUS) add(`menu_${m}`);
  for (const s of [48, 64]) for (const r of RARITIES) add(`slot_${s}_${r}`);
  for (const b of BARS) for (const h of BAR_HEIGHTS) add(`bar_${b}_h${h}`);
  for (const w of ["background", "frame", "title"]) add(`window_${w}`);
  add("badge_lock");
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
  readonly icon: Phaser.GameObjects.Image | null;
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
    this.icon = opts.icon === undefined ? null : scene.add.image(x + w / 2, y + Math.min(16, h / 2 - 6), opts.icon).setOrigin(0.5);
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
  parts(): (Phaser.GameObjects.NineSlice | Phaser.GameObjects.Text | Phaser.GameObjects.Image)[] {
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
