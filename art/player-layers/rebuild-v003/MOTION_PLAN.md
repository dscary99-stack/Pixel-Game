# Rebuild motion plan

Contract: ART_HANDOFF §12 at Claude commit 7214186. Scope: human + hair01–04 + face01–03, 14 clips each.

Use separate generated pose cels for head, hair and face; retain existing body/limb poses and 60 head-rig anchors. The earlier procedural contour experiment was rejected internally and is not the final pipeline. Source extraction uses one scale per atlas; final frames always use the fixed 64×64 canvas. Registration is positioning an independently drawn pose, not making animation by translating one repeated pose.

- Idle: breathing, short blink, loose tips changing with the pose.
- Walk: alternating steps and opposing hair motion, four separately drawn directions.
- Attack: windup, contact at frame 3, overshoot, recovery.
- Ranged attack: draw, release at frame 3, recovery; no sword-pose head reuse.
- Cast: lift, concentration, release and settle.
- Hurt: recoil and squint.
- KO: collapse to the side, closed/cross eyes, final hold.

Hair secondary motion and face angles are visually interpreted by generated source poses. Exact one-frame physical lag and numeric head angles are not machine-certified. Review the native and 4× GIFs before approving aesthetics.
