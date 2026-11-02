# Player layers proof — 2026-11-02

Base 682d3c0. Scope for this review: human v002, hair01 back/front v001, face01 v001. All fourteen clips including ranged attack; other styles/faces/races wait for Nut's review as explicitly requested.

Preserve existing authored body/limb motion and weapon registration. Separate native head components; generated bald-head turnaround supplies hidden scalp, existing short tousled hair supplies hair01. Author face01 expressions on the native grid. Record each frame's head attachment and semantic masks. Future races must use these exact head trajectories, plus one constant headOffset only.

Recolourable pixels use exact contract keys, outside the ordinary cute palette where necessary. Non-key pixels use the unchanged cute v002 palette with all reserved keys excluded. Skin masks cover scalp/ears and exposed hands, hair masks only hair, eyes only iris, trim only scarf/piping. Do not recolour boots/belt as skin or hair. Alpha is binary.

Motion: preserve limb articulation from v001; head/hair/face move together, retain directional views and deliberate KO head tilt; hair cap follows the head while source tufts keep cel variation. Face idle blinks, hurt squints, KO has X eyes. Up-facing face is intentionally transparent. All layers share frame count, fps, origin and offsets; no independent clocks.

Deliver 1x/2x battle and four-direction world composites, GIFs, 6x10 skin/hair contact sheet using appearance.ts ramps, masks, reproducible export, native QA and npm run check. Publish proof branch without merge; this is not approval for the remaining sets.
