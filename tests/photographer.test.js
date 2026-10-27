import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MEMORY_SETTINGS } from "../src/memory-settings.js";
import { alignment, photographerLayout, uprightTurn } from "../src/photographer.js";

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a-b) < tolerance, `${a} != ${b}`);
const layout = photographerLayout(MEMORY_SETTINGS);

// A camera at `eye` in the photographer's frame, turned by Euler angles.
function view(eye, [pitch, yaw, roll] = [0, 0, 0], wide = true) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"));
  return { eye, wide,
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q) };
}

test("scene size alone sets the photographer's eye, the portal and the street", () => {
  const { tanX, tanY, eyeHeight, portalDistance, portalWidth, portalHeight, photoWidth, photoHeight, photoDistance } = layout;
  // SHARP's assumed 30mm lens: a 60° by 46.8° frame.
  close(2*THREE.MathUtils.radToDeg(Math.atan(tanX)), 59.96, 0.01);
  close(2*THREE.MathUtils.radToDeg(Math.atan(tanY)), 46.79, 0.01);
  close(eyeHeight, 1.7*0.85);
  // The portal fills the frame and its bottom edge rests on the floor.
  close(portalHeight/2, portalDistance*tanY);
  close(portalHeight/2, eyeHeight);
  close(portalWidth/portalHeight, MEMORY_SETTINGS.captureAspect);
  close(portalDistance, 3.34, 0.005);
  close(photoWidth/photoDistance, portalWidth/portalDistance);
  close(photoHeight/photoDistance, portalHeight/portalDistance);
  // The street begins just in front of the portal, where the frame meets the ground.
  close(layout.sceneDistance, 3.78*0.85-portalDistance);
  assert.ok(layout.sceneDistance < 0 && layout.sceneDistance > -0.2);
  for (const sceneScale of [0.5, 1, 1.6]) {
    const scaled = photographerLayout({ ...MEMORY_SETTINGS, sceneScale });
    close(scaled.portalDistance/portalDistance, sceneScale/0.85);
    close(scaled.sceneDistance/layout.sceneDistance, sceneScale/0.85);
  }
  // The photograph always stays in front of the portal.
  const tiny = photographerLayout({ ...MEMORY_SETTINGS, sceneScale: 0.2, photoDistance: 3 });
  assert.ok(tiny.photoDistance < tiny.portalDistance);
});

test("aim never changes the match error; position does", () => {
  const eye = new THREE.Vector3(0.03, -0.01, 0.05);
  const straight = alignment(view(eye), layout, 4);
  for (const angles of [[0.1, 0, 0], [0, -0.12, 0], [0.05, 0.08, 0.2]]) {
    close(alignment(view(eye, angles), layout, 4).error, straight.error);
  }
  assert.equal(alignment(view(new THREE.Vector3()), layout, 4).error, 0);
  // Stepping sideways shifts the frame by the step over the distance.
  const step = Math.tan(THREE.MathUtils.degToRad(3))*layout.photoDistance;
  close(alignment(view(new THREE.Vector3(step, 0, 0)), layout, 4).error, 3);
  close(alignment(view(new THREE.Vector3(0, -step, 0)), layout, 4).error, 3);
  assert.equal(alignment(view(new THREE.Vector3(step, 0, 0)), layout, 3.01).aligned, true);
  assert.equal(alignment(view(new THREE.Vector3(step, 0, 0)), layout, 2.99).aligned, false);
});

test("the hint names what to fix first", () => {
  const hint = (eye, angles, wide) => alignment(view(new THREE.Vector3(...eye), angles, wide), layout, 4).hint;
  assert.equal(hint([0, 0, 0], [0, 0, 0], false), "Turn your phone sideways");
  assert.equal(hint([0, 0, 0], [0, 0, Math.PI/2], false), "Hold still");
  assert.equal(hint([0, 0, 0], [0, 0.5, 0]), "Face the photograph");
  assert.equal(hint([0, 0, 1]), "Walk up until the photograph fills the frame");
  assert.equal(hint([0, 0, 0.12]), "A little closer");
  assert.equal(hint([0, 0, -0.15]), "Step back a little");
  assert.equal(hint([0.15, 0, 0.02]), "Step left");
  assert.equal(hint([-0.15, 0, 0.02]), "Step right");
  assert.equal(hint([0, 0.15, 0.02]), "Lower your phone");
  assert.equal(hint([0, -0.15, 0.02]), "Raise your phone");
  assert.equal(hint([0, 0, -0.7]), "Step back from the photograph");
  assert.equal(hint([0.01, -0.01, 0.01]), "Hold still");
});

test("hint text turns upright for the phone as held", () => {
  assert.equal(uprightTurn(0, 1), 0);
  assert.equal(uprightTurn(0.97, 0.2), 90);
  assert.equal(uprightTurn(-1, 0.1), -90);
  assert.equal(Math.abs(uprightTurn(0.1, -1)), 180);
});
