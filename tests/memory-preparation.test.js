import test, { after } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DEFAULTS } from "../src/config.js";
import { MEMORY_TUNING_PARAMETERS, readMemorySettings } from "../src/memory-settings.js";
import { createMemoryWindow } from "../src/memory-window.js";
import { createMatte } from "../src/window-rig.js";
import { createAnchor, anchorPoseFromCamera } from "../src/ar/placement.js";
import { frameScale, photographerLayout } from "../src/photographer.js";

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

async function fixture(compile = async () => {}, options = {}) {
  let generators = 0;
  const mesh = new THREE.Mesh();
  mesh.rotation.x = Math.PI; // SHARP's OpenCV frame, as loadSplatScene sets it
  mesh.updateGenerator = () => { generators++; };
  mesh.updateVersion = () => {};
  const splat = { mesh, pivot:new THREE.Group(), root:new THREE.Group() };
  splat.pivot.add(mesh); splat.root.add(splat.pivot);
  const matte = createMatte({ occluder:true });
  const anchor = createAnchor(matte,splat.root);
  const memory = await createMemoryWindow({ anchor, splat, matte, config:DEFAULTS, ...options });
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

// The camera and canvas of a phone `offset` from the photographer's spot, in
// the spot's frame. `roll` turns the phone about its view axis; `wide` lays
// the page out wider than tall, as when the page turns with the phone.
function phoneAt(f, offset, { roll = 0, yaw = 0, wide = true } = {}) {
  const spot = f.anchor.children.find(o => o.children.length && o.children[0].children.includes(f.matte));
  spot.updateWorldMatrix(true,true);
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(spot.localToWorld(offset.clone()));
  camera.quaternion.copy(spot.getWorldQuaternion(new THREE.Quaternion()))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,yaw,roll,"YXZ")));
  const [width,height] = wide ? [844,390] : [390,844];
  const canvas = { width, height, clientWidth:width, clientHeight:height,
    getBoundingClientRect:() => ({ left:0, top:0, width, height, right:width, bottom:height }) };
  return { camera, canvas, spot };
}

test("the photograph waits at the spot as the viewer moves", async () => {
  for (const height of [1,1.6,2.1]) {
    const f = await fixture();
    await f.memory.prepare(f.context);
    const { camera } = f.context;
    camera.position.set(2,height,-3);
    camera.quaternion.setFromEuler(new THREE.Euler(-.3,.7,0,"YXZ"));
    const pose = anchorPoseFromCamera(camera);
    f.anchor.position.copy(pose.position);
    f.anchor.quaternion.copy(pose.quaternion);
    f.memory.setFloor(-1.6);
    f.memory.reset();
    const { walkDistance } = f.memory.getSettings();
    const { eyeHeight, photoDistance } = f.memory.layout;
    const photo = f.matte.parent.children.find(o => o.material?.uniforms?.photograph);
    const { spot } = phoneAt(f,new THREE.Vector3());
    // The spot: walkDistance along the placement heading, eyeHeight above the floor.
    const expected = new THREE.Vector3(0,0,-walkDistance).applyQuaternion(pose.quaternion).add(pose.position);
    expected.y = height-1.6+eyeHeight;
    close(spot.getWorldPosition(new THREE.Vector3()).distanceTo(expected),0);
    const placed = photo.getWorldPosition(new THREE.Vector3());
    close(placed.distanceTo(expected),photoDistance);
    // The capture camera was level to within half a degree.
    assert.ok(Math.abs(placed.y-expected.y) < photoDistance*Math.sin(THREE.MathUtils.degToRad(.5)));
    camera.position.add(new THREE.Vector3(.3,.2,-.1));
    f.memory.update(camera,{ width:390, clientWidth:390, clientHeight:844 });
    close(photo.getWorldPosition(new THREE.Vector3()).distanceTo(placed),0);
    f.memory.dispose();
  }
});

test("from the spot each street point sits where its pixel was, scaled by the window's growth and the dolly", async () => {
  for (const dolly of [0,.2,1]) {
    const f = await fixture();
    const { memory,splat } = f;
    // Matched at the photographer's own height, so nothing is lifted.
    memory.setTuning({ sceneScale:.85, photoDistance:.8, dolly, matchHeight:memory.getSettings().captureCameraHeight*.85 });
    await memory.prepare(f.context);
    const settings = memory.getSettings();
    const { photoScale, captureOffset } = memory.layout;
    const { spot } = phoneAt(f,new THREE.Vector3());
    const photo = f.matte.parent.children.find(o => o.material?.uniforms?.photograph);
    photo.updateWorldMatrix(true,false);
    splat.mesh.updateWorldMatrix(true,false);
    const base = photo.geometry.parameters;
    const tangents = point => { const local = spot.worldToLocal(point.clone()); return [local.x/-local.z, local.y/-local.z]; };
    for (const p of [[0,0,5],[-2,1.6,4],[3,-1.2,9],[-8,-6,30],[40,25,300]].map(xyz => new THREE.Vector3(...xyz))) {
      // SHARP's pinhole, in the colour photograph's frame (OpenCV: y down).
      const u = .5+p.x/p.z*settings.captureFocalRatio;
      const v = .5-p.y/p.z*settings.captureFocalRatio*settings.captureAspect;
      const pixel = tangents(photo.localToWorld(new THREE.Vector3((u-.5)*base.width,(v-.5)*base.height,0)));
      const point = tangents(p.clone().applyMatrix4(splat.mesh.matrixWorld));
      const depth = p.z*settings.sceneScale;
      const growth = depth/(depth-captureOffset)/photoScale;
      for (const axis of [0,1]) assert.ok(Math.abs(point[axis]-pixel[axis]*growth) < 1e-9*(1+Math.abs(point[axis])),`dolly ${dolly}: ${p.toArray()} axis ${axis}`);
    }
    memory.dispose();
  }
});

test("with no dolly and the photographer's own frame, the street lies on the photograph's rays", async () => {
  const f = await fixture();
  const { memory,splat } = f;
  // A screen twice the photographer's frame, which the frame fills at half its height.
  const { tanX, tanY } = memory.layout;
  memory.setScreen({ tanLong:2*tanX, tanShort:2*tanY });
  const { captureCameraHeight, sceneScale } = memory.getSettings();
  memory.setTuning({ dolly:0, matchFrame:.5, matchHeight:captureCameraHeight*sceneScale });
  await memory.prepare(f.context);
  const settings = memory.getSettings();
  close(memory.layout.photoScale,1); close(memory.layout.portalScale,1); close(memory.layout.captureOffset,0);
  const { spot } = phoneAt(f,new THREE.Vector3());
  const eye = spot.getWorldPosition(new THREE.Vector3());
  const photo = f.matte.parent.children.find(o => o.material?.uniforms?.photograph);
  photo.updateWorldMatrix(true,false);
  splat.mesh.updateWorldMatrix(true,false);
  const base = photo.geometry.parameters;
  for (const p of [[0,0,5],[-2,1.6,4],[40,25,300]].map(xyz => new THREE.Vector3(...xyz))) {
    const u = .5+p.x/p.z*settings.captureFocalRatio;
    const v = .5-p.y/p.z*settings.captureFocalRatio*settings.captureAspect;
    const pixel = photo.localToWorld(new THREE.Vector3((u-.5)*base.width,(v-.5)*base.height,0)).sub(eye).normalize();
    const point = p.clone().applyMatrix4(splat.mesh.matrixWorld).sub(eye).normalize();
    assert.ok(pixel.angleTo(point) < 1e-6,`ray to ${p.toArray()} is ${pixel.angleTo(point)} rad off`);
  }
  memory.dispose();
});

test("from the spot the aperture grows evenly from the photograph's frame to the portal's", async () => {
  const f = await fixture();
  const { memory } = f;
  await memory.prepare(f.context);
  const { tanY, photoScale, portalScale, photoDistance, portalDistance, eyeHeight } = memory.layout;
  assert.ok(photoScale < 1 && portalScale > 1);
  const { colorDuration, flatHoldDuration, depthDuration } = memory.getSettings();
  let previous = photoDistance;
  for (let step = 0; step <= 20; step++) {
    const seconds = colorDuration+flatHoldDuration+depthDuration*step/20;
    memory.seek(seconds);
    const { centerY, width, height, distance } = memory.aperture;
    const scale = height/distance/(2*tanY);
    close(centerY,0); close(width/height,memory.getSettings().captureAspect);
    close(scale,photoScale+(portalScale-photoScale)*memory.frame.growth);
    assert.ok(distance >= previous-1e-12, `aperture came forward at step ${step}`);
    previous = distance;
  }
  close(previous,portalDistance);
  // The finished portal stands on the floor below the spot.
  close(f.matte.position.y-memory.aperture.height/2,-eyeHeight);
  memory.dispose();
});

test("live match, scene and timing tuning re-derives the layout and reuses shader generators", async () => {
  const f = await fixture();
  const { memory,matte,splat } = f;
  await memory.prepare(f.context);
  const photo = matte.parent.children.find(o => o.material?.uniforms?.photograph);
  const width = memory.layout.photoWidth;
  const generators = f.generators();
  memory.setTuning({ walkDistance:1.5, matchHeight:1.62, photoDistance:.6, matchFrame:.6, dolly:.5, matchTolerance:6, matchHold:1,
    sceneScale:1.1, spillStrength:2.5,
    colorDuration:3, flatHoldDuration:.5, depthDuration:4, depthStretch:3, parallaxGain:2 });
  const screen = { tanLong:.7, tanShort:.35 };
  memory.setScreen(screen);
  memory.reset();
  const settings = memory.getSettings();
  assert.deepEqual({ ...memory.layout },{ ...photographerLayout(settings,screen) });
  const { eyeHeight, portalDistance, tanX, tanY, photoScale, portalScale, captureOffset, captureLift } = memory.layout;
  close(eyeHeight,1.62); close(captureLift,1.62-settings.captureCameraHeight*1.1);
  close(photo.position.z,-.6); close(photo.position.y,0);
  close(photo.scale.x,memory.layout.photoWidth/width); close(memory.layout.photoWidth,1.2*photoScale*tanX);
  close(photoScale,frameScale(.6,screen,tanX,tanY));
  close(matte.parent.parent.position.z,-1.5); close(matte.parent.parent.position.y,-1.6+eyeHeight);
  close(splat.pivot.scale.x,1.1);
  // The capture camera behind the spot by the dolly's offset, below it by the lift, along the ground's up.
  const [gx,gy,gz] = settings.captureGroundUp;
  close(splat.root.position.distanceTo(new THREE.Vector3(0,0,captureOffset).addScaledVector(new THREE.Vector3(gx,-gy,-gz).normalize(),-captureLift)),0);
  assert.ok(captureOffset > 0);
  close(memory.duration,7.5);
  memory.seek(memory.duration);
  close(matte.position.z,-portalDistance);
  close(memory.aperture.height,2*portalScale*tanY*portalDistance);
  assert.equal(f.generators(),generators,"Uniform tuning must not rebuild shader generators");
  const query = new URLSearchParams(Object.fromEntries(MEMORY_TUNING_PARAMETERS.map(({key}) => [key,memory.getSettings()[key]])));
  const parsed = readMemorySettings(query);
  close(parsed.walkDistance,1.5); close(parsed.matchHeight,1.62); close(parsed.photoDistance,.6); close(parsed.sceneScale,1.1); close(parsed.matchTolerance,6);
  close(parsed.matchFrame,.6); close(parsed.dolly,.5);
  assert.throws(() => memory.setScreen({ tanLong:0, tanShort:.3 }),/positive/);
  assert.throws(() => memory.setTuning({ portalDistance:2 }),/Unknown tuning parameter/);
  assert.throws(() => memory.setTuning({ photoDistance:0 }));
  assert.throws(() => memory.setTuning({ particleSizeMin:9, particleSizeMax:2 }));
  memory.dispose();
});

test("the street stands where it was shot: its camera just behind and below the spot, its ground on the floor", async () => {
  for (const [height,scale,walk,dolly,matchHeight] of [[1.6,.85,1,0,1.55],[1.2,1,0,.2,1.39],[2,1.4,2.5,1,1.7],[1.5,1.04,1,.3,1.3]]) {
    const f = await fixture();
    const { memory,anchor,splat } = f;
    anchor.position.set(1,height,-2);
    anchor.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.8);
    memory.setFloor(-height);
    memory.setTuning({ sceneScale:scale, walkDistance:walk, dolly, matchHeight });
    anchor.updateWorldMatrix(true,true);
    const settings = memory.getSettings();
    const { captureOffset, captureLift, streetStart } = memory.layout;
    close(captureLift,matchHeight-settings.captureCameraHeight*scale);
    const { spot } = phoneAt(f,new THREE.Vector3());
    // The capture camera stands captureOffset behind the spot, on its view
    // axis, and captureLift below it along the ground's up.
    const fromSpot = spot.worldToLocal(new THREE.Vector3().setFromMatrixPosition(splat.mesh.matrixWorld));
    const [gx,gy,gz] = settings.captureGroundUp;
    const lowered = new THREE.Vector3(0,0,captureOffset).addScaledVector(new THREE.Vector3(gx,-gy,-gz).normalize(),-captureLift);
    close(fromSpot.distanceTo(lowered),0);
    // The spot itself is at the matching height above the floor.
    close(anchor.worldToLocal(spot.getWorldPosition(new THREE.Vector3())).y+height,matchHeight);
    close(captureOffset,Math.min(dolly*1.803/3.213*settings.captureGroundStart*scale,settings.captureGroundStart*scale-.5));
    // That axis tilts as the capture camera did, under half a degree.
    const level = Math.max(captureOffset*Math.sin(THREE.MathUtils.degToRad(.5)),1e-8);
    const placed = point => anchor.worldToLocal(point.clone().applyMatrix4(splat.mesh.matrixWorld));
    const camera = placed(new THREE.Vector3());
    close(camera.x,0); assert.ok(Math.abs(camera.y+height-settings.captureCameraHeight*scale) <= level);
    // SHARP's OpenCV frame: the ground below the photographer, and the street's start.
    const up = new THREE.Vector3(...settings.captureGroundUp).normalize();
    const ahead = new THREE.Vector3(0,0,1).addScaledVector(up,-up.z).normalize();
    const start = up.clone().multiplyScalar(-settings.captureCameraHeight).addScaledVector(ahead,settings.captureGroundStart);
    const begins = placed(start);
    close(begins.x,0); assert.ok(Math.abs(begins.y+height) <= level);
    assert.ok(Math.abs(begins.z+walk+streetStart) <= level);
    close(streetStart+captureOffset,settings.captureGroundStart*scale);
    close(memory.layout.streetStart-memory.layout.portalDistance,memory.layout.sceneDistance);
    // The street keeps its captured scale and runs straight ahead on the floor.
    const further = placed(start.clone().addScaledVector(ahead,1));
    close(further.x,0); close(further.y,begins.y); close(further.z,begins.z-scale);
    const aside = placed(start.clone().add(new THREE.Vector3().crossVectors(up,ahead)));
    close(aside.y,begins.y); close(Math.abs(aside.x),scale);
    memory.dispose();
  }
});

test("holding the phone sideways at the spot pulls the photograph onto it, then activates", async () => {
  const f = await fixture();
  const { memory } = f;
  await memory.prepare(f.context);
  const offset = new THREE.Vector3(.02,-.012,.03);
  const { camera, canvas } = phoneAt(f,offset,{ yaw:.05 });
  let now = 10;
  memory.update(camera,canvas,now);
  assert.equal(memory.match.hint,"Hold still");
  assert.equal(memory.phase,"dormant");
  let halfway = null;
  while (memory.phase === "dormant" && now < 12) {
    now += .05;
    memory.update(camera,canvas,now);
    if (halfway === null && now >= 10.3) halfway = memory.correction.length();
  }
  assert.equal(memory.phase,"colorizing");
  close(Math.round((now-10)*20)/20,memory.getSettings().matchHold);
  assert.ok(halfway > 0 && halfway < offset.length());
  // The stage now sits exactly where the phone is and turns where it points,
  // so the photograph sits straight ahead of it, filling the frame.
  close(memory.correction.distanceTo(offset),0);
  close(memory.correctionHeading,.05);
  const photo = f.matte.parent.children.find(o => o.material?.uniforms?.photograph);
  const seen = camera.worldToLocal(photo.getWorldPosition(new THREE.Vector3()));
  close(seen.x,0); close(seen.y,0); close(seen.z,-memory.layout.photoDistance);
  assert.equal(memory.match,null);
  memory.reset();
  close(memory.correction.length(),0);
  memory.dispose();
});

test("the guide frame stays fixed on the screen however the phone moves", async () => {
  const f = await fixture();
  const { memory } = f;
  await memory.prepare(f.context);
  const guide = f.matte.parent.parent.children.find(o => o.children.length === 4 && o.children.every(bar => bar.material?.isMeshBasicMaterial));
  const poses = [[new THREE.Vector3(0,0,.4),{}],[new THREE.Vector3(.2,-.05,.1),{ yaw:.3, roll:.1 }],[new THREE.Vector3(-.1,.05,.6),{ yaw:-.2 }]];
  poses.forEach(([offset,angles],n) => {
    const { camera, canvas } = phoneAt(f,offset,angles);
    memory.update(camera,canvas,40+n);
    assert.ok(guide.visible);
    guide.updateWorldMatrix(true,false);
    const local = camera.worldToLocal(guide.getWorldPosition(new THREE.Vector3()));
    close(local.x,0); close(local.y,0); close(local.z,-memory.layout.photoDistance);
    const turn = camera.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(guide.getWorldQuaternion(new THREE.Quaternion()));
    close(Math.abs(turn.w),1);
  });
  // Under rotation lock the frame turns a quarter so its long side stays across the screen.
  const { camera, canvas } = phoneAt(f,new THREE.Vector3(0,0,.4),{ roll:Math.PI/2, wide:false });
  memory.update(camera,canvas,50);
  const turn = camera.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(guide.getWorldQuaternion(new THREE.Quaternion()));
  close(Math.abs(new THREE.Euler().setFromQuaternion(turn).z),Math.PI/2);
  memory.dispose();
});

// A stack that records what the window asks of it and steps aside for
// `depart` ms, and a flight that touches the photograph `duration` seconds
// after its launch.
function stackAndFlight(duration = 2, depart = 300) {
  const calls = [];
  const pose = { x:700, y:330, width:84, height:98, border:4, rotation:86 };
  const cards = { albumOpen:false, update(state) { calls.push(["update",state.shown]); }, reset() { calls.push(["reset"]); },
    depart() { calls.push(["depart"]); this.departedAt = this.now; return depart; },
    launch() { calls.push(["launch"]); return pose; } };
  const flight = { mesh:new THREE.Group(), launched:null, settled:[],
    launch(options) { calls.push(["fly"]); this.launched = options; },
    update(now) {
      if (!this.launched) return { state:"idle" };
      const landedAt = this.launched.now+duration;
      return now >= landedAt ? { state:"landed", landedAt } : { state:"flying" };
    },
    settle(frame) { this.settled.push(frame.seconds); },
    reset() { calls.push(["flight reset"]); this.launched = null; },
    dispose() {} };
  return { calls, pose, cards, flight };
}

test("the match launches the arriving print from the stack, and its touch starts the activation", async () => {
  const { calls, pose, cards, flight } = stackAndFlight();
  const f = await fixture(undefined, { cards, flight });
  const { memory } = f;
  await memory.prepare(f.context);
  assert.ok(f.matte.parent.children.includes(flight.mesh),"the print flies in the stage's space");
  const { camera, canvas } = phoneAt(f,new THREE.Vector3(.01,0,.02));
  let now = 60;
  while (!flight.launched && now < 62) { cards.now = now += .05; memory.update(camera,canvas,now); }
  assert.ok(calls.some(([name,shown]) => name === "update" && shown),"the stack is out while matching");
  // The print leaves only once the rest of the pile has stepped aside.
  assert.ok(flight.launched.now-cards.departedAt >= .3-1e-9 && flight.launched.now-cards.departedAt < .35);
  // The 3D print takes over from the stack's print where it lay on the screen.
  assert.equal(flight.launched.pose,pose);
  assert.equal(flight.launched.camera,camera);
  assert.equal(flight.launched.layout,memory.layout);
  assert.deepEqual(flight.launched.rect,canvas.getBoundingClientRect());
  const launchedAt = flight.launched.now;
  assert.equal(memory.phase,"dormant","the print is still flying");
  const held = memory.correction;
  for (let n = 0; n < 5; n++) memory.update(phoneAt(f,new THREE.Vector3(.08,.03,.1)).camera,canvas,now += .05);
  close(memory.correction.distanceTo(held),0);
  assert.equal(memory.match,null,"no hint while it flies");
  assert.deepEqual(flight.settled,[],"nothing to dissolve before it lands");
  while (memory.phase === "dormant" && now < 66) memory.update(camera,canvas,now += .05);
  assert.equal(memory.phase,"colorizing");
  // The activation's clock starts at the touch, not at the frame that noticed it.
  close(memory.frame.seconds,now-(launchedAt+2));
  assert.ok(flight.settled.length > 0,"it sinks into the photograph as the colour comes");
  assert.deepEqual(calls.filter(([name]) => name !== "update").map(([name]) => name),["reset","flight reset","depart","launch","fly"]);
  memory.reset();
  assert.deepEqual(calls.slice(-2).map(([name]) => name),["reset","flight reset"]);
  memory.dispose();
  assert.equal(flight.mesh.parent,null);
});

test("an activation that doesn't come from the print clears a print still in the air", async () => {
  const { cards, flight } = stackAndFlight(5);
  const f = await fixture(undefined, { cards, flight });
  const { memory } = f;
  await memory.prepare(f.context);
  const { camera, canvas } = phoneAt(f,new THREE.Vector3());
  let now = 70;
  while (!flight.launched && now < 72) memory.update(camera,canvas,now += .05);
  assert.ok(flight.launched);
  assert.equal(memory.activate(now),true);
  assert.equal(flight.launched,null);
  memory.update(camera,canvas,now += .5);
  assert.deepEqual(flight.settled,[],"no print to dissolve");
  memory.dispose();
});

test("the match holds while the album is open, and resumes when it closes", async () => {
  const { cards, flight } = stackAndFlight();
  cards.albumOpen = true;
  const f = await fixture(undefined, { cards, flight, hint:{ hidden:true, style:{}, classList:{ toggle() {} } } });
  const { memory } = f;
  await memory.prepare(f.context);
  const { camera, canvas } = phoneAt(f,new THREE.Vector3(.02,0,.03));
  let now = 80;
  for (let n = 0; n < 40; n++) memory.update(camera,canvas,now += .05);
  assert.equal(memory.match.aligned,true,"the view is still measured");
  close(memory.correction.length(),0);
  assert.equal(flight.launched,null);
  cards.albumOpen = false;
  while (!flight.launched && now < 84) memory.update(camera,canvas,now += .05);
  assert.ok(flight.launched,"the print leaves once the album has closed");
  memory.dispose();
});

test("the plate holder frames the photograph and follows the timeline", async () => {
  const seen = { layouts:[], frames:[] };
  const plate = { object:new THREE.Group(), layout(layout) { seen.layouts.push(layout.photoWidth); },
    update(frame, settings) { seen.frames.push([frame.phase,settings.colorDuration]); }, dispose() { seen.disposed = true; } };
  const f = await fixture(undefined, { plate });
  const { memory } = f;
  assert.ok(f.matte.parent.children.includes(plate.object));
  assert.equal(seen.layouts.at(-1),memory.layout.photoWidth);
  memory.setTuning({ matchFrame:.6 });
  assert.equal(seen.layouts.at(-1),memory.layout.photoWidth);
  await memory.prepare(f.context);
  memory.activate(10);
  memory.seek(memory.getSettings().colorDuration+.1);
  assert.deepEqual(seen.frames.at(-1),["surface",memory.getSettings().colorDuration]);
  memory.reset();
  assert.equal(seen.frames.at(-1)[0],"dormant");
  memory.dispose();
  assert.ok(seen.disposed);
  assert.equal(plate.object.parent,null);
});

test("the match waits for the phone to be sideways, steady and at the spot", async () => {
  const f = await fixture();
  const { memory } = f;
  await memory.prepare(f.context);
  const run = (camera, canvas) => {
    for (let n = 0; n < 40; n++) memory.update(camera,canvas,20+n*.05);
    return memory.match;
  };
  const here = new THREE.Vector3();
  let phone = phoneAt(f,here,{ wide:false });
  assert.equal(run(phone.camera,phone.canvas).hint,"Turn your phone sideways");
  // With rotation lock the page stays portrait while the phone turns.
  phone = phoneAt(f,here,{ wide:false, roll:Math.PI/2 });
  memory.setMatching(false);
  assert.equal(run(phone.camera,phone.canvas),null);
  assert.equal(memory.phase,"dormant");
  memory.setMatching(true);
  phone = phoneAt(f,new THREE.Vector3(0,0,1));
  assert.equal(run(phone.camera,phone.canvas).hint,"Walk up until the photograph fills the frame");
  assert.equal(memory.phase,"dormant");
  close(memory.correction.length(),0);
  phone = phoneAt(f,here,{ wide:false, roll:Math.PI/2 });
  run(phone.camera,phone.canvas);
  assert.equal(memory.phase,"colorizing");
  memory.dispose();
});
