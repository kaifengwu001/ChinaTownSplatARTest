import * as THREE from "three";
import { SparkRenderer, SparkControls } from "@sparkjsdev/spark";

import { DEFAULTS, geometry } from "./config.js";
import { loadSplatScene, placeSplatScene } from "./splat-scene.js";
import { createMatte, updateMatte, eyePosition } from "./window-rig.js";
import { buildPanel, renderHud } from "./ui.js";

const SPLAT_URL = "/chop_suey.sog";

async function main() {
  const canvas = document.getElementById("view");
  const hud = document.getElementById("hud");

  // antialias must be false: MSAA is pure cost for splat rendering and is the
  // single biggest perf regression on Apple GPUs.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.add(new SparkRenderer({ renderer }));

  const camera = new THREE.PerspectiveCamera(DEFAULTS.cameraFovY, 1, 0.05, 500);
  const freeLookRig = new THREE.Group();
  freeLookRig.add(camera);
  scene.add(freeLookRig);

  const matte = createMatte();
  scene.add(matte);

  let splat;
  try {
    splat = await loadSplatScene(SPLAT_URL);
  } catch (err) {
    hud.textContent = `Failed to load ${SPLAT_URL}\n${err?.message ?? err}`;
    throw err;
  }
  scene.add(splat.root);

  let config = DEFAULTS;
  let lastWindowKey = "";

  const applyConfig = (next) => {
    config = next;
    placeSplatScene(splat, config);

    // Rebuilding aperture geometry is only needed when its dimensions change.
    const key = `${config.windowWidth}|${config.windowHeight}|${config.windowDistance}|${config.showMatte}`;
    if (key !== lastWindowKey) {
      updateMatte(matte, config);
      lastWindowKey = key;
    }

    if (camera.fov !== config.cameraFovY) {
      camera.fov = config.cameraFovY;
      camera.updateProjectionMatrix();
    }
  };

  buildPanel(document.getElementById("panel"), DEFAULTS, applyConfig);
  applyConfig(DEFAULTS);

  // Scripting hook so viewpoints can be set reproducibly for comparison shots.
  // The panel sliders do not track changes made through here.
  window.__viewer = {
    get: () => config,
    set: (patch) => applyConfig(Object.freeze({ ...config, ...patch })),
    geometry: () => geometry(config),
  };

  const controls = new SparkControls({ canvas });

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();

    if (config.mode === "free") {
      controls.update(freeLookRig);
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
    } else {
      // Window mode: eye slides laterally, facing straight ahead.
      freeLookRig.position.set(0, 0, 0);
      freeLookRig.rotation.set(0, 0, 0);
      camera.position.copy(eyePosition(config, t));
      camera.rotation.set(0, 0, 0);
      if (config.trackWindow) camera.lookAt(0, 0, -config.windowDistance);
    }

    renderer.render(scene, camera);
    renderHud(hud, config, geometry(config), splat.splatCount);
  });
}

main();
