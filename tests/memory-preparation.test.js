import test, { after } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DEFAULTS } from "../src/config.js";
import { MEMORY_TUNING_PARAMETERS, readMemorySettings } from "../src/memory-settings.js";
import { createMemoryWindow } from "../src/memory-window.js";
import { createMatte } from "../src/window-rig.js";
import { createAnchor, anchorPoseFromCamera } from "../src/ar/placement.js";

const originalLoad = THREE.TextureLoader.prototype.loadAsync;
const originalRaf = globalThis.requestAnimationFrame;
THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture({ width:1035, height:698 });
globalThis.requestAnimationFrame = callback => setImmediate(callback);
after(() => {
  THREE.TextureLoader.prototype.loadAsync = originalLoad;
  if (originalRaf) globalThis.requestAnimationFrame = originalRaf;
  else delete globalThis.requestAnimationFrame;
});
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

async function fixture(compile = async () => {}) {
  let generators = 0;
  const mesh = new THREE.Mesh();
  mesh.updateGenerator = () => { generators++; };
  mesh.updateVersion = () => {};
  const splat = { mesh, pivot:new THREE.Group(), root:new THREE.Group() };
  splat.pivot.add(mesh); splat.root.add(splat.pivot);
  const matte = createMatte({ occluder:true });
  const anchor = createAnchor(matte,splat.root);
  const memory = await createMemoryWindow({ anchor, splat, matte, config:DEFAULTS });
  anchor.visible = true; anchor.position.y = 1.6;
  memory.setFloor(-1.6); memory.reset();
  const gl = { SYNC_GPU_COMMANDS_COMPLETE:1, TIMEOUT_EXPIRED:2, WAIT_FAILED:3,
    fenceSync:() => ({}), flush() {}, clientWaitSync:() => 4, deleteSync() {} };
  const calls = { sorts:0, renders:0, compiles:0, textures:0 };
  const renderer = { debug:{}, outputColorSpace:THREE.SRGBColorSpace,
    initTexture() { calls.textures++; }, getRenderTarget:() => null,
    resetState() {}, setRenderTarget() {}, clear() {}, getContext:() => gl,
    render() { calls.renders++; }, async compileAsync() { calls.compiles++; await compile(renderer); },
  };
  const spark = { autoUpdate:true, async update() { calls.sorts++; } };
  const camera = new THREE.PerspectiveCamera();
  camera.position.y = 1.6;
  const context = { renderer, spark, scene:new THREE.Scene(), camera };
  return { memory, anchor, matte, splat, calls, context, generators:() => generators };
}

test("activation and scrubbing wait for compilation; placement priming gates replay too", async () => {
  const gate = deferred();
  const f = await fixture(() => gate.promise);
  const { memory,context } = f;
  assert.equal(memory.activate(10),false);
  assert.equal(memory.seek(1),false);
  const preparation = memory.prepare(context);
  assert.equal(memory.prepare(context),preparation,"Concurrent preparation is shared");
  await new Promise(setImmediate);
  assert.equal(memory.ready,false);
  assert.equal(memory.activate(20),false);
  gate.resolve(); await preparation;
  assert.equal(memory.ready,true);
  assert.equal(memory.phase,"dormant");
  assert.deepEqual(f.calls,{ sorts:4, renders:4, compiles:4, textures:2 });
  assert.equal(context.spark.autoUpdate,true);
  assert.equal(context.renderer.debug.onShaderError,undefined);
  const secondGate = deferred();
  context.renderer.compileAsync = () => secondGate.promise;
  const priming = memory.prime(context);
  assert.equal(memory.ready,false);
  assert.equal(memory.activate(30),false);
  secondGate.resolve(); await priming;
  assert.equal(memory.ready,true);
  assert.equal(memory.activate(100),true);
  const canvas = { width:390, clientWidth:390 };
  close(memory.update(context.camera,canvas,100).seconds,0);
  close(memory.update(context.camera,canvas,100.4).seconds,.4);
  memory.dispose();
});

test("shader or GPU failure never enables activation and restores renderer state", async () => {
  for (const failure of ["shader","gpu"]) {
    const f = await fixture(renderer => {
      if (failure === "shader") renderer.debug.onShaderError();
    });
    if (failure === "gpu") f.context.renderer.getContext().clientWaitSync = () => 3;
    await assert.rejects(f.memory.prepare(f.context),/compilation failed|preparation failed/);
    assert.equal(f.memory.ready,false);
    assert.equal(f.memory.activate(),false);
    assert.equal(f.memory.phase,"dormant");
    assert.equal(f.context.spark.autoUpdate,true);
    assert.equal(f.context.renderer.debug.onShaderError,undefined);
    f.memory.dispose();
  }
});

test("placement priming waits for an existing sort and a sort queued by update", async () => {
  const f = await fixture();
  await f.memory.prepare(f.context);
  const { spark } = f.context;
  let updates = 0;
  spark.sorting = true;
  spark.update = async () => {
    updates++;
    spark.sorting = true;
    spark.sortDirty = true;
  };
  const priming = f.memory.prime(f.context);
  await new Promise(setImmediate);
  assert.equal(updates,0,"Do not generate against an in-flight sort");
  assert.equal(f.memory.activate(),false);
  spark.sorting = false;
  await new Promise(setImmediate);
  assert.equal(updates,1);
  assert.equal(f.memory.ready,false,"update returning does not mean sorting finished");
  spark.sorting = false;
  spark.sortDirty = false;
  await priming;
  assert.equal(f.memory.ready,true);
  assert.equal(spark.autoUpdate,true);
  f.memory.dispose();
});

test("original stays 0.4m ahead of the placement-time phone as the viewer moves", async () => {
  for (const height of [1,1.6,2.1]) {
    const f = await fixture();
    await f.memory.prepare(f.context);
    const { camera } = f.context;
    camera.position.set(2,height,-3);
    camera.quaternion.setFromEuler(new THREE.Euler(-.3,.7,0,"YXZ"));
    const pose = anchorPoseFromCamera(camera);
    f.anchor.position.copy(pose.position);
    f.anchor.quaternion.copy(pose.quaternion);
    f.memory.setFloor(-height);
    f.memory.reset();
    const photo = f.anchor.children.find(o => o.material?.uniforms?.photograph);
    const expected = new THREE.Vector3(0,0,-.4).applyQuaternion(pose.quaternion).add(pose.position);
    const placed = photo.getWorldPosition(new THREE.Vector3());
    close(placed.distanceTo(expected),0);
    close(placed.y,height);
    camera.position.add(new THREE.Vector3(.3,.2,-.1));
    f.memory.update(camera,{ width:390, clientWidth:390 });
    close(photo.getWorldPosition(new THREE.Vector3()).distanceTo(placed),0);
    f.memory.seek(f.memory.duration);
    const centerY = f.matte.getWorldPosition(new THREE.Vector3()).y;
    close(centerY-f.memory.dimensions.portalHeight/2,.5);
    close(centerY+f.memory.dimensions.portalHeight/2,1.5);
    f.memory.dispose();
  }
});

test("live layout, scene and timing tuning preserves endpoints and reuses shader generators", async () => {
  const f = await fixture();
  const { memory,matte,splat,anchor } = f;
  await memory.prepare(f.context);
  const photo = anchor.children.find(o => o.material?.uniforms?.photograph);
  close(photo.position.z,-.4);
  close(photo.getWorldPosition(new THREE.Vector3()).y,1.6);
  const generators = f.generators();
  memory.setTuning({ photoScale:1, photoDistance:.3, photoElevation:.2,
    portalWidthScale:2, portalHeightScale:3, portalDistance:1.7, portalBottomHeight:.7,
    sceneScale:1.4, sceneDistance:2, sceneElevation:-1, scenePitch:20,
    colorDuration:3, flatHoldDuration:.5, depthDuration:4, depthStretch:3, parallaxGain:2 });
  memory.reset();
  close(photo.position.z,-.3); close(photo.position.y,.2); close(photo.scale.x,2);
  close(memory.dimensions.photoWidth,.4);
  close(splat.pivot.scale.x,1.4); close(splat.root.position.z,-2);
  close(splat.pivot.rotation.x,THREE.MathUtils.degToRad(20));
  close(memory.duration,7.5);
  memory.seek(memory.duration);
  close(matte.position.z,-1.7);
  close(matte.getWorldPosition(new THREE.Vector3()).y-memory.dimensions.portalHeight/2,.7);
  close(memory.dimensions.portalWidth,.8); close(memory.dimensions.portalHeight,1.2);
  assert.equal(f.generators(),generators,"Uniform tuning must not rebuild shader generators");
  const query = new URLSearchParams(Object.fromEntries(MEMORY_TUNING_PARAMETERS.map(({key}) => [key,memory.getSettings()[key]])));
  const parsed = readMemorySettings(query);
  close(parsed.photoDistance,.3); close(parsed.sceneScale,1.4);
  assert.throws(() => memory.setTuning({ photoDistance:0 }));
  assert.throws(() => memory.setTuning({ particleSizeMin:9, particleSizeMax:2 }));
  memory.dispose();
});
