import * as THREE from "three";

const MATTE_EXTENT = 30; // metres; large enough to fill the view at any angle

/**
 * An opaque matte with a rectangular hole cut in it, sitting at the window
 * plane. Splats behind it are hidden by depth testing, so the scene is only
 * visible through the aperture.
 *
 * This is deliberately the same technique as the iOS fallback path (an occluder
 * with one open face), so what we tune here transfers directly even if
 * RealityKit turns out not to clip Gaussian splats.
 *
 * With `occluder: true` the matte writes depth but no color, so in AR the
 * camera feed shows through it while splats outside the aperture still fail
 * the depth test. That works only because every splat sits behind the window
 * plane: any sight line to a splat crosses the matte unless it passes through
 * the hole.
 */
export function createMatte({ occluder = false } = {}) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
    colorWrite: !occluder,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.renderOrder = -1;
  return mesh;
}

/** Rebuild the aperture geometry. Called when window dimensions change. */
export function updateMatte(mesh, config) {
  const { windowWidth: w, windowHeight: h, windowDistance: d } = config;

  const outer = new THREE.Shape();
  outer.moveTo(-MATTE_EXTENT, -MATTE_EXTENT);
  outer.lineTo(MATTE_EXTENT, -MATTE_EXTENT);
  outer.lineTo(MATTE_EXTENT, MATTE_EXTENT);
  outer.lineTo(-MATTE_EXTENT, MATTE_EXTENT);
  outer.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-w / 2, -h / 2);
  hole.lineTo(-w / 2, h / 2);
  hole.lineTo(w / 2, h / 2);
  hole.lineTo(w / 2, -h / 2);
  hole.closePath();
  outer.holes.push(hole);

  mesh.geometry.dispose();
  mesh.geometry = new THREE.ShapeGeometry(outer);
  mesh.position.set(0, 0, -d);
  mesh.visible = config.showMatte;
}

/**
 * Eye position for the current frame. The viewer faces straight ahead (down -z)
 * and slides laterally, which is what walking past a real window looks like.
 */
export function eyePosition(config, timeSeconds) {
  const sway = config.swayEnabled
    ? Math.sin((timeSeconds / config.swayPeriod) * Math.PI * 2) * config.swayAmplitude
    : 0;
  return new THREE.Vector3(config.eyeOffsetX + sway, 0, 0);
}
