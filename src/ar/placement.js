import * as THREE from "three";

/**
 * Builds the node that stands in for the viewer's "sweet spot": the eye
 * position the desktop preview renders from.
 *
 * In the preview the eye is at the origin looking down -z, the window sits at
 * z = -windowDistance and the scene root at z = -sceneOffsetZ. Parenting the
 * matte and scene under this anchor reproduces that layout exactly, so values
 * tuned in the preview carry over without conversion.
 */
export function createAnchor(matte, splatRoot) {
  const anchor = new THREE.Group();
  anchor.add(matte);
  anchor.add(splatRoot);
  anchor.visible = false;
  return anchor;
}

/**
 * Pose for the anchor given the camera at the moment of placement: at the
 * camera's position, turned to its heading but kept upright, so the window
 * never tilts with the phone.
 *
 * Returns a new position and quaternion; the caller applies them.
 */
export function anchorPoseFromCamera(camera) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  forward.y = 0;

  // Pointing straight up or down leaves no heading; fall back to world -z.
  const heading = forward.lengthSq() < 1e-8 ? new THREE.Vector3(0, 0, -1) : forward.normalize();
  const yaw = Math.atan2(-heading.x, -heading.z);

  return {
    position: camera.position.clone(),
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
  };
}

/** Reject feature points and tilted surfaces; placement needs a real floor. */
export function floorFromHits(hits, cameraY) {
  const floors = hits.filter((hit) => {
    if (!["DETECTED_SURFACE", "ESTIMATED_SURFACE"].includes(hit.type)) return false;
    const { position: p, rotation: r } = hit;
    if (!p || !r || ![p.x,p.y,p.z,r.x,r.y,r.z,r.w].every(Number.isFinite)) return false;
    const up = new THREE.Vector3(0,1,0).applyQuaternion(new THREE.Quaternion(r.x,r.y,r.z,r.w));
    return Math.abs(up.y)>0.9 && p.y<cameraY-0.15;
  });
  return floors.sort((a,b) => a.position.y-b.position.y)[0] ?? null;
}
