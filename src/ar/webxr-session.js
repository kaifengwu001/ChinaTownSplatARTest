// WebXR decisions shared by the AR page and its tests. Nothing here touches
// three.js or the DOM, so node --test can run it with fake sessions.

/** Phone height above the floor assumed until a floor is found, in metres. */
export const ASSUMED_DEVICE_HEIGHT = 1.45;

/**
 * Features asked of the AR session. All are optional, so any WebXR host can
 * start one: Chrome on Android, or an iOS App Clip that adds WebXR.
 */
export const SESSION_FEATURES = Object.freeze(["local-floor", "hit-test", "dom-overlay"]);

export const TRACKING_CHOICES = Object.freeze(["auto", "webxr", "xr8"]);

/**
 * Which tracker drives the page: "webxr" when the browser offers immersive
 * AR, otherwise 8th Wall ("xr8"). `requested` is the ?tracking value.
 */
export async function chooseTracking(requested, xr) {
  if (!TRACKING_CHOICES.includes(requested)) {
    throw new Error(`Unknown ?tracking=${requested}; use one of ${TRACKING_CHOICES.join(", ")}`);
  }
  if (requested === "xr8") return "xr8";
  let supported = false;
  try {
    supported = Boolean(await xr?.isSessionSupported?.("immersive-ar"));
  } catch {
    supported = false;
  }
  if (requested === "webxr" && !supported) {
    throw new Error("This browser has no WebXR AR. Open the page through a WebXR App Clip, or use ?tracking=xr8.");
  }
  return supported ? "webxr" : "xr8";
}

/** The best reference space the session grants: the floor if known, else the start pose. */
export async function pickReferenceSpace(session) {
  for (const type of ["local-floor", "local"]) {
    try {
      await session.requestReferenceSpace(type);
      return type;
    } catch {
      // Not granted; try the next one.
    }
  }
  throw new Error("The AR session offers no local reference space");
}

/** 8th Wall-style tracking state from a WebXR viewer pose. */
export function trackingFromPose(pose) {
  if (!pose || pose.emulatedPosition) return { trackingStatus: "LIMITED", trackingReason: "" };
  return { trackingStatus: "NORMAL", trackingReason: "" };
}

/**
 * World height of the floor. With "local-floor" the floor is y = 0. With
 * "local", y = 0 is where the phone started, so use a surface detected below
 * that point when there is one, otherwise assume a hand-held height.
 */
export function floorHeight(referenceSpace, hitY = null) {
  if (referenceSpace === "local-floor") return 0;
  return Number.isFinite(hitY) ? hitY : -ASSUMED_DEVICE_HEIGHT;
}

/**
 * Framebuffer scale that renders about `dpr` device pixels per CSS pixel.
 * `nativeScale` is the session's scale for full device resolution; 1 is the
 * browser's default size.
 */
export function framebufferScale(dpr, devicePixelRatio, nativeScale = 1) {
  const ratio = devicePixelRatio > 0 ? dpr / devicePixelRatio : 1;
  return Math.min(nativeScale, Math.max(0.25, nativeScale * ratio));
}
