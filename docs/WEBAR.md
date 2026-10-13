# WebAR parallax window

The GitHub repository contains three implementations of a photograph reconstructed with Apple's SHARP: native iOS (`ios/`, ARKit and MetalSplatter), Mattercraft (`mattercraft/`, Zappar and Spark), and WebAR (`src/ar/`, 8th Wall, Three.js, and Spark). WebAR is the development target. Mattercraft's multiple-window placement is separate from the single-window WebAR experience; the sweep-band and periphery effects are shared through its shader graph files.

## Run and review

Run `npm install` if needed, then `npm run dev`. Vite serves HTTPS on port 5174 for phone camera and motion access. The engine copy step runs automatically and preserves the bundled 8th Wall engine and license.

- `/ar.html`: phone experience. Start AR, allow camera/motion, move slowly until tracking is normal, then point at and tap the floor to place the photograph. Only horizontal tracked/estimated surface hits below the phone are accepted; feature points and tilted surfaces are rejected. Tap the photograph or **tap to activate memory** below it. Reset clears the placement and restores the original for the next placement.
- `/memory.html`: camera-free preview of the **same** activation controller and splat modifier. Tap to play; use the timeline to inspect stages and the sideways slider to compare parallax. Replay restores the dormant photograph.
- `/index.html`: existing camera/framing tuning preview.

AR and memory preview accept `?splats=full|50|25` (default `50`) and `?fx=none|band|periphery|band,periphery`. AR also accepts `?dpr=1`. Memory preview accepts `?t=1.15` to freeze a stage on load and `?fxTime=3` to freeze the ambient sweep phase for comparisons.

Both pages accept `?depthStretch=2&parallaxGain=2`. Depth stretch ranges from 0.5 to 4; parallax strength ranges from 1 to 4. The memory preview also provides live sliders for both. Defaults are 2× each. Depth stretch doubles the distance behind the window plane while preserving the central composition; parallax strength exaggerates lateral/vertical viewer movement about that plane. Larger gains consume SHARP's limited viewing baseline faster, so its reconstruction quality still limits extreme viewpoints.

`?flatEffectStrength=0.25` scales dreamlike effect changes during the flat stage (range 0–1, default 25%). The **Flat dream effects** slider provides the same live control: 0% disables the flat-stage modulation and 100% reproduces the previous full-strength behavior. Size growth/shrinkage, brightness boost, and opacity reduction are interpolated from their neutral values, so reducing strength does not shrink or darken the base image. The gain smoothly reaches 100% as depth opens; the final 3D effect tuning is unaffected.

## Memory activation

`input/memory-original.jpg` is the supplied black-and-white photograph, copied without modification. Vite bundles it as a hashed asset. Replace that file to change the original.

`input/chop_suey.jpg` is the color photograph used for the SOG reconstruction. `colorPhotoUrl` selects it for the activation surface and particle spray. Each particle carries its originating pixel's color while its motion varies. The surface's chromatic refraction samples neighboring RGB channels from this image, and the splats retain their own reconstruction colors. There is no generated pink/cyan palette. Update this color asset when changing the reconstruction.

The stages are controlled by `src/memory-settings.js`:

1. **Dormant:** full photograph at 0.2 m wide (half the previous width), preserving its proportions, with an instruction projected below the anchored image. The splat scene is hidden. The image and portal share a center 0.5 m above the selected floor.
2. **Color (2.7 s):** a wide, irregular circular wave travels from the center in physical coordinates, independent of photo aspect. The photograph refracts and dissolves through its own restored colors; a 15,000-particle spray curls around the crest. The actual colored splats are revealed on a thin sheet behind the window. Ambient sweep/periphery effects begin with the first colored region at the configurable flat-stage strength.
3. **Surface hold (0.35 s):** the colored reconstruction stays flat before opening.
4. **Depth (3.1 s):** a quintic minimum-jerk curve starts slowly, accelerates, and slows to a stop. The aperture grows to **0.6 m wide × 1.0 m tall**, with its bottom exactly at the selected floor height. Splats move into the scene with configurable depth stretch and exaggerated parallax. Their inverse depth and image rays interpolate with the same eased progress as the aperture, so perceived depth develops gradually alongside the opening.

The GPU modifier changes uniforms during activation instead of uploading new splat buffers each frame. It transforms covariance with the spatial mapping's Jacobian, preserving each Gaussian's projected footprint instead of separately mixing thin scales and orientations. This fixes gaps during expansion; a small temporary overlap reserve also protects the decimated samples. Spark's covariance renderer and extended precision retain the resulting shapes and positions. This uses more GPU memory than the checkpoint's packed renderer, so mobile performance needs verification. The photo, splats, and particle spray share the same wave. Aperture growth scales the existing matte instead of rebuilding geometry each frame.

The desktop preview includes a floor grid and widens its review camera as the portal opens to keep the larger result visible. Its camera framing uses the same current frame as the geometry. The phone retains 8th Wall's calibrated projection. Ambient effects compensate for the floor shift so their sharp center follows the memory when the phone points down.

Depth uses `1 / mix(1 / sheetDepth, 1 / targetDepth, growth)` during expansion. Interpolating metres had made distant background splats reach most of their visible parallax change while the aperture had barely grown. The new mapping interpolates the perspective quantity that controls apparent depth; its analytic derivative also drives the covariance transformation, keeping splat footprints coordinated with their centers. The flat shell and fully expanded scene retain their exact endpoint mappings. For example, a background splat going from about 1.41 m to 1,330 m at 3.6× stretch now sits at about 1.41 m at 3.2 s and 1.44 m at 3.5 s, rather than jumping to 2.81 m and 33.73 m. Its inverse-depth progression now equals the aperture's eased progression.

Flattening every splat onto exactly the same depth destroys its foreground/background blend order. Spark sorts by distance to the viewer; a coplanar image therefore becomes smeared even with `fx=none`, then abruptly sharpens as the first depth movement restores ordering. The flat stage now uses a shallow camera-centered shell: each splat stays on the viewing ray through its anchored photograph pixel, while its hidden distance increases with its original capture distance. The covariance follows the same mapping, so its projected footprint is preserved. This retains the capture's blend order while the image looks flat, then smoothly interpolates to the existing 3D mapping. The fully expanded geometry is unchanged. The flat-stage gain separately controls the actual sweep/periphery modulation.

`captureAspect` and `captureFocalRatio` describe **the color photograph that produced the SOG**, not the original. Current values match `input/chop_suey.jpg` at 1024×678 and SHARP's assumed 30mm focal length. Update them if the reconstruction changes. The final portal retains the framing in `src/config.js`, so it looks into a closer crop than the starting full photograph.

## Build and delivery

`npm run build` produces `dist/`, including the AR page, both previews, original photograph, and unmodified 8th Wall engine. SOG files under `public/` are currently ignored by Git and must also be available in the deployment environment. This feature uses the existing SOG assets; it does not regenerate them.

Desktop browser verification covers the shader compilation, all activation stages, tap hit testing, sideways viewing, reset/replay, and a 390×844 viewport. Actual mobile camera tracking, Safari rendering, and frame rate require a device check. GitHub sync and Vercel publication require the user's terminal login before those actions.

To check the flat/depth boundary, load `/memory.html?t=3&fxTime=3&flatEffectStrength=0.25` and scrub between 3.0 and 3.2 s. Also compare 3.05 and 3.06 s, immediately around expansion's start. Repeat with `&fx=none` to isolate splat ordering from ambient effects and use the sideways slider to check that the flat image stays anchored when the viewing direction changes.
