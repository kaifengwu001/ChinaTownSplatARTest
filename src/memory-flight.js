import * as THREE from "three";
import { ARRIVAL } from "./memory-people.js";

// Peter SooHoo's print as a real card: it leaves the stack where the DOM print
// sat and glides into the photograph in one unbroken curve. It rises from the
// pile, draws a little toward the viewer as it sweeps over to him, and comes
// down along the line of sight to his eyes, tilted back, settling flat as it
// touches. It never turns its back on the viewer. Its soft shadow on the
// photograph tightens as it comes in. Touching starts the activation; the
// card then dissolves into the street as the colour arrives. Pure path
// geometry is exported for node --test.

// Seconds from the pile to the photograph: unhurried, slowing all the way in.
export const FLIGHT_DURATION = 2.4;
// The curve comes in toward the photograph along the line of sight to his
// eyes, through where the card would be this many times his size there.
export const APPROACH = 1.6;
// The DOM print's cream border, as a fraction of its photograph's height.
export const DEFAULT_BORDER = 0.045;
// Lands this far in front of the photograph, along the line of sight, so
// nothing coplanar can fight it for depth; from the eye it still sits exactly
// over Peter.
const LANDING_LIFT = 0.0015;
// The start sits where the card is as large as it will be in the photograph,
// kept clear of the near plane and in front of the photograph and its plate.
const NEAREST = 0.25, FARTHEST = 1.5, BEFORE_PHOTO = 0.92;
// The curve: it lifts off toward the viewer and rises, and comes in from a
// little above the line of sight, in fractions of the distance it crosses.
const LIFT = 0.42, RISE = 0.24, SETTLE = 0.06;
// How far it tilts on the way, in radians about its own axes: its top edge
// back, latest and most, so it comes in tilted and settles flat; its leading
// edge away as it crosses; a slight bank into the curve as it rises.
const PITCH = -0.42, YAW = -0.26, ROLL = 0.12;
// The paper's gentle flex at its side edges, in radians, mid-flight.
const BEND = 0.1;
// The print's corner radius, as a fraction of its height (the DOM's 2 px).
const CORNER = 0.02;
// Self-lit, from the upper left and in front of the photograph in the stage's
// frame, as the plate holder is. Ambient and key sum to exactly 1 face-on, so
// at the handoff the card is as bright as the unlit DOM print it replaces.
const KEY_LIGHT = new THREE.Vector3(-0.453, 0.655, 0.604).normalize();
const KEY = 0.42, AMBIENT = 1-KEY*KEY_LIGHT.z;
// Its shadow's light is more frontal than the key, so the shadow gathers
// close under the print, the way a print casts one as it is laid down.
const SHADOW_LIGHT = new THREE.Vector3(-0.22, 0.32, 0.92).normalize();
const PAPER = 0xf1e9d8;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (from, to, x) => { const t = clamp01((x-from)/(to-from)); return t*t*(3-2*t); };

// CSS cubic-bezier timing, solved for x, so the motion uses the stageshow kit's curves.
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3*x1, bx = 3*(x2-x1)-cx, ax = 1-cx-bx;
  const cy = 3*y1, by = 3*(y2-y1)-cy, ay = 1-cy-by;
  const sampleX = (t) => ((ax*t+bx)*t+cx)*t, sampleY = (t) => ((ay*t+by)*t+cy)*t, slopeX = (t) => (3*ax*t+2*bx)*t+cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t)-x;
      if (Math.abs(error) < 1e-7) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error/slope;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40 && hi-lo > 1e-7; i++) { if (sampleX(t) < x) lo = t; else hi = t; t = (lo+hi)/2; }
    return sampleY(t);
  };
}
// Between the kit's travel and Fly curves: it leaves the pile gently and
// takes a long, soft settle into the photograph, no bounce.
const glide = cubicBezier(0.42, 0, 0.22, 1);
// The kit's arrival curve, for shedding the tilt it had in the pile early.
const arrive = cubicBezier(0.25, 0.8, 0.25, 1);
// Tilts that rise from nothing and settle back with no jolt at either end,
// peaking early, midway and late in the flight.
const early = (t) => t*t*(1-t)**3/0.03456;
const middle = (t) => 16*t*t*(1-t)**2;
const late = (t) => t**3*(1-t)**2/0.03456;

function bezierAt([p0, p1, p2, p3], t, target) {
  const s = 1-t;
  return target.set(0, 0, 0).addScaledVector(p0, s*s*s).addScaledVector(p1, 3*s*s*t)
    .addScaledVector(p2, 3*s*t*t).addScaledVector(p3, t*t*t);
}

/** The card's size: its photograph `photoHeight` tall and `aspect` times as wide, inside a border `border` times that height. */
export function cardSize(aspect, border, photoHeight) {
  const edge = border*photoHeight;
  return { width: aspect*photoHeight+2*edge, height: photoHeight+2*edge, photoHeight, border: edge };
}

/**
 * Where the card lies in the photograph: upright and flat, its photograph
 * `street.eyes / portrait.eyes` of the photograph's height tall, so his face
 * on the card matches his face in the street, and the point between its eyes
 * on his. `eye` is the viewer's eye in the stage's frame; the card sits just
 * in front of the photograph on the line of sight through his eyes.
 */
export function landingPose(layout, { aspect, border = DEFAULT_BORDER }, arrival = ARRIVAL, eye = new THREE.Vector3()) {
  const size = cardSize(aspect, border, arrival.street.eyes/arrival.portrait.eyes*layout.photoHeight);
  const eyes = new THREE.Vector3((arrival.street.x-0.5)*layout.photoWidth, (0.5-arrival.street.y)*layout.photoHeight, -layout.photoDistance);
  // The point between the card's own eyes, from its centre.
  const offset = new THREE.Vector3((arrival.portrait.x-0.5)*aspect*size.photoHeight, (0.5-arrival.portrait.y)*size.photoHeight, 0);
  const lifted = eyes.clone().addScaledVector(eye.clone().sub(eyes).normalize(), LANDING_LIFT);
  return { position: lifted.sub(offset), quaternion: new THREE.Quaternion(), size, eyes, offset };
}

/** Where it waits in front of him: on the line of sight to his eyes, `factor` times nearer, so `factor` times his size. */
export function approachPose(landing, eye, factor = APPROACH) {
  const point = eye.clone().lerp(landing.position.clone().add(landing.offset), 1/factor);
  return { position: point.sub(landing.offset), quaternion: landing.quaternion.clone() };
}

/**
 * The 3D card's start: where it covers the DOM print exactly. `pose` is the
 * print's centre and unrotated size in viewport CSS px, its border, and its
 * on-screen rotation in degrees clockwise; `rect` the canvas the projection
 * maps onto. The card faces the camera at the depth where it is `height`
 * (the landing's) tall, so its size holds through the flight; outside
 * `depthRange` it starts `scale` times that and eases back.
 */
export function startPose({ pose, rect, projection, cameraToParent, height, depthRange: [nearest, farthest] }) {
  const inverse = new THREE.Matrix4().copy(projection).invert();
  // A point on the screen, on its ray at one unit of depth in front of the camera.
  const ray = (x, y) => {
    const p = new THREE.Vector3((x-rect.left)/rect.width*2-1, 1-(y-rect.top)/rect.height*2, 0.5).applyMatrix4(inverse);
    return p.multiplyScalar(-1/p.z);
  };
  const angle = THREE.MathUtils.degToRad(pose.rotation);
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const centre = ray(pose.x, pose.y);
  const linear = new THREE.Matrix3().setFromMatrix4(cameraToParent);
  // Its half-height and half-width upward and rightward on the screen, per unit of depth.
  const up = ray(pose.x+sin*pose.height/2, pose.y-cos*pose.height/2).sub(centre).applyMatrix3(linear);
  const right = ray(pose.x+cos*pose.width/2, pose.y+sin*pose.width/2).sub(centre).applyMatrix3(linear);
  const perDepth = 2*up.length();
  const depth = Math.min(farthest, Math.max(nearest, height/perDepth));
  const position = centre.multiplyScalar(depth).applyMatrix4(cameraToParent);
  const x = right.normalize(), y = up.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  y.crossVectors(z, x);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return { position, quaternion, depth, scale: perDepth*depth/height };
}

/**
 * Without a DOM print to replace, it starts from the lower right as the
 * phone is held: the stage's up, seen from the camera, gives the turn.
 */
export function heldPose(rect, cameraToParent, aspect, border = DEFAULT_BORDER) {
  const up = new THREE.Vector3(0, 1, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(cameraToParent).invert());
  const angle = Math.atan2(up.x, up.y);
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const long = Math.abs(cos)*rect.width+Math.abs(sin)*rect.height, short = Math.abs(sin)*rect.width+Math.abs(cos)*rect.height;
  const photo = 0.24*short, edge = Math.max(3, border*photo);
  const across = 0.36*long, down = 0.3*short;
  return { x: rect.left+rect.width/2+cos*across-sin*down, y: rect.top+rect.height/2+sin*across+cos*down,
    width: aspect*photo+2*edge, height: photo+2*edge, border: edge, rotation: THREE.MathUtils.radToDeg(angle) };
}

/**
 * The flight from `start` to `landing` for a viewer at `eye`: one cubic curve
 * that leaves the pile rising and drawing toward the viewer, and comes into
 * the photograph from `approach`, on the line of sight to his eyes, a little
 * above it, so the last of the glide settles down into place.
 */
export function flightPath({ start, approach, landing, eye }) {
  const span = approach.position.distanceTo(start.position);
  const up = new THREE.Vector3(0, 1, 0);
  const toEye = eye.clone().sub(start.position).normalize();
  return { start, approach, landing, eye: eye.clone(),
    curve: [start.position.clone(),
      start.position.clone().addScaledVector(toEye, LIFT*span).addScaledVector(up, RISE*span),
      approach.position.clone().addScaledVector(up, SETTLE*span),
      landing.position.clone()] };
}

const tilt = new THREE.Euler();
const tilted = new THREE.Quaternion();

/** The card `seconds` into its flight: where it is, how it is turned and flexed, and its size relative to its landing. */
export function sampleFlight(path, seconds, target = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1, bend: 0, stage: "glide" }) {
  const t = clamp01(seconds/FLIGHT_DURATION);
  const along = glide(t);
  bezierAt(path.curve, along, target.position);
  // It sheds the pile's tilt early, upright by the middle of the glide, and
  // tilts on its own axes on the way: back latest, so it comes in tilted and
  // lies flat only as it touches. Near the photograph the tilt eases off with
  // the gap, so no edge reaches through it.
  target.quaternion.slerpQuaternions(path.start.quaternion, path.landing.quaternion, arrive(clamp01(t/0.55)));
  const gap = target.position.distanceTo(path.landing.position);
  const clear = smoothstep(0, 0.02, gap);
  target.quaternion.multiply(tilted.setFromEuler(tilt.set(PITCH*late(t)*clear, YAW*middle(t), ROLL*early(t), "YXZ")));
  target.scale = THREE.MathUtils.lerp(path.start.scale, 1, along);
  target.bend = BEND*middle(t);
  target.stage = t >= 1 ? "landed" : "glide";
  return target;
}

/**
 * The card's shadow on the photograph when it is `gap` metres in front of
 * it: wide and faint further off, gathering and darkening as it comes in.
 */
export function shadowFor(gap) {
  const height = Math.max(0, gap);
  return { softness: 0.0025+0.3*height, strength: 0.3*(1-smoothstep(0.04, 0.3, height)) };
}

/** How much of the card still shows as the colour arrives: its border first, then the print. */
export function settleOpacity(frame) {
  if (frame.phase === "dormant") return { opacity: 1, border: 1 };
  if (frame.phase !== "colorizing") return { opacity: 0, border: 0 };
  return { opacity: 1-smoothstep(0.04, 0.28, frame.color), border: 1-smoothstep(0, 0.14, frame.color) };
}

// Seeded, so every visit draws the same paper.
function random(seed) {
  return () => {
    seed = (seed+0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t+Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0)/4294967296;
  };
}

// The back of the print: aged paper with his name in pencil. Only where a
// canvas exists; node tests and anything without one see plain paper.
function paperBack(title, aspect) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const width = 512, height = Math.round(width/aspect);
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const rand = random(1907);
  g.fillStyle = "#e7dbc3";
  g.fillRect(0, 0, width, height);
  for (let i = 0; i < 14; i++) {
    const x = rand()*width, y = rand()*height, r = (0.2+0.3*rand())*width;
    const stain = g.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, `rgba(168, 136, 92, ${0.05+0.05*rand()})`);
    stain.addColorStop(1, "rgba(168, 136, 92, 0)");
    g.fillStyle = stain;
    g.fillRect(0, 0, width, height);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(150, 108, 66, ${0.1+0.18*rand()})`;
    g.beginPath(); g.arc(rand()*width, rand()*height, 0.8+3*rand(), 0, 2*Math.PI); g.fill();
  }
  g.lineWidth = 0.6;
  for (let i = 0; i < 320; i++) {
    const x = rand()*width, y = rand()*height, length = 4+10*rand(), angle = rand()*Math.PI;
    g.strokeStyle = rand() < 0.6 ? "rgba(255, 250, 238, 0.2)" : "rgba(120, 98, 66, 0.08)";
    g.beginPath(); g.moveTo(x, y); g.lineTo(x+Math.cos(angle)*length, y+Math.sin(angle)*length); g.stroke();
  }
  const edge = g.createRadialGradient(width/2, height/2, 0.35*Math.min(width, height), width/2, height/2, 0.75*Math.max(width, height));
  edge.addColorStop(0, "rgba(140, 108, 68, 0)");
  edge.addColorStop(1, "rgba(140, 108, 68, 0.3)");
  g.fillStyle = edge;
  g.fillRect(0, 0, width, height);
  // His name in soft pencil across the lower third, broken up by the paper's tooth.
  const size = Math.round(width*0.085);
  g.save();
  g.translate(width/2, height*0.7);
  g.rotate(-0.04);
  g.font = `italic ${size}px ui-serif, "New York", Georgia, "Times New Roman", serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(72, 66, 60, 0.6)";
  g.fillText(title, 0, 0);
  const span = Math.min(width*0.9, g.measureText(title).width);
  g.fillStyle = "rgba(231, 219, 195, 0.55)";
  for (let i = 0; i < 1800; i++) g.fillRect(-span/2+rand()*span, -size*0.6+rand()*size*1.2, 1, 1);
  g.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const vertexShader = /* glsl */ `
  uniform vec2 size;
  uniform float bend;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec3 p = vec3(position.xy*size, 0.0);
    vLocal = p.xy;
    vec3 n = vec3(0.0, 0.0, 1.0);
    // The paper flexes about its upright axis as a cylinder through its
    // centre, its side edges curling back, so no length stretches.
    float curvature = bend/(0.5*size.x);
    if (abs(curvature) > 1e-4) {
      float angle = curvature*p.x;
      p.x = sin(angle)/curvature;
      p.z = -(1.0-cos(angle))/curvature;
      n = vec3(sin(angle), 0.0, cos(angle));
    }
    vec4 view = modelViewMatrix*vec4(p, 1.0);
    vNormal = normalize(normalMatrix*n);
    vView = -view.xyz;
    gl_Position = projectionMatrix*view;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D print;
  uniform sampler2D paperBack;
  uniform float hasBack;
  uniform vec3 paper;
  uniform vec2 size;
  uniform vec2 inset;
  uniform float radius;
  uniform float opacity;
  uniform float borderOpacity;
  uniform vec3 keyLight;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 normal = normalize(vNormal)*(gl_FrontFacing ? 1.0 : -1.0);
    vec3 light = normalize((viewMatrix*vec4(keyLight, 0.0)).xyz);
    vec3 eye = normalize(vView);
    float shade = ${AMBIENT.toFixed(6)}+${KEY.toFixed(6)}*max(dot(normal, light), 0.0);
    float sheen = pow(max(dot(normal, normalize(light+eye)), 0.0), 48.0);
    // Rounded corners, as the DOM print's.
    vec2 q = abs(vLocal)-(0.5*size-radius);
    float corner = length(max(q, 0.0))+min(max(q.x, q.y), 0.0)-radius;
    float soft = max(fwidth(corner), 1e-6);
    float coverage = 1.0-smoothstep(-soft, soft, corner);
    vec3 base;
    float alpha;
    if (gl_FrontFacing) {
      vec2 photoUv = (vUv-inset)/(1.0-2.0*inset);
      vec2 edge = min(photoUv, 1.0-photoUv);
      vec2 width = max(fwidth(photoUv), vec2(1e-6));
      float inside = smoothstep(-width.x, width.x, edge.x)*smoothstep(-width.y, width.y, edge.y);
      base = mix(paper, texture2D(print, clamp(photoUv, 0.0, 1.0)).rgb, inside);
      alpha = opacity*mix(borderOpacity, 1.0, inside);
      sheen *= 0.08;
    } else {
      // Seen from behind, so the writing reads the right way round.
      base = mix(paper*0.95, texture2D(paperBack, vec2(1.0-vUv.x, vUv.y)).rgb, hasBack);
      alpha = opacity*borderOpacity;
      sheen *= 0.03;
    }
    gl_FragColor = vec4(base*shade+sheen, alpha*coverage);
    #include <colorspace_fragment>
  }
`;

// The shadow is the card's own surface, grown by its penumbra and cast along
// the key light onto the photograph's plane in the stage's frame; it ignores
// its own transform. Only the photograph receives it.
const shadowVertexShader = /* glsl */ `
  uniform mat4 cardMatrix;
  uniform mat4 stageMatrix;
  uniform vec2 size;
  uniform float bend;
  uniform float margin;
  uniform vec3 lightDirection;
  uniform float planeZ;
  varying vec2 vLocal;
  varying vec2 vPlane;
  void main() {
    vec3 p = vec3(position.xy*(size+2.0*margin), 0.0);
    vLocal = p.xy;
    float curvature = bend/(0.5*size.x);
    if (abs(curvature) > 1e-4) {
      float angle = curvature*p.x;
      p.x = sin(angle)/curvature;
      p.z = -(1.0-cos(angle))/curvature;
    }
    vec3 s = (cardMatrix*vec4(p, 1.0)).xyz;
    s -= lightDirection*((s.z-planeZ)/max(lightDirection.z, 0.05));
    vPlane = s.xy;
    gl_Position = projectionMatrix*viewMatrix*stageMatrix*vec4(s.xy, planeZ, 1.0);
  }
`;

const shadowFragmentShader = /* glsl */ `
  uniform vec2 size;
  uniform float radius;
  uniform float softness;
  uniform float strength;
  uniform vec4 photoRect;
  varying vec2 vLocal;
  varying vec2 vPlane;
  void main() {
    if (any(lessThan(vPlane, photoRect.xy)) || any(greaterThan(vPlane, photoRect.zw))) discard;
    vec2 q = abs(vLocal)-(0.5*size-radius);
    float d = length(max(q, 0.0))+min(max(q.x, q.y), 0.0)-radius;
    float shade = strength*(1.0-smoothstep(-softness, softness, d));
    if (shade <= 0.0) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, shade);
  }
`;

/**
 * Peter's card in 3D. `mesh` goes into the memory's stage; `launch` replaces
 * the DOM print with it at `now`, `update` flies it and reports when it has
 * touched the photograph, and `settle` dissolves it into the photograph on
 * the memory's clock. While idle it stays in the scene, clear, so the
 * memory's preparation compiles its shader.
 */
export function createCardFlight({ texture, person, arrival = ARRIVAL }) {
  texture.colorSpace = THREE.SRGBColorSpace;
  const shape = cardSize(person.aspect, DEFAULT_BORDER, 1);
  const back = paperBack(person.title, shape.width/shape.height);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      print: { value: texture }, paperBack: { value: back }, hasBack: { value: back ? 1 : 0 },
      paper: { value: new THREE.Color(PAPER) }, size: { value: new THREE.Vector2(1, 1) }, inset: { value: new THREE.Vector2() },
      radius: { value: 0 }, opacity: { value: 0 }, borderOpacity: { value: 1 }, bend: { value: 0 },
      keyLight: { value: KEY_LIGHT.clone() },
    },
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const geometry = new THREE.PlaneGeometry(1, 1, 32, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "arriving-card";
  // Over the photograph (1) and the guide frame (3): the print is nearer than both.
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  // Its soft shadow on the photograph, drawn over the photograph (1) and under
  // the card. A child, so it shows and hides with the card.
  const shadowMaterial = new THREE.ShaderMaterial({
    uniforms: {
      cardMatrix: { value: new THREE.Matrix4() }, stageMatrix: { value: new THREE.Matrix4() },
      size: material.uniforms.size, bend: material.uniforms.bend, radius: material.uniforms.radius,
      margin: { value: 0 }, softness: { value: 0.01 }, strength: { value: 0 },
      lightDirection: { value: SHADOW_LIGHT.clone() }, planeZ: { value: -1 }, photoRect: { value: new THREE.Vector4() },
    },
    vertexShader: shadowVertexShader, fragmentShader: shadowFragmentShader,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const shadowGeometry = new THREE.PlaneGeometry(1, 1, 32, 1);
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.name = "arriving-card-shadow";
  shadow.renderOrder = 2;
  shadow.frustumCulled = false;
  shadow.onBeforeRender = () => { if (mesh.parent) shadowMaterial.uniforms.stageMatrix.value.copy(mesh.parent.matrixWorld); };
  mesh.add(shadow);
  let planeZ = -1;
  const cameraToParent = new THREE.Matrix4();
  const parentQuaternion = new THREE.Quaternion();
  const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1, bend: 0, stage: "travel" };
  let state = "idle", launchedAt = 0, landedAt = null, path = null, gone = false;

  function show({ position, quaternion, scale, bend }) {
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    mesh.scale.setScalar(scale);
    material.uniforms.bend.value = bend;
    mesh.updateMatrix();
    shadowMaterial.uniforms.cardMatrix.value.copy(mesh.matrix);
    shade();
  }

  // The shadow follows the card's gap to the photograph, and fades with it.
  function shade() {
    const { softness, strength } = shadowFor(mesh.position.z-planeZ);
    shadowMaterial.uniforms.softness.value = softness;
    shadowMaterial.uniforms.margin.value = 1.6*softness;
    shadowMaterial.uniforms.strength.value = strength*material.uniforms.opacity.value;
  }

  function idle() {
    state = "idle"; landedAt = null; path = null; gone = false;
    mesh.visible = true;
    mesh.position.set(0, 0, -1);
    mesh.quaternion.identity();
    mesh.scale.setScalar(1);
    material.uniforms.opacity.value = 0;
    material.uniforms.borderOpacity.value = 1;
    material.uniforms.bend.value = 0;
    shadowMaterial.uniforms.strength.value = 0;
  }

  function light() {
    if (mesh.parent) mesh.parent.getWorldQuaternion(parentQuaternion);
    else parentQuaternion.identity();
    material.uniforms.keyLight.value.copy(KEY_LIGHT).applyQuaternion(parentQuaternion);
  }

  idle();
  return {
    mesh,
    get state() { return state; },
    /** The flight's start, approach and landing, once launched. */
    get path() { return path; },
    /**
     * Replace the DOM print `pose` (see the stack's launch) with the card,
     * seen by `camera` on the canvas `rect`, and fly it into the photograph
     * of `layout` from `now` (seconds). The card must already be in the stage.
     */
    launch({ camera, rect, pose: print, layout, now }) {
      const parent = mesh.parent;
      if (!parent) throw new Error("Add the card to the stage before launching it");
      parent.updateWorldMatrix(true, false);
      camera.updateWorldMatrix(true, false);
      cameraToParent.copy(parent.matrixWorld).invert().multiply(camera.matrixWorld);
      const eye = new THREE.Vector3().setFromMatrixPosition(cameraToParent);
      const fraction = print?.border/(print?.height-2*print?.border);
      const border = fraction > 0 && Number.isFinite(fraction) ? fraction : DEFAULT_BORDER;
      const landing = landingPose(layout, { aspect: person.aspect, border }, arrival, eye);
      const from = print ?? heldPose(rect, cameraToParent, person.aspect, border);
      const start = startPose({ pose: from, rect, projection: camera.projectionMatrix, cameraToParent, height: landing.size.height,
        depthRange: [NEAREST, Math.min(FARTHEST, BEFORE_PHOTO*layout.photoDistance)] });
      path = flightPath({ start, approach: approachPose(landing, eye), landing, eye });
      const { width, height, border: edge } = landing.size;
      material.uniforms.size.value.set(width, height);
      material.uniforms.inset.value.set(edge/width, edge/height);
      material.uniforms.radius.value = CORNER*height;
      material.uniforms.opacity.value = 1;
      material.uniforms.borderOpacity.value = 1;
      // The shadow falls on the photograph, just in front of it and behind the landed card.
      planeZ = -layout.photoDistance+0.0008;
      shadowMaterial.uniforms.planeZ.value = planeZ;
      shadowMaterial.uniforms.photoRect.value.set(-layout.photoWidth/2, -layout.photoHeight/2, layout.photoWidth/2, layout.photoHeight/2);
      state = "flying"; launchedAt = now; landedAt = null; gone = false;
      mesh.visible = true;
      show(sampleFlight(path, 0, pose));
      light();
      return path;
    },
    /** Every frame: fly on; `landedAt` is when it touched the photograph, on the same clock as `now`. */
    update(now) {
      if (state === "flying") {
        // Compared on the caller's clock, so `start + FLIGHT_DURATION` lands exactly.
        const end = launchedAt+FLIGHT_DURATION;
        if (now >= end) { state = "landed"; landedAt = end; }
        show(sampleFlight(path, now >= end ? FLIGHT_DURATION : now-launchedAt, pose));
      }
      light();
      return { state, landedAt };
    },
    /** After the activation, every frame with the memory's frame: it dissolves into the photograph, then stays hidden. */
    settle(frame) {
      if (state !== "landed" || gone) return;
      const { opacity, border } = settleOpacity(frame);
      material.uniforms.opacity.value = opacity;
      material.uniforms.borderOpacity.value = border;
      shade();
      if (opacity <= 0) { gone = true; mesh.visible = false; }
    },
    reset() { idle(); },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      back?.dispose();
    },
  };
}
