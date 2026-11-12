import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MEMORY_SETTINGS } from "../src/memory-settings.js";
import { DEFAULT_SCREEN, alignment, frameScale, photographerLayout, screenTangents, uprightTurn } from "../src/photographer.js";

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

test("scene size and the matching height set the photographer's eye, the portal and the street", () => {
  const { captureCameraHeight, captureGroundStart, sceneScale } = MEMORY_SETTINGS;
  // The viewer matches higher than the photographer stood, where most people
  // hold a phone; the street sits that much lower than the spot.
  const raised = photographerLayout(MEMORY_SETTINGS);
  close(raised.eyeHeight, MEMORY_SETTINGS.matchHeight);
  close(raised.eyeHeight, 1.55);
  close(raised.captureLift, 1.55-captureCameraHeight*sceneScale);
  assert.ok(raised.captureLift > 0.1 && raised.captureLift < 0.11);
  // The portal still stands on the floor below the raised spot.
  close(raised.portalScale*raised.tanY*raised.portalDistance, raised.eyeHeight);
  // At the photographer's own height nothing is lifted: the cut is theirs exactly.
  const own = { ...MEMORY_SETTINGS, dolly: 0, matchHeight: captureCameraHeight*sceneScale };
  const exact = photographerLayout(own);
  const { tanX, tanY, eyeHeight, portalDistance, portalWidth, portalHeight, captureOffset, portalScale } = exact;
  // SHARP's assumed 30mm lens: a 60° by 46.8° frame.
  close(2*THREE.MathUtils.radToDeg(Math.atan(tanX)), 59.96, 0.01);
  close(2*THREE.MathUtils.radToDeg(Math.atan(tanY)), 46.79, 0.01);
  close(eyeHeight, captureCameraHeight*sceneScale);
  assert.equal(exact.captureLift, 0);
  // Without the dolly the portal fills the photographer's frame and its bottom edge rests on the floor.
  assert.equal(captureOffset, 0); assert.equal(portalScale, 1);
  close(portalHeight/2, portalDistance*tanY);
  close(portalHeight/2, eyeHeight);
  close(portalWidth/portalHeight, MEMORY_SETTINGS.captureAspect);
  close(portalDistance, eyeHeight/tanY);
  // The street begins just in front of the portal, where the frame meets the ground.
  close(exact.sceneDistance, captureGroundStart*sceneScale-portalDistance);
  assert.ok(exact.sceneDistance < 0 && exact.sceneDistance > -0.4);
  // Matching at the photographer's height, everything scales with the scene.
  const ownLayout = photographerLayout({ ...MEMORY_SETTINGS, matchHeight: captureCameraHeight*sceneScale });
  for (const scale of [0.5, 1, 1.6]) {
    const scaled = photographerLayout({ ...MEMORY_SETTINGS, sceneScale: scale, matchHeight: captureCameraHeight*scale });
    close(scaled.portalDistance/ownLayout.portalDistance, scale/sceneScale);
    close(scaled.captureOffset/ownLayout.captureOffset, scale/sceneScale);
    close(scaled.sceneDistance/ownLayout.sceneDistance, scale/sceneScale);
    // At a fixed matching height the portal stays put while the street scales.
    const fixed = photographerLayout({ ...MEMORY_SETTINGS, sceneScale: scale });
    close(fixed.portalDistance, layout.portalDistance);
    close(fixed.captureLift, MEMORY_SETTINGS.matchHeight-captureCameraHeight*scale);
  }
  // The photograph always stays in front of the portal.
  const tiny = photographerLayout({ ...MEMORY_SETTINGS, sceneScale: 0.2, photoDistance: 3 });
  assert.ok(tiny.photoDistance < tiny.portalDistance);
});

test("the dolly zooms: the frame keeps content at three times the street's start, nearer grows and farther shrinks", () => {
  const street = MEMORY_SETTINGS.captureGroundStart*MEMORY_SETTINGS.sceneScale;
  // Dolly 1 is the tap version: its viewer stood 1.80 m in front of the
  // photographer, 0.56 of the way to the street's start at 3.21 m.
  close(photographerLayout({ ...MEMORY_SETTINGS, dolly: 1 }).captureOffset, 1.803/3.213*street);
  close(photographerLayout({ ...MEMORY_SETTINGS, captureGroundStart: 3.78, sceneScale: 0.85, dolly: 1 }).captureOffset, 1.803, 1e-9);
  const { captureOffset: d, portalScale, portalDistance, tanY, eyeHeight, portalWidth, portalHeight } = layout;
  close(d, 0.3*1.803/3.213*street);
  // Size in the finished frame, relative to the photograph's, of content `depth` from the capture camera.
  const inFrame = depth => depth/(depth-d)/portalScale;
  close(inFrame(3*street), 1);
  // Peter SooHoo, a quarter beyond the street's start, grows 9%; the sky shrinks 5.6%.
  assert.ok(inFrame(1.25*street) > 1.085 && inFrame(1.25*street) < 1.095);
  assert.ok(inFrame(1e6) < 0.95 && inFrame(1e6) > 0.94);
  // The grown portal still stands on the floor, the same size, a little nearer the spot.
  close(portalScale*tanY*portalDistance, eyeHeight);
  close(portalHeight, 2*eyeHeight); close(portalWidth, 2*eyeHeight*MEMORY_SETTINGS.captureAspect);
  close(layout.streetStart, street-d);
  // The street never begins behind the spot.
  const extreme = photographerLayout({ ...MEMORY_SETTINGS, dolly: 1.5, sceneScale: 0.4 });
  assert.ok(extreme.streetStart >= 0.5-1e-12);
});

test("the matched photograph fits inside a sideways screen at the asked share of its height", () => {
  const { tanX, tanY } = layout;
  const screens = [DEFAULT_SCREEN, { tanLong: 0.6, tanShort: 0.45 }, { tanLong: 0.7, tanShort: 0.2 }, { tanLong: 0.4, tanShort: 0.39 }];
  for (const screen of screens) {
    for (const share of [0.3, 0.6, 0.8, 1]) {
      const scale = frameScale(share, screen, tanX, tanY);
      const across = scale*tanX/screen.tanLong, up = scale*tanY/screen.tanShort;
      assert.ok(across <= share+1e-12 && up <= share+1e-12, "fits inside");
      close(Math.max(across, up), share);
    }
  }
  // On a phone a 4:3 photograph reaches the top and bottom first.
  const phone = frameScale(0.8, DEFAULT_SCREEN, tanX, tanY);
  close(phone*tanY/DEFAULT_SCREEN.tanShort, 0.8);
  assert.ok(phone*tanX/DEFAULT_SCREEN.tanLong < 0.5);
  close(layout.photoScale, phone);
  close(layout.photoWidth/(2*layout.photoDistance), phone*tanX);
  // A projection's axes in either order give the same screen; garbage gives the default.
  const projection = new THREE.Matrix4().makePerspective(-0.3, 0.3, 0.65, -0.65, 1, 10).elements;
  assert.deepEqual(screenTangents(projection), { tanLong: 0.65, tanShort: 0.3 });
  assert.equal(screenTangents([0, 0, 0, 0, 0, 0]), DEFAULT_SCREEN);
});

test("the error is what the screen shows: aiming moves the photograph in the frame too", () => {
  const at = (eye, angles, tolerance = 4) => alignment(view(new THREE.Vector3(...eye), angles), layout, tolerance);
  assert.equal(at([0, 0, 0]).error, 0);
  // Turning 3° at the spot moves the photograph about 3° in the frame.
  const turned = at([0, 0, 0], [0, 3*Math.PI/180, 0]);
  assert.ok(Math.abs(turned.error-3) < 0.4, `turned ${turned.error}`);
  assert.equal(at([0, 0, 0], [0, 3*Math.PI/180, 0], 4).aligned, true);
  assert.equal(at([0, 0, 0], [0, 3*Math.PI/180, 0], 2.5).aligned, false);
  // Stepping 10 cm aside shifts it about 7°; turning back to it lines it up
  // again, bar a little keystone, and the match then eases the memory there.
  assert.ok(at([0.1, 0, 0]).error > 6);
  const back = at([0.1, 0, 0], [0, Math.asin(0.1/Math.hypot(0.1, layout.photoDistance)), 0]);
  assert.ok(back.error < 1.5 && back.aligned, `turned back ${back.error}`);
  // A slight roll in landscape still matches; a tilt up or down does not,
  // since the memory stays level.
  assert.equal(at([0, 0, 0], [0, 0, 3*Math.PI/180]).aligned, true);
  const tilted = at([0, 0, 0], [6*Math.PI/180, 0, 0]);
  assert.equal(tilted.aligned, false);
  assert.ok(Math.abs(tilted.pitch-6) < 1e-9);
  // Held sideways under rotation lock, the page stays portrait: same match.
  close(alignment(view(new THREE.Vector3(0.02, 0, 0.03), [0, 0, Math.PI/2], false), layout, 4).error,
    at([0.02, 0, 0.03]).error);
});

test("the hint names what to fix first", () => {
  const hint = (eye, angles, wide) => alignment(view(new THREE.Vector3(...eye), angles, wide), layout, 4).hint;
  assert.equal(hint([0, 0, 0], [0, 0, 0], false), "Turn your phone sideways");
  assert.equal(hint([0, 0, 0], [0, 0, Math.PI/2], false), "Hold still");
  assert.equal(hint([0, 0, 0], [0, 0.5, 0]), "Face the photograph");
  assert.equal(hint([0, 0, 0], [0.12, 0, 0]), "Hold your phone level");
  assert.equal(hint([0, 0, 1]), "Walk up until the photograph fills the frame");
  assert.equal(hint([0, 0, 0.3]), "A little closer");
  assert.equal(hint([0, 0, -0.25]), "Step back a little");
  // Off to one side, the photograph sits to the other side of the frame.
  assert.equal(hint([0.15, 0, 0.02]), "Turn left");
  assert.equal(hint([-0.15, 0, 0.02]), "Turn right");
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
