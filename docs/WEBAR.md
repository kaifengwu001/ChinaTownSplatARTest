# WebAR parallax window

The GitHub repository contains three implementations of a photograph reconstructed with Apple's SHARP: native iOS (`ios/`, ARKit and MetalSplatter), Mattercraft (`mattercraft/`, Zappar and Spark), and WebAR (`src/ar/`, 8th Wall, Three.js, and Spark). WebAR is the development target. Mattercraft's multiple-window placement is separate from the single-window WebAR experience; the sweep-band and periphery effects are shared through its shader graph files.

## Run and review

Run `npm install` if needed, then `npm run dev`. Vite serves HTTPS on port 5174 for phone camera and motion access. The engine copy step runs automatically and preserves the bundled 8th Wall engine and license.

- `/ar.html`: phone experience. Start AR, allow camera/motion, move slowly until tracking is normal, then tap to place the photograph. Tap the photograph or **tap to activate memory** below it. Reset clears the placement and restores the original for the next placement.
- `/memory.html`: camera-free preview of the **same** activation controller and splat modifier. Tap to play; use the timeline to inspect stages and the sideways slider to compare parallax. Replay restores the dormant photograph.
- `/index.html`: existing camera/framing tuning preview.

AR and memory preview accept `?splats=full|50|25` (default `50`) and `?fx=none|band|periphery|band,periphery`. AR also accepts `?dpr=1`. Memory preview accepts `?t=1.15` to freeze a stage on load.

## Memory activation

`input/memory-original.jpg` is the supplied black-and-white photograph, copied without modification. Vite bundles it as a hashed asset. Replace that file to change the original.

The stages are controlled by `src/memory-settings.js`:

1. **Dormant:** full photograph, preserving its proportions, with an instruction projected below the anchored image. The splat scene is hidden.
2. **Color (2.7 s):** a turbulent wave travels from the center. The photograph refracts and dissolves along the crest, revealing the actual colored splats projected onto a thin sheet behind the window. Splats move radially and sideways along the crest and briefly glow.
3. **Surface hold (0.35 s):** the colored reconstruction stays flat before opening.
4. **Depth (3.1 s):** splats return to their existing 3D positions, orientations, and sizes. Projected coordinates and inverse depth are interpolated so far-away content moves smoothly. The aperture grows from the photograph's landscape proportions to the existing 0.4 m square window. Ambient effects fade in near the end.

The GPU modifier changes uniforms during activation instead of uploading new splat buffers each frame. Projected Gaussian covariance preserves the reconstructed photograph's footprints. The image shader and splat modifier share the same wave function so their reveal stays aligned when the viewer moves. Aperture growth scales the existing matte instead of rebuilding geometry each frame.

`captureAspect` and `captureFocalRatio` describe **the color photograph that produced the SOG**, not the original. Current values match `input/chop_suey.jpg` at 1024×678 and SHARP's assumed 30mm focal length. Update them if the reconstruction changes. The final portal retains the framing in `src/config.js`, so it looks into a closer crop than the starting full photograph.

## Build and delivery

`npm run build` produces `dist/`, including the AR page, both previews, original photograph, and unmodified 8th Wall engine. SOG files under `public/` are currently ignored by Git and must also be available in the deployment environment. This feature uses the existing SOG assets; it does not regenerate them.

Desktop browser verification covers the shader compilation, all activation stages, tap hit testing, sideways viewing, reset/replay, and a 390×844 viewport. Actual mobile camera tracking, Safari rendering, and frame rate require a device check. GitHub sync and Vercel publication require the user's terminal login before those actions.
