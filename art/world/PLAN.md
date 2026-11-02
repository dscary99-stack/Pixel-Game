# World sprites — production contract, 2026-11-01

Base: claude/project-thread-ektp0t, 582c4d77c1359db7960cc16e7e5a7cb734ac1bf6. Branch codex/world-sprites. User's latest sizes/timings/flip decisions override older proposals. This expands the approved cute UI style to the explicitly requested world art; the old UI-only scope restriction does not apply.

Shared immutable palette: art/ui/cute-rebuild/palette.json. Rounded friendly proportions, upper-left cream light, indigo/lavender shade, warm gold/coral/mint. Masters are design sources; native export uses one declared transform across a pose atlas, never per-frame trim or scale. Final cells are native 64px, boss battle128px, tiles32px, backgrounds960x540; display at1x or integer zoom only.

Mandatory: six species battle states and four world directions; human base and four synchronized weapon layers;14 NPC idle clips; town/field terrain with adjacency data/occlusion and animated portals; three battle backgrounds; shared shadows; actual-map and6v10 proofs; metadata/QA/GIFs/docs. Extra seven player races are optional after mandatory delivery.

Motion: idle4@6fps loop (667ms, explicit idle timing takes precedence over approximate600ms action limit); walk4@8fps loop; attack6@10fps once with hitFrame3 (zero-based); cast6@10fps once with castFrame3; hurt2@8fps once; ko4@8fps once hold last. Battle always faces right, allowedFlip.x=true. World directions are authored separately, no automatic world flips. Element identity uses game-side VFX/badge, no recolored species copies.

Pose plan: idle planted contacts + breathing/blink, walk alternate contacts/passing with real limb/wing/foot deformation; attack neutral→compress→windup→contact→followthrough→settle; cast neutral→gather→raise→release→lower→settle; hurt recoil→recover; ko stagger→fold→fall→rest. Crab claws pivot with pincers opening; fox paws and tail articulate; snail foot ripples and eyestalks extend; mole arms and pack follow through; bird wing joints and bell swing; boss claws have a separately addressable layer if coherent separation passes QA.

World root: bottom center, groundOffset4px; normal battle same. Boss groundOffset8px. Hit/cast landmarks use native frame coordinates and remain tied to the root. Flight uses the same virtual ground. No source-game code edits. Boss128px cannot occupy a76px row without overlap: include a separate reserved-slot boss composition and document the integration constraint, without silently scaling it down.

Production status: mandatory export complete; native QA and npm check pass. Contact sheets and scene proofs visually reviewed. Export metadata uses grid_ready, not an assertion of engine integration or user style approval. Source/prompt provenance and final review live here, outside public. Final coverage and optional omissions: PROOF.md; renderer contract: HANDOFF.md.
