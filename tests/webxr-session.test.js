import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSUMED_DEVICE_HEIGHT, chooseTracking, floorHeight, framebufferScale, pickReferenceSpace, trackingFromPose,
} from "../src/ar/webxr-session.js";

const xrWith = (supported) => ({ isSessionSupported: async (mode) => mode === "immersive-ar" && supported });

test("tracking prefers WebXR AR when the browser offers it, and 8th Wall otherwise", async () => {
  assert.equal(await chooseTracking("auto", xrWith(true)), "webxr");
  assert.equal(await chooseTracking("auto", xrWith(false)), "xr8");
  assert.equal(await chooseTracking("auto", undefined), "xr8", "Safari has no navigator.xr");
  assert.equal(await chooseTracking("auto", {}), "xr8", "navigator.xr without isSessionSupported");
  const throwing = { isSessionSupported: async () => { throw new Error("SecurityError"); } };
  assert.equal(await chooseTracking("auto", throwing), "xr8");
});

test("?tracking forces a tracker and rejects WebXR where none exists", async () => {
  assert.equal(await chooseTracking("xr8", xrWith(true)), "xr8");
  assert.equal(await chooseTracking("webxr", xrWith(true)), "webxr");
  await assert.rejects(chooseTracking("webxr", xrWith(false)), /no WebXR AR/);
  await assert.rejects(chooseTracking("arkit", xrWith(true)), /Unknown \?tracking=arkit/);
});

test("reference space falls back from the floor to the start pose", async () => {
  const session = (granted) => ({
    async requestReferenceSpace(type) {
      if (!granted.includes(type)) throw new Error(`NotSupportedError: ${type}`);
      return { type };
    },
  });
  assert.equal(await pickReferenceSpace(session(["local-floor", "local"])), "local-floor");
  assert.equal(await pickReferenceSpace(session(["local"])), "local");
  await assert.rejects(pickReferenceSpace(session(["viewer"])), /no local reference space/);
});

test("tracking is NORMAL only for a tracked, non-emulated pose", () => {
  assert.deepEqual(trackingFromPose(null), { trackingStatus: "LIMITED", trackingReason: "" });
  assert.deepEqual(trackingFromPose({ emulatedPosition: true }), { trackingStatus: "LIMITED", trackingReason: "" });
  assert.deepEqual(trackingFromPose({ emulatedPosition: false }), { trackingStatus: "NORMAL", trackingReason: "" });
});

test("floor height uses local-floor, then a detected surface, then a hand-held guess", () => {
  assert.equal(floorHeight("local-floor", -0.4), 0);
  assert.equal(floorHeight("local", -1.31), -1.31);
  assert.equal(floorHeight("local", null), -ASSUMED_DEVICE_HEIGHT);
  assert.equal(floorHeight("local", Number.NaN), -ASSUMED_DEVICE_HEIGHT);
});

test("framebuffer scale matches the 8th Wall path's pixel ratio cap", () => {
  assert.ok(Math.abs(framebufferScale(2, 3) - 2 / 3) < 1e-12, "dpr 2 on a 3x phone");
  assert.equal(framebufferScale(2, 2), 1);
  assert.equal(framebufferScale(4, 2), 1, "never above the default size");
  assert.equal(framebufferScale(0.1, 3), 0.25, "floor keeps the view legible");
  assert.ok(Math.abs(framebufferScale(2, 3, 1.5) - 1) < 1e-12, "native scale converts to device pixels");
});
