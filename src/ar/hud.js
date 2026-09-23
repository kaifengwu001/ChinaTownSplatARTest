/**
 * On-screen readout and centre prompt. The phone has no devtools console, so
 * everything worth knowing, including errors, has to be visible here.
 */
export function createHud(hudEl, promptEl) {
  let fields = Object.freeze({
    asset: "",
    splats: null,
    tracking: "starting",
    placed: false,
    headroom: 0,
    fps: 0,
    view: "…",
  });
  let frames = [];
  let lastPaint = 0;

  const paint = () => {
    const splats = fields.splats == null ? "…" : fields.splats.toLocaleString();
    hudEl.textContent = [
      `splats   ${splats} (${fields.asset})`,
      `fps      ${fields.fps.toFixed(0)}`,
      `tracking ${fields.tracking}`,
      `headroom ${fields.headroom.toFixed(1)}°`,
      `view     ${fields.view}`,
    ].join("\n");
  };

  return {
    set(patch) {
      fields = Object.freeze({ ...fields, ...patch });
      paint();
    },

    // Rolling one-second frame rate; repainting the DOM every frame would cost
    // more than the readout is worth, so paint at most twice a second.
    tick(now) {
      frames = [...frames.filter((t) => now - t < 1000), now];
      if (now - lastPaint < 500) return;
      lastPaint = now;
      const span = now - frames[0];
      fields = Object.freeze({ ...fields, fps: span > 0 ? ((frames.length - 1) * 1000) / span : 0 });
      paint();
    },

    prompt(text) {
      promptEl.textContent = text;
    },

    fail(message) {
      console.error(message);
      promptEl.textContent = `Error: ${message}`;
    },
  };
}

const REASON_HINTS = Object.freeze({
  INITIALIZING: "Move the phone slowly forward and back to measure scale",
  TOO_MUCH_MOTION: "Slow down",
  NOT_ENOUGH_TEXTURE: "Point at a more detailed surface, like a textured floor",
});

/** Coaching text for the current tracking state, or "" when none is needed. */
export function trackingPrompt({ status, reason }, placed) {
  if (placed) return "";
  if (status === "NORMAL") return "Tap to place the window";
  return REASON_HINTS[reason] ?? "Move the phone slowly to start tracking";
}
