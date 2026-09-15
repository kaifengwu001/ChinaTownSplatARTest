import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

/**
 * Loads a SHARP-produced splat file and reorients it for three.js.
 *
 * SHARP emits OpenCV convention (x right, y DOWN, z forward into the scene)
 * with the original camera at the origin. three.js is y-up with the camera
 * looking down -z, so a 180 degree rotation about X maps (x,y,z)->(x,-y,-z),
 * which fixes both axes at once.
 *
 * Node hierarchy matters here:
 *   root  - translation (push-back and vertical offset)
 *     pivot - pitch and scale, applied ABOUT THE ORIGINAL CAMERA POSITION
 *       mesh  - the convention-fixing rotation
 *
 * Pitching at the pivot (before translation) is what lets us choose which band
 * of the photo the window frames. The photo's optical axis sits above street
 * level, so re-aiming is a rotation about the capture point, not a translation:
 * translating the scene vertically would shear near and far content by
 * different angles and break the perspective.
 */
export async function loadSplatScene(url) {
  const mesh = new SplatMesh({ url });
  await mesh.initialized;
  mesh.rotation.x = Math.PI;

  const pivot = new THREE.Group();
  pivot.add(mesh);

  const root = new THREE.Group();
  root.add(pivot);

  return { root, pivot, mesh, splatCount: mesh.numSplats ?? null };
}

/**
 * Apply placement. Pure with respect to config; only writes transforms.
 * Positive `scenePitchDeg` aims the window lower into the scene (toward the
 * street) by rotating the scene up about the capture point.
 */
export function placeSplatScene(scene, config) {
  scene.pivot.scale.setScalar(config.sceneScale);
  scene.pivot.rotation.x = (config.scenePitchDeg * Math.PI) / 180;
  scene.root.position.set(0, config.sceneOffsetY, -config.sceneOffsetZ);
}
