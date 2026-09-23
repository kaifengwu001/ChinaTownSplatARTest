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
