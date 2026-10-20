import { DEFAULTS, geometry } from "../config.js";
import { loadSplatScene, placeSplatScene } from "../splat-scene.js";
import { attachEffects, readEnabledEffects } from "../splat-effects.js";
import { createMatte, updateMatte } from "../window-rig.js";
import { createThreeBridge } from "./xr-bridge.js";
import { createWebXrBridge } from "./webxr-bridge.js";
import { TRACKING_CHOICES, chooseTracking } from "./webxr-session.js";
import { createAnchor, anchorPoseFromCamera } from "./placement.js";
import { createHud, trackingPrompt } from "./hud.js";
import { createMemoryWindow } from "../memory-window.js";
import { readMemorySettings } from "../memory-settings.js";
import { createArTuning } from "./tuning.js";

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

  // ?tracking=webxr|xr8 forces a tracker; auto prefers WebXR AR when offered.
  const tracking = params.get("tracking") ?? "auto";
  if (!TRACKING_CHOICES.includes(tracking)) {
    throw new Error(`Unknown ?tracking=${tracking}; use one of ${TRACKING_CHOICES.join(", ")}`);
  }

  return Object.freeze({ assetKey: key, assetUrl: ASSETS[key], dpr, effects, tracking });
}

// 8th Wall engine binary (closed source, limited-use license; see
// /external/xr/LICENSE). It is loaded only when WebXR AR is unavailable, and
// lazy-loads its `slam` chunk relative to its own URL.
function loadXR8() {
  if (window.XR8) return Promise.resolve(window.XR8);
  return new Promise((resolve, reject) => {
    window.addEventListener("xrloaded", () => resolve(window.XR8), { once: true });
    const script = document.createElement("script");
    script.src = "/external/xr/xr.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.preloadChunks = "slam";
    script.addEventListener("error", () => reject(new Error("Could not load the 8th Wall engine")), { once: true });
    document.head.append(script);
  });
}

// The buffer must match the canvas's laid-out size exactly, or the browser
// scales the image to fit and everything comes out stretched.
function sizeCanvas(canvas, dpr) {
  const { width, height } = canvas.getBoundingClientRect();
  const nextWidth = Math.round(width * dpr), nextHeight = Math.round(height * dpr);
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;
}

function formatView({ width, height, cssWidth, cssHeight, aspectError }) {
  return `${width}×${height} on ${cssWidth}×${cssHeight}, aspect ×${aspectError.toFixed(3)}`;
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  // Dev server only: emulate a WebXR AR device so the WebXR path runs on a
  // desktop browser. Vite drops this branch from production builds.
  if (import.meta.env.DEV && params.has("xremu")) {
    const { XRDevice, metaQuest3 } = await import("iwer");
    const device = new XRDevice(metaQuest3);
    device.stereoEnabled = false;
    device.installRuntime({ forceInstall: true });
    window.xrEmulator = device;
  }

  const canvas = document.getElementById("camerafeed");
  const startButton = document.getElementById("start");
  const resetButton = document.getElementById("reset");
  const activateButton = document.getElementById("activate-memory");
  const tapTarget = document.getElementById("ar-tap") ?? canvas;
  const hud = createHud(document.getElementById("hud"), document.getElementById("prompt"), {
    debug: params.get("debug") === "1",
  });

  window.addEventListener("error", (e) => hud.fail(e.message));
  window.addEventListener("unhandledrejection", (e) => hud.fail(e.reason?.message ?? String(e.reason)));

  const options = readOptions(window.location.search);
  const trackingKind = await chooseTracking(options.tracking, navigator.xr);
  document.documentElement.classList.add(`tracking-${trackingKind}`);
  // Start fetching 8th Wall alongside the splats, as the old script tag did.
  const engine = trackingKind === "xr8" ? loadXR8() : null;
  engine?.catch(() => {}); // Reported when Start awaits it.
  const startPrompt = trackingKind === "webxr"
    ? "Tap Start, then allow camera access"
    : "Tap Start, then allow camera and motion access";

  const config = DEFAULTS;
  const matte = createMatte({ occluder: true });
  updateMatte(matte, config);

  hud.set({ asset: options.assetKey, headroom: geometry(config).headroomDeg, tracker: trackingKind });
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
  const tuning = createArTuning(memory,anchor);
  hud.prompt(startPrompt);

  let camera = null;
  let tracking = { status: "", reason: "" };
  let preparationFailed = false;
  let renderContext = null;
  let started = false;
  let tracker = null;

  const place = async () => {
    if (!camera || !memory.ready || tracking.status !== "NORMAL") return;
    const pose = anchorPoseFromCamera(camera);
    anchor.position.copy(pose.position);
    anchor.quaternion.copy(pose.quaternion);
    // The tracker reports the floor in world coordinates (XR8's absolute-scale
    // ground is y=0). Convert it into this camera-height anchor's coordinates;
    // no surface hit is needed at placement.
    memory.setFloor(tracker.groundY() - pose.position.y);
    memory.reset();
    anchor.visible = true;
    resetButton.hidden = false;
    hud.set({ placed: true });
    hud.prompt("Preparing memory…");
    try { await memory.prime(renderContext); hud.prompt(anchor.visible ? "" : trackingPrompt(tracking,false)); }
    catch (err) { preparationFailed = true; hud.fail(err?.message ?? String(err)); }
  };

  const reset = () => {
    tuning.stop();
    anchor.visible = false;
    memory.reset();
    resetButton.hidden = true;
    hud.set({ placed: false });
    hud.prompt(memory.ready ? trackingPrompt(tracking, false) : "Preparing memory…");
  };

  const callbacks = {
    onReady: async ({ renderer, spark, scene, camera: xrCamera }) => {
      camera = xrCamera;
      renderContext = { renderer, spark, scene, camera:xrCamera };
      scene.add(anchor);
      hud.prompt("Preparing memory effects…");
      try {
        await memory.prepare({ renderer, spark, scene, camera:xrCamera,
          beforeSample: (cam,seconds) => updateEffects(memory.effectsCamera(cam),seconds,memory.frame.effects),
        });
      } catch (err) { preparationFailed = true; throw err; }
      tuning.update(performance.now()/1000);
      hud.prompt(started ? trackingPrompt(tracking,false) : startPrompt);
      // WebXR prepares before its session starts; see webxr-bridge.js.
      if (!started) startButton.disabled = false;
    },
    onTracking: (next) => {
      tracking = next;
      hud.set({ tracking: `${next.status}${next.reason ? ` (${next.reason})` : ""}` });
      if (started && !anchor.visible && !preparationFailed) hud.prompt(memory.ready ? trackingPrompt(next, false) : "Preparing memory effects…");
    },
    onBeforeRender: (xrCamera) => {
      const now = performance.now();
      tuning.update(now/1000);
      const frame = memory.update(xrCamera, canvas, now / 1000);
      if (anchor.visible && frame.phase !== "dormant") {
        updateEffects(memory.effectsCamera(xrCamera), (now - effectsStart) / 1000, frame.effects);
      }
    },
    onRendered: () => hud.tick(performance.now()),
    onView: (view) => hud.set({ view: formatView(view) }),
    onError: (err) => hud.fail(err?.message ?? String(err)),
  };

  sizeCanvas(canvas, options.dpr);
  if (trackingKind === "webxr") {
    tracker = createWebXrBridge({
      canvas, overlay: document.getElementById("ar-ui"), dpr: options.dpr, ...callbacks,
      onEnd: () => {
        started = false;
        tracking = { status: "", reason: "" };
        reset();
        hud.set({ tracking: "ended" });
        hud.prompt("AR ended. Tap Start to resume");
        startButton.hidden = false;
        startButton.disabled = false;
      },
    });
  } else {
    const module = createThreeBridge(callbacks);
    tracker = { kind: "xr8", presenting: false, groundY: () => 0, start: () => startXR(canvas, module, hud, engine) };
  }

  let resizeFrame = null;
  new ResizeObserver(() => {
    if (resizeFrame !== null) return;
    // While a WebXR session presents, the session owns the buffer size.
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; if (!tracker.presenting) sizeCanvas(canvas, options.dpr); });
  }).observe(canvas);

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    started = true;
    hud.prompt("Starting camera…");
    try {
      await tracker.start();
      startButton.hidden = true;
      if (memory.ready && !preparationFailed) hud.prompt(trackingPrompt(tracking, false));
    } catch (err) {
      started = false;
      startButton.disabled = false;
      hud.fail(err?.message ?? String(err));
    }
  });
  // 8th Wall prepares after its camera starts; WebXR enables Start once ready.
  startButton.disabled = trackingKind === "webxr";

  resetButton.addEventListener("click", reset);
  activateButton.addEventListener("click", () => memory.activate());
  const onTap = (event) => {
    if (!anchor.visible) place();
    else if (camera && memory.hit(event, camera, canvas)) memory.activate();
  };
  // The tap layer covers the canvas, but a WebXR host may raise the canvas
  // above the page while it presents; a tap reaches only one of them.
  for (const target of new Set([tapTarget, canvas])) target.addEventListener("click", onTap);
}

async function startXR(canvas, bridge, hud, engine) {
  const XR8 = await engine;

  // Metric scale also estimates camera height above the world ground (y=0).
  // Placement waits for NORMAL tracking, when this scale has been calibrated.
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
