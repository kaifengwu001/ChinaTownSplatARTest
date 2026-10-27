import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";

// The street never begins nearer the placement point than this, so every
// visible splat keeps a viewing ray from that point (see `reachable` below).
export const STREET_START_MIN = 0.15;

const SPILL_LIGHT_GLSL = /* glsl */ `
  // Daylight on the floor d in front of a doorway's centre, its sill on the
  // floor: twice the form factor from that point to the opening, 1 at the sill.
  float doorwayLight(float d, vec2 size) {
    d = max(d, 1e-4);
    float r = length(vec2(d, size.y));
    float sill = 2.0*atan(0.5*size.x/d);
    float lintel = 2.0*atan(0.5*size.x/r);
    return max(0.0, (sill-d/r*lintel)/3.14159265);
  }
  // The spill is a fan whose edges leave the portal's sides at spreadTan (the
  // tangent of half the fan angle). Like daylight it dims with distance, rolling
  // off smoothly through an exposure curve that is 1 at the threshold rather
  // than clipping into a flat plateau. Like a penumbra its edges are a smooth
  // sigmoid, with soft tails, widening the further they are from the portal.
  float spillLight(float x, float d, vec2 size, float strength, float spreadTan, float blurRate) {
    if (strength <= 0.0) return 0.0;
    float exposure = (1.0-exp(-strength*doorwayLight(d, size)))/(1.0-exp(-strength));
    float edge = abs(x)-0.5*size.x-d*spreadTan;
    float blur = 0.03+blurRate*d;
    return exposure/(1.0+exp(4.0*edge/blur));
  }
  // C2 ease from 0 to 1, flat at both ends.
  float smoother(float x) {
    x = clamp(x, 0.0, 1.0);
    return x*x*x*(x*(6.0*x-15.0)+10.0);
  }
`;

/** Tangent of an angle in degrees: for the spill's half fan angle and penumbra. */
const tangent = (degrees) => Math.tan(THREE.MathUtils.degToRad(degrees));

/**
 * Deform centers AND covariance with the same spatial mapping. `frame` is the
 * node at the photographer's spot whose coordinates `layout` uses (see
 * photographerLayout); the shader calls it the anchor.
 */
export function attachMemoryModifier(mesh, frame, layout, settings) {
  const photoSize = new THREE.Vector2(layout.photoWidth, layout.photoHeight);
  const portalSize = new THREE.Vector2(layout.portalWidth, layout.portalHeight);
  const u = {
    color: dyno.dynoFloat(-0.15), motion: dyno.dynoFloat(0), seconds: dyno.dynoFloat(0),
    meshFromAnchor: dyno.dynoMat4(new THREE.Matrix4()),
    anchorFromMesh: dyno.dynoMat4(new THREE.Matrix4()),
    eye: dyno.dynoVec3(new THREE.Vector3()),
    sheetRadius: dyno.dynoFloat(layout.photoDistance),
    photoSize: dyno.dynoVec2(photoSize.clone()), photoDistance: dyno.dynoFloat(layout.photoDistance),
    portalDistance: dyno.dynoFloat(layout.portalDistance),
    portalSize: dyno.dynoVec2(portalSize.clone()), streetStart: dyno.dynoFloat(STREET_START_MIN),
    spill: dyno.dynoFloat(settings.spillStrength), stretch: dyno.dynoFloat(settings.depthStretch),
    spillSpread: dyno.dynoFloat(tangent(settings.spillAngle/2)), spillBlur: dyno.dynoFloat(tangent(settings.spillSoftness)),
    aperture: dyno.dynoVec4(new THREE.Vector4(0, layout.photoDistance, layout.photoWidth, layout.photoHeight)),
    parallax: dyno.dynoFloat(settings.parallaxGain),
    ...Object.fromEntries(["rippleDiameter","transitionWidth","flowStrength","flowSpeed","rippleTurbulence"].map(key => [key,dyno.dynoFloat(settings[key])])),
  };
  const modifier = dyno.dyno({
    inTypes: { covsplat: dyno.CovSplat, color: "float", motion: "float", seconds: "float", meshFromAnchor: "mat4", anchorFromMesh: "mat4", eye: "vec3", sheetRadius: "float", stretch: "float", parallax: "float", photoSize: "vec2", photoDistance: "float", portalDistance: "float",
      portalSize: "vec2", streetStart: "float", spill: "float", spillSpread: "float", spillBlur: "float", aperture: "vec4",
      rippleDiameter: "float", transitionWidth: "float", flowStrength: "float", flowSpeed: "float", rippleTurbulence: "float" },
    outTypes: { covsplat: dyno.CovSplat }, inputs: u,
    globals: () => [dyno.defineCovSplat, MEMORY_WAVE_GLSL, SPILL_LIGHT_GLSL],
    statements: ({ inputs: i, outputs: o }) => [/* glsl */ `
      ${o.covsplat} = ${i.covsplat};
      if (isCovSplatActive(${i.covsplat}.flags)) {
        vec3 p = ${i.covsplat}.center;
        float z = max(p.z, 0.001);
        vec2 focal = vec2(${i.photoSize}.x*${settings.captureFocalRatio}, ${i.photoSize}.y*${settings.captureFocalRatio*settings.captureAspect});
        vec2 surfaceXY = p.xy*focal/z*vec2(1.0,-1.0);
        vec2 uv = surfaceXY/${i.photoSize}+0.5;
        float front = 0.0, reveal = 1.0;
        if (${i.color} < 1.0) {
          float flowTime = ${i.seconds}*${i.flowSpeed};
          float radius = memoryRadius(uv, ${i.photoSize}, flowTime, ${i.rippleTurbulence});
          front = memoryFront(radius, ${i.color}, ${i.rippleDiameter}, ${i.transitionWidth});
          reveal = memoryReveal(radius, ${i.color}, ${i.rippleDiameter}, ${i.transitionWidth});
          vec2 field = memoryCoordinates(uv, ${i.photoSize});
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
        // The settled street is the capture itself, placed rigidly with its
        // ground on the floor. Depth stretch scales only distances BEHIND the
        // portal plane, along its normal, so that ground stays level.
        vec3 base = (${i.anchorFromMesh}*vec4(p,1.0)).xyz;
        float behind = -base.z-${i.portalDistance};
        float stretch = behind > 0.0 ? ${i.stretch} : 1.0;
        vec3 target = vec3(base.xy, base.z-(stretch-1.0)*behind);
        vec3 tz = stretch*az;
        // The street in front of the portal spills out like daylight through a
        // doorway: a fan of light, brightest at the threshold.
        float spillDistance = target.z+${i.portalDistance};
        float light = spillDistance > 0.0
          ? spillLight(target.x, spillDistance, ${i.portalSize}, ${i.spill}, ${i.spillSpread}, ${i.spillBlur}) : 1.0;
        // When the street starts in front of the portal, its cut-off edge fades
        // over most of the spilled strip, so the spill trails off rather than
        // ending in a rim. The fade ends at the portal plane, which keeps the
        // bottom of the photographer's frame whole.
        float spillLength = ${i.portalDistance}-${i.streetStart};
        float fadeLength = spillLength > 0.0 ? min(max(0.6, 0.8*spillLength), spillLength) : 0.6;
        float street = smoother((-base.z-${i.streetStart})/fadeLength);
        // The street start stays ahead of the placement point, so every visible
        // splat has a viewing ray from it. Hidden ones nearer than that travel
        // toward the portal plane instead while they fade.
        bool reachable = -target.z > 0.1;
        vec3 travel = reachable ? target : vec3(target.xy, -${i.portalDistance});
        float targetDepth = -travel.z;
        vec3 targetDepthDerivative = reachable ? -tz : vec3(0.0);
        // Extra parallax is a camera-dependent shear about the WINDOW plane,
        // applied only to the street behind it.
        vec2 cameraShear = (${i.parallax}-1.0)*${i.eye}.xy/max(${i.portalDistance}+${i.eye}.z,0.15);
        float shear = max(0.0, 1.0-${i.portalDistance}/targetDepth);
        vec3 shearDerivative = shear > 0.0
          ? ${i.portalDistance}/(targetDepth*targetDepth)*targetDepthDerivative : vec3(0.0);
        vec2 targetRay = travel.xy/targetDepth + cameraShear*shear;
        vec3 rayXDerivative = ax/targetDepth - travel.x/(targetDepth*targetDepth)*targetDepthDerivative
          + cameraShear.x*shearDerivative;
        vec3 rayYDerivative = ay/targetDepth - travel.y/(targetDepth*targetDepth)*targetDepthDerivative
          + cameraShear.y*shearDerivative;

        float t = ${i.motion};
        float sheetDepth = ${i.photoDistance}+0.006;
        vec3 sheetDepthDerivative = vec3(0.0);
        vec2 sheetRay = vec2(0.0);
        vec3 sheetDX = vec3(0.0), sheetDY = vec3(0.0);
        // The shell is only needed during activation, not in the final scene.
        if (t < 1.0) {
          // A coplanar sheet loses the capture's foreground/background ordering:
          // Spark sorts by camera distance, so the wrong splats cover each other.
          // Place each flat splat along the viewing ray through its sheet pixel,
          // on a shallow camera-centered shell ordered by ORIGINAL distance.
          // Its screen position and footprint still match the anchored flat photo,
          // which is centred on the photographer's view axis. The ray passes
          // through the pixel ON the photograph: a point behind it at the same
          // offset would sit on a slightly narrower ray and shrink the image.
          vec3 sheetPoint = vec3(surfaceXY,-${i.photoDistance});
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
        vec3 settled = vec3(ray*depth,-depth);
        // While the aperture recedes, ground bound for the floor in front of
        // the portal is still behind it, and the matte would hide that ground
        // just below the opening: a gap between the portal and the spill. Hold
        // it just in front of the aperture instead, sliding it along the
        // viewer's line of sight so its place and size on screen do not change.
        if (spillDistance > 0.0 && t < 1.0 && -${i.eye}.z < ${i.aperture}.y && -settled.z > 0.97*${i.aperture}.y) {
          float pull = (-0.97*${i.aperture}.y-${i.eye}.z)/(settled.z-${i.eye}.z);
          settled = ${i.eye}+(settled-${i.eye})*pull;
          covariance *= pull*pull;
        }
        covariance[2][2] += 1e-10;
        mat3 back = mat3(${i.meshFromAnchor});
        covariance = back*covariance*transpose(back);
        ${o.covsplat}.center = (${i.meshFromAnchor}*vec4(settled,1.0)).xyz;
        ${o.covsplat}.xxyyzz = vec3(covariance[0][0],covariance[1][1],covariance[2][2]);
        ${o.covsplat}.xyxzyz = vec3(covariance[0][1],covariance[0][2],covariance[1][2]);
        float inside = step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
        float alpha = ${i.covsplat}.rgba.a*mix(reveal*inside,1.0,t);
        // About 1.5 nearly opaque SHARP splats overlap at each point of the
        // ground (1.2-1.7 across the full, 50% and 25% assets), so fading each
        // one by the light would compound into a harder edge. Sharing the light's
        // optical depth among them, equally, keeps the spill's fades smooth: a
        // per-splat share made neighbouring splats fade unevenly, a speckle.
        float visibility = light*street;
        float settledAlpha = visibility < 1.0
          ? min(alpha, 1.0-exp(log(max(1.0-visibility, 1e-4))/1.5)) : alpha;
        // The spilled ground reads as light: slightly brighter than the street,
        // evenly, so its fading edges stay smooth rather than glinting.
        if (spillDistance > 0.0) ${o.covsplat}.rgba.rgb *= 1.0+0.15*t;
        // The matte occludes a splat at its centre's depth only, so a large
        // splat just behind it can paint past the opening onto the floor in
        // front of the portal. Drop splats whose centres the viewer cannot see
        // through the aperture; the matte trims the rest per pixel.
        vec4 aperture = ${i.aperture}; // centre height, distance, width, height
        float seen = 1.0;
        if (-settled.z > aperture.y && -${i.eye}.z < aperture.y) {
          vec3 toSplat = settled-${i.eye};
          float atPlane = (-aperture.y-${i.eye}.z)/toSplat.z;
          vec2 crossing = abs(${i.eye}.xy+toSplat.xy*atPlane-vec2(0.0, aperture.x));
          seen = step(crossing.x, 0.5*aperture.z+0.01)*step(crossing.y, 0.5*aperture.w+0.01);
        }
        // Splats that settle dim or hidden fade early in the expansion rather
        // than streaking across the room on their way out of the portal.
        ${o.covsplat}.rgba.a = seen*mix(alpha, settledAlpha, smoothstep(0.0,0.12,t));
      }
    `],
  });
  mesh.covObjectModifiers = [...(mesh.covObjectModifiers ?? []), modifier];
  mesh.updateGenerator();
  const relative = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  const aperture = new THREE.Vector4();
  let previousPhase;
  /** `opening` is the current aperture: { centerY, distance, width, height }. */
  return (memoryFrame, camera, opening) => {
    frame.updateWorldMatrix(true,true);
    relative.copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld);
    const transformChanged = !u.anchorFromMesh.value.equals(relative);
    u.anchorFromMesh.value.copy(relative);
    u.meshFromAnchor.value.copy(relative).invert();
    if (camera) {
      camera.updateWorldMatrix(true,false);
      eye.setFromMatrixPosition(camera.matrixWorld);
      frame.worldToLocal(eye);
    }
    photoSize.set(layout.photoWidth, layout.photoHeight);
    portalSize.set(layout.portalWidth, layout.portalHeight);
    const streetStart = Math.max(layout.streetStart, STREET_START_MIN);
    aperture.set(opening.centerY, opening.distance, opening.width, opening.height);
    const spillSpread = tangent(settings.spillAngle/2), spillBlur = tangent(settings.spillSoftness);
    const changed = transformChanged || !u.eye.value.equals(eye)
      || u.stretch.value !== settings.depthStretch || u.parallax.value !== settings.parallaxGain
      || !u.photoSize.value.equals(photoSize) || u.photoDistance.value !== layout.photoDistance
      || u.portalDistance.value !== layout.portalDistance
      || !u.portalSize.value.equals(portalSize) || u.streetStart.value !== streetStart
      || u.spill.value !== settings.spillStrength || u.spillSpread.value !== spillSpread
      || u.spillBlur.value !== spillBlur || !u.aperture.value.equals(aperture);
    u.photoSize.value.copy(photoSize);
    u.portalSize.value.copy(portalSize);
    u.spillSpread.value = spillSpread;
    u.spillBlur.value = spillBlur;
    u.aperture.value.copy(aperture);
    u.streetStart.value = streetStart;
    u.spill.value = settings.spillStrength;
    for (const key of ["photoDistance","portalDistance"]) u[key].value = layout[key];
    u.eye.value.copy(eye);
    // Start the shell behind the furthest photo corner, keeping it behind the
    // portal matte. Radius differences then encode depth, not pixel location.
    if (memoryFrame.growth < 1) {
      let sheetRadius = 0;
      for (const x of [-layout.photoWidth/2,layout.photoWidth/2]) {
        for (const y of [-layout.photoHeight/2,layout.photoHeight/2]) {
          sheetRadius = Math.max(sheetRadius,Math.hypot(x-eye.x,y-eye.y,-layout.photoDistance-0.006-eye.z));
        }
      }
      u.sheetRadius.value = sheetRadius+0.006;
    }
    u.stretch.value = settings.depthStretch;
    u.parallax.value = settings.parallaxGain;
    for (const key of ["rippleDiameter","transitionWidth","flowStrength","flowSpeed","rippleTurbulence"]) u[key].value=settings[key];
    u.color.value = memoryFrame.color;
    u.motion.value = memoryFrame.growth;
    u.seconds.value = memoryFrame.seconds;
    if ((memoryFrame.phase !== "active" && memoryFrame.phase !== "dormant") || previousPhase !== memoryFrame.phase || changed) mesh.updateVersion();
    previousPhase = memoryFrame.phase;
  };
}
