import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { DEFAULTS } from "./config.js";
import { loadSplatScene, placeSplatScene } from "./splat-scene.js";
import { createMatte, updateMatte } from "./window-rig.js";
import { buildEffectModifier } from "../mattercraft/splatEffectGraph.ts";
import {
  DEFAULT_EFFECT_SETTINGS,
  applyCamera,
  applySettings,
  createUniforms,
} from "../mattercraft/splatEffectUniforms.ts";

// Desktop check for the Mattercraft effect program: the same Spark modifier,
// seen from the window's sweet spot with the tuned window defaults.
//   ?fx=band,periphery,fireflies,dissolve   effects to enable (default: band)
//   ?t=3.5                                  freeze time, for comparing stills
//   ?splats=full|50|25                      asset (default 50)
//   ?fov=20                                 vertical field of view, to zoom in

const EFFECTS = ["band", "periphery", "fireflies", "dissolve"];
const ASSETS = Object.freeze({ full: "/chop_suey.sog", 50: "/chop_suey_50.sog", 25: "/chop_suey_25.sog" });

function readOptions(search) {
  const params = new URLSearchParams(search);
  const requested = (params.get("fx") ?? "band").split(",").filter(Boolean);
  const unknown = requested.filter((name) => !EFFECTS.includes(name));
  if (unknown.length) throw new Error(`Unknown effect ${unknown.join(", ")}; use ${EFFECTS.join(", ")}`);

  const frozen = params.has("t") ? Number(params.get("t")) : null;
  if (frozen !== null && !Number.isFinite(frozen)) throw new Error(`?t must be a number of seconds`);

  const assetKey = params.get("splats") ?? "50";
  if (!(assetKey in ASSETS)) throw new Error(`Unknown ?splats=${assetKey}`);

  const fov = Number(params.get("fov") ?? DEFAULTS.cameraFovY);
  if (!(fov > 1 && fov < 170)) throw new Error(`?fov must be between 1 and 170 degrees`);

  const enabled = Object.fromEntries(EFFECTS.map((name) => [name, requested.includes(name)]));
  return Object.freeze({ enabled, frozen, fov, assetUrl: ASSETS[assetKey] });
}

async function main() {
  const status = document.getElementById("status");
  const options = readOptions(window.location.search);
  const canvas = document.getElementById("view");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.add(new SparkRenderer({ renderer }));
  const camera = new THREE.PerspectiveCamera(options.fov, window.innerWidth / window.innerHeight, 0.05, 1000);

  const matte = createMatte();
  updateMatte(matte, DEFAULTS);
  scene.add(matte);

  const splat = await loadSplatScene(options.assetUrl);
  placeSplatScene(splat, DEFAULTS);
  scene.add(splat.root);

  const uniforms = createUniforms();
  splat.mesh.objectModifier = buildEffectModifier(uniforms, options.enabled);
  splat.mesh.updateGenerator();

  const on = EFFECTS.filter((name) => options.enabled[name]).join(", ") || "none";
  window.__effects = { ready: true, on };
  status.textContent = `effects  ${on}\nsplats   ${splat.splatCount?.toLocaleString()}`;

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const start = performance.now();
  renderer.setAnimationLoop(() => {
    const seconds = options.frozen ?? (performance.now() - start) / 1000;
    applySettings(uniforms, DEFAULT_EFFECT_SETTINGS, seconds);
    applyCamera(uniforms, splat.mesh, camera);
    splat.mesh.updateVersion();
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  console.error(err);
  window.__effects = { ready: false, error: String(err?.message ?? err) };
  document.getElementById("status").textContent = `Error: ${err?.message ?? err}`;
});
