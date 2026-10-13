import * as THREE from "three";
import { MEMORY_WAVE_GLSL } from "./memory-wave.js";

/** A light, procedural spray riding the wide activation front. */
export function createMemoryParticles(photoWidth, photoHeight, distance) {
  const columns = 150, rows = 100, count = columns*rows;
  const positions = new Float32Array(count*3);
  const seeds = new Float32Array(count*2);
  for (let j=0;j<rows;j++) for (let k=0;k<columns;k++) {
    const n = j*columns+k;
    const a = Math.sin(n*127.1+1)*43758.5453, b = Math.sin(n*311.7+2)*19642.349;
    const s = a-Math.floor(a), r = b-Math.floor(b);
    positions[n*3] = (k+s)/columns;
    positions[n*3+1] = (j+r)/rows;
    seeds[n*2] = s; seeds[n*2+1] = r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  geometry.setAttribute("seed",new THREE.BufferAttribute(seeds,2));
  const material = new THREE.ShaderMaterial({
    uniforms: { progress:{value:-0.15}, seconds:{value:0}, pixelRatio:{value:1}, centerY:{value:0} },
    vertexShader: /* glsl */ `
      uniform float progress, seconds, pixelRatio, centerY;
      attribute vec2 seed;
      varying vec3 particleColor;
      varying float particleAlpha;
      ${MEMORY_WAVE_GLSL}
      void main() {
        vec2 uv = position.xy;
        vec2 field = memoryCoordinates(uv,vec2(${photoWidth},${photoHeight}));
        float radius = memoryRadius(uv,vec2(${photoWidth},${photoHeight}),seconds);
        float front = memoryFront(radius,progress);
        vec2 direction = normalize(field+vec2(0.00001));
        vec2 tangent = vec2(-direction.y,direction.x);
        vec2 turbulence = vec2(memoryFbm(field*7.0+seconds*0.65)-0.5,
          memoryFbm(field*9.0+8.0-seconds*0.55)-0.5);
        float curl = sin(radius*25.0-seconds*4.0+seed.x*4.0);
        vec2 displacement = front*(turbulence*0.04 + tangent*curl*0.014
          + direction*(seed.y-0.5)*0.023);
        vec3 p = vec3((uv-0.5)*vec2(${photoWidth},${photoHeight})+displacement,
          -${distance}+front*(0.008+seed.x*0.022));
        p.y += centerY;
        vec4 view = modelViewMatrix*vec4(p,1.0);
        gl_Position = projectionMatrix*view;
        gl_PointSize = pixelRatio*mix(0.8,4.7,pow(seed.x,5.0))*front;
        particleAlpha = front*mix(0.18,0.88,seed.y);
        particleColor = memoryChromatic(field+seed*0.3,seconds);
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
      material.uniforms.centerY.value=centerY;
      material.uniforms.seconds.value=frame.seconds; material.uniforms.pixelRatio.value=dpr; },
    dispose() { points.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
