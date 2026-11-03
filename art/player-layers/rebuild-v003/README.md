# Player layers — rebuild v003

3 November 2026. **New visual proof; not yet approved by Nat.** Supersedes the rejected proof 01.

## Delivered

- Human key-colour base v003; hair 01 back/front and face 01 v002.
- Hair 02–04 back/front and faces 02–03 v001.
- 14 clips per layer: six battle clips (including ranged attack), idle/walk in four world directions.
- 168 horizontal PNG sheets, 720 frame slots; fixed 64×64, origin [0.5,1], groundOffset 4.
- 336 composite GIFs: every hair/face combination, every clip, at 1× and 4×. One-shots do not loop; KO holds its last frame.
- 6 skin × 10 hair colour chart using the actual appearance.ts ramps.

Open `preview.html`. `review/styles.png` compares styles; `review/h01-battle-cels.png` through `h04-world-cels.png` show all poses; `review/bare-body.png` shows skin planes without hair/face.

## Source and reproduction

The image-generation tool drew separate pose atlases. `masters/` contains the source images and references; `provenance.json` contains prompts. `adapt_sources.py` extracts the individual source poses, samples each atlas with one constant scale, registers it to the existing head rig, separates layers and maps exact colour keys. It does not rotate a finished bitmap or reuse one head image as the animation. Generated angles are interpretations of the rig, not numerically certified measurements.

The original body/limb poses and weapon attachment contract are retained. Exposed flesh is remapped using material/component masks; clothing retains its original palette. The head, hair and face come from the new pose sources. `source-registration.json` records all registrations; `native-cels.zip` contains all 720 native output frames for direct retouching. Extract here to restore `cels/`; running the adapter also recreates it.

```sh
python art/player-layers/rebuild-v003/adapt_sources.py
python art/player-layers/rebuild-v003/review.py
python art/player-layers/rebuild-v003/qa.py --install
npm run check
```

Python dependencies: Pillow and NumPy. The source extraction cache is optional and ignored. Old v001 body assets and `art/player-layers/build.py` supply the existing body and palette utilities; do not remove them. `draw_cels.py` is now utilities only, not a drawing entry point.

For up-facing views, visible rear hair is placed in the front render layer so the body does not hide hair hanging over the back. Back-layer sheets remain present and transparent. This occlusion adjustment is recorded in ART_HANDOFF §9 and metadata.

## Review and remaining scope

Technical checks are recorded in `qa-report.json`; visual observations in `REVIEW_NOTES.md`. A scan can detect foreign keys by layer but cannot prove semantic anatomy. Browser proof is separate from in-game integration. Hair 05–08, faces 04–06 and the seven other race bases remain pending visual approval of this set. No runtime code changed; no merge or deployment.

Validation: `npm run check` passed: 88 test files / 802 tests, typecheck, client build and Worker dry-run. The host lacked npm on PATH; the installed pnpm ran the official npm@10.9.2 package. No deployment.
