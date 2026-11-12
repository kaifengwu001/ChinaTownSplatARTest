import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ease } from "./memory-timeline.js";

// The wooden plate holder the historical photograph sits in, cut from the
// user's model by scripts/extract_plate.py: its dark slide is out, the hole
// goes through, and its opening is 1 wide and 0.75 tall, centred, with the
// photograph's plane at z = 0 and the frame's face toward +z.
export const PLATE_URL = new URL("../input/plate/photo-plate.glb", import.meta.url).href;
export const PLATE_OPENING = Object.freeze({ width: 1, height: 0.75 });
// The plate gives way once the colour is this far across the photograph, and
// is gone by the end of the flat hold, before the street opens into depth.
export const PLATE_DISSOLVE_START = 0.8;

/** The plate's geometry and texture, as the model ships them. Browser only. */
export async function loadPhotoPlate(url = PLATE_URL) {
  const gltf = await new GLTFLoader().loadAsync(url);
  let mesh = null;
  gltf.scene.traverse(object => { if (!mesh && object.isMesh) mesh = object; });
  const map = mesh?.material?.map;
  if (!map) throw new Error("The photo plate model has no textured mesh");
  map.colorSpace = THREE.SRGBColorSpace;
  // The viewer walks up to it at an angle; keep the wood grain from smearing.
  map.anisotropy = 4;
  mesh.material.dispose();
  return { geometry: mesh.geometry, map };
}

/** How far the plate has dissolved: 0 whole, 1 gone. */
export function plateDissolve(frame, settings) {
  if (!frame || frame.phase === "dormant") return 0;
  const start = PLATE_DISSOLVE_START*settings.colorDuration;
  const end = settings.colorDuration+settings.flatHoldDuration;
  return ease((frame.seconds-start)/Math.max(end-start, 1e-6));
}

// Lit in its own frame, so it needs no scene lights: the AR scene has none,
// and adding some would recompile every other lit material.
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vLocal = position;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float dissolve;
  uniform vec4 bounds; // the plate's outer edge in its own units: left, bottom, right, top
  uniform vec2 opening;
  uniform vec3 eye; // the camera, in the plate's own units
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vNormal;
  // A key light high on the left in front of the plate, as in the street.
  const vec3 KEY = vec3(-0.453, 0.655, 0.604);
  const vec3 CREAM = vec3(1.0, 0.871, 0.672); // #fff0d6, linear
  const float EDGE = 0.05;
  float plateHash(vec3 p) {
    p = fract(p*0.3183099+0.1);
    p *= 17.0;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
  }
  float plateNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(mix(plateHash(i), plateHash(i+vec3(1,0,0)), f.x), mix(plateHash(i+vec3(0,1,0)), plateHash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(plateHash(i+vec3(0,0,1)), plateHash(i+vec3(1,0,1)), f.x), mix(plateHash(i+vec3(0,1,1)), plateHash(i+vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    // How far out from the opening toward the plate's outer edge, 0 to 1 on
    // every side, so the dissolve reaches all of the edge together; noise on
    // the plate's own surface breaks its front up.
    vec2 inner = 0.5*opening, p = vLocal.xy;
    float across = (abs(p.x)-inner.x)/((p.x < 0.0 ? -bounds.x : bounds.z)-inner.x);
    float up = (abs(p.y)-inner.y)/((p.y < 0.0 ? -bounds.y : bounds.w)-inner.y);
    float grain = 0.55*plateNoise(vLocal*16.0)+0.3*plateNoise(vLocal*33.0+5.3)+0.15*plateNoise(vLocal*68.0-2.9);
    float field = mix(clamp(max(across, up), 0.0, 1.0), grain, 0.42);
    float front = dissolve*(1.0+2.0*EDGE)-EDGE;
    if (field < front) discard;

    vec3 view = normalize(eye-vLocal);
    vec3 n = faceforward(normalize(vNormal), -view, normalize(vNormal));
    vec3 albedo = texture2D(map, vUv).rgb;
    float key = max(dot(n, KEY), 0.0);
    // Old lacquer: mostly matte, with a low sheen toward the light and a
    // faint lift at grazing angles that keeps the edges from sinking into a
    // dark street.
    float sheen = pow(max(dot(n, normalize(KEY+view)), 0.0), 28.0);
    float rim = pow(1.0-max(dot(n, view), 0.0), 3.0);
    vec3 color = albedo*(0.38+0.08*n.y+0.7*key)+0.05*sheen*key+0.025*rim;
    // The frame turns to light from the photograph outward: a thin cream
    // edge where it gives way, with a faint warmth just ahead of it.
    float ahead = field-front;
    float glow = step(0.0005, dissolve)*(1.0-smoothstep(0.0, EDGE, ahead));
    float warmth = step(0.0005, dissolve)*0.08*(1.0-smoothstep(0.0, 0.12, ahead));
    color = mix(mix(color, CREAM*0.6, warmth), CREAM, glow);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The plate around the photograph, in the stage's frame: `layout` fits its
 * opening to the photograph, and `update` dissolves it near the end of the
 * colour. It stays visible while dormant, so the memory's warm-up compiles it.
 */
export function createPhotoPlate({ geometry, map }) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      dissolve: { value: 0 },
      bounds: { value: new THREE.Vector4(min.x, min.y, max.x, max.y) },
      opening: { value: new THREE.Vector2(PLATE_OPENING.width, PLATE_OPENING.height) },
      eye: { value: new THREE.Vector3(0, 0, 1) },
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "photo-plate";
  // Before the occluding matte (-1), which stands in the photograph's plane
  // and would otherwise hide the plate's back half.
  mesh.renderOrder = -2;
  const toLocal = new THREE.Matrix4();
  mesh.onBeforeRender = (renderer, scene, camera) => {
    toLocal.copy(mesh.matrixWorld).invert();
    material.uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(toLocal);
  };
  return {
    object: mesh,
    /** Fits the opening to the photograph at the layout's distance. */
    layout({ photoWidth, photoHeight, photoDistance }) {
      const scale = photoWidth/PLATE_OPENING.width;
      mesh.scale.set(scale, photoHeight/PLATE_OPENING.height, scale);
      mesh.position.set(0, 0, -photoDistance);
    },
    /** Follows the memory's timeline; returns how far it has dissolved. */
    update(frame, settings) {
      const amount = plateDissolve(frame, settings);
      material.uniforms.dissolve.value = amount;
      mesh.visible = amount < 1;
      return amount;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}
