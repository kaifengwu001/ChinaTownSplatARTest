import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { DEFAULTS } from "./config.js";
import { loadSplatScene, placeSplatScene } from "./splat-scene.js";
import { attachEffects, readEnabledEffects } from "./splat-effects.js";
import { createMatte } from "./window-rig.js";
import { createAnchor } from "./ar/placement.js";
import { createMemoryWindow } from "./memory-window.js";
import { readMemorySettings } from "./memory-settings.js";
import { SPLAT_ASSETS } from "./scene-assets.js";
import { createMemoryFlowControls } from "./memory-flow-controls.js";
import { createArTuning } from "./ar/tuning.js";
import { screenTangents } from "./photographer.js";
import { createMemoryCards } from "./memory-cards.js";
import { PEOPLE } from "./memory-people.js";
import { loadMemoryProps } from "./memory-props.js";

const STAGES = { dormant: "A photograph, waiting", colorizing: "Color ripples across the surface", surface: "The reconstructed photograph", expanding: "The street opens into depth", active: "A window into the memory" };
const ASSETS = SPLAT_ASSETS;
// The memory is placed by a phone 1.5 m above the floor.
const FLOOR_Y = -1.5;
// The review eye is a phone held sideways, which shows about 64° across its
// long side.
const PHONE_FOV = 64;

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
  const walk = document.getElementById("walk");
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
    hint: document.getElementById("match-hint"),
    cards: createMemoryCards(document.body, PEOPLE),
    ...await loadMemoryProps(PEOPLE),
    onPhase: (phase) => { document.getElementById("stage").textContent = STAGES[phase]; },
  });
  anchor.visible = true;
  memory.setFloor(FLOOR_Y);
  document.getElementById("stage").textContent = "Preparing effects…";
  document.getElementById("preview-instructions").textContent = "Preparing memory effects…";
  renderer.setSize(window.innerWidth,window.innerHeight,false);
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  await memory.prepare({ renderer, spark, scene, camera,
    beforeSample: (cam,seconds) => updateEffects(memory.effectsCamera(cam),seconds,memory.frame.effects),
  });
  document.getElementById("preview-instructions").textContent = showControls
    ? "Walk forward to the photographer's spot, or tap the photograph."
    : "Tap the photograph to bring the street back to life.";
  // Metres walked from where the memory was placed. Frames are reviewed from
  // the photographer's spot, the walk's end.
  walk.max = settings.walkDistance+0.5;
  walk.value = params.has("walk") ? Number(params.get("walk")) : params.has("t") ? settings.walkDistance : 0;
  const flowControls = showControls ? createMemoryFlowControls(memory,settings,() => { frozenFxTime = null; }) : null;
  const arTuning = params.get("arControls") === "1" ? createArTuning(memory,anchor) : null;
  const floor = new THREE.GridHelper(10,40,0x405553,0x283b39);
  floor.position.y = FLOOR_Y;
  floor.renderOrder = -2;
  floor.material.depthWrite = false;
  scene.add(floor);
  timeline.max = memory.duration;
  for (const control of [timeline, viewpoint, walk, replay, depthStretch, parallaxGain, flatEffects]) control.disabled = false;
  depthStretch.addEventListener("input", () => memory.setDepthStretch(Number(depthStretch.value)));
  parallaxGain.addEventListener("input", () => memory.setParallaxGain(Number(parallaxGain.value)));
  flatEffects.addEventListener("input", () => memory.setFlatEffectStrength(Number(flatEffects.value)));
  replay.addEventListener("click", () => {
    memory.reset();
    viewpoint.value = "0";
  });
  timeline.addEventListener("input", () => memory.seek(Number(timeline.value)));
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
  let framedAspect = 0;
  renderer.setAnimationLoop(() => {
    // A phone at the photographer's eye height, level and facing the
    // photograph, walked forward from the placement and glancing sideways.
    const { walkDistance } = memory.getSettings();
    walk.max = walkDistance+0.5;
    camera.position.set(Number(viewpoint.value), FLOOR_Y+memory.layout.eyeHeight, -Number(walk.value));
    const tangent = Math.tan(THREE.MathUtils.degToRad(PHONE_FOV/2));
    const fov = THREE.MathUtils.radToDeg(2*Math.atan(camera.aspect >= 1 ? tangent/camera.aspect : tangent));
    if (camera.fov !== fov || camera.aspect !== framedAspect) {
      camera.fov = fov;
      framedAspect = camera.aspect;
      camera.updateProjectionMatrix();
      // The matched photograph covers its share of this screen.
      memory.setScreen(screenTangents(camera.projectionMatrix.elements));
    }
    const now = performance.now() / 1000;
    flowControls?.update(now);
    arTuning?.update(now);
    const frame = memory.update(camera, canvas, now);
    if (frame.phase !== "dormant") updateEffects(memory.effectsCamera(camera), frozenFxTime ?? now, frame.effects);
    timeline.value = Math.min(frame.seconds, memory.duration);
    time.textContent = `${Math.min(frame.seconds, memory.duration).toFixed(1)}s`;
    document.getElementById("walk-value").textContent = `${Number(walk.value).toFixed(2)} m`;
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
