/** Distance of the receding aperture from the spot. It moves in inverse depth, as the splats it frames do. */
export function apertureDistance(growth, layout) {
  return 1/((1-growth)/layout.photoDistance + growth/layout.portalDistance);
}
