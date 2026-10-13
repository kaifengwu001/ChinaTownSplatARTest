import * as THREE from "three";
import { MEMORY_SETTINGS } from "./memory-settings.js";
import { memoryDuration, memoryFrame } from "./memory-timeline.js";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";
import { attachMemoryModifier } from "./memory-splat.js";
import { updateMatte } from "./window-rig.js";

export async function createMemoryWindow({ anchor, splat, matte, config, button, settings = MEMORY_SETTINGS, onPhase = () => {} }) {
  const texture = await new THREE.TextureLoader().loadAsync(settings.photoUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const photoHeight = config.windowWidth * texture.image.height / texture.image.width;
  updateMatte(matte, { ...config, windowHeight: photoHeight });
  const material = new THREE.ShaderMaterial({
    uniforms: { photograph: { value: texture }, progress: { value: -0.15 }, seconds: { value: 0 } },
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
      varying vec2 photoUv;
      ${MEMORY_WAVE_GLSL}
      void main() {
        float radius = memoryRadius(photoUv, seconds);
        float front = memoryFront(radius, progress);
        vec2 direction = normalize(photoUv - 0.5 + vec2(0.00001));
        vec2 uv = clamp(photoUv + direction * front * sin(radius*56.0 - seconds*12.0) * 0.004, 0.0, 1.0);
        vec3 rgb = texture2D(photograph, uv).rgb;
        float gray = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 glow = vec3(0.38, 0.24, 0.10) * front;
        gl_FragColor = vec4(vec3(gray) + glow, 1.0 - memoryReveal(radius, progress));
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(config.windowWidth, photoHeight), material);
  photo.position.z = -config.windowDistance;
  photo.renderOrder = 1;
  anchor.add(photo);

  const updateSplats = attachMemoryModifier(splat.mesh, anchor, config, photoHeight, settings);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const labelPoint = new THREE.Vector3();
  const cameraPoint = new THREE.Vector3();
  let startedAt = null;
  let frozenSeconds; // Used by the desktop preview, never by AR.
  let phase;
  let frame = memoryFrame(null, settings);

  function apply(seconds) {
    frame = memoryFrame(seconds, settings);
    material.uniforms.progress.value = frame.color;
    material.uniforms.seconds.value = frame.seconds;
    photo.visible = frame.color < 1;
    splat.root.visible = frame.phase !== "dormant";
    const height = THREE.MathUtils.lerp(photoHeight, config.windowHeight, frame.growth);
    // Scaling the matte also scales its rectangular hole; this avoids building
    // and discarding geometry on every frame of the height animation.
    matte.scale.y = height / photoHeight;
    updateSplats(frame);
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
    labelPoint.set(0, -photoHeight / 2 - 0.045, -config.windowDistance);
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
      apply(seconds);
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
    },
  };
  apply(null);
  return api;
}
