/**
 * Distance of the receding aperture, in the photographer's frame. It moves in
 * inverse depth, as the splats it frames do. The photograph and the portal
 * fill the same frustum, so from the photographer's spot the aperture keeps
 * the photograph's frame exactly all the way to the portal.
 */
export function apertureDistance(growth, layout) {
  return 1/((1-growth)/layout.photoDistance + growth/layout.portalDistance);
}
