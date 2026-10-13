import * as THREE from "three";
import { MEMORY_SETTINGS, PARTICLE_FLOW_PARAMETERS, memoryDimensions, validateParticleFlow } from "./memory-settings.js";
import { memoryDuration, memoryFrame, ambientEffectStrength } from "./memory-timeline.js";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";
import { attachMemoryModifier } from "./memory-splat.js";
import { createMemoryParticles } from "./memory-particles.js";
import { memoryPlacement } from "./memory-placement.js";
import { updateMatte } from "./window-rig.js";

export async function createMemoryWindow({ anchor, splat, matte, config, button, settings = MEMORY_SETTINGS, onPhase = () => {} }) {
  const loader = new THREE.TextureLoader();
  const [texture, colorTexture] = await Promise.all([
    loader.loadAsync(settings.photoUrl), loader.loadAsync(settings.colorPhotoUrl),
  ]);
  texture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  settings = { ...settings };
  const dimensions = memoryDimensions(config, texture.image.width/texture.image.height, settings);
  const { photoWidth, photoHeight, portalWidth, portalHeight } = dimensions;
  updateMatte(matte, { ...config, windowWidth: photoWidth, windowHeight: photoHeight });
  const material = new THREE.ShaderMaterial({
    uniforms: { photograph: { value: texture }, colorImage: { value: colorTexture }, photoSize: { value: new THREE.Vector2(photoWidth,photoHeight) }, progress: { value: -0.15 }, seconds: { value: 0 },
      ...Object.fromEntries(["rippleDiameter","transitionWidth","flowStrength","flowSpeed","rippleTurbulence"].map(key => [key,{value:settings[key]}])) },
    vertexShader: /* glsl */ `
      varying vec2 photoUv;
      void main() {
        photoUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D photograph;
      uniform sampler2D colorImage;
      uniform float progress;
      uniform float seconds;
      uniform vec2 photoSize;
      uniform float rippleDiameter, transitionWidth, flowStrength, flowSpeed, rippleTurbulence;
      varying vec2 photoUv;
      ${MEMORY_WAVE_GLSL}
      void main() {
        float flowTime = seconds*flowSpeed;
        float radius = memoryRadius(photoUv, photoSize, flowTime, rippleTurbulence);
        float front = memoryFront(radius, progress, rippleDiameter, transitionWidth);
        vec2 field = memoryCoordinates(photoUv,photoSize);
        vec2 flow = vec2(memoryFbm(field*9.0+flowTime*0.8)-0.5,memoryFbm(field*8.0+7.3-flowTime*0.6)-0.5);
        vec2 uv = clamp(photoUv+flow*front*flowStrength*0.014,0.0,1.0);
        vec2 split = normalize(field+vec2(0.00001))*front*flowStrength*0.003;
        vec3 original = texture2D(photograph,uv).rgb;
        float gray = dot(original, vec3(0.2126, 0.7152, 0.0722));
        // Chromatic refraction samples nearby channels of the restored image,
        // retaining its sky, brick, awning, and car colors without a new palette.
        vec3 rgb = vec3(texture2D(colorImage,clamp(uv+split,0.0,1.0)).r,
          texture2D(colorImage,uv).g,texture2D(colorImage,clamp(uv-split,0.0,1.0)).b);
        float grain = memoryNoise(photoUv*vec2(350.0,230.0)+seconds*0.25);
        vec3 activated = mix(vec3(gray),rgb*(0.9+grain*0.25),front*0.85);
        gl_FragColor = vec4(activated, 1.0-memoryReveal(radius,progress,rippleDiameter,transitionWidth));
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(photoWidth, photoHeight), material);
  photo.position.z = -settings.photoDistance;
  photo.renderOrder = 1;
  anchor.add(photo);

  const updateSplats = attachMemoryModifier(splat.mesh, anchor, config, dimensions, settings);
  const particles = createMemoryParticles(photoWidth, photoHeight, settings.photoDistance, colorTexture, settings);
  anchor.add(particles.points);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const labelPoint = new THREE.Vector3();
  const cameraPoint = new THREE.Vector3();
  const effectsCamera = new THREE.PerspectiveCamera();
  const effectsForward = new THREE.Vector3();
  const captureForward = new THREE.Vector3();
  const effectsPose = new THREE.Matrix4();
  const effectsOrigin = new THREE.Vector3();
  const effectsUp = new THREE.Vector3(0,1,0);
  let startedAt = null;
  let frozenSeconds; // Used by the desktop preview, never by AR.
  let phase;
  let floorY = -1.5; // Preview default; AR uses XR8's estimated world ground before placement.
  let frame = memoryFrame(null, settings);

  function apply(seconds, camera, dpr = 1) {
    frame = memoryFrame(seconds, settings);
    frame = { ...frame, effects: ambientEffectStrength(frame,settings.flatEffectStrength) };
    material.uniforms.progress.value = frame.color;
    material.uniforms.seconds.value = frame.seconds;
    for (const key of ["rippleDiameter","transitionWidth","flowStrength","flowSpeed","rippleTurbulence"]) material.uniforms[key].value=settings[key];
    photo.visible = frame.color < 1;
    splat.root.visible = frame.phase !== "dormant";
    const height = THREE.MathUtils.lerp(photoHeight, portalHeight, frame.growth);
    const width = THREE.MathUtils.lerp(photoWidth, portalWidth, frame.growth);
    const placement = memoryPlacement(frame.growth, config, dimensions, settings, floorY);
    // Scaling the matte also scales its rectangular hole; this avoids building
    // and discarding geometry on every frame of the height animation.
    matte.scale.y = height / photoHeight;
    matte.scale.x = width / photoWidth;
    matte.position.set(0, placement.centerY, -placement.distance);
    photo.position.copy(matte.position);
    updateSplats(frame, camera, placement.targetCenterY);
    // The ripple finishes on the original plane before spatial expansion.
    particles.update(frame,dpr,0);
    if (phase !== frame.phase) {
      phase = frame.phase;
      onPhase(phase);
    }
  }

  function positionButton(camera, canvas) {
    if (!button) return;
    button.hidden = !anchor.visible || phase !== "dormant";
    if (button.hidden) return;
    // Project a point BELOW the anchored photograph, rather than putting the
    // instruction over the image or at an unrelated screen-fixed location.
    camera.updateWorldMatrix(true, false);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    labelPoint.set(0, -photoHeight/2-0.045, -settings.photoDistance);
    anchor.localToWorld(labelPoint);
    cameraPoint.copy(labelPoint).applyMatrix4(camera.matrixWorldInverse);
    labelPoint.project(camera);
    if (cameraPoint.z >= -camera.near || Math.abs(labelPoint.x) > 1 || Math.abs(labelPoint.y) > 0.94 || labelPoint.z > 1) {
      button.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    button.style.left = `${rect.left + (labelPoint.x * 0.5 + 0.5) * rect.width}px`;
    button.style.top = `${rect.top + (-labelPoint.y * 0.5 + 0.5) * rect.height}px`;
  }

  const api = {
    get phase() { return phase; },
    get frame() { return frame; },
    duration: memoryDuration(settings),
    dimensions,
    get portalCenterY() { return memoryPlacement(frame.growth, config, dimensions, settings, floorY).centerY; },
    get portalDistance() { return memoryPlacement(frame.growth, config, dimensions, settings, floorY).distance; },
    effectsCamera(camera) {
      // Ambient effects are evaluated in capture space. Undo the floor shift
      // in their viewing direction so the sharp center follows the memory,
      // rather than fading the entire photograph when the phone looks down.
      effectsForward.set(0,0,-1).transformDirection(camera.matrixWorld);
      effectsPose.copy(anchor.matrixWorld).invert();
      effectsForward.transformDirection(effectsPose);
      const targetCenterY = floorY + settings.portalBottomHeight + portalHeight/2;
      effectsForward.y += targetCenterY/config.windowDistance*effectsForward.z;
      effectsForward.normalize().transformDirection(anchor.matrixWorld);
      captureForward.set(0,0,1).transformDirection(splat.mesh.matrixWorld);
      effectsForward.lerpVectors(captureForward,effectsForward,frame.growth).normalize();
      effectsCamera.position.setFromMatrixPosition(splat.mesh.matrixWorld)
        .lerp(cameraPoint.setFromMatrixPosition(camera.matrixWorld),frame.growth);
      effectsPose.lookAt(effectsOrigin,effectsForward,effectsUp);
      effectsCamera.quaternion.setFromRotationMatrix(effectsPose);
      return effectsCamera;
    },
    setFloor(localY) {
      if (!Number.isFinite(localY)) throw new Error("Floor height must be finite");
      floorY = localY;
    },
    setDepthStretch(value) {
      if (!Number.isFinite(value) || value<0.5 || value>4) throw new Error("Depth stretch must be between 0.5 and 4");
      settings.depthStretch=value;
    },
    setParallaxGain(value) {
      if (!Number.isFinite(value) || value<1 || value>4) throw new Error("Parallax strength must be between 1 and 4");
      settings.parallaxGain=value;
    },
    setFlatEffectStrength(value) {
      if (!Number.isFinite(value) || value<0 || value>1) throw new Error("Flat effect strength must be between 0 and 1");
      settings.flatEffectStrength=value;
    },
    setParticleFlow(values) {
      const keys = PARTICLE_FLOW_PARAMETERS.map(({ key }) => key);
      for (const key of Object.keys(values)) if (!keys.includes(key)) throw new Error(`Unknown particle flow parameter: ${key}`);
      const next = { ...settings, ...values };
      validateParticleFlow(next);
      Object.assign(settings,values);
    },
    activate(now = performance.now() / 1000) {
      if (!anchor.visible || phase !== "dormant") return false;
      frozenSeconds = undefined;
      startedAt = now;
      apply(0);
      if (button) button.hidden = true;
      return true;
    },
    reset() {
      startedAt = null;
      frozenSeconds = undefined;
      apply(null);
      if (button) button.hidden = true;
    },
    seek(seconds) {
      frozenSeconds = seconds;
      apply(seconds);
    },
    update(camera, canvas, now = performance.now() / 1000) {
      const seconds = frozenSeconds !== undefined ? frozenSeconds : startedAt === null ? null : now - startedAt;
      apply(seconds, camera, canvas.width/canvas.clientWidth);
      positionButton(camera, canvas);
      return frame;
    },
    updatePrompt: positionButton,
    hit(event, camera, canvas) {
      if (phase !== "dormant" || !anchor.visible) return false;
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      camera.updateWorldMatrix(true, false);
      anchor.updateWorldMatrix(true, true);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(photo, false).length > 0;
    },
    dispose() {
      photo.removeFromParent();
      photo.geometry.dispose();
      material.dispose();
      texture.dispose();
      colorTexture.dispose();
      particles.dispose();
    },
  };
  apply(null);
  return api;
}
