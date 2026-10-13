import { DEFAULTS, geometry } from "../config.js";
import { loadSplatScene, placeSplatScene } from "../splat-scene.js";
import { attachEffects, readEnabledEffects } from "../splat-effects.js";
import { createMatte, updateMatte } from "../window-rig.js";
import { createThreeBridge } from "./xr-bridge.js";
import { createAnchor, anchorPoseFromCamera, floorFromHits } from "./placement.js";
import { createHud, trackingPrompt } from "./hud.js";
import { createMemoryWindow } from "../memory-window.js";
import { readMemorySettings } from "../memory-settings.js";

// Selectable with ?splats=full|50|25. Half the splats is the default because
// Spark's sort and 8th Wall's SLAM share the phone's CPU; full is the native
// app's asset for comparison.
const ASSETS = Object.freeze({
  full: "/chop_suey.sog",
  50: "/chop_suey_50.sog",
  25: "/chop_suey_25.sog",
});

function readOptions(search) {
  const params = new URLSearchParams(search);
  const key = params.get("splats") ?? "50";
  if (!(key in ASSETS)) throw new Error(`Unknown ?splats=${key}; use one of ${Object.keys(ASSETS).join(", ")}`);

  const dpr = Number(params.get("dpr") ?? Math.min(window.devicePixelRatio, 2));
  if (!(dpr > 0 && dpr <= 4)) throw new Error(`?dpr must be between 0 and 4, got ${params.get("dpr")}`);

  // ?fx=none turns the dreamlike effects off, for comparison.
  const effects = readEnabledEffects(params.get("fx"));

  return Object.freeze({ assetKey: key, assetUrl: ASSETS[key], dpr, effects });
}

function waitForXR8() {
  if (window.XR8) return Promise.resolve(window.XR8);
  return new Promise((resolve) => window.addEventListener("xrloaded", () => resolve(window.XR8), { once: true }));
}

// The buffer must match the canvas's laid-out size exactly, or the browser
// scales the image to fit and everything comes out stretched.
function sizeCanvas(canvas, dpr) {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
}

function formatView({ width, height, cssWidth, cssHeight, aspectError }) {
  return `${width}×${height} on ${cssWidth}×${cssHeight}, aspect ×${aspectError.toFixed(3)}`;
}

async function main() {
  const canvas = document.getElementById("camerafeed");
  const startButton = document.getElementById("start");
  const resetButton = document.getElementById("reset");
  const activateButton = document.getElementById("activate-memory");
  const hud = createHud(document.getElementById("hud"), document.getElementById("prompt"));

  window.addEventListener("error", (e) => hud.fail(e.message));
  window.addEventListener("unhandledrejection", (e) => hud.fail(e.reason?.message ?? String(e.reason)));

  const options = readOptions(window.location.search);
  const config = DEFAULTS;
  const matte = createMatte({ occluder: true });
  updateMatte(matte, config);

  hud.set({ asset: options.assetKey, headroom: geometry(config).headroomDeg });
  hud.prompt("Loading splats…");

  const splat = await loadSplatScene(options.assetUrl, { covSplats: true });
  placeSplatScene(splat, config);
  hud.set({ splats: splat.splatCount });
  const updateEffects = attachEffects(splat.mesh, options.effects);
  const effectsStart = performance.now();

  const anchor = createAnchor(matte, splat.root);
  hud.prompt("Loading original photograph…");
  const memory = await createMemoryWindow({
    anchor, splat, matte, config, button: activateButton, settings: readMemorySettings(window.location.search),
    onPhase: (phase) => hud.set({ memory: phase }),
  });
  hud.prompt("Tap Start, then allow camera and motion access");

  let camera = null;
  let tracking = { status: "", reason: "" };

  const place = (event) => {
    if (!camera || tracking.status !== "NORMAL") return;
    const rect = canvas.getBoundingClientRect();
    const hits = window.XR8.XrController.hitTest((event.clientX-rect.left)/rect.width,
      (event.clientY-rect.top)/rect.height, ["DETECTED_SURFACE","ESTIMATED_SURFACE"]);
    const floor = floorFromHits(hits,camera.position.y);
    if (!floor) {
      hud.prompt("Point at the floor, move slowly, then tap the floor to place the memory");
      return;
    }
    const pose = anchorPoseFromCamera(camera);
    anchor.position.copy(pose.position);
    anchor.quaternion.copy(pose.quaternion);
    memory.setFloor(floor.position.y-pose.position.y);
    memory.reset();
    anchor.visible = true;
    resetButton.hidden = false;
    hud.set({ placed: true });
    hud.prompt("");
  };

  const reset = () => {
    anchor.visible = false;
    memory.reset();
    resetButton.hidden = true;
    hud.set({ placed: false });
    hud.prompt(trackingPrompt(tracking, false));
  };

  const bridge = createThreeBridge({
    onReady: ({ scene, camera: xrCamera }) => {
      camera = xrCamera;
      scene.add(anchor);
    },
    onTracking: (next) => {
      tracking = next;
      hud.set({ tracking: `${next.status}${next.reason ? ` (${next.reason})` : ""}` });
      if (!anchor.visible) hud.prompt(trackingPrompt(next, false));
    },
    onBeforeRender: (xrCamera) => {
      const now = performance.now();
      const frame = memory.update(xrCamera, canvas, now / 1000);
      if (anchor.visible && frame.phase !== "dormant") {
        updateEffects(memory.effectsCamera(xrCamera), (now - effectsStart) / 1000, frame.effects);
      }
    },
    onRendered: () => hud.tick(performance.now()),
    onView: (view) => hud.set({ view: formatView(view) }),
  });

  sizeCanvas(canvas, options.dpr);
  new ResizeObserver(() => sizeCanvas(canvas, options.dpr)).observe(canvas);

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    hud.prompt("Starting camera…");
    try {
      await startXR(canvas, bridge, hud);
      startButton.hidden = true;
    } catch (err) {
      startButton.disabled = false;
      hud.fail(err?.message ?? String(err));
    }
  });

  resetButton.addEventListener("click", reset);
  activateButton.addEventListener("click", () => memory.activate());
  canvas.addEventListener("click", (event) => {
    if (!anchor.visible) place(event);
    else if (camera && memory.hit(event, camera, canvas)) memory.activate();
  });
}

async function startXR(canvas, bridge, hud) {
  const XR8 = await waitForXR8();

  // Metric scale is essential: the window is meant to be 1.7m, not "1.7 units
  // of whatever the first frame's baseline happened to be".
  XR8.XrController.configure({ scale: "absolute" });

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(), // camera feed
    XR8.XrController.pipelineModule(), // SLAM
    bridge, // must follow the feed so splats draw over it
    {
      name: "parallax-errors",
      onException: (err) => hud.fail(err?.message ?? String(err)),
      onCameraStatusChange: ({ status }) => {
        if (status === "failed") hud.fail("Camera access failed. Check Safari's camera permission for this site.");
      },
    },
  ]);

  XR8.run({ canvas, webgl2: true, allowedDevices: XR8.XrConfig.device().ANY });
}

main().catch((err) => {
  console.error(err);
  const prompt = document.getElementById("prompt");
  prompt.textContent = `Error: ${err?.message ?? err}`;
});
