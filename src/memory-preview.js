import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { DEFAULTS } from "./config.js";
import { loadSplatScene, placeSplatScene } from "./splat-scene.js";
import { attachEffects, readEnabledEffects } from "./splat-effects.js";
import { createMatte } from "./window-rig.js";
import { createAnchor } from "./ar/placement.js";
import { createMemoryWindow } from "./memory-window.js";
import { readMemorySettings } from "./memory-settings.js";
import { createMemoryFlowControls } from "./memory-flow-controls.js";
import { createArTuning } from "./ar/tuning.js";

const STAGES = { dormant: "A photograph, waiting", colorizing: "Color ripples across the surface", surface: "The reconstructed photograph", expanding: "The street opens into depth", active: "A window into the memory" };
const ASSETS = { full: "/chop_suey.sog", 50: "/chop_suey_50.sog", 25: "/chop_suey_25.sog" };

async function main() {
  const params = new URLSearchParams(window.location.search);
  const showControls = params.get("controls") === "1";
  document.getElementById("preview-controls").hidden = !showControls;
  document.getElementById("particle-flow").hidden = !showControls;
  const asset = params.get("splats") ?? "50";
  if (!(asset in ASSETS)) throw new Error(`Unknown ?splats=${asset}`);
  // Hold the ambient sweep at the same phase for visual strength comparisons.
  let frozenFxTime = params.has("fxTime") ? Number(params.get("fxTime")) : null;
  if (frozenFxTime !== null && (!Number.isFinite(frozenFxTime) || frozenFxTime<0)) throw new Error("?fxTime must be a non-negative number of seconds");
  const canvas = document.getElementById("view");
  const timeline = document.getElementById("timeline");
  const time = document.getElementById("time");
  const viewpoint = document.getElementById("viewpoint");
  const replay = document.getElementById("replay");
  const settings = readMemorySettings(window.location.search);
  const depthStretch = document.getElementById("depth-stretch");
  const parallaxGain = document.getElementById("parallax-gain");
  const flatEffects = document.getElementById("flat-effects");
  depthStretch.value = settings.depthStretch;
  parallaxGain.value = settings.parallaxGain;
  flatEffects.value = settings.flatEffectStrength;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const spark = new SparkRenderer({ renderer, covSplats: true, accumExtSplats: true, sortRadial: true });
  scene.add(spark);
  const camera = new THREE.PerspectiveCamera(29, 1, 0.05, 5000);
  const matte = createMatte({ occluder: true });
  const splat = await loadSplatScene(ASSETS[asset], { covSplats: true });
  placeSplatScene(splat, DEFAULTS);
  const updateEffects = attachEffects(splat.mesh, readEnabledEffects(params.get("fx")));
  const anchor = createAnchor(matte, splat.root);
  scene.add(anchor);
  const memory = await createMemoryWindow({
    anchor, splat, matte, config: DEFAULTS, settings,
    button: document.getElementById("activate-memory"),
    onPhase: (phase) => { document.getElementById("stage").textContent = STAGES[phase]; },
  });
  anchor.visible = true;
  memory.setFloor(-1.5);
  document.getElementById("stage").textContent = "Preparing effects…";
  document.getElementById("preview-instructions").textContent = "Preparing memory effects…";
  renderer.setSize(window.innerWidth,window.innerHeight,false);
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  await memory.prepare({ renderer, spark, scene, camera,
    beforeSample: (cam,seconds) => updateEffects(memory.effectsCamera(cam),seconds,memory.frame.effects),
  });
  document.getElementById("preview-instructions").textContent = "Tap the photograph to bring the street back to life.";
  const flowControls = showControls ? createMemoryFlowControls(memory,settings,() => { frozenFxTime = null; }) : null;
  const arTuning = params.get("arControls") === "1" ? createArTuning(memory,anchor) : null;
  const floor = new THREE.GridHelper(10,40,0x405553,0x283b39);
  floor.position.y = -1.5;
  floor.renderOrder = -2;
  floor.material.depthWrite = false;
  scene.add(floor);
  timeline.max = memory.duration;
  for (const control of [timeline, viewpoint, replay, depthStretch, parallaxGain, flatEffects]) control.disabled = false;
  depthStretch.addEventListener("input", () => memory.setDepthStretch(Number(depthStretch.value)));
  parallaxGain.addEventListener("input", () => memory.setParallaxGain(Number(parallaxGain.value)));
  flatEffects.addEventListener("input", () => memory.setFlatEffectStrength(Number(flatEffects.value)));
  replay.addEventListener("click", () => {
    memory.reset();
    viewpoint.value = "0";
  });
  timeline.addEventListener("input", () => memory.seek(Number(timeline.value)));
  document.getElementById("activate-memory").addEventListener("click", () => memory.activate());
  canvas.addEventListener("click", (event) => {
    if (memory.hit(event, camera, canvas)) memory.activate();
  });
  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  let resizeFrame = null;
  new ResizeObserver(() => {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; resize(); });
  }).observe(canvas);
  resize();
  window.addEventListener("error", (event) => showError(event.message));
  window.addEventListener("unhandledrejection", (event) => showError(event.reason?.message ?? String(event.reason)));
  if (params.has("t")) {
    const seconds = Number(params.get("t"));
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("?t must be a non-negative number of seconds");
    memory.seek(seconds);
  }
  renderer.setAnimationLoop(() => {
    camera.position.x = Number(viewpoint.value);
    const now = performance.now() / 1000;
    flowControls?.update(now);
    arTuning?.update(now);
    const frame = memory.update(camera, canvas, now);
    camera.lookAt(0, memory.portalCenterY-0.15, -memory.portalDistance);
    // Only the review camera widens its view as the larger portal opens.
    // The phone AR camera always retains 8th Wall's calibrated projection.
    // Geometry and camera framing use the same frame's progress.
    const growth = frame.growth;
    const apertureWidth = THREE.MathUtils.lerp(memory.dimensions.photoWidth,memory.dimensions.portalWidth,growth);
    const apertureHeight = THREE.MathUtils.lerp(memory.dimensions.photoHeight,memory.dimensions.portalHeight,growth);
    const halfView = Math.max(THREE.MathUtils.lerp(0.36,0.68,growth),apertureHeight/2+0.18,
      THREE.MathUtils.lerp(0.28,0.42,growth)/camera.aspect,(apertureWidth/2+0.08)/camera.aspect);
    const nextFov = THREE.MathUtils.radToDeg(2*Math.atan(halfView/memory.portalDistance));
    if (camera.fov!==nextFov) { camera.fov=nextFov; camera.updateProjectionMatrix(); }
    camera.updateWorldMatrix(true, false);
    memory.updatePrompt(camera, canvas);
    if (frame.phase !== "dormant") updateEffects(memory.effectsCamera(camera), frozenFxTime ?? now, frame.effects);
    timeline.value = Math.min(frame.seconds, memory.duration);
    time.textContent = `${Math.min(frame.seconds, memory.duration).toFixed(1)}s`;
    document.getElementById("depth-value").textContent = `${Number(depthStretch.value).toFixed(1)}×`;
    document.getElementById("parallax-value").textContent = `${Number(parallaxGain.value).toFixed(1)}×`;
    document.getElementById("flat-effects-value").textContent = `${Math.round(Number(flatEffects.value)*100)}%`;
    renderer.render(scene, camera);
    if (arTuning) canvas.dataset.programCount = renderer.info.programs.length;
  });
}

function showError(message) {
  const error = document.getElementById("error");
  error.hidden = false;
  error.textContent = message;
  console.error(message);
}
main().catch((err) => showError(err?.message ?? String(err)));
