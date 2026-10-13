import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { DEFAULTS } from "./config.js";
import { loadSplatScene, placeSplatScene } from "./splat-scene.js";
import { attachEffects, readEnabledEffects } from "./splat-effects.js";
import { createMatte } from "./window-rig.js";
import { createAnchor } from "./ar/placement.js";
import { createMemoryWindow } from "./memory-window.js";

const STAGES = { dormant: "A photograph, waiting", colorizing: "Color ripples across the surface", surface: "The reconstructed photograph", expanding: "The street opens into depth", active: "A window into the memory" };
const ASSETS = { full: "/chop_suey.sog", 50: "/chop_suey_50.sog", 25: "/chop_suey_25.sog" };

async function main() {
  const params = new URLSearchParams(window.location.search);
  const asset = params.get("splats") ?? "50";
  if (!(asset in ASSETS)) throw new Error(`Unknown ?splats=${asset}`);
  const canvas = document.getElementById("view");
  const timeline = document.getElementById("timeline");
  const time = document.getElementById("time");
  const viewpoint = document.getElementById("viewpoint");
  const replay = document.getElementById("replay");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.add(new SparkRenderer({ renderer }));
  const camera = new THREE.PerspectiveCamera(29, 1, 0.05, 1000);
  const matte = createMatte({ occluder: true });
  const splat = await loadSplatScene(ASSETS[asset]);
  placeSplatScene(splat, DEFAULTS);
  const updateEffects = attachEffects(splat.mesh, readEnabledEffects(params.get("fx")));
  const anchor = createAnchor(matte, splat.root);
  scene.add(anchor);
  const memory = await createMemoryWindow({
    anchor, splat, matte, config: DEFAULTS,
    button: document.getElementById("activate-memory"),
    onPhase: (phase) => { document.getElementById("stage").textContent = STAGES[phase]; },
  });
  anchor.visible = true;
  timeline.max = memory.duration;
  for (const control of [timeline, viewpoint, replay]) control.disabled = false;
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
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    // Keep the photograph and the eventual taller portal clear of the UI.
    const halfView = Math.max(DEFAULTS.windowHeight * 0.9, DEFAULTS.windowWidth * 0.7 / camera.aspect);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfView / DEFAULTS.windowDistance));
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
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
    camera.lookAt(0, 0, -DEFAULTS.windowDistance);
    const now = performance.now() / 1000;
    const frame = memory.update(camera, canvas, now);
    if (frame.phase !== "dormant") updateEffects(camera, now, frame.effects);
    timeline.value = Math.min(frame.seconds, memory.duration);
    time.textContent = `${Math.min(frame.seconds, memory.duration).toFixed(1)}s`;
    renderer.render(scene, camera);
  });
}

function showError(message) {
  const error = document.getElementById("error");
  error.hidden = false;
  error.textContent = message;
  console.error(message);
}
main().catch((err) => showError(err?.message ?? String(err)));
