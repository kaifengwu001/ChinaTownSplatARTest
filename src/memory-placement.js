/** Positions are local to the fixed phone pose captured at placement. */
export function memoryPlacement(growth, config, dimensions, settings, floorY) {
  const targetCenterY = floorY + settings.portalBottomHeight + dimensions.portalHeight / 2;
  // Match the splats' inverse-depth and viewing-ray interpolation. This keeps
  // the moving aperture in front of the scene and centered on the same ray.
  const distance = 1 / ((1-growth)/settings.photoDistance + growth/settings.portalDistance);
  const centerY = distance * ((1-growth)*settings.photoElevation/settings.photoDistance + growth*targetCenterY/settings.portalDistance);
  return { distance, centerY, targetCenterY };
}
