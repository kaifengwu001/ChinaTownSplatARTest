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
    sheetRadius: dyno.dynoFloat(d),
    centerY: dyno.dynoFloat(0), stretch: dyno.dynoFloat(settings.depthStretch),
    parallax: dyno.dynoFloat(settings.parallaxGain),
    ...Object.fromEntries(["rippleDiameter","transitionWidth","flowStrength","flowSpeed","rippleTurbulence"].map(key => [key,dyno.dynoFloat(settings[key])])),
  };
  const modifier = dyno.dyno({
    inTypes: { covsplat: dyno.CovSplat, color: "float", motion: "float", seconds: "float", meshFromAnchor: "mat4", anchorFromMesh: "mat4", eye: "vec3", sheetRadius: "float", centerY: "float", stretch: "float", parallax: "float",
      rippleDiameter: "float", transitionWidth: "float", flowStrength: "float", flowSpeed: "float", rippleTurbulence: "float" },
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
          float flowTime = ${i.seconds}*${i.flowSpeed};
          float radius = memoryRadius(uv, vec2(${photoWidth},${photoHeight}), flowTime, ${i.rippleTurbulence});
          front = memoryFront(radius, ${i.color}, ${i.rippleDiameter}, ${i.transitionWidth});
          reveal = memoryReveal(radius, ${i.color}, ${i.rippleDiameter}, ${i.transitionWidth});
          vec2 field = memoryCoordinates(uv, vec2(${photoWidth},${photoHeight}));
          vec2 flow = vec2(memoryFbm(field*9.0+flowTime*0.8)-0.5,
            memoryFbm(field*8.0+7.3-flowTime*0.6)-0.5);
          surfaceXY += flow*front*${i.flowStrength}*0.009;
          // Keep the reconstruction's own RGB through the ripple. Its ambient
          // brightness modulation is applied by the shared effect modifier.
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

        surfaceXY.y += ${i.centerY};
        float t = ${i.motion};
        float sheetDepth = ${d}+0.006;
        vec3 sheetDepthDerivative = vec3(0.0);
        vec2 sheetRay = vec2(0.0);
        vec3 sheetDX = vec3(0.0), sheetDY = vec3(0.0);
        // The shell is only needed during activation, not in the final scene.
        if (t < 1.0) {
          // A coplanar sheet loses the capture's foreground/background ordering:
          // Spark sorts by camera distance, so the wrong splats cover each other.
          // Place each flat splat along the viewing ray through its sheet pixel,
          // on a shallow camera-centered shell ordered by ORIGINAL distance.
          // Its screen position and footprint still match the anchored flat photo.
          vec3 sheetPoint = vec3(surfaceXY,-${d}-0.006);
          vec3 sheetDelta = sheetPoint-${i.eye};
          float sheetLength = max(length(sheetDelta),0.001);
          vec3 sheetDirection = sheetDelta/sheetLength;
          float sourceDistance = max(length(p),0.001);
          float shellRadius = ${i.sheetRadius}+0.01*log(1.0+sourceDistance);
          vec3 radiusDerivative = 0.01*p/(sourceDistance*(1.0+sourceDistance));
          mat3 flatJ = mat3(vec3(focal.x/z,0.0,0.0),vec3(0.0,-focal.y/z,0.0),
            vec3(-focal.x*p.x/(z*z),focal.y*p.y/(z*z),0.0));
          mat3 shellJ = shellRadius/sheetLength*(mat3(1.0)-outerProduct(sheetDirection,sheetDirection))*flatJ
            + outerProduct(sheetDirection,radiusDerivative);
          vec3 sheet = ${i.eye}+shellRadius*sheetDirection;
          sheetDepth = max(-sheet.z,0.01);
          sheetDepthDerivative = -vec3(shellJ[0].z,shellJ[1].z,shellJ[2].z);
          sheetRay = sheet.xy/sheetDepth;
          sheetDX = (vec3(shellJ[0].x,shellJ[1].x,shellJ[2].x)-sheetRay.x*sheetDepthDerivative)/sheetDepth;
          sheetDY = (vec3(shellJ[0].y,shellJ[1].y,shellJ[2].y)-sheetRay.y*sheetDepthDerivative)/sheetDepth;
        }
        float depth = mix(sheetDepth,targetDepth,t);
        vec3 depthDerivative = mix(sheetDepthDerivative,targetDepthDerivative,t);
        if (t > 0.0 && t < 1.0) {
          // Perspective responds to inverse depth. Blending metres sends far
          // content away almost instantly while the aperture barely grows.
          // Match apparent depth/parallax to the same eased progress as the
          // aperture and image rays; retain the exact flat and 3D endpoints.
          depth = 1.0/mix(1.0/sheetDepth,1.0/targetDepth,t);
          // Differentiate the new depth mapping too, so Gaussian footprints
          // follow their centers without introducing holes or a size jump.
          depthDerivative = depth*depth*((1.0-t)*sheetDepthDerivative/(sheetDepth*sheetDepth)
            + t*targetDepthDerivative/(targetDepth*targetDepth));
        }
        vec2 ray = mix(sheetRay,targetRay,t);
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
    // Start the shell behind the furthest photo corner, keeping it behind the
    // portal matte. Radius differences then encode depth, not pixel location.
    if (frame.growth < 1) {
      let sheetRadius = 0;
      for (const x of [-photoWidth/2,photoWidth/2]) {
        for (const y of [-photoHeight/2,photoHeight/2]) {
          sheetRadius = Math.max(sheetRadius,Math.hypot(x-eye.x,centerY+y-eye.y,-d-0.006-eye.z));
        }
      }
      u.sheetRadius.value = sheetRadius+0.006;
    }
    u.centerY.value = centerY;
    u.stretch.value = settings.depthStretch;
    u.parallax.value = settings.parallaxGain;
    for (const key of ["rippleDiameter","transitionWidth","flowStrength","flowSpeed","rippleTurbulence"]) u[key].value=settings[key];
    u.color.value = frame.color;
    u.motion.value = frame.growth;
    u.seconds.value = frame.seconds;
    if (frame.phase !== "dormant" && (frame.phase !== "active" || previousPhase !== "active" || changed)) mesh.updateVersion();
    previousPhase = frame.phase;
  };
}
