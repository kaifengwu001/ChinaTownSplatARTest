import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";

/** Deform centers AND covariance with the same spatial mapping. */
export function attachMemoryModifier(mesh, anchor, config, dimensions, settings) {
  const { photoWidth, photoHeight } = dimensions;
  const focalX = photoWidth * settings.captureFocalRatio;
  const focalY = focalX * photoHeight / (photoWidth / settings.captureAspect);
  const d = config.windowDistance;
  const u = {
    color: dyno.dynoFloat(-0.15), motion: dyno.dynoFloat(0), seconds: dyno.dynoFloat(0),
    meshFromAnchor: dyno.dynoMat4(new THREE.Matrix4()),
    anchorFromMesh: dyno.dynoMat4(new THREE.Matrix4()),
    eye: dyno.dynoVec3(new THREE.Vector3()),
    centerY: dyno.dynoFloat(0), stretch: dyno.dynoFloat(settings.depthStretch),
    parallax: dyno.dynoFloat(settings.parallaxGain),
  };
  const modifier = dyno.dyno({
    inTypes: { covsplat: dyno.CovSplat, color: "float", motion: "float", seconds: "float", meshFromAnchor: "mat4", anchorFromMesh: "mat4", eye: "vec3", centerY: "float", stretch: "float", parallax: "float" },
    outTypes: { covsplat: dyno.CovSplat }, inputs: u,
    globals: () => [dyno.defineCovSplat, MEMORY_WAVE_GLSL],
    statements: ({ inputs: i, outputs: o }) => [/* glsl */ `
      ${o.covsplat} = ${i.covsplat};
      if (isCovSplatActive(${i.covsplat}.flags)) {
        vec3 p = ${i.covsplat}.center;
        float z = max(p.z, 0.001);
        vec2 focal = vec2(${focalX}, ${focalY});
        vec2 surfaceXY = p.xy*focal/z*vec2(1.0,-1.0);
        vec2 uv = surfaceXY/vec2(${photoWidth},${photoHeight})+0.5;
        float front = 0.0, reveal = 1.0;
        if (${i.color} < 1.0) {
          float radius = memoryRadius(uv, vec2(${photoWidth},${photoHeight}), ${i.seconds});
          front = memoryFront(radius, ${i.color});
          reveal = memoryReveal(radius, ${i.color});
          vec2 field = memoryCoordinates(uv, vec2(${photoWidth},${photoHeight}));
          vec2 flow = vec2(memoryFbm(field*9.0+${i.seconds}*0.8)-0.5,
            memoryFbm(field*8.0+7.3-${i.seconds}*0.6)-0.5);
          surfaceXY += flow*front*0.009;
          ${o.covsplat}.rgba.rgb = mix(${o.covsplat}.rgba.rgb,
            memoryChromatic(field, ${i.seconds}), front*0.35);
        }

        mat3 A = mat3(${i.anchorFromMesh});
        vec3 ax = vec3(A[0].x,A[1].x,A[2].x);
        vec3 ay = vec3(A[0].y,A[1].y,A[2].y);
        vec3 az = vec3(A[0].z,A[1].z,A[2].z);
        vec3 base = (${i.anchorFromMesh}*vec4(p,1.0)).xyz;
        float baseDepth = max(-base.z,0.01);
        float targetDepth = max(${d}+${i.stretch}*(baseDepth-${d}), ${d}+0.01);
        vec3 targetDepthDerivative = -${i.stretch}*az;
        // Depth stretching preserves the center view. Extra parallax is a
        // camera-dependent shear about the WINDOW plane, which stays anchored.
        vec2 cameraShear = (${i.parallax}-1.0)*${i.eye}.xy/max(${d}+${i.eye}.z,0.15);
        vec2 targetRay = base.xy/baseDepth + vec2(0.0,${i.centerY}/${d})
          + cameraShear*(1.0-${d}/targetDepth);
        vec3 rayXDerivative = ax/baseDepth + base.x/(baseDepth*baseDepth)*az
          + cameraShear.x*${d}/(targetDepth*targetDepth)*targetDepthDerivative;
        vec3 rayYDerivative = ay/baseDepth + base.y/(baseDepth*baseDepth)*az
          + cameraShear.y*${d}/(targetDepth*targetDepth)*targetDepthDerivative;

        float sheetDepth = ${d}+0.006;
        surfaceXY.y += ${i.centerY};
        float t = ${i.motion};
        float depth = mix(sheetDepth,targetDepth,t);
        vec3 depthDerivative = t*targetDepthDerivative;
        vec2 ray = mix(surfaceXY/sheetDepth,targetRay,t);
        vec3 sheetDX = vec3(focal.x/(z*sheetDepth),0.0,-focal.x*p.x/(z*z*sheetDepth));
        vec3 sheetDY = vec3(0.0,-focal.y/(z*sheetDepth),focal.y*p.y/(z*z*sheetDepth));
        vec3 dx = depth*mix(sheetDX,rayXDerivative,t)+ray.x*depthDerivative;
        vec3 dy = depth*mix(sheetDY,rayYDerivative,t)+ray.y*depthDerivative;
        vec3 dz = -depthDerivative;
        mat3 J = mat3(vec3(dx.x,dy.x,dz.x),vec3(dx.y,dy.y,dz.y),vec3(dx.z,dy.z,dz.z));

        vec3 diagonal = ${i.covsplat}.xxyyzz, off = ${i.covsplat}.xyxzyz;
        mat3 covariance = mat3(diagonal.x,off.x,off.y, off.x,diagonal.y,off.z, off.y,off.z,diagonal.z);
        covariance = J*covariance*transpose(J);
        // Small overlap reserve at mid-transition protects coverage between
        // decimated SHARP samples; endpoints keep their original footprints.
        float overlap = 1.0+0.12*sin(t*3.14159265)*sin(t*3.14159265);
        covariance *= overlap*overlap;
        covariance[2][2] += 1e-10;
        mat3 back = mat3(${i.meshFromAnchor});
        covariance = back*covariance*transpose(back);
        ${o.covsplat}.center = (${i.meshFromAnchor}*vec4(ray*depth,-depth,1.0)).xyz;
        ${o.covsplat}.xxyyzz = vec3(covariance[0][0],covariance[1][1],covariance[2][2]);
        ${o.covsplat}.xyxzyz = vec3(covariance[0][1],covariance[0][2],covariance[1][2]);
        float inside = step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
        ${o.covsplat}.rgba.a *= mix(reveal*inside,1.0,t);
      }
    `],
  });
  mesh.covObjectModifiers = [...(mesh.covObjectModifiers ?? []), modifier];
  mesh.updateGenerator();
  const relative = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  let previousPhase;
  return (frame, camera, centerY) => {
    anchor.updateWorldMatrix(true,true);
    relative.copy(anchor.matrixWorld).invert().multiply(mesh.matrixWorld);
    u.anchorFromMesh.value.copy(relative);
    u.meshFromAnchor.value.copy(relative).invert();
    if (camera) {
      camera.updateWorldMatrix(true,false);
      eye.setFromMatrixPosition(camera.matrixWorld);
      anchor.worldToLocal(eye);
    }
    const changed = !u.eye.value.equals(eye) || u.centerY.value !== centerY
      || u.stretch.value !== settings.depthStretch || u.parallax.value !== settings.parallaxGain;
    u.eye.value.copy(eye);
    u.centerY.value = centerY;
    u.stretch.value = settings.depthStretch;
    u.parallax.value = settings.parallaxGain;
    u.color.value = frame.color;
    u.motion.value = frame.growth;
    u.seconds.value = frame.seconds;
    if (frame.phase !== "dormant" && (frame.phase !== "active" || previousPhase !== "active" || changed)) mesh.updateVersion();
    previousPhase = frame.phase;
  };
}
