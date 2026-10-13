import * as THREE from "three";
import { MEMORY_SETTINGS, memoryDimensions } from "./memory-settings.js";
import { memoryDuration, memoryFrame } from "./memory-timeline.js";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";
import { attachMemoryModifier } from "./memory-splat.js";
import { createMemoryParticles } from "./memory-particles.js";
import { updateMatte } from "./window-rig.js";

export async function createMemoryWindow({ anchor, splat, matte, config, button, settings = MEMORY_SETTINGS, onPhase = () => {} }) {
  const texture = await new THREE.TextureLoader().loadAsync(settings.photoUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  settings = { ...settings };
  const dimensions = memoryDimensions(config, texture.image.width/texture.image.height, settings);
  const { photoWidth, photoHeight, portalWidth, portalHeight } = dimensions;
  updateMatte(matte, { ...config, windowWidth: photoWidth, windowHeight: photoHeight });
  const material = new THREE.ShaderMaterial({
    uniforms: { photograph: { value: texture }, photoSize: { value: new THREE.Vector2(photoWidth,photoHeight) }, progress: { value: -0.15 }, seconds: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 photoUv;
      void main() {
        photoUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D photograph;
      uniform float progress;
      uniform float seconds;
      uniform vec2 photoSize;
      varying vec2 photoUv;
      ${MEMORY_WAVE_GLSL}
      void main() {
        float radius = memoryRadius(photoUv, photoSize, seconds);
        float front = memoryFront(radius, progress);
        vec2 field = memoryCoordinates(photoUv,photoSize);
        vec2 flow = vec2(memoryFbm(field*9.0+seconds*0.8)-0.5,memoryFbm(field*8.0+7.3-seconds*0.6)-0.5);
        vec2 uv = clamp(photoUv+flow*front*0.014,0.0,1.0);
        vec2 split = normalize(field+vec2(0.00001))*front*0.006;
        vec3 rgb = vec3(texture2D(photograph,clamp(uv+split,0.0,1.0)).r,
          texture2D(photograph,uv).g,texture2D(photograph,clamp(uv-split,0.0,1.0)).b);
        float gray = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 chromatic = memoryChromatic(field,seconds);
        float grain = memoryNoise(photoUv*vec2(350.0,230.0)+seconds*0.25);
        vec3 activated = mix(vec3(gray),rgb,front*0.7);
        activated = mix(activated,chromatic*(0.35+grain*0.9),front*0.55);
        gl_FragColor = vec4(activated, 1.0-memoryReveal(radius,progress));
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(photoWidth, photoHeight), material);
  photo.position.z = -config.windowDistance;
  photo.renderOrder = 1;
  anchor.add(photo);

  const updateSplats = attachMemoryModifier(splat.mesh, anchor, config, dimensions, settings);
  const particles = createMemoryParticles(photoWidth, photoHeight, config.windowDistance);
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
  let floorY = -1.5; // Preview default; AR replaces this with a tracked hit before placement.
  let frame = memoryFrame(null, settings);

  function apply(seconds, camera, dpr = 1) {
    frame = memoryFrame(seconds, settings);
    material.uniforms.progress.value = frame.color;
    material.uniforms.seconds.value = frame.seconds;
    photo.visible = frame.color < 1;
    splat.root.visible = frame.phase !== "dormant";
    const height = THREE.MathUtils.lerp(photoHeight, portalHeight, frame.growth);
    const width = THREE.MathUtils.lerp(photoWidth, portalWidth, frame.growth);
    // Scaling the matte also scales its rectangular hole; this avoids building
    // and discarding geometry on every frame of the height animation.
    matte.scale.y = height / photoHeight;
    matte.scale.x = width / photoWidth;
    matte.position.y = floorY+portalHeight/2;
    photo.position.y = matte.position.y;
    updateSplats(frame, camera, floorY+portalHeight/2);
    particles.update(frame,dpr,matte.position.y);
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
    labelPoint.set(0, floorY+portalHeight/2-photoHeight/2-0.045, -config.windowDistance);
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
    get portalCenterY() { return floorY+portalHeight/2; },
    effectsCamera(camera) {
      // Ambient effects are evaluated in capture space. Undo the floor shift
      // in their viewing direction so the sharp center follows the memory,
      // rather than fading the entire photograph when the phone looks down.
      effectsForward.set(0,0,-1).transformDirection(camera.matrixWorld);
      effectsPose.copy(anchor.matrixWorld).invert();
      effectsForward.transformDirection(effectsPose);
      effectsForward.y += (floorY+portalHeight/2)/config.windowDistance*effectsForward.z;
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
      particles.dispose();
    },
  };
  apply(null);
  return api;
}
