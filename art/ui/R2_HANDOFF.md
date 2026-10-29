# UI round 2 — animation contract

Base `2e8a8b8`; branch `codex/ui-kit-r2`. Read together with PROOF.md and metadata.

## Coverage

| Family | PNG files | Native cells | Motion |
|---|---:|---|---|
| Numbers: 0–9,+,− × damage/crit/heal/shield | 48 | 16×24; ink10×14 | 5 frames,10fps,once |
| หลบ / MISS / คริ! | 3 | 39×24 /44×24 /30×24 | 5 frames,10fps,once |
| Element hits + heal | 8 | 32×32 | 6 frames,10fps,once |
| Selected / ally-turn / enemy-turn brackets | 6 | 60×16 | synchronized back/front,6frames,10fps,loop |
| Target arrow | 1 | 60×20 | 6frames,10fps,loop |
| Non-instant status ids | 70 | 16×16 | 4frames,8fps,loop |
| Elements | 14 | 16×16 | 7static +7loop4frames,8fps |
| Ascend-full overlay | 3 | 64×4/6/8 | 6frames,10fps,loop |
| Ready ascend / skill frame | 2 | 56×48 | 6frames,10fps,loop |
| Menu windows | 23 | 24×24 | 21static +mail/quests new4frames,8fps |
| Classes / races | 17 | 32×32 | static |
| Items / equipment / Sigils | 116 | 32×32 | static |
| Login scene + twinkles | 2 | 580×540 | static scene +6frame overlay,8fps |

Total313 files;151 animated clips;859 source cells. No required content ids deferred.
Optional rarity sparkle variants are not included. Faces/HUD portraits and class2/3 are outside this request.

## Loading and playback (Claude)

`apps/client/src/ui-kit.ts` currently uses `load.image` and hardcoded v001 keys. Appending metadata/index.json alone will NOT load these assets. This delivery changes no runtime code.

1. Load each manifest in index.json. `file` is the public URL. New `assetId` uses the stem (`ui_status_stun`); existing v001 colon-separated ids stay unchanged. Use exact strings, not a guessed naming transform. Content-backed entries carry `contentId`; inventory also has `contentGroup`.
2. For frameCount>1, load an untrimmed horizontal spritesheet with frameWidth/frameHeight, zero margin/spacing. Static entries can remain images. Do not load a sheet as one stretched image.
3. Create animations using `animations[].name/frames/fps/loop`; loop=true means repeat indefinitely, false means once. Do not trigger gameplay damage from visual contactFrame; server events remain authoritative.
4. Origin [0,0]. Keep native size. The source frame0 is a readable static fallback when animation is disabled. Effects may be omitted entirely under reduced-motion; retain static status/menu affordances.
5. Once hit/heal: hide/destroy on completion. Popup numbers: hold final cel for the owning popup's lifetime then remove; no gameplay duration is baked into art. Number advance12px, baseline20px relative to the24px cell. Use consistent frame and start time across glyphs in a number; do not animate each glyph with an independent timer.
6. Split target geometry: top/back part at `(actorCenterX-30, actorTop-6)` below actor; front at `(actorCenterX-30, actorBottom-10)` above actor. This encloses variable height without stretching any pixels. Keep both phases synchronized. Arrow at `(actorCenterX-30, actorTop-20)`; place it in a separate indicator channel when top ring overlaps. Source parts are60×16; this is the §11 split alternative requested by the user, not a full-height frame.
7. Ascend sparkle overlays tile/crop horizontally at fixed height over the existing full fill; only show at full gauge. Ready borders sit on56×48 command bounds, under runtime text. Do not nine-slice animated borders.
8. Title scene and sparkles align at [0,0] on580×540. Scene includes working logo PIXEL GAME; overlay stays independent. Concept is reference-only, outside public. Native title artwork is re-authored from integer geometry, not a resized AI bitmap.
9. Status red minus vs teal plus badge encodes harmful/helpful alongside color. Related stat glyphs add up/down chevrons. For identification/accessibility keep game tooltip/name available; 16px symbols cannot replace text descriptions.
10. Inventory medallions are icon art, not rarity frames. Bottom ticks distinguish content tier; refine ward top dots distinguish protection strength p6–p10. They do NOT claim rolled rarity. Use the existing48/64 rarity slot around them. `item:*_sigil` and matching `sigil:*` intentionally share art (the same Sigil as inventory item vs definition), but retain independent files and metadata.

## Proof and reproducibility

All exports use v001 palette, binary alpha, native grid, transparent exterior. Production status remains grid_ready; engine/mobile review is pending.

From repository root, with Node dependencies installed and Python3.10+/Pillow available:

```sh
node node_modules/vite-node/vite-node.mjs art/ui/read-r2-content.ts
python art/ui/build_ui_r2.py
python art/ui/r2_proofs.py
python art/ui/validate_ui_kit.py
python art/ui/validate_ui_r2.py
npm run check
```

Windows Tahoma16 is used only for the three explicitly permitted popup words; the font is not redistributed. The script expects `C:/Windows/Fonts/tahoma.ttf`. Digit/logo glyphs are original bitmap recipes. All other shapes are original code-native motifs extending v001.

The source snapshot `r2-content.json` comes from runtime exports (not a guessed regex list). Refresh it after content changes and regenerate intentionally. A source refresh can change coverage; it is not an automatic migration of prior exports.

Review `r2/overview-01..07.png`, `r2/animation-wall-01..07.png`, every `*_strip.png`, `r2/title-native.png`, `r2/title-loop.gif`, `r2/vfx-playback.gif`, and `r2/preview.html`. GIF VFX montage repeats for inspection; actual VFX metadata is once. Preview page pause shows frame0. Source counts differ from GIF encoded counts if an encoder merges held poses.

Serve repository root with a local static HTTP server and open `/art/ui/r2/preview.html`; paths are repository-relative. Preview is an art review tool, not a replacement for Phaser integration.
