import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MEMORY_SETTINGS } from "../src/memory-settings.js";
import { memoryFrame } from "../src/memory-timeline.js";
import { photographerLayout } from "../src/photographer.js";
import { ARRIVAL, PEOPLE } from "../src/memory-people.js";
import { APPROACH, FLIGHT_DURATION, createCardFlight, sampleFlight, shadowFor } from "../src/memory-flight.js";

const PETER = PEOPLE.find(person => person.arrives);
const DEGREE = Math.PI/180;
const TAN_LONG = Math.tan(32*DEGREE), TAN_SHORT = TAN_LONG*393/852;
const layout = photographerLayout(MEMORY_SETTINGS, { tanLong: TAN_LONG, tanShort: TAN_SHORT });
const close = (a, b, tolerance = 1e-9, what = "") => assert.ok(Math.abs(a-b) < tolerance, `${what} ${a} != ${b}`);

// A portrait page on a phone held sideways, top to the left (a quarter turn
// of 90°), standing at the spot of a stage placed somewhere in the world.
function rig({ offCentre = false } = {}) {
  const rect = { left: 0, top: 0, width: 393, height: 852 };
  const stage = new THREE.Group();
  stage.position.set(0.4, 1.3, -2.1);
  stage.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6);
  stage.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(64, rect.width/rect.height, 0.05, 100);
  const local = new THREE.Matrix4().compose(new THREE.Vector3(0.015, -0.01, 0.02),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.012, 0.02, Math.PI/2, "YXZ")), new THREE.Vector3(1, 1, 1));
  stage.matrixWorld.clone().multiply(local).decompose(camera.position, camera.quaternion, camera.scale);
  camera.updateMatrixWorld(true);
  if (offCentre) {
    // A WebXR-like projection with its centre off the screen's, pixels still square.
    const near = 0.05, x = TAN_SHORT*near, y = TAN_LONG*near;
    camera.projectionMatrix.makePerspective(-1.12*x, 0.88*x, 0.94*y, -1.06*y, near, 100);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  const eye = stage.worldToLocal(camera.position.clone());
  return { rect, stage, camera, eye };
}

// The stack's top print, held: its photograph 94 px tall with the DOM's border,
// in the lower right as held (the page's lower left), tilted 6° back.
function printPose(photo = 94) {
  const border = Math.max(3, 0.045*photo);
  return { x: 70, y: 742, width: PETER.aspect*photo+2*border, height: photo+2*border, border, rotation: 90-6 };
}

function launched(options = {}) {
  const f = rig(options);
  const flight = createCardFlight({ texture: new THREE.Texture(), person: PETER });
  f.stage.add(flight.mesh);
  const pose = "pose" in options ? options.pose : printPose();
  const path = flight.launch({ camera: f.camera, rect: f.rect, pose, layout, now: 10 });
  return { ...f, flight, pose, path };
}

// Card-local point (bend 0) to page CSS px, as the camera sees it.
function onPage({ flight, camera, rect, stage }, x, y) {
  stage.updateMatrixWorld(true);
  const p = new THREE.Vector3(x, y, 0).applyMatrix4(flight.mesh.matrixWorld).project(camera);
  return [rect.left+(p.x+1)/2*rect.width, rect.top+(1-p.y)/2*rect.height];
}

// Where a point of the DOM print lies on the page: `along` its width and `up` its height from its centre.
function onPrint(pose, along, up) {
  const angle = pose.rotation*DEGREE;
  return [pose.x+along*Math.cos(angle)+up*Math.sin(angle), pose.y+along*Math.sin(angle)-up*Math.cos(angle)];
}

function cardEyes(flight) {
  const { size, inset } = flight.mesh.material.uniforms;
  const photo = size.value.y*(1-2*inset.value.y);
  const local = new THREE.Vector3((ARRIVAL.portrait.x-0.5)*PETER.aspect*photo, (0.5-ARRIVAL.portrait.y)*photo, 0);
  return { photo: photo*flight.mesh.scale.x,
    point: local.multiplyScalar(flight.mesh.scale.x).applyQuaternion(flight.mesh.quaternion).add(flight.mesh.position) };
}

const peterEyes = () => new THREE.Vector3((ARRIVAL.street.x-0.5)*layout.photoWidth, (0.5-ARRIVAL.street.y)*layout.photoHeight, -layout.photoDistance);

for (const offCentre of [false, true]) {
  test(`at launch the card covers the DOM print exactly${offCentre ? ", through an off-centre projection" : ""}`, () => {
    const f = launched({ offCentre });
    const { size, inset } = f.flight.mesh.material.uniforms;
    const [width, height] = [size.value.x, size.value.y];
    const border = inset.value.y*height;
    for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      const [px, py] = onPage(f, sx*width/2, sy*height/2);
      const [ex, ey] = onPrint(f.pose, sx*f.pose.width/2, sy*f.pose.height/2);
      close(px, ex, 1, "corner x"); close(py, ey, 1, "corner y");
      // The photograph inside its cream border lines up too.
      const [ix, iy] = onPage(f, sx*(width/2-border), sy*(height/2-border));
      const [jx, jy] = onPrint(f.pose, sx*(f.pose.width/2-f.pose.border), sy*(f.pose.height/2-f.pose.border));
      close(ix, jx, 1, "photo corner x"); close(iy, jy, 1, "photo corner y");
    }
    // It faces the camera, unflexed and opaque, from the first frame.
    assert.equal(f.flight.mesh.material.uniforms.opacity.value, 1);
    assert.equal(f.flight.mesh.material.uniforms.bend.value, 0);
    assert.equal(f.flight.state, "flying");
  });
}

test("it touches the photograph with his eyes on Peter's, at his size there", () => {
  const f = launched();
  const { state, landedAt } = f.flight.update(10+FLIGHT_DURATION);
  assert.equal(state, "landed");
  close(landedAt, 10+FLIGHT_DURATION, 1e-12);
  f.stage.updateMatrixWorld(true);
  const { photo, point } = cardEyes(f.flight);
  close(photo, ARRIVAL.street.eyes/ARRIVAL.portrait.eyes*layout.photoHeight, 1e-9, "face-matched size");
  const peter = peterEyes();
  // From the viewer's eye the card's eyes cover his, from just in front of the photograph.
  assert.ok(point.clone().sub(f.eye).angleTo(peter.clone().sub(f.eye)) < 1e-6);
  assert.ok(point.z > -layout.photoDistance && point.z < -layout.photoDistance+0.002, `z ${point.z}`);
  close(point.x, peter.x, 2e-4, "x"); close(point.y, peter.y, 2e-4, "y");
  // Upright and flat in the photograph's plane.
  assert.ok(f.flight.mesh.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
  assert.equal(f.flight.mesh.material.uniforms.bend.value, 0);
});

test("update reports idle, then flying, then landed when it touches the photograph", () => {
  const f = rig();
  const flight = createCardFlight({ texture: new THREE.Texture(), person: PETER });
  f.stage.add(flight.mesh);
  assert.deepEqual(flight.update(5), { state: "idle", landedAt: null });
  flight.launch({ camera: f.camera, rect: f.rect, pose: printPose(), layout, now: 20 });
  assert.deepEqual(flight.update(20.5), { state: "flying", landedAt: null });
  assert.equal(flight.update(20+FLIGHT_DURATION-1e-6).state, "flying");
  assert.deepEqual(flight.update(20+FLIGHT_DURATION+0.3), { state: "landed", landedAt: 20+FLIGHT_DURATION });
  assert.deepEqual(flight.update(40), { state: "landed", landedAt: 20+FLIGHT_DURATION });
  assert.ok(FLIGHT_DURATION >= 2.2 && FLIGHT_DURATION <= 2.8, "unhurried, under three seconds");
});

// The flight sampled finely, from the pile to the photograph.
const trace = (path, steps = 240) => Array.from({ length: steps+1 }, (_, n) => sampleFlight(path, n/steps*FLIGHT_DURATION, {
  position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1, bend: 0, stage: "glide" }));

test("it glides in one unbroken curve, drawing toward the viewer, and settles into the photograph", () => {
  const f = launched();
  const { start, landing } = f.path;
  assert.ok(start.depth > 0.25 && start.depth < 0.92*layout.photoDistance, `depth ${start.depth}`);
  close(start.scale, 1, 1e-9, "start scale");
  const samples = trace(f.path);
  for (const at of samples) close(at.scale, 1, 1e-9, "it keeps its size");
  // It never stops on the way: every step moves it, and no step jumps.
  const steps = samples.slice(1).map((at, n) => at.position.distanceTo(samples[n].position));
  const longest = Math.max(...steps);
  assert.ok(steps.slice(1, -2).every(step => step > 0), "no pause before it touches");
  assert.ok(longest < 0.012, `no jump: ${longest}`);
  // It eases out of the pile and slows all the way into the photograph.
  assert.ok(steps[0] < 0.05*longest && steps.at(-1) < 0.05*longest);
  const peak = steps.indexOf(longest);
  for (let n = peak+1; n < steps.length; n++) assert.ok(steps[n] <= steps[n-1]+1e-12, `it slows at step ${n}`);
  // It draws toward the viewer, larger, before it recedes into the photograph.
  const nearest = Math.min(...samples.map(at => at.position.distanceTo(f.eye)));
  assert.ok(nearest < 0.85*landing.position.distanceTo(f.eye), `nearest ${nearest}`);
  assert.ok(nearest > landing.position.distanceTo(f.eye)/APPROACH, "never nearer than the approach");
  // It comes in along the line of sight to his eyes, from a little above it.
  const target = landing.position.clone().add(landing.offset);
  const late = sampleFlight(f.path, 0.92*FLIGHT_DURATION).position.clone().add(landing.offset);
  assert.ok(late.clone().sub(f.eye).angleTo(target.clone().sub(f.eye)) < 0.02);
  assert.ok(late.y > target.y-1e-9, "it settles down into place");
});

test("a print too small to match its size starts nearer its size and eases to it", () => {
  const f = launched({ pose: printPose(30) });
  assert.ok(f.path.start.scale < 1, `scale ${f.path.start.scale}`);
  close(f.path.start.depth, 0.92*layout.photoDistance, 1e-9, "clamped depth");
  let last = 0;
  for (const { scale } of trace(f.path, 60)) {
    assert.ok(scale >= last-1e-12, "it only grows");
    last = scale;
  }
  close(sampleFlight(f.path, FLIGHT_DURATION).scale, 1, 1e-12);
  // It still covers the DOM print at launch.
  const [px, py] = onPage(f, 0, 0);
  close(px, f.pose.x, 1); close(py, f.pose.y, 1);
});

test("it never turns its back: it tilts back as it comes in and lies flat as it touches", () => {
  const f = launched();
  const samples = trace(f.path);
  const facing = (at) => new THREE.Vector3(0, 0, 1).applyQuaternion(at.quaternion).dot(f.eye.clone().sub(at.position).normalize());
  // Its face is toward the viewer the whole way.
  assert.ok(Math.min(...samples.map(facing)) > 0.8);
  // It tilts well away from flat on the way, most of it its top edge leaning back,
  // and is still tilted as it comes in, flat only as it touches.
  const tilt = (at) => at.quaternion.angleTo(f.path.landing.quaternion);
  const most = Math.max(...samples.map(tilt));
  assert.ok(most > 20*DEGREE && most < 35*DEGREE, `tilt ${most/DEGREE}°`);
  assert.ok(tilt(sampleFlight(f.path, 0.75*FLIGHT_DURATION)) > 15*DEGREE, "tilted as it comes in");
  assert.ok(tilt(sampleFlight(f.path, 0.97*FLIGHT_DURATION)) < 1*DEGREE);
  const leaning = sampleFlight(f.path, 0.6*FLIGHT_DURATION);
  const top = new THREE.Vector3(0, 1, 0).applyQuaternion(leaning.quaternion);
  assert.ok(top.z < -0.3, "its top edge leans back, into the photograph");
  // No edge reaches through the photograph as it settles.
  const { width, height } = f.path.landing.size;
  for (const at of samples) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const corner = new THREE.Vector3(x*width/2, y*height/2, 0).applyQuaternion(at.quaternion).add(at.position);
    assert.ok(corner.z > -layout.photoDistance-0.002, `a corner reaches ${corner.z+layout.photoDistance} through`);
  }
  // The paper flexes a little, and is flat at both ends.
  const bends = samples.map(at => at.bend);
  assert.ok(Math.max(...bends) > 0.05 && Math.max(...bends) < 0.15);
  assert.equal(bends[0], 0); assert.equal(bends.at(-1), 0);
});

test("its shadow on the photograph gathers and darkens as it comes in", () => {
  let last = shadowFor(0.4);
  assert.equal(last.strength, 0, "too far off to cast one");
  for (let gap = 0.38; gap >= 0; gap -= 0.02) {
    const next = shadowFor(gap);
    assert.ok(next.strength >= last.strength-1e-12 && next.softness < last.softness, `at ${gap}`);
    last = next;
  }
  assert.ok(shadowFor(0.0015).softness < 0.004);
  const f = launched();
  const shadow = f.flight.mesh.children.find(child => child.name === "arriving-card-shadow");
  assert.ok(shadow && shadow.renderOrder > 1 && shadow.renderOrder < f.flight.mesh.renderOrder, "over the photograph, under the card");
  const { uniforms } = shadow.material;
  close(uniforms.planeZ.value, -layout.photoDistance+0.0008, 1e-12);
  close(uniforms.photoRect.value.z, layout.photoWidth/2, 1e-12);
  f.flight.update(10+FLIGHT_DURATION);
  close(uniforms.strength.value, shadowFor(f.flight.mesh.position.z-uniforms.planeZ.value).strength, 1e-12);
  // It fades with the card as the colour comes.
  f.flight.settle(memoryFrame(0.15*MEMORY_SETTINGS.colorDuration, MEMORY_SETTINGS));
  close(uniforms.strength.value, shadowFor(f.flight.mesh.position.z-uniforms.planeZ.value).strength*f.flight.mesh.material.uniforms.opacity.value, 1e-12);
  f.flight.reset();
  assert.equal(uniforms.strength.value, 0);
});

test("without a DOM print it starts from the lower right as the phone is held", () => {
  const f = launched({ pose: null });
  const [x, y] = onPage(f, 0, 0);
  // Held a quarter turn, the screen's lower right is the page's lower left.
  assert.ok(x < f.rect.width/2 && y > f.rect.height/2, `${x}, ${y}`);
  f.flight.update(10+FLIGHT_DURATION);
  f.stage.updateMatrixWorld(true);
  const { photo } = cardEyes(f.flight);
  close(photo, ARRIVAL.street.eyes/ARRIVAL.portrait.eyes*layout.photoHeight, 1e-9);
});

test("after the landing it dissolves into the photograph as the colour comes, then stays hidden", () => {
  const f = launched();
  const { uniforms } = f.flight.mesh.material;
  f.flight.settle(memoryFrame(0.2, MEMORY_SETTINGS));
  assert.equal(uniforms.opacity.value, 1, "settling waits for the landing");
  f.flight.update(10+FLIGHT_DURATION);
  const at = (color) => memoryFrame(color*MEMORY_SETTINGS.colorDuration, MEMORY_SETTINGS);
  f.flight.settle(at(0));
  assert.equal(uniforms.opacity.value, 1); assert.equal(uniforms.borderOpacity.value, 1);
  f.flight.settle(at(0.1));
  assert.ok(uniforms.borderOpacity.value < uniforms.opacity.value, "its border fades first");
  assert.ok(uniforms.opacity.value > 0 && uniforms.opacity.value < 1);
  f.flight.settle(at(0.3));
  assert.equal(uniforms.opacity.value, 0);
  assert.equal(f.flight.mesh.visible, false);
  f.flight.settle(at(0.05));
  assert.equal(f.flight.mesh.visible, false, "once gone it stays gone");
  f.flight.reset();
  assert.equal(f.flight.state, "idle");
  assert.equal(f.flight.mesh.visible, true);
  assert.equal(uniforms.opacity.value, 0);
  assert.deepEqual(f.flight.update(99), { state: "idle", landedAt: null });
});

test("while idle it stays in the scene, clear, so preparation compiles it", () => {
  const flight = createCardFlight({ texture: new THREE.Texture(), person: PETER });
  const { mesh } = flight;
  assert.equal(mesh.visible, true);
  assert.equal(mesh.frustumCulled, false);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.uniforms.opacity.value, 0);
  assert.ok(mesh.renderOrder > 1, "drawn over the photograph");
  assert.throws(() => flight.launch({ camera: new THREE.PerspectiveCamera(), rect: { left: 0, top: 0, width: 1, height: 1 }, pose: null, layout, now: 0 }), /stage/);
  flight.dispose();
});
