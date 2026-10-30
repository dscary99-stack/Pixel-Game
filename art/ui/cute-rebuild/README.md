# Cute UI rebuild v002 — handoff, 2026-10-31

Rebuild of all 364 assets from v001 and round two on `codex/ui-kit-cute-rebuild`, based on `73d808e`. The user approved a cuter dimensional pixel direction and explicitly included frames, buttons, inventory slots and all round-two work. This package supersedes their old visual style, not the game rules.

## Delivered

364 native PNG sheets, 151 animated clips, 910 source frames. Coverage: all 51 original UI pieces; 48 number sprites and 3 popup words; 7 elemental hits and heal; 7 targeting parts; 70 status icons; 7 static and 7 looping elements; 5 ready/ascend overlays; 21 menu icons and 2 notifications; 9 class and 8 race emblems; all 116 item/equipment/Sigil entries; title illustration and separate sparkle layer. No mandatory IDs remain unbuilt. Optional EPIC/LEGENDARY item shimmer is not included.

## Load contract for Claude

- Read the updated public metadata index. Semantic `assetId` and content IDs are unchanged; file and metadata names advance to `_v002` and `version: 2`. Old v001 files remain available for rollback. Do not construct `_v001` paths in the loader.
- Native frame sizes, frame counts, 16px nine-slice corners, origin `[0,0]`, target split-ring geometry and animation names are preserved. All sheets are horizontal. Use `frameWidth`, `frameHeight`, `columns`, `frameCount` and `animations` from each metadata file.
- Use spritesheet loading for animated entries. `loop:false` hits/popups finish once and should be hidden/released on completion; the review GIF repeats after a blank pause only for inspection. Looping icons/notifications use the declared fps.
- Reduced motion uses frame zero. Title uses the static scene plus the sparkle sheet at the same origin. All art has binary alpha and a shared 128-color palette; do not smooth textures or use fractional display positions.
- Equipment tiers and ward strength use shared illustrated families with color/pip variations. Status icons share motifs, with polarity badges and specific modifiers. Race icons are emblems, not character appearances. Item/Sigil duplicate schema entries intentionally share artwork.
- `status: grid_ready`, `productionApproved: false`: prepared for integration and user review, not a claim that this revision has been approved in the running game. No runtime source was changed and no merge/deploy was performed.

## Review and reproduce

Serve the repository root and open `art/ui/cute-rebuild/review/preview.html`. It includes search, 1x/2x/4x, pause and first-frame mode. `layout-960x540.png` is an assembly proof, not a game screenshot. `overview-01.png` through `overview-13.png` show every small asset; title has its own native proof and composite GIF. Every animated asset has a GIF and every asset has a native strip.

Python 3 + Pillow, from repository root:

```sh
python art/ui/cute-rebuild/build.py
python art/ui/cute-rebuild/proofs.py
python art/ui/cute-rebuild/validate.py
npm run check
```

Run in this order: `proofs.py` creates the final catalog, `validate.py` writes the final QA report. Masters and generation prompts/provenance are bundled in `masters/`; scripts record native adaptation, fixed framing, palette quantization and authored UI motion. `native-basis/` records the initial three-asset proof only; use the final `review/` and `palette.json` for this delivery.

Validation: all 364 asset checks pass; npm check passes (87 test files, 795 tests, typecheck, client build, Worker dry-run). Existing bundle-size, zod annotation and Wrangler environment warnings remain. See `VISUAL_REVIEW.md` for the scope and limits of visual QA.
