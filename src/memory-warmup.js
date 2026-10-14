import * as THREE from "three";

// update() can return early when another sort is running. Its completion is
// only safe to use once the queued automatic update and all sorts have drained.
export async function waitForSplatWork(spark, gl) {
  const deadline = performance.now()+30000;
  while (spark.sorting || spark.sortDirty || (spark.updateTimeoutId != null && spark.updateTimeoutId !== -1)) {
    if (gl.isContextLost?.()) throw new Error("GPU context lost while preparing memory");
    if (performance.now() > deadline) throw new Error("Memory splat preparation timed out");
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

/** Wait for submitted uploads/draws, without blocking the camera/UI thread. */
export function finishGpu(gl) {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if (!fence) throw new Error("Could not prepare GPU effects");
  gl.flush();
  return new Promise((resolve,reject) => {
    const deadline = performance.now()+30000;
    const check = () => {
      const status = gl.clientWaitSync(fence,0,0);
      if (status === gl.TIMEOUT_EXPIRED && performance.now() < deadline && !gl.isContextLost?.()) { requestAnimationFrame(check); return; }
      gl.deleteSync(fence);
      if (status === gl.WAIT_FAILED || status === gl.TIMEOUT_EXPIRED) reject(new Error("GPU effects preparation failed"));
      else resolve();
    };
    check();
  });
}

/** Use the actual renderer/context, including Spark's generated GPU shaders. */
export async function warmMemory({ renderer, spark, scene, camera, anchor, textures, sample, samples, beforeSample = () => {} }) {
  const warmCamera = camera.clone();
  warmCamera.updateWorldMatrix(true,false);
  const visible = anchor.visible;
  const autoUpdate = spark.autoUpdate;
  const target = new THREE.WebGLRenderTarget(128,128);
  // Match the canvas variant of the photograph/particle color-space shaders.
  target.texture.colorSpace = renderer.outputColorSpace;
  const previousErrorHandler = renderer.debug.onShaderError;
  let shaderError = null;
  renderer.debug.onShaderError = (...args) => {
    shaderError = new Error("Memory effects shader compilation failed");
    previousErrorHandler?.(...args);
  };
  try {
    spark.autoUpdate = false;
    await waitForSplatWork(spark,renderer.getContext());
    anchor.visible = true;
    renderer.resetState();
    for (const texture of textures) renderer.initTexture(texture);
    for (const seconds of samples) {
      sample(seconds,warmCamera);
      beforeSample(warmCamera,seconds);
      // Await generated covariance buffers, initial worker/WASM sorting,
      // and ordering-texture uploads before any user animation can begin.
      renderer.resetState();
      await spark.update({ scene, camera:warmCamera });
      await waitForSplatWork(spark,renderer.getContext());
      const previousTarget = renderer.getRenderTarget();
      try {
        renderer.resetState();
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene,warmCamera);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.resetState();
      }
      await renderer.compileAsync(scene,warmCamera);
      await finishGpu(renderer.getContext());
      if (shaderError) throw shaderError;
    }
  } finally {
    anchor.visible = visible;
    spark.autoUpdate = autoUpdate;
    renderer.debug.onShaderError = previousErrorHandler;
    target.dispose();
  }
}

/** Restore the visible splat mapping after AR's unplaced anchor was hidden. */
export async function primeMemory({ renderer, spark, scene, camera, sample }) {
  const autoUpdate = spark.autoUpdate;
  const previousErrorHandler = renderer.debug.onShaderError;
  let shaderError = null;
  renderer.debug.onShaderError = (...args) => {
    shaderError = new Error("Memory effects shader compilation failed");
    previousErrorHandler?.(...args);
  };
  try {
    spark.autoUpdate = false;
    await waitForSplatWork(spark,renderer.getContext());
    camera.updateWorldMatrix(true,false);
    const snapshot = camera.clone();
    sample(null,snapshot);
    renderer.resetState();
    await spark.update({ scene, camera:snapshot });
    await waitForSplatWork(spark,renderer.getContext());
    renderer.resetState();
    if (spark.orderingTexture) renderer.initTexture(spark.orderingTexture);
    await renderer.compileAsync(scene,snapshot);
    await finishGpu(renderer.getContext());
    if (shaderError) throw shaderError;
  } finally {
    spark.autoUpdate = autoUpdate;
    renderer.debug.onShaderError = previousErrorHandler;
  }
}
