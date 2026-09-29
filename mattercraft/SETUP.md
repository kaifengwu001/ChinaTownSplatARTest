# Parallax window in Mattercraft

The same experience as the 8th Wall build, rebuilt in ZapWorks Mattercraft:
Zappar world tracking (ARKit through an App Clip on iOS) instead of 8th Wall
SLAM, and Mattercraft's Spark-based `GaussianSplat` node instead of our own
Spark setup. `ParallaxWindow.ts` is the only code; everything else is set up
in the editor.

## What you need

- A ZapWorks account with Mattercraft, and a plan that allows publishing.
- The splat asset `public/chop_suey_50.sog` from this project (about 6 MB,
  589,824 splats). It is git-ignored, so it exists only on the machine that
  generated it. `public/chop_suey_25.sog` (about 3 MB) is the lighter option.
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

1. Drag `chop_suey_50.sog` into the Project panel.
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
        GaussianSplat
```

1. **ParallaxWindow.** Right-click `GroundAnchorGroup` and add
   `ParallaxWindow`. Leave its position and rotation at zero, because it
   overwrites them at runtime. Its Window properties default to our current
   values: width 0.4, height 0.4, distance 1.28.
2. **SceneOffset.** Right-click `ParallaxWindow`, add a **Group** and name it
   `SceneOffset`. Set its position to **X 0, Y −1.4, Z −1.12**. These are the
   scene offset Y and scene push-back values.
3. **GaussianSplat.** Right-click `SceneOffset` and add a **GaussianSplat**,
   then set:
   - **Source:** `chop_suey_50.sog`
   - **Rotation X:** 11.56° (0.2018 in radians). This is the scene pitch.
     Leave Y and Z at 0, and do **not** add a 180° flip: the node already turns
     the capture the right way up.
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
- the street scene behind it, framed the way the desktop preview frames it.

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

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Tapping does nothing | Raycastable is on for the splat, or some other raycastable object covers the screen. |
| Window tilted, jumping, or at floor height | `ParallaxWindow` is inside a `WorldPlacementGroup`, or its own position or rotation is not zero. |
| Splat visible outside the window | The scene is poking in front of the window plane. Push-back plus the scene's nearest content (about 1.5 m × scale) must exceed the window distance. |
| Splat upside down | An extra 180° X rotation was added. The node already applies it. |
| Window the wrong physical size | The experience is running in the browser rather than an App Clip, so tracking isn't in true metres. |
| Splat never appears, or a load error | three.js is outside 0.180–0.184; see step 2. |
| Low frame rate | Switch Source to `chop_suey_25.sog`. |
