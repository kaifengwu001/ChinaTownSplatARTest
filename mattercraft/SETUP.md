# Parallax window in Mattercraft

The same experience as the 8th Wall build, rebuilt in ZapWorks Mattercraft:
Zappar world tracking (ARKit through an App Clip on iOS) instead of 8th Wall
SLAM, and Mattercraft's Spark-based `GaussianSplat` node instead of our own
Spark setup. `ParallaxWindow.ts` is the only code; everything else is set up
in the editor.

## What you need

- A ZapWorks account with Mattercraft, and a plan that allows publishing.
- The splat asset `output/mattercraft/chop_suey_50.spz` from this project
  (9 MB, 589,824 splats). `output/mattercraft/chop_suey_25.spz` (4.4 MB,
  294,912 splats) is the lighter option. Both are git-ignored, so they exist
  only on the machine that generated them; `scripts/make_mattercraft_assets.sh`
  regenerates them from the decimated PLYs.
  Releases of the splat component before 1.0.0-alpha.5 do not read `.sog`,
  which is why these are `.spz`.
- `mattercraft/ParallaxWindow.ts` from this folder.
- An iPhone with the Camera app, to scan the preview QR code.

## 1. Create the project

1. In Mattercraft, create a new project from a **World Tracking** template.
   Pick the TypeScript version if you are offered a choice.
2. Open the template's scene (`scene.zcomp`). It contains a `ZapparCamera` and
   a `WorldTracker` with a `GroundAnchorGroup` inside it, a
   `WorldPlacementGroup` inside that, and some sample content.

## 2. Set the dependency versions

Open the **Dependencies Browser** in the left panel.

1. Check the `three` version. The splat package needs three.js
   **0.180 to 0.184**.
2. If the project is on an older three.js, move all of these to their alpha
   releases, which are the ones that support three.js 0.180 and above:
   - `@zcomponent/core`: 2.0.0-alpha
   - `@zcomponent/three`: 2.0.0-alpha
   - `@zcomponent/zappar-three`: 5.0.0-alpha
   - `three`: 0.184.0
3. Add `@zcomponent/three-gaussian-splatting` (1.0.0-alpha.5 or later).

## 3. Enable App Clips

App Clips run Apple's ARKit tracking, which measures the room in real metres.
Without one, the 0.4 m window is not guaranteed to be 0.4 m.

1. Open `mattercraft.json` in the Project panel.
2. If it has no `preferAppClip` entry, add `"preferAppClip": true` to the
   top-level object. This makes the App Clip checkbox appear in the preview
   dialog.

## 4. Add the files

1. Drag `chop_suey_50.spz` into the Project panel.
2. Add the component. Either drag `ParallaxWindow.ts` into the Project panel,
   or click **+** in the Project panel, choose **CustomThreeJSComponent**,
   rename the new file to `ParallaxWindow.ts`, and replace its contents with
   this folder's file.
3. Check the file shows no errors in the code editor.

## 5. Build the scene

Leave `ZapparCamera`, `WorldTracker` and `GroundAnchorGroup` in place. Delete
the `WorldPlacementGroup` and the sample content inside it: `ParallaxWindow`
does its own placement and would fight the placement group over position.

Then build this hierarchy:

```
ZapparCamera
WorldTracker
  GroundAnchorGroup
    ParallaxWindow
      SceneOffset          (a Group)
        ScenePitch         (a Group)
          GaussianSplat
```

1. **ParallaxWindow.** Right-click `GroundAnchorGroup` and add
   `ParallaxWindow`. Leave its position and rotation at zero, because it
   overwrites them at runtime. Its Window properties default to our current
   values: width 0.4, height 0.4, distance 1.28.
2. **SceneOffset.** Right-click `ParallaxWindow`, add a **Group** and name it
   `SceneOffset`. Set its position to **X 0, Y −1.4, Z −1.12**. These are the
   scene offset Y and scene push-back values.
3. **ScenePitch.** Right-click `SceneOffset`, add a **Group** and name it
   `ScenePitch`. Set its rotation to **X 11.56°**, Y 0, Z 0. This is the scene
   pitch, which re-aims the window about the capture point.
4. **GaussianSplat.** Right-click `ScenePitch` and add a **GaussianSplat**,
   then set:
   - **Source:** `chop_suey_50.spz`
   - **Rotation:** **X 180°**, Y 0, Z 0. The node turns every capture over,
     assuming SHARP's upside-down convention, but the `.spz` converter has
     already done that; this half turn cancels the second flip. Without it the
     scene is upside down and behind the viewer. A `.ply` or `.sog` source
     straight from SHARP needs 0 here instead.
     Keep the pitch on `ScenePitch` rather than folding it in here: the editor
     rewrites angles past 180°, and the pitch must be applied after the flip.
   - **Scale:** 0.99 on all three axes, which must stay equal.
   - **Level of Detail:** Off. The default builds a detail tree in the browser
     and keeps it in memory next to the original. Our file is already thinned
     for phones.
   - **Raycastable:** off. Taps that hit the splat would not reach
     `ParallaxWindow`'s tap handler.
   - **View Dependent Color:** Off. SHARP's output has only base colour, so
     this saves shader work for nothing lost.

## 6. Check it in the editor

`ParallaxWindow`'s origin stands for your eye. In the viewport you should see:

- a white outline of the 0.4 m aperture 1.28 m in front of that origin, along
  −Z;
- the street scene upright and further along −Z than the outline, framed the
  way the desktop preview frames it. If the scene is upside down or on the +Z
  side of the origin, recheck Rotation X before previewing on the phone.

The invisible matte is hidden in the editor, so the whole splat is visible
there. On the phone, only the part seen through the window shows.

## 7. Preview on the iPhone

1. Click **Preview**, tick **App Clip**, and scan the QR code with the iPhone
   Camera app.
2. Open the App Clip card and allow camera access.
3. Move the phone slowly until the template's instructions say tracking has
   started.
4. The window hangs 1.28 m in front of you and follows your view. The prompt
   reads "Tap to place the window". Tap to fix it in the room.
5. Walk sideways about half a metre to see the parallax.
6. Tap again at any time to pick the window up and place it somewhere else.

## 8. Publish

Click **Publish**. When it asks about triggers, make sure **App Clips** is
enabled on the trigger, then share its QR code or link.

## 9. Dreamlike effects (optional)

`SplatEffects` runs a small GPU program over every splat each frame, changing
only its size, brightness and opacity. Splats never move, so the depth sort
and the window clipping stay correct. It works with both Spark versions the
splat package has shipped: 0.1 in releases 1.0.0-alpha.1 to .3, and 2 from
alpha.4.

### Add it

1. Drag all three files into the Project panel, in the same folder: they
   import each other by relative path.
   - `SplatEffects.ts`, the component
   - `splatEffectGraph.ts`, the per-splat program
   - `splatEffectUniforms.ts`, the settings and per-frame values
2. If the code editor reports that it can't find `@sparkjsdev/spark`, add it
   in the Dependencies Browser. Use the version the splat package already
   depends on: 0.1.x for splat package alpha.1 to .3, 2.x from alpha.4.
3. Right-click the `GaussianSplat` node and add `SplatEffects`. It must be a
   child of that node, which is how it finds the splats:

   ```
   ScenePitch
     GaussianSplat
       SplatEffects
   ```

The effects also run in the editor viewport, following the editor camera, so
you can tune them there before previewing on the phone.

### The four effects

Only **Sweep band** is on by default. Switching an effect on or off
recompiles the program; every other setting updates live and can be animated
with timelines. Distances are in the capture's own units: this capture's
splats sit about 12 to 490 units from the capture point, with half of them
within 41.

- **Sweep band:** a brighter band travelling from near to far every
  **Band Period** seconds, between **Band Near** (12) and **Band Far** (150).
  Its front (the far, leading side) swells splats and its back (the near,
  trailing side) shrinks them, so a swell rolls outward with a trough behind it.
  - **Band Front Width** and **Band Back Width** set how deep each side is, as
    a fraction of distance (0.25 is about 28%).
  - **Band Front Grow** is the extra size at the front's peak; 1 doubles it.
  - **Band Back Shrink** is the share of size lost at the back's deepest point;
    1 shrinks splats to nothing.
  - Both sides are back to normal size at the band's centre and outer edges,
    so there's no hard seam between them.
  - **Band Brightness** is the extra brightness across the band, strongest at
    the centre.
- **Soft periphery:** the centre of view stays sharp out to **Sharp Degrees**
  (2°) and blurs to full effect by **Soft Degrees** (8°). At full effect,
  splats grow by **Grow** (1.5, so 2.5 times larger) and their opacity is
  multiplied by **Opacity** (0.35). The window spans about ±9° at 1.28 m, so
  these angles are small on purpose.
- **Fireflies:** a **Fraction** (15%) of the small splats blink brightly at
  their own random rhythm. A splat counts as small when its size divided by
  its distance is under **Size** (0.001, roughly the smallest quarter of this
  capture). **Speed** sets the blink rate and **Brightness** the peak.
- **Dissolve:** drifting patches of the scene shrink to nothing and grow back
  over **Period** seconds (10). **Depth** 1 dissolves all of it at the deepest
  point, **Softness** widens the fade at patch edges, and **Noise Scale** sets
  the patch size (larger means smaller patches).

### Things to know

- **The room shows through.** Behind the scene there is only the camera feed,
  so wherever the periphery or dissolve makes splats translucent, your real
  room shows through the window.
- **Enlarging splats costs frame rate; shrinking and fading are nearly free.**
  Larger splats cover more screen pixels, and filling pixels is what limits
  phones. If the frame rate drops, lower the Grow settings first, then switch
  Source to `chop_suey_25.spz`.
- **Try one effect at a time first.** All four together are very busy.

### Tuning on the desktop

The web project runs the same three files on the desktop. Run `npm run dev`,
accept the self-signed certificate, and open
`https://localhost:5174/effects.html`. It shows the scene through the window
from its sweet spot. URL options:

- `?fx=band,periphery,fireflies,dissolve` chooses effects (default: band);
- `?t=3` freezes time, for comparing stills;
- `?fov=20` zooms in;
- `?splats=25` uses the lighter asset.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Tapping does nothing | Raycastable is on for the splat, or some other raycastable object covers the screen. |
| Window tilted, jumping, or at floor height | `ParallaxWindow` is inside a `WorldPlacementGroup`, or its own position or rotation is not zero. |
| Splat visible outside the window | The scene is poking in front of the window plane. Push-back plus the scene's nearest content (about 1.5 m × scale) must exceed the window distance. |
| Splat upside down, behind the viewer, and not clipped by the window | The GaussianSplat is missing its X 180° for `.spz` sources. The window can only hide splats in front of the viewer. |
| Splat upside down with a `.ply` or `.sog` source | The GaussianSplat has an X 180° it doesn't need; set it to 0. |
| Window the wrong physical size | The experience is running in the browser rather than an App Clip, so tracking isn't in true metres. |
| Splat never appears, or a load error | three.js is outside the splat package's range: 0.175–0.184 for alpha.1 to .3, 0.180–0.184 from alpha.4. See step 2. |
| Low frame rate | Switch Source to `chop_suey_25.spz`. With effects on, lower their Grow settings first. |
| Effects do nothing; console says "no splat mesh found" | `SplatEffects` isn't a child of the `GaussianSplat` node. |
| Console says "Spark rejected the effect program" | The Spark version in the project differs from the splat package's; see section 9, step 2. Send me the full console error. |
