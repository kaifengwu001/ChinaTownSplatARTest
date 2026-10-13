import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";

const QUATERNION_GLSL = /* glsl */ `
  vec3 memoryRotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }
  vec4 memoryQuatMultiply(vec4 a, vec4 b) {
    return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz),
      a.w * b.w - dot(a.xyz, b.xyz));
  }
`;

/**
 * Project the actual reconstructed splats onto the photograph, then release
 * them to their unchanged 3D positions. Only uniforms change during animation;
 * no CPU splat traversal or per-frame texture uploads are needed.
 */
export function attachMemoryModifier(mesh, anchor, config, photoHeight, settings) {
  const u = {
    color: dyno.dynoFloat(-0.15),
    depth: dyno.dynoFloat(0),
    seconds: dyno.dynoFloat(0),
    meshFromAnchor: dyno.dynoMat4(new THREE.Matrix4()),
    anchorFromMesh: dyno.dynoMat4(new THREE.Matrix4()),
    anchorRotation: dyno.dynoVec4(new THREE.Vector4()),
    meshScale: dyno.dynoFloat(config.sceneScale),
  };
  const focalX = config.windowWidth * settings.captureFocalRatio;
  const focalY = focalX * photoHeight / (config.windowWidth / settings.captureAspect);
  const modifier = dyno.dyno({
    inTypes: { gsplat: dyno.Gsplat, color: "float", depth: "float", seconds: "float", meshFromAnchor: "mat4", anchorFromMesh: "mat4", anchorRotation: "vec4", meshScale: "float" },
    outTypes: { gsplat: dyno.Gsplat },
    inputs: u,
    globals: () => [dyno.defineGsplat, MEMORY_WAVE_GLSL, QUATERNION_GLSL],
    statements: ({ inputs: i, outputs: o }) => [/* glsl */ `
      ${o.gsplat} = ${i.gsplat};
      if (${i.depth} < 1.0) {
        vec3 source = ${i.gsplat}.center;
        float z = max(source.z, 0.001);
        vec2 focal = vec2(${focalX}, ${focalY});
        vec2 xy = source.xy * focal / z * vec2(1.0, -1.0);
        vec2 uv = xy / vec2(${config.windowWidth}, ${photoHeight}) + 0.5;
        float radius = memoryRadius(uv, ${i.seconds});
        float front = memoryFront(radius, ${i.color});
        float reveal = memoryReveal(radius, ${i.color});
        float expand = smoothstep(0.0, 1.0, clamp(
          (${i.depth} - 0.06 * clamp(radius, 0.0, 1.0)) / 0.94, 0.0, 1.0));

        // Project each Gaussian's covariance using the capture-camera Jacobian.
        // This preserves its footprint, rather than making every splat a dot.
        vec4 q = ${i.gsplat}.quaternion;
        vec3 s = ${i.gsplat}.scales;
        vec3 ax = memoryRotate(q, vec3(s.x, 0.0, 0.0));
        vec3 ay = memoryRotate(q, vec3(0.0, s.y, 0.0));
        vec3 az = memoryRotate(q, vec3(0.0, 0.0, s.z));
        vec2 jx = focal / z * (ax.xy - source.xy / z * ax.z) * vec2(1.0, -1.0);
        vec2 jy = focal / z * (ay.xy - source.xy / z * ay.z) * vec2(1.0, -1.0);
        vec2 jz = focal / z * (az.xy - source.xy / z * az.z) * vec2(1.0, -1.0);
        float a = jx.x*jx.x + jy.x*jy.x + jz.x*jz.x;
        float b = jx.x*jx.y + jy.x*jy.y + jz.x*jz.y;
        float d = jx.y*jx.y + jy.y*jy.y + jz.y*jz.y;
        float middle = (a + d) * 0.5;
        float delta = sqrt(max(0.0, (a-d)*(a-d)*0.25 + b*b));
        float angle = 0.5 * atan(2.0*b, a-d + 1e-12);
        vec3 flatScales = vec3(sqrt(max(middle+delta, 1e-10)),
          sqrt(max(middle-delta, 1e-10)), 0.000015) / ${i.meshScale};
        vec4 flatQ = memoryQuatMultiply(${i.anchorRotation},
          vec4(0.0, 0.0, sin(angle*0.5), cos(angle*0.5)));
        if (dot(flatQ, q) < 0.0) flatQ = -flatQ;

        // A narrow fluid crest stirs the surface, always behind the aperture.
        vec2 radial = normalize(xy + vec2(0.00001));
        vec2 tangent = vec2(-radial.y, radial.x);
        float hash = fract(sin(float(${i.gsplat}.index) * 12.9898) * 43758.5453);
        float ripple = sin(radius * 56.0 - ${i.seconds} * 12.0);
        xy += front * (radial * ripple * 0.008 + tangent * cos(radius*42.0 - ${i.seconds}*9.0) * 0.005);
        // Preserve the source's depth order in the flattened sheet to avoid
        // arbitrary blending of foreground and background Gaussians.
        float flatZ = -${config.windowDistance} - 0.004 - 0.001 * z / (z + 20.0);
        vec3 surfacePosition = vec3(xy, flatZ - front * abs(ripple) * 0.014);
        vec3 originalPosition = (${i.anchorFromMesh} * vec4(source, 1.0)).xyz;
        float surfaceDepth = -surfacePosition.z;
        float originalDepth = max(-originalPosition.z, 0.01);
        // Interpolate inverse depth and the projected position. A direct XYZ
        // lerp would throw distant sky splats hundreds of metres back in the
        // first frames, causing a sudden zoom rather than a gradual opening.
        float currentDepth = 1.0 / mix(1.0/surfaceDepth, 1.0/originalDepth, expand);
        vec2 direction = mix(surfacePosition.xy/surfaceDepth, originalPosition.xy/originalDepth, expand);
        vec3 openingPosition = vec3(direction * currentDepth, -currentDepth);
        ${o.gsplat}.center = (${i.meshFromAnchor} * vec4(openingPosition, 1.0)).xyz;
        ${o.gsplat}.scales = mix(flatScales * (1.0 + front * (hash-0.5) * 0.65) / surfaceDepth,
          s / originalDepth, expand) * currentDepth;
        ${o.gsplat}.quaternion = normalize(mix(flatQ, q, expand));
        ${o.gsplat}.rgba.rgb += vec3(0.34, 0.21, 0.09) * front * (0.5 + hash) * (1.0-expand);
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        ${o.gsplat}.rgba.a *= mix(reveal * inside, 1.0, expand);
      }
    `],
  });
  mesh.objectModifiers = [...(mesh.objectModifiers ?? []), modifier];
  mesh.updateGenerator();

  const relative = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  let previousPhase;
  return (frame) => {
    anchor.updateWorldMatrix(true, true);
    relative.copy(anchor.matrixWorld).invert().multiply(mesh.matrixWorld);
    u.anchorFromMesh.value.copy(relative);
    u.meshFromAnchor.value.copy(relative).invert();
    relative.decompose(position, rotation, scale);
    rotation.invert();
    u.anchorRotation.value.set(rotation.x, rotation.y, rotation.z, rotation.w);
    u.meshScale.value = scale.x;
    u.color.value = frame.color;
    u.depth.value = frame.depth;
    u.seconds.value = frame.seconds;
    if (frame.phase !== "dormant" && (frame.phase !== "active" || previousPhase !== "active")) mesh.updateVersion();
    previousPhase = frame.phase;
  };
}
