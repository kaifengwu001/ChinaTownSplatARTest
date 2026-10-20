"""Fit the street ground of a SHARP reconstruction for floor-aligned placement.

Prints the `captureGroundUp`, `captureCameraHeight` and `captureGroundStart`
values used by src/memory-settings.js. Re-run when the reconstruction changes:

    .venv/bin/python scripts/fit_ground.py output/apalabassa/apalabassa.ply

SHARP writes OpenCV camera coordinates (x right, y DOWN, z forward) with the
capture camera at the origin, in approximately metric units. The ground is fit
to the lowest surface of each 0.5 m x 1 m cell (building bases, tyres, street),
which ignores facades and car bodies, then refined on the inlier cells.
"""
import argparse

import numpy as np

TYPES = {"float": "<f4", "double": "<f8", "uint": "<u4", "int": "<i4", "uchar": "u1"}


def read_vertices(path):
    """Splat centres and opacities."""
    with open(path, "rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            header += f.readline()
        elements = []
        for line in header.decode().splitlines():
            parts = line.split()
            if parts[0] == "element":
                elements.append((parts[1], int(parts[2]), []))
            elif parts[0] == "property":
                elements[-1][2].append((parts[-1], TYPES[parts[1]]))
        if elements[0][0] != "vertex":
            raise ValueError("expected the vertex element first")
        _, count, props = elements[0]
        v = np.frombuffer(f.read(np.dtype(props).itemsize * count), dtype=np.dtype(props), count=count)
    xyz = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float64)
    alpha = 1 / (1 + np.exp(-v["opacity"].astype(np.float64)))
    return xyz, alpha


def cell_lows(p):
    """The near-bottom point (92nd percentile of y, which points down) of each ground cell."""
    x, y, z = p.T
    key = np.floor(x / 0.5).astype(np.int64) * 100000 + np.floor(z).astype(np.int64)
    order = np.lexsort((y, key))
    key, p = key[order], p[order]
    starts = np.r_[0, np.nonzero(np.diff(key))[0] + 1]
    ends = np.r_[starts[1:], len(key)]
    return np.array([p[a + int(0.92 * (b - a - 1))] for a, b in zip(starts, ends) if b - a >= 15])


def fit_plane(lows, tolerance=0.15):
    """Robust y = c0 + c1 x + c2 z."""
    a = np.c_[np.ones(len(lows)), lows[:, 0], lows[:, 2]]
    rng = np.random.default_rng(0)
    best = None
    for _ in range(4000):
        idx = rng.choice(len(lows), 3, replace=False)
        try:
            c = np.linalg.solve(a[idx], lows[idx, 1])
        except np.linalg.LinAlgError:
            continue
        count = (np.abs(a @ c - lows[:, 1]) < tolerance).sum()
        if best is None or count > best[0]:
            best = (count, c)
    c = best[1]
    for _ in range(3):
        inliers = np.abs(a @ c - lows[:, 1]) < tolerance
        c = np.linalg.lstsq(a[inliers], lows[inliers, 1], rcond=None)[0]
    return c, inliers.sum()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("ply")
    args = parser.parse_args()

    xyz, alpha = read_vertices(args.ply)
    near = (alpha > 0.3) & (xyz[:, 2] > 2) & (xyz[:, 2] < 80) & (np.abs(xyz[:, 0]) < 9)
    lows = cell_lows(xyz[near])
    c, inliers = fit_plane(lows)

    up = np.array([c[1], -1.0, c[2]])  # plane normal pointing up (-y in OpenCV)
    up /= np.linalg.norm(up)
    height = c[0] * -up[1]  # distance from the camera to the plane
    forward = np.array([0.0, 0.0, 1.0]) - up * up[2]
    forward /= np.linalg.norm(forward)
    right = np.cross(up, forward)
    right *= np.sign(right[0])

    visible = alpha > 0.05
    above = xyz @ up + height
    ahead = xyz @ forward
    side = xyz @ right
    ground = visible & (np.abs(above) < 0.2) & (np.abs(side) < 1.5)
    start = np.percentile(ahead[ground], 0.5)
    corridor = visible & (np.abs(side) < 1) & (ahead >= start) & (ahead < start + 3)

    print(f"ground plane from {inliers}/{len(lows)} cells")
    print(f"camera pitch {np.degrees(np.arcsin(up[2])):+.1f} deg (positive looks up), roll {np.degrees(np.arcsin(up[0])):+.1f} deg")
    print(f"street content in the first 3 m past the front edge, |side| < 1 m: "
          f"{np.mean(above[corridor] < 0.3) * 100:.0f}% within 0.3 m of the ground")
    print()
    print(f"  captureGroundUp: [{up[0]:.5f}, {up[1]:.5f}, {up[2]:.5f}],")
    print(f"  captureCameraHeight: {height:.2f},")
    print(f"  captureGroundStart: {start:.2f},")


if __name__ == "__main__":
    main()
