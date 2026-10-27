"""Find where a restored colour photograph's frame lies in the original.

Prints the `originalFrame` value used by src/memory-settings.js: the colour
frame's left, top, right and bottom edges as fractions of the original's width
and height from its top-left corner. Re-run when either photograph changes:

    .venv/bin/python scripts/register_original.py input/apalabassa-original.jpg input/apalabassa.jpg

Restorations crop and stretch the original, and may add people or objects, so
the fit compares gradient magnitudes over a band of the colour frame that holds
unchanged structure (the facades, by default), not pixels. The mapping is a
scale and offset per axis; the script also fits shear and prints it, which
should be negligible.
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage, optimize


def gray(path, width):
    image = Image.open(path).convert("L")
    height = round(width * image.height / image.width)
    return np.asarray(image.resize((width, height), Image.LANCZOS), dtype=np.float64)


def edges(a, sigma=1.2):
    a = ndimage.gaussian_filter(a, sigma)
    return np.hypot(ndimage.sobel(a, 0), ndimage.sobel(a, 1))


def prepare(args, color_width, original_width):
    """Edge maps at one resolution, with the colour frame's pixel coordinates."""
    target = edges(gray(args.color, color_width))
    source = edges(gray(args.original, original_width))
    rows, cols = np.mgrid[0:target.shape[0], 0:target.shape[1]]
    xc = (cols + 0.5) / target.shape[1]
    yc = (rows + 0.5) / target.shape[0]
    return source, target, xc, yc, (yc > args.band[0]) & (yc < args.band[1])


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("original")
    parser.add_argument("color")
    parser.add_argument("--band", type=float, nargs=2, default=(0.12, 0.62),
                        help="rows of the colour frame to compare, as fractions from the top")
    args = parser.parse_args()

    # Edge maps to refine the fit on, and a coarse copy to search crops on.
    levels = [prepare(args, 724, 1000), prepare(args, 240, 330)]

    # Colour-frame coordinates to the original's: x_o = ax*x_c + bx + sx*y_c,
    # y_o = ay*y_c + by + sy*x_c, all as fractions from the top-left.
    def score(p, level=0):
        source, target, xc, yc, band = levels[level]
        ax, bx, ay, by, sx, sy = p
        xo = ax * xc + bx + sx * yc
        yo = ay * yc + by + sy * xc
        sampled = ndimage.map_coordinates(source, [yo * source.shape[0] - 0.5, xo * source.shape[1] - 0.5],
                                          order=1, mode="constant", cval=np.nan)
        keep = band & np.isfinite(sampled)
        a, b = sampled[keep], target[keep]
        return -np.mean((a - a.mean()) * (b - b.mean())) / (a.std() * b.std() + 1e-12)

    def fit(start, free):
        fixed = np.array(start, dtype=np.float64)
        def partial(q):
            p = fixed.copy()
            p[free] = q
            return score(p)
        best = fixed[free]
        for tolerance in (1e-5, 1e-6, 1e-7):
            best = optimize.minimize(partial, best, method="Nelder-Mead",
                                     options=dict(xatol=tolerance, fatol=tolerance / 10, maxiter=4000)).x
        fixed[free] = best
        return fixed, -score(fixed)

    # Restorations mostly crop and stretch one axis, which leaves the other
    # nearly whole, so search each axis's scale and offset in turn on the
    # coarse level before refining all of them together.
    start = np.array([1, 0, 1, 0, 0, 0], dtype=np.float64)
    for scale, offset in ((2, 3), (0, 1), (2, 3)):
        grid = [(a, b) for a in np.arange(0.75, 1.0001, 0.01) for b in np.arange(-0.05, 1.0001 - a + 0.05, 0.005)]
        def trial(pair):
            p = start.copy()
            p[[scale, offset]] = pair
            return score(p, 1)
        start[[scale, offset]] = min(grid, key=trial)

    sheared, sheared_score = fit(start, [0, 1, 2, 3, 4, 5])
    aligned, aligned_score = fit([*sheared[:4], 0, 0], [0, 1, 2, 3])
    ax, bx, ay, by = aligned[:4]
    print(f"correlation {aligned_score:.4f} (with shear {sheared_score:.4f}, shear {sheared[4]:.5f}, {sheared[5]:.5f})")
    print(f"originalFrame: Object.freeze([{bx:.4f}, {by:.4f}, {ax + bx:.4f}, {ay + by:.4f}]),")


if __name__ == "__main__":
    main()
