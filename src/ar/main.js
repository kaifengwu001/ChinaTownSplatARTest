import { DEFAULTS, geometry } from "../config.js";
import { loadSplatScene, placeSplatScene } from "../splat-scene.js";
import { createMatte, updateMatte } from "../window-rig.js";
import { createThreeBridge } from "./xr-bridge.js";
import { createAnchor, anchorPoseFromCamera } from "./placement.js";
import { createHud, trackingPrompt } from "./hud.js";

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

  return Object.freeze({ assetKey: key, assetUrl: ASSETS[key], dpr });
}

function waitForXR8() {
  if (window.XR8) return Promise.resolve(window.XR8);
  return new Promise((resolve) => window.addEventListener("xrloaded", () => resolve(window.XR8), { once: true }));
}

function sizeCanvas(canvas, dpr) {
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

async function main() {
  const canvas = document.getElementById("camerafeed");
  const startButton = document.getElementById("start");
  const resetButton = document.getElementById("reset");
  const hud = createHud(document.getElementById("hud"), document.getElementById("prompt"));

  window.addEventListener("error", (e) => hud.fail(e.message));
  window.addEventListener("unhandledrejection", (e) => hud.fail(e.reason?.message ?? String(e.reason)));

  const options = readOptions(window.location.search);
  const config = DEFAULTS;
  const matte = createMatte({ occluder: true });
  updateMatte(matte, config);

  hud.set({ asset: options.assetKey, headroom: geometry(config).headroomDeg });
  hud.prompt("Loading splats…");

  const splat = await loadSplatScene(options.assetUrl);
  placeSplatScene(splat, config);
  hud.set({ splats: splat.splatCount });

  const anchor = createAnchor(matte, splat.root);
  hud.prompt("Tap Start, then allow camera and motion access");

  let camera = null;
  let tracking = { status: "", reason: "" };

  const place = () => {
    if (!camera || tracking.status !== "NORMAL") return;
    const pose = anchorPoseFromCamera(camera);
    anchor.position.copy(pose.position);
    anchor.quaternion.copy(pose.quaternion);
    anchor.visible = true;
    resetButton.hidden = false;
    hud.set({ placed: true });
    hud.prompt("");
  };

  const reset = () => {
    anchor.visible = false;
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
    onRendered: () => hud.tick(performance.now()),
  });

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    hud.prompt("Starting camera…");
    try {
      await startXR(canvas, options, bridge, hud);
      startButton.hidden = true;
    } catch (err) {
      startButton.disabled = false;
      hud.fail(err?.message ?? String(err));
    }
  });

  resetButton.addEventListener("click", reset);
  canvas.addEventListener("click", () => {
    if (!anchor.visible) place();
  });
}

async function startXR(canvas, options, bridge, hud) {
  const XR8 = await waitForXR8();

  sizeCanvas(canvas, options.dpr);
  window.addEventListener("resize", () => sizeCanvas(canvas, options.dpr));

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
