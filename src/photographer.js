// The match cut puts the viewer where the photographer stood, or a little in
// front of it. The photograph becomes the street there, then opens into the
// portal with a slight dolly zoom. Pure geometry, shared by the AR page, the
// preview and node --test.

const DEGREE = Math.PI/180;
// The phone counts as sideways while its long side is within 25° of level,
// and as facing the photograph while its centre is within 15° of the view's.
const LANDSCAPE_TILT = Math.sin(25*DEGREE);
const FACING = Math.cos(15*DEGREE);
// Nearer than this fraction of its distance, the viewer has walked into it.
const TOO_CLOSE = 0.25;
// Dolly 1 restores the tap version, whose viewer stood 1.80 m in front of the
// photographer, 0.56 of the way to where the street began (3.21 m). Measured
// against the street's start, as the dolly's pivot is, the same dolly looks
// the same in any reconstruction.
const TAP_DOLLY = 1.803/3.213;
// The street begins at least this far ahead of the spot.
const STREET_AHEAD = 0.5;

// Until a phone's camera is known: about 64° across a 19.5:9 screen.
export const DEFAULT_SCREEN = Object.freeze({ tanLong: Math.tan(32*DEGREE), tanShort: Math.tan(32*DEGREE)/(19.5/9) });

/**
 * Half the screen's field of view, as tangents along its long and short
 * sides, from a camera's projection matrix elements.
 */
export function screenTangents(projection) {
  const x = 1/projection?.[0], y = 1/projection?.[5];
  if (!(x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y))) return DEFAULT_SCREEN;
  return Object.freeze({ tanLong: Math.max(x, y), tanShort: Math.min(x, y) });
}

/**
 * Scale of the photographer's frame (half-tangents `tanX` and `tanY`) that
 * fits inside a sideways screen and spans `share` of it along whichever side
 * it reaches first: the height, for a 4:3 photograph on a phone.
 */
export function frameScale(share, { tanLong, tanShort }, tanX, tanY) {
  return share*Math.min(tanLong/tanX, tanShort/tanY);
}

/**
 * Sizes and distances for the match cut, in the frame of the spot where the
 * viewer matches the photograph: looking down -z, `eyeHeight` above the floor,
 * with the capture camera `captureOffset` behind it. Scene size, the dolly and
 * the share of the screen the matched photograph covers fix all of them.
 *
 * Distant things always appear at the photographer's angles, so a photograph
 * smaller than the photographer's frame must grow as it opens: it covers
 * `photoScale` of that frame on the matching screen, the finished portal
 * `portalScale`. The dolly moves the spot in front of the capture camera and
 * grows the portal to keep content at three times the street's starting
 * distance the same size in it, so nearer content grows in the frame and
 * farther content shrinks: a dolly zoom. A sideways phone at the spot sees
 * the street from about 5 m on, so that pivot falls between the foreground
 * (the cart, the children) and the buildings.
 */
export function photographerLayout(settings, screen = DEFAULT_SCREEN) {
  // Half the capture's field of view, as tangents. SHARP centres the
  // principal point, so the frame is symmetric about the view axis.
  const tanX = 0.5/settings.captureFocalRatio;
  const tanY = tanX/settings.captureAspect;
  const eyeHeight = settings.captureCameraHeight*settings.sceneScale;
  const captureStreet = settings.captureGroundStart*settings.sceneScale;
  const captureOffset = Math.max(0, Math.min(settings.dolly*TAP_DOLLY*captureStreet, captureStreet-STREET_AHEAD));
  const subject = 3*captureStreet;
  const portalScale = subject/(subject-captureOffset);
  // The capture camera was level, so the bottom of the portal's frame meets
  // the floor here, and the portal stands on it.
  const portalDistance = eyeHeight/(portalScale*tanY);
  const photoScale = frameScale(settings.matchFrame, screen, tanX, tanY);
  // The aperture recedes from the photograph to the portal, never toward the viewer.
  const photoDistance = Math.min(settings.photoDistance, 0.95*portalDistance);
  const streetStart = captureStreet-captureOffset;
  return Object.freeze({
    tanX, tanY, eyeHeight, captureOffset, photoScale, portalScale,
    photoDistance, photoWidth: 2*photoScale*tanX*photoDistance, photoHeight: 2*photoScale*tanY*photoDistance,
    portalDistance, portalWidth: 2*portalScale*tanX*portalDistance, portalHeight: 2*eyeHeight,
    streetStart,
    // From the portal plane to where the street begins; below zero its ground
    // spills out in front of the portal.
    sceneDistance: streetStart-portalDistance,
  });
}

const dot = (a, b) => a.x*b.x+a.y*b.y+a.z*b.z;

/**
 * Where the photograph sits in the guide frame, which stays fixed on the
 * screen, and what to tell the viewer. `view` is the camera in the spot's
 * frame: its `eye`, its `right`, `up` and `forward` axes, and `wide` when the
 * screen is wider than tall (then `right` runs along its long side, otherwise
 * `up` does).
 *
 * The frame is the photograph's outline as seen from the spot, looking
 * straight ahead. `error` is how far, in degrees, the photograph's corners sit
 * from the frame's on the screen as the phone is held, so it is what the
 * viewer sees: stepping and aiming both move them. The match then eases the
 * memory onto wherever the phone stands and points. The memory stays level,
 * so the phone must be too: `pitch` is how far, in degrees, it looks up.
 */
export function alignment({ eye, right, up, forward, wide }, layout, tolerance) {
  const distance = layout.photoDistance;
  const halfX = layout.photoWidth/2, halfY = layout.photoHeight/2;
  const frameX = halfX/distance, frameY = halfY/distance;
  const depth = distance+eye.z;
  const landscape = Math.abs((wide ? right : up).y) < LANDSCAPE_TILT;
  const toPhoto = { x: -eye.x, y: -eye.y, z: -depth };
  const facing = dot(forward, toPhoto) > FACING*Math.sqrt(dot(toPhoto, toPhoto));
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)))/DEGREE;
  const missed = hint => ({ landscape, facing, pitch, error: 90, aligned: false, hint });
  if (depth <= TOO_CLOSE*distance) return missed("Step back from the photograph");
  if (!landscape) return missed("Turn your phone sideways");
  if (!facing) return missed("Face the photograph");
  // The screen's axes as the phone is held: `across` along its physical horizontal.
  const turn = uprightTurn(right.y, up.y)*DEGREE, c = Math.cos(turn), s = Math.sin(turn);
  const across = { x: c*right.x-s*up.x, y: c*right.y-s*up.y, z: c*right.z-s*up.z };
  const upward = { x: s*right.x+c*up.x, y: s*right.y+c*up.y, z: s*right.z+c*up.z };
  // Each corner of the photograph on screen, as tangents, against the frame's.
  let offset = 0, centreX = 0, centreY = 0, width = 0;
  for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const corner = { x: i*halfX-eye.x, y: j*halfY-eye.y, z: -distance-eye.z };
    const ahead = dot(corner, forward);
    const x = dot(corner, across)/ahead, y = dot(corner, upward)/ahead;
    offset = Math.max(offset, Math.hypot(x-i*frameX, y-j*frameY));
    centreX += x/4; centreY += y/4; width += i*x/4;
  }
  const error = Math.atan(offset)/DEGREE;
  const level = Math.abs(pitch) <= tolerance;
  const aligned = level && error <= tolerance;
  let hint = "Hold still";
  if (!level) hint = "Hold your phone level";
  else if (!aligned) {
    const along = width < frameX
      ? width < 0.5*frameX ? "Walk up until the photograph fills the frame" : "A little closer"
      : "Step back a little";
    // Name the largest correction: the photograph's size, or where it sits.
    [, hint] = [[Math.abs(width-frameX), along],
      [Math.abs(centreX), centreX > 0 ? "Turn right" : "Turn left"],
      [Math.abs(centreY), centreY > 0 ? "Raise your phone" : "Lower your phone"]]
      .reduce((most, next) => next[0] > most[0] ? next : most);
  }
  return { landscape, facing, pitch, error, aligned, hint };
}

/** Heading of a view direction about the spot's up axis: the turn taking -z to it. */
export function heading(forward) {
  return Math.atan2(-forward.x, -forward.z);
}

/**
 * Turn, in degrees, that sets on-screen text upright for the phone as held.
 * `upX` and `upY` are the world's up along the screen's right and up axes.
 * Quarter turns only, so text stays crisp and settles while the phone sways.
 */
export function uprightTurn(upX, upY) {
  return 90*Math.round(Math.atan2(upX, upY)/(90*DEGREE));
}
