# WebAR parallax window

The GitHub repository contains three implementations of a photograph reconstructed with Apple's SHARP: native iOS (`ios/`, ARKit and MetalSplatter), Mattercraft (`mattercraft/`, Zappar and Spark), and WebAR (`src/ar/`, 8th Wall, Three.js, and Spark). WebAR is the development target. Mattercraft's multiple-window placement is separate from the single-window WebAR experience; the sweep-band and periphery effects are shared through its shader graph files.

## Run and review

Run `npm install` if needed, then `npm run dev`. Vite serves HTTPS on port 5174 for phone camera and motion access. The engine copy step runs automatically and preserves the bundled 8th Wall engine and license.

- `/ar.html`: phone experience. Start AR, allow camera/motion, move slowly until tracking is normal, then point at and tap the floor to place the photograph. Only horizontal tracked/estimated surface hits below the phone are accepted; feature points and tilted surfaces are rejected. Tap the photograph or **tap to activate memory** below it. Reset clears the placement and restores the original for the next placement.
- `/memory.html`: camera-free preview of the **same** activation controller and splat modifier. Tap to play; use the timeline to inspect stages and the sideways slider to compare parallax. Replay restores the dormant photograph.
- `/index.html`: existing camera/framing tuning preview.

AR and memory preview accept `?splats=full|50|25` (default `50`) and `?fx=none|band|periphery|band,periphery`. AR also accepts `?dpr=1`. Memory preview accepts `?t=1.15` to freeze a stage on load.

Both pages accept `?depthStretch=2&parallaxGain=2`. Depth stretch ranges from 0.5 to 4; parallax strength ranges from 1 to 4. The memory preview also provides live sliders for both. Defaults are 2× each. Depth stretch doubles the distance behind the window plane while preserving the central composition; parallax strength exaggerates lateral/vertical viewer movement about that plane. Larger gains consume SHARP's limited viewing baseline faster, so its reconstruction quality still limits extreme viewpoints.

## Memory activation

`input/memory-original.jpg` is the supplied black-and-white photograph, copied without modification. Vite bundles it as a hashed asset. Replace that file to change the original.

The stages are controlled by `src/memory-settings.js`:

1. **Dormant:** full photograph at 0.2 m wide (half the previous width), preserving its proportions, with an instruction projected below the anchored image. The splat scene is hidden. The image and portal share a center 0.5 m above the selected floor.
2. **Color (2.7 s):** a wide, irregular circular wave travels from the center in physical coordinates, independent of photo aspect. The photograph refracts and dissolves through cyan, pink, violet, and pearl grain; a 15,000-particle spray curls around the crest. The actual colored splats are revealed on a thin sheet behind the window. Ambient sweep/periphery effects begin with the first colored region and reach full strength during colorization.
3. **Surface hold (0.35 s):** the colored reconstruction stays flat before opening.
4. **Depth (3.1 s):** a quintic minimum-jerk curve starts slowly, accelerates, and slows to a stop. The aperture grows to **0.6 m wide × 1.0 m tall**, with its bottom exactly at the selected floor height. Splats move into the scene with configurable depth stretch and exaggerated parallax.

The GPU modifier changes uniforms during activation instead of uploading new splat buffers each frame. It transforms covariance with the spatial mapping's Jacobian, preserving each Gaussian's projected footprint instead of separately mixing thin scales and orientations. This fixes gaps during expansion; a small temporary overlap reserve also protects the decimated samples. Spark's covariance renderer and extended precision retain the resulting shapes and positions. This uses more GPU memory than the checkpoint's packed renderer, so mobile performance needs verification. The photo, splats, and particle spray share the same wave. Aperture growth scales the existing matte instead of rebuilding geometry each frame.

The desktop preview includes a floor grid and widens its review camera as the portal opens to keep the larger result visible. The phone retains 8th Wall's calibrated projection. Ambient effects compensate for the floor shift so their sharp center follows the memory when the phone points down.

`captureAspect` and `captureFocalRatio` describe **the color photograph that produced the SOG**, not the original. Current values match `input/chop_suey.jpg` at 1024×678 and SHARP's assumed 30mm focal length. Update them if the reconstruction changes. The final portal retains the framing in `src/config.js`, so it looks into a closer crop than the starting full photograph.

## Build and delivery

`npm run build` produces `dist/`, including the AR page, both previews, original photograph, and unmodified 8th Wall engine. SOG files under `public/` are currently ignored by Git and must also be available in the deployment environment. This feature uses the existing SOG assets; it does not regenerate them.

Desktop browser verification covers the shader compilation, all activation stages, tap hit testing, sideways viewing, reset/replay, and a 390×844 viewport. Actual mobile camera tracking, Safari rendering, and frame rate require a device check. GitHub sync and Vercel publication require the user's terminal login before those actions.
