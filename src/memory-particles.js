import * as THREE from "three";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";
import { MEMORY_SETTINGS, PARTICLE_FLOW_PARAMETERS } from "./memory-settings.js";

/** A light, procedural spray riding the wide activation front. */
export function createMemoryParticles(photoWidth, photoHeight, distance, colorTexture, settings = MEMORY_SETTINGS) {
  const count = PARTICLE_FLOW_PARAMETERS.find(({ key }) => key === "particleCount").max;
  const positions = new Float32Array(count*3);
  const seeds = new Float32Array(count*2);
  for (let n=0;n<count;n++) {
    const a = Math.sin(n*127.1+1)*43758.5453, b = Math.sin(n*311.7+2)*19642.349;
    const s = a-Math.floor(a), r = b-Math.floor(b);
    // Every prefix covers the whole image, so reducing draw count changes
    // density rather than removing rows from one side of the photograph.
    positions[n*3] = (0.5+(n+1)*0.7548776662466927)%1;
    positions[n*3+1] = (0.5+(n+1)*0.5698402909980532)%1;
    seeds[n*2] = s; seeds[n*2+1] = r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  geometry.setAttribute("seed",new THREE.BufferAttribute(seeds,2));
  geometry.setDrawRange(0,settings.particleCount);
  const material = new THREE.ShaderMaterial({
    uniforms: { progress:{value:-0.15}, seconds:{value:0}, pixelRatio:{value:1}, centerY:{value:0}, colorImage:{value:colorTexture},
      sizeMin:{value:settings.particleSizeMin}, sizeMax:{value:settings.particleSizeMax},
      rippleDiameter:{value:settings.rippleDiameter}, transitionWidth:{value:settings.transitionWidth},
      flowStrength:{value:settings.flowStrength}, flowSpeed:{value:settings.flowSpeed}, rippleTurbulence:{value:settings.rippleTurbulence} },
    vertexShader: /* glsl */ `
      uniform float progress, seconds, pixelRatio, centerY;
      uniform float sizeMin, sizeMax, rippleDiameter, transitionWidth, flowStrength, flowSpeed, rippleTurbulence;
      uniform sampler2D colorImage;
      attribute vec2 seed;
      varying vec3 particleColor;
      varying float particleAlpha;
      ${MEMORY_WAVE_GLSL}
      void main() {
        vec2 uv = position.xy;
        float flowTime = seconds*flowSpeed;
        vec2 field = memoryCoordinates(uv,vec2(${photoWidth},${photoHeight}));
        float radius = memoryRadius(uv,vec2(${photoWidth},${photoHeight}),flowTime,rippleTurbulence);
        float front = memoryFront(radius,progress,rippleDiameter,transitionWidth);
        vec2 direction = normalize(field+vec2(0.00001));
        vec2 tangent = vec2(-direction.y,direction.x);
        vec2 turbulence = vec2(memoryFbm(field*7.0+flowTime*0.65)-0.5,
          memoryFbm(field*9.0+8.0-flowTime*0.55)-0.5);
        float curl = sin(radius*25.0-flowTime*4.0+seed.x*4.0);
        vec2 displacement = front*flowStrength*(turbulence*0.04 + tangent*curl*0.014
          + direction*(seed.y-0.5)*0.023);
        vec3 p = vec3((uv-0.5)*vec2(${photoWidth},${photoHeight})+displacement,
          -${distance}+front*flowStrength*(0.008+seed.x*0.022));
        p.y += centerY;
        vec4 view = modelViewMatrix*vec4(p,1.0);
        gl_Position = projectionMatrix*view;
        gl_PointSize = pixelRatio*mix(sizeMin,sizeMax,pow(seed.x,5.0))*front;
        particleAlpha = front*mix(0.18,0.88,seed.y);
        // Each particle carries the color of the pixel it came from. Random
        // seeds vary motion/size/alpha only; they never select a hue.
        particleColor = texture2D(colorImage,uv).rgb;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 particleColor;
      varying float particleAlpha;
      void main() {
        vec2 p = gl_PointCoord*2.0-1.0;
        float r = dot(p,p);
        if(r>1.0) discard;
        float sphere = sqrt(1.0-r);
        float highlight = pow(max(0.0,1.0-length(p-vec2(-0.3,0.3))),8.0);
        gl_FragColor = vec4(particleColor*(0.5+0.6*sphere)+vec3(highlight*0.7),
          particleAlpha*(1.0-smoothstep(0.35,1.0,r)));
        #include <colorspace_fragment>
      }
    `,
    transparent:true, depthTest:false, depthWrite:false, toneMapped:false,
  });
  const points = new THREE.Points(geometry,material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return { points,
    update(frame,dpr,centerY) { points.visible=frame.phase==="colorizing"; material.uniforms.progress.value=frame.color;
      geometry.setDrawRange(0,settings.particleCount);
      material.uniforms.sizeMin.value=settings.particleSizeMin;
      material.uniforms.sizeMax.value=settings.particleSizeMax;
      for (const key of ["rippleDiameter","transitionWidth","flowStrength","flowSpeed","rippleTurbulence"]) material.uniforms[key].value=settings[key];
      material.uniforms.centerY.value=centerY;
      material.uniforms.seconds.value=frame.seconds; material.uniforms.pixelRatio.value=dpr; },
    dispose() { points.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
