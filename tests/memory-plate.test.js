import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { MEMORY_SETTINGS } from "../src/memory-settings.js";
import { memoryFrame } from "../src/memory-timeline.js";
import { PLATE_OPENING, PLATE_DISSOLVE_START, createPhotoPlate, plateDissolve } from "../src/memory-plate.js";

const PLATE = new URL("../input/plate/photo-plate.glb", import.meta.url);

// The GLB's JSON and its vertex data, read directly: GLTFLoader needs a browser.
function readPlate() {
  const data = readFileSync(PLATE);
  assert.equal(data.readUInt32LE(0), 0x46546C67, "a binary glTF");
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20+jsonLength).toString("utf8"));
  const binary = data.subarray(20+jsonLength+8);
  const read = (index) => {
    const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
    const width = { SCALAR:1, VEC2:2, VEC3:3 }[accessor.type];
    const Type = { 5123:Uint16Array, 5125:Uint32Array, 5126:Float32Array }[accessor.componentType];
    const start = binary.byteOffset+(view.byteOffset ?? 0)+(accessor.byteOffset ?? 0);
    return new Type(binary.buffer.slice(start, start+accessor.count*width*Type.BYTES_PER_ELEMENT));
  };
  const primitive = gltf.meshes[0].primitives[0];
  return { gltf, positions:read(primitive.attributes.POSITION), normals:read(primitive.attributes.NORMAL), indices:read(primitive.indices) };
}

test("the plate stays whole until the colour is nearly across, and is gone before the street opens", () => {
  for (const settings of [MEMORY_SETTINGS, { ...MEMORY_SETTINGS, colorDuration:4.2, flatHoldDuration:0.8 }]) {
    const { colorDuration:color, flatHoldDuration:hold } = settings;
    const at = (seconds) => plateDissolve(memoryFrame(seconds, settings), settings);
    assert.equal(plateDissolve(memoryFrame(null, settings), settings), 0, "dormant");
    for (const seconds of [0, 0.3*color, 0.6*color, PLATE_DISSOLVE_START*color]) assert.equal(at(seconds), 0, `${seconds}s`);
    assert.ok(at(0.85*color) > 0, "it has begun once the colour is nearly across");
    assert.equal(at(color+hold), 1, "gone by the end of the flat hold");
    assert.equal(at(color+hold+settings.depthDuration), 1);
    let last = 0;
    for (let seconds = 0; seconds <= color+hold+1; seconds += 0.01) {
      const amount = at(seconds);
      assert.ok(amount >= last-1e-12, `monotonic at ${seconds.toFixed(2)}s`);
      last = amount;
    }
  }
});

test("the plate's opening fits the photograph at its distance, and hides once dissolved", () => {
  const plate = createPhotoPlate({ geometry:new THREE.BoxGeometry(1.6, 1, 0.1), map:new THREE.Texture() });
  plate.layout({ photoWidth:0.492, photoHeight:0.369, photoDistance:0.8 });
  const { object } = plate;
  assert.ok(Math.abs(object.scale.x-0.492/PLATE_OPENING.width) < 1e-12);
  assert.ok(Math.abs(object.scale.y-0.369/PLATE_OPENING.height) < 1e-12);
  assert.equal(object.scale.z, object.scale.x);
  assert.deepEqual(object.position.toArray(), [0, 0, -0.8]);
  assert.equal(object.renderOrder, -2, "drawn before the occluding matte");
  const settings = MEMORY_SETTINGS;
  assert.equal(plate.update(memoryFrame(null, settings), settings), 0);
  assert.equal(object.visible, true, "visible while dormant, so the warm-up compiles it");
  assert.equal(plate.update(memoryFrame(settings.colorDuration+settings.flatHoldDuration, settings), settings), 1);
  assert.equal(object.visible, false);
  plate.update(memoryFrame(null, settings), settings);
  assert.equal(object.visible, true, "whole again once reset");
  plate.dispose();
});

test("the extracted plate frames a 4:3 opening that nothing blocks or backs", () => {
  assert.ok(statSync(PLATE).size <= 600*1024, "within its size budget");
  const { gltf, positions, normals, indices } = readPlate();
  const [left, bottom, right, top] = gltf.meshes[0].extras.opening;
  assert.deepEqual([left, bottom, right, top], [-0.5, -0.375, 0.5, 0.375]);
  assert.ok(Math.abs((right-left)/(top-bottom)-1448/1086) < 1e-9, "the photograph's 4:3");
  assert.equal(right-left, PLATE_OPENING.width);
  assert.equal(top-bottom, PLATE_OPENING.height);

  const { min, max } = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
  assert.ok(min[0] < -0.55 && min[0] > -0.62, `left border ${min[0]}`);
  assert.ok(max[0] > 0.75 && max[0] < 0.85, `rail and handle ${max[0]}`);
  assert.ok(min[1] < -0.43 && max[1] > 0.43, "top and bottom borders");
  assert.ok(max[2] > 0.02 && max[2] < 0.05, "the frame's face stands just in front of the photograph");
  assert.ok(min[2] < -0.08 && min[2] > -0.12, "and its back a little behind");
  for (let i = 0; i < normals.length; i += 3) assert.ok(Math.abs(Math.hypot(normals[i], normals[i+1], normals[i+2])-1) < 1e-3, "unit normals");

  // Inside the opening only the frame's curved left end may overlap the
  // photograph, from in front, where it hides its two left corners. Nothing
  // lies behind the photograph's plane there: the hole goes through.
  const margin = 0.01;
  let walls = { left:0, right:0, bottom:0, top:0 };
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [0, 1, 2].map(k => Array.from(positions.subarray(3*indices[t+k], 3*indices[t+k]+3)));
    assert.ok(corners.every(([x, y, z]) => Number.isFinite(x+y+z)));
    const [cx, cy, cz] = [0, 1, 2].map(axis => corners.reduce((sum, p) => sum+p[axis], 0)/3);
    const zMax = Math.max(...corners.map(p => p[2]));
    if (cx > left+margin && cx < right-margin && cy > bottom+margin && cy < top-margin) {
      assert.ok(cx < left+0.08, `triangle ${t/3} sits inside the opening at x ${cx.toFixed(3)}`);
      assert.ok(Math.min(...corners.map(p => p[2])) > -1e-6, `triangle ${t/3} lies behind the photograph inside the opening`);
    }
    // The walls lining the hole, from the photograph's plane to the back.
    if (zMax <= 1e-6 && cz < -0.01) {
      const on = (axis, value) => corners.every(p => Math.abs(p[axis]-value) < 1e-6);
      if (on(0, left)) walls.left++;
      if (on(0, right)) walls.right++;
      if (on(1, bottom)) walls.bottom++;
      if (on(1, top)) walls.top++;
    }
  }
  assert.deepEqual(walls, { left:2, right:2, bottom:2, top:2 }, "a wall on each side of the hole");
});
