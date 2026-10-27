import * as THREE from "three";
import { MEMORY_SETTINGS, MEMORY_TUNING_PARAMETERS, PARTICLE_FLOW_PARAMETERS, validateMemorySettings, validateParticleFlow } from "./memory-settings.js";
import { memoryDuration, memoryFrame, ambientEffectStrength, spatialEase } from "./memory-timeline.js";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";
import { attachMemoryModifier } from "./memory-splat.js";
import { createMemoryParticles } from "./memory-particles.js";
import { apertureDistance } from "./memory-placement.js";
import { photographerLayout, alignment, uprightTurn } from "./photographer.js";
import { updateMatte } from "./window-rig.js";
import { warmMemory, primeMemory } from "./memory-warmup.js";

// The guide fades out over this long once the activation starts.
const GUIDE_FADE = 0.5;

/**
 * The target frame for the match: the photograph's outline as it looks from
 * the photographer's spot, carried along with the viewer. Only stepping, not
 * aiming, lines the photograph up with it.
 */
function createGuide() {
  const material = new THREE.MeshBasicMaterial({ color: 0xfff0d6, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
  const bar = new THREE.PlaneGeometry(1, 1);
  const bars = Array.from({ length: 4 }, () => Object.assign(new THREE.Mesh(bar, material), { renderOrder: 3, frustumCulled: false }));
  // Visible but clear until first shown, so preparation compiles its shader.
  const group = new THREE.Group();
  group.add(...bars);
  return {
    group,
    layout({ photoWidth: w, photoHeight: h, photoDistance }) {
      const t = photoDistance*Math.tan(THREE.MathUtils.degToRad(0.25)); // lines 0.25° thick
      for (const [n, x, y, width, height] of [[0,0,h/2,w+t,t],[1,0,-h/2,w+t,t],[2,w/2,0,t,h+t],[3,-w/2,0,t,h+t]]) {
        bars[n].position.set(x, y, 0);
        bars[n].scale.set(width, height, 1);
      }
    },
    show(position, opacity) {
      group.visible = opacity > 0;
      group.position.copy(position);
      material.opacity = opacity;
    },
    get opacity() { return group.visible ? material.opacity : 0; },
    dispose() { group.removeFromParent(); bar.dispose(); material.dispose(); },
  };
}

export async function createMemoryWindow({ anchor, splat, matte, config, hint, settings = MEMORY_SETTINGS, onPhase = () => {} }) {
  const loader = new THREE.TextureLoader();
  const [texture, colorTexture] = await Promise.all([
    loader.loadAsync(settings.photoUrl), loader.loadAsync(settings.colorPhotoUrl),
  ]);
  texture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  settings = { ...settings };
  // Live layout, shared with the splat modifier; tuning updates it in place.
  const layout = { ...photographerLayout(settings) };
  const { photoWidth, photoHeight } = layout;
  const baseLayout = { ...layout };
  // The photographer's spot as placed, and the stage the memory stands on.
  // Holding the match pulls the stage from the spot onto the viewer.
  const spot = new THREE.Group();
  const stage = new THREE.Group();
  spot.add(stage);
  anchor.add(spot);
  stage.add(matte, splat.root);
  updateMatte(matte, { ...config, windowWidth: photoWidth, windowHeight: photoHeight });
  const material = new THREE.ShaderMaterial({
    uniforms: { photograph: { value: texture }, colorImage: { value: colorTexture }, photoSize: { value: new THREE.Vector2(photoWidth,photoHeight) }, progress: { value: -0.15 }, seconds: { value: 0 },
      originalFrame: { value: new THREE.Vector4(...settings.originalFrame) },
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
      uniform vec4 originalFrame; // the colour frame in the original: left, top, right, bottom
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
        // The photograph spans the colour frame, so show the part of the
        // original the restoration was cut from: each feature stays put as
        // its colour arrives.
        vec2 originalUv = vec2(mix(originalFrame.x,originalFrame.z,uv.x), 1.0-mix(originalFrame.w,originalFrame.y,uv.y));
        vec3 original = texture2D(photograph,originalUv).rgb;
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
  photo.position.z = -layout.photoDistance;
  photo.renderOrder = 1;
  stage.add(photo);
  const guide = createGuide();
  stage.add(guide.group);

  const updateSplats = attachMemoryModifier(splat.mesh, stage, layout, settings);
  const particles = createMemoryParticles(photoWidth, photoHeight, layout.photoDistance, colorTexture, settings);
  stage.add(particles.points);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
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
  let floorY = -1.5; // Preview default; AR uses the tracker's floor at placement.
  let frame = memoryFrame(null, settings);
  let opening = null; // The current aperture: { centerY, distance, width, height }.
  let ready = false;
  let preparing = null;
  // The match: AR pauses it while tracking is unsure. `lock` is how far the
  // stage has been pulled onto the viewer, eased in over the match hold, and
  // `held` where the viewer last stood within tolerance, in the spot's frame.
  let matching = true;
  let match = null; // The latest alignment while the photograph waits.
  let lock = 0;
  let lastUpdate = null;
  let guideFrom = 0; // The guide's opacity when the activation started.
  const held = new THREE.Vector3();
  const guidePosition = new THREE.Vector3();
  const view = { eye: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), forward: new THREE.Vector3(), wide: true };
  const viewRotation = new THREE.Quaternion();
  const cameraRotation = new THREE.Quaternion();
  let hintKey = "";
  // Level the capture's street along the placement heading: its ground's up
  // direction (in the splat mesh's flipped OpenCV-to-three.js frame) becomes
  // the anchor's up, and the photographer's heading along the ground its
  // forward. The spot carries this tilt, so the stage keeps the capture
  // camera's own axes and the photograph faces it exactly.
  const [groundX, groundY, groundZ] = settings.captureGroundUp;
  const groundUp = new THREE.Vector3(groundX, -groundY, -groundZ).normalize();
  const groundBack = new THREE.Vector3(0, 0, 1).addScaledVector(groundUp, -groundUp.z).normalize();
  const level = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3().crossVectors(groundUp, groundBack), groundUp, groundBack)).invert();

  function refreshLayout() {
    Object.assign(layout, photographerLayout(settings));
    photo.scale.set(layout.photoWidth/baseLayout.photoWidth, layout.photoHeight/baseLayout.photoHeight, 1);
    material.uniforms.photoSize.value.set(layout.photoWidth,layout.photoHeight);
    guide.layout(layout);
    // The capture camera stands at the spot, `walkDistance` ahead of the
    // placement and `eyeHeight` above the floor, so the street, scaled about
    // that camera, keeps its ground on the floor and every capture ray.
    spot.position.set(0, floorY+layout.eyeHeight, -settings.walkDistance);
    spot.quaternion.copy(level);
    splat.pivot.quaternion.identity();
    splat.pivot.scale.setScalar(settings.sceneScale);
    splat.root.position.set(0, 0, 0);
  }

  // The camera's position and axes in `frame`, and whether the screen is wide.
  function viewIn(frame, camera, canvas) {
    camera.updateWorldMatrix(true, false);
    frame.updateWorldMatrix(true, false);
    frame.worldToLocal(view.eye.setFromMatrixPosition(camera.matrixWorld));
    frame.getWorldQuaternion(viewRotation).invert().multiply(camera.getWorldQuaternion(cameraRotation));
    view.right.set(1,0,0).applyQuaternion(viewRotation);
    view.up.set(0,1,0).applyQuaternion(viewRotation);
    view.forward.set(0,0,-1).applyQuaternion(viewRotation);
    view.wide = canvas.clientWidth >= canvas.clientHeight;
    return view;
  }

  // While the photograph waits, measure the viewer against the spot. Holding
  // within tolerance eases the stage onto them, so the cut lands exactly where
  // they stand, and starts the activation once it arrives.
  function matchViewer(camera, canvas, now) {
    const elapsed = lastUpdate === null ? 0 : THREE.MathUtils.clamp(now-lastUpdate, 0, 0.1);
    lastUpdate = now;
    match = null;
    if (!camera || !anchor.visible) return;
    viewIn(spot, camera, canvas);
    if (!ready || !matching || phase !== "dormant" || startedAt !== null || frozenSeconds !== undefined) return;
    match = alignment(view, layout, settings.matchTolerance);
    if (match.aligned) held.copy(view.eye);
    lock = THREE.MathUtils.clamp(lock+(match.aligned ? elapsed : -elapsed)/Math.max(settings.matchHold, 1e-3), 0, 1);
    stage.position.copy(held).multiplyScalar(spatialEase(lock));
    if (lock === 1 && match.aligned) api.activate(now);
  }

  // The guide frame and the instruction, upright and nearest the floor for
  // the phone as held, whether or not the page turned with it.
  function showGuidance(canvas) {
    if (!anchor.visible) guide.show(guidePosition, 0);
    else {
      guidePosition.copy(view.eye).sub(stage.position).z -= layout.photoDistance;
      const fade = startedAt === null ? 0 : guideFrom*(1-THREE.MathUtils.clamp(frame.seconds/GUIDE_FADE, 0, 1));
      guide.show(guidePosition, match?.landscape ? 0.55+0.45*spatialEase(lock) : fade);
    }
    if (!hint) return;
    const text = match?.hint ?? "";
    hint.hidden = !text;
    if (!text) { hintKey = ""; return; }
    const turn = uprightTurn(view.right.y, view.up.y);
    const rect = canvas.getBoundingClientRect();
    const inset = 56;
    const [x, y] = turn === 0 ? [rect.left+rect.width/2, rect.bottom-inset]
      : turn === 90 ? [rect.left+inset, rect.top+rect.height/2]
      : turn === -90 ? [rect.right-inset, rect.top+rect.height/2]
      : [rect.left+rect.width/2, rect.top+inset];
    const key = `${text}|${turn}|${Math.round(x)}|${Math.round(y)}`;
    if (key === hintKey) return;
    hintKey = key;
    hint.textContent = text;
    hint.style.left = `${Math.round(x)}px`;
    hint.style.top = `${Math.round(y)}px`;
    hint.style.transform = `translate(-50%, -50%) rotate(${turn}deg)`;
  }

  function apply(seconds, camera, dpr = 1) {
    frame = memoryFrame(seconds, settings);
    frame = { ...frame, effects: ambientEffectStrength(frame,settings.flatEffectStrength) };
    material.uniforms.progress.value = frame.color;
    material.uniforms.seconds.value = frame.seconds;
    for (const key of ["rippleDiameter","transitionWidth","flowStrength","flowSpeed","rippleTurbulence"]) material.uniforms[key].value=settings[key];
    photo.visible = frame.color < 1;
    // Keep the generated splat layout resident while dormant; the modifier's
    // zero reveal hides it without discarding its warmed rendering resources.
    splat.root.visible = true;
    // The aperture recedes along the photographer's frustum: from the spot it
    // keeps the photograph's frame exactly while it grows into the portal.
    const distance = apertureDistance(frame.growth, layout);
    opening = { centerY: 0, distance, width: 2*layout.tanX*distance, height: 2*layout.tanY*distance };
    // Scaling the matte also scales its rectangular hole; this avoids building
    // and discarding geometry on every frame of the expansion.
    matte.scale.set(opening.width/baseLayout.photoWidth, opening.height/baseLayout.photoHeight, 1);
    matte.position.set(0, 0, -distance);
    photo.position.set(0, 0, -layout.photoDistance);
    updateSplats(frame, camera, opening);
    // The ripple finishes on the photograph's plane before spatial expansion.
    particles.update(frame,dpr,0,layout);
    if (phase !== frame.phase) {
      phase = frame.phase;
      onPhase(phase);
    }
  }

  const api = {
    get phase() { return phase; },
    get frame() { return frame; },
    get duration() { return memoryDuration(settings); },
    get ready() { return ready; },
    getSettings() { return { ...settings }; },
    layout,
    get aperture() { return opening; },
    /** The latest alignment while the photograph waits for the match, else null. */
    get match() { return match; },
    /** The stage's pull from the spot onto the viewer: the match's correction. */
    get correction() { return stage.position.clone(); },
    effectsCamera(camera) {
      // Ambient effects are evaluated in capture space. The settled street is
      // the capture placed rigidly, so the live camera applies unchanged; the
      // flat stage still uses the capture camera's own view.
      effectsForward.set(0,0,-1).transformDirection(camera.matrixWorld);
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
      refreshLayout();
    },
    /** AR pauses the match while tracking is unsure. */
    setMatching(enabled) {
      matching = Boolean(enabled);
    },
    setTuning(values) {
      const keys = MEMORY_TUNING_PARAMETERS.map(({ key }) => key);
      for (const key of Object.keys(values)) if (!keys.includes(key)) throw new Error(`Unknown tuning parameter: ${key}`);
      const next = { ...settings, ...values };
      validateMemorySettings(next);
      Object.assign(settings,values);
      refreshLayout();
    },
    prepare(context) {
      if (ready) return Promise.resolve();
      if (preparing) return preparing;
      preparing = warmMemory({ ...context, anchor, textures:[texture,colorTexture],
        sample: (seconds,camera) => apply(seconds,camera),
        samples: [settings.colorDuration*0.35, settings.colorDuration+settings.flatHoldDuration+settings.depthDuration*0.5, memoryDuration(settings), settings.colorDuration*0.35],
      }).then(() => { ready = true; }).finally(() => { preparing = null; apply(null); });
      return preparing;
    },
    prime(context) {
      if (preparing) return preparing;
      ready = false;
      preparing = primeMemory({ ...context, sample: (seconds,camera) => apply(seconds,camera) })
        .then(() => { ready = true; }).finally(() => { preparing = null; });
      return preparing;
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
      if (!ready || !anchor.visible || phase !== "dormant") return false;
      frozenSeconds = undefined;
      startedAt = now;
      guideFrom = guide.opacity;
      match = null;
      apply(0);
      if (hint) hint.hidden = true;
      return true;
    },
    reset() {
      startedAt = null;
      frozenSeconds = undefined;
      lock = 0;
      held.set(0, 0, 0);
      stage.position.set(0, 0, 0);
      apply(null);
      if (hint) hint.hidden = true;
    },
    seek(seconds) {
      if (!ready) return false;
      frozenSeconds = seconds;
      apply(seconds);
      return true;
    },
    update(camera, canvas, now = performance.now() / 1000) {
      matchViewer(camera, canvas, now);
      const seconds = frozenSeconds !== undefined ? frozenSeconds : startedAt === null ? null : now - startedAt;
      apply(seconds, camera, canvas.width/canvas.clientWidth);
      showGuidance(canvas);
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
      guide.dispose();
      photo.removeFromParent();
      photo.geometry.dispose();
      material.dispose();
      texture.dispose();
      colorTexture.dispose();
      particles.dispose();
    },
  };
  refreshLayout();
  apply(null);
  return api;
}
