// The match cut puts the viewer where the photographer stood. From that spot
// the photograph, the portal and the reconstructed street fill one frame, so
// the photograph can become the street without a pixel moving. Pure geometry,
// shared by the AR page, the preview and node --test.

const DEGREE = Math.PI/180;
// The phone counts as sideways while its long side is within 25° of level,
// and as facing the photograph while its centre is within 15° of the view's.
const LANDSCAPE_TILT = Math.sin(25*DEGREE);
const FACING = Math.cos(15*DEGREE);
// Nearer than this fraction of its distance, the viewer has walked into it.
const TOO_CLOSE = 0.25;

/**
 * Sizes and distances for the match cut, in the photographer's frame: the
 * capture camera at the origin, looking down -z, `eyeHeight` above the floor.
 * Scene size fixes all of them, so the street keeps its size and still lines
 * up with the photograph.
 */
export function photographerLayout(settings) {
  // Half the capture's field of view, as tangents. SHARP centres the
  // principal point, so the frame is symmetric about the view axis.
  const tanX = 0.5/settings.captureFocalRatio;
  const tanY = tanX/settings.captureAspect;
  const eyeHeight = settings.captureCameraHeight*settings.sceneScale;
  // The capture camera was level, so the bottom of its frame meets the floor
  // here: a portal that fills the frame at this distance stands on the floor.
  const portalDistance = eyeHeight/tanY;
  const streetStart = settings.captureGroundStart*settings.sceneScale;
  // The aperture recedes from the photograph to the portal, never toward the viewer.
  const photoDistance = Math.min(settings.photoDistance, 0.95*portalDistance);
  return Object.freeze({
    tanX, tanY, eyeHeight,
    photoDistance, photoWidth: 2*tanX*photoDistance, photoHeight: 2*tanY*photoDistance,
    portalDistance, portalWidth: 2*tanX*portalDistance, portalHeight: 2*eyeHeight,
    streetStart,
    // From the portal plane to where the street begins; below zero its ground
    // spills out in front of the portal.
    sceneDistance: streetStart-portalDistance,
  });
}

const dot = (a, b) => a.x*b.x+a.y*b.y+a.z*b.z;

/**
 * Where the phone stands relative to the photographer's spot, and what to tell
 * the viewer. `view` is the camera in the photographer's frame: its `eye`, its
 * `right`, `up` and `forward` axes, and `wide` when the screen is wider than
 * tall (then `right` runs along its long side, otherwise `up` does).
 *
 * `error` is how far, in degrees, the photograph's edges sit from where they
 * appear from the spot itself. It depends on where the phone is, not on where
 * it points, so aiming the phone cannot fake a match.
 */
export function alignment({ eye, right, up, forward, wide }, layout, tolerance) {
  const distance = layout.photoDistance;
  const depth = distance+eye.z;
  const landscape = Math.abs((wide ? right : up).y) < LANDSCAPE_TILT;
  const toPhoto = { x: -eye.x, y: -eye.y, z: -depth };
  const facing = dot(forward, toPhoto) > FACING*Math.sqrt(dot(toPhoto, toPhoto));
  if (depth <= TOO_CLOSE*distance) {
    return { landscape, facing, error: 90, aligned: false, hint: "Step back from the photograph" };
  }
  // Tangent offsets of the frame's edges: a sideways or vertical step shifts
  // the photograph; a step along the view scales it about its centre.
  const across = Math.abs(eye.x)/depth, vertical = Math.abs(eye.y)/depth;
  const scale = Math.abs(eye.z)/depth;
  const error = Math.atan(Math.max(across+layout.tanX*scale, vertical+layout.tanY*scale))/DEGREE;
  const aligned = landscape && facing && error <= tolerance;
  let hint = "Hold still";
  if (!landscape) hint = "Turn your phone sideways";
  else if (!facing) hint = "Face the photograph";
  else if (!aligned) {
    const along = eye.z > 0
      ? error > 3*tolerance ? "Walk up until the photograph fills the frame" : "A little closer"
      : "Step back a little";
    // Name the largest of the three offsets.
    [, hint] = [[layout.tanX*scale, along],
      [across, eye.x > 0 ? "Step left" : "Step right"],
      [vertical, eye.y > 0 ? "Lower your phone" : "Raise your phone"]]
      .reduce((most, next) => next[0] > most[0] ? next : most);
  }
  return { landscape, facing, error, aligned, hint };
}

/**
 * Turn, in degrees, that sets on-screen text upright for the phone as held.
 * `upX` and `upY` are the world's up along the screen's right and up axes.
 * Quarter turns only, so text stays crisp and settles while the phone sways.
 */
export function uprightTurn(upX, upY) {
  return 90*Math.round(Math.atan2(upX, upY)/(90*DEGREE));
}
