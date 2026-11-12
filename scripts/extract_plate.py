"""Cut the photographic plate holder out of the Tripo model, as the frame the
historical photograph sits in.

Usage:
  .venv/bin/python -I scripts/extract_plate.py SOURCE.glb input/plate/photo-plate.glb

The model (tripo_convert_2cc39e33-…glb) is a wooden plate holder standing at
the front of a little stage of brass gadgets. Only the holder is kept. Its
dark slide is taken out and the hole is cut through its back, with walls
lining the hole, so the photograph shows in the slide's place and the street
can open behind it. The opening is stretched to the photograph's 4:3 while the
frame's borders, rail and handle keep their widths. The result is normalized
for src/memory-plate.js: the opening is 1 wide and 0.75 tall, centred on the
origin, the photograph's plane (where the slide sat) is z = 0, and the frame's
face looks down +z with y up.
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ASPECT = 1448 / 1086  # the photograph's, captureAspect in src/memory-settings.js
# The holder stands at the front of the model; everything with a part behind
# this depth is the gadgets' stage.
HOLDER_Z = 0.34
TEXTURE_SIZE = 2048
JPEG_QUALITY = 84
PADDING = 12  # texels of island colour around each island, so mipmaps don't bleed

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
DTYPES = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise SystemExit(f"{path} is not a glTF 2 binary")
    offset, chunks = 12, []
    while offset < length:
        size, _ = struct.unpack_from("<II", data, offset)
        chunks.append(data[offset + 8: offset + 8 + size])
        offset += 8 + size
    gltf, binary = json.loads(chunks[0]), chunks[1]

    def accessor(index):
        a = gltf["accessors"][index]
        view = gltf["bufferViews"][a["bufferView"]]
        dtype = np.dtype(DTYPES[a["componentType"]])
        width = COMPONENTS[a["type"]]
        start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = view.get("byteStride", 0) or dtype.itemsize * width
        rows = np.ndarray((a["count"], width), dtype, binary, start, (stride, dtype.itemsize)).copy()
        return rows if width > 1 else rows[:, 0]

    meshes = gltf["meshes"]
    if len(meshes) != 1 or len(meshes[0]["primitives"]) != 1:
        raise SystemExit("Expected the Tripo model's single mesh")
    primitive = meshes[0]["primitives"][0]
    attributes = primitive["attributes"]
    image = gltf["images"][0]
    view = gltf["bufferViews"][image["bufferView"]]
    texture = Image.open(io.BytesIO(binary[view.get("byteOffset", 0): view.get("byteOffset", 0) + view["byteLength"]])).convert("RGB")
    return (gltf,
            accessor(attributes["POSITION"]).astype(np.float64),
            accessor(attributes["NORMAL"]).astype(np.float64),
            accessor(attributes["TEXCOORD_0"]).astype(np.float64),
            accessor(primitive["indices"]).astype(np.int64).reshape(-1, 3),
            texture)


def components(count, triangles):
    rows = triangles.ravel()
    cols = triangles[:, [1, 2, 0]].ravel()
    return connected_components(coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(count, count)), directed=False)


def find_slide(positions, normals, triangles, labels):
    """The dark slide: the largest island lying flat in one plane, facing out of the holder."""
    best = None
    for label in np.unique(labels[triangles[:, 0]]):
        faces = triangles[labels[triangles[:, 0]] == label]
        points = positions[np.unique(faces)]
        if np.ptp(points[:, 2]) > 1e-4 or normals[np.unique(faces), 2].mean() < 0.5:
            continue
        area = np.ptp(points[:, 0]) * np.ptp(points[:, 1])
        if best is None or area > best[0]:
            best = (area, label, points)
    if best is None:
        raise SystemExit("Could not find the dark slide")
    return best[1], best[2]


def clip(polygon, keep):
    """Sutherland-Hodgman: the part of a convex polygon where keep(vertex) >= 0."""
    out = []
    for i, current in enumerate(polygon):
        previous = polygon[i - 1]
        a, b = keep(previous), keep(current)
        if b >= 0:
            if a < 0:
                out.append(previous + (current - previous) * (a / (a - b)))
            out.append(current)
        elif a >= 0:
            out.append(previous + (current - previous) * (a / (a - b)))
    return out


def outside(polygon, x0, x1, y0, y1):
    """The polygon minus the opening's footprint, as convex pieces left, right, below and above it."""
    pieces = [
        [lambda v: x0 - v[0]],
        [lambda v: v[0] - x1],
        [lambda v: v[0] - x0, lambda v: x1 - v[0], lambda v: y0 - v[1]],
        [lambda v: v[0] - x0, lambda v: x1 - v[0], lambda v: v[1] - y1],
    ]
    for planes in pieces:
        piece = polygon
        for plane in planes:
            piece = clip(piece, plane)
            if len(piece) < 3:
                break
        if len(piece) >= 3:
            yield piece


def plain_patch(texture, used):
    """A small, plain, dark square of texels well inside the kept islands, for the hole's walls."""
    gray = np.asarray(texture.convert("L"), dtype=np.float64) / 255
    inner = ndimage.binary_erosion(used, iterations=24)
    mean = ndimage.uniform_filter(gray, 33)
    variance = ndimage.uniform_filter(gray * gray, 33) - mean * mean
    score = np.where(inner & (mean < 0.25), variance, np.inf)
    row, col = np.unravel_index(np.argmin(score), score.shape)
    if not np.isfinite(score[row, col]):
        raise SystemExit("No plain dark patch for the walls")
    h, w = gray.shape
    return (col + 0.5) / w, (row + 0.5) / h, 6 / w, 6 / h


def rasterize_uv(uvs, triangles, size):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    w, h = size
    for face in triangles:
        draw.polygon([(uvs[i, 0] * w, uvs[i, 1] * h) for i in face], fill=255)
    return np.asarray(mask) > 0


def pad_texture(texture, used):
    """Islands keep their texels and spread their edge colours a little way out; the
    rest of the atlas, the slide's and the gadgets', becomes one flat dark colour."""
    pixels = np.asarray(texture, dtype=np.uint8)
    distance, (rows, cols) = ndimage.distance_transform_edt(~used, return_indices=True)
    padded = pixels[rows, cols]
    flat = pixels[used].mean(0).astype(np.uint8)
    padded[distance > PADDING] = flat
    return Image.fromarray(padded)


def write_glb(path, positions, normals, uvs, triangles, jpeg, extras, mesh_extras):
    blob = bytearray()
    views = []

    def add(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        view = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
        if target:
            view["target"] = target
        blob.extend(data)
        views.append(view)
        return len(views) - 1

    index_type = np.uint16 if len(positions) < 65535 else np.uint32
    accessors = [
        {"bufferView": add(positions.astype(np.float32).tobytes(), 34962), "componentType": 5126, "count": len(positions), "type": "VEC3",
         "min": positions.min(0).astype(np.float32).tolist(), "max": positions.max(0).astype(np.float32).tolist()},
        {"bufferView": add(normals.astype(np.float32).tobytes(), 34962), "componentType": 5126, "count": len(normals), "type": "VEC3"},
        {"bufferView": add(uvs.astype(np.float32).tobytes(), 34962), "componentType": 5126, "count": len(uvs), "type": "VEC2"},
        {"bufferView": add(triangles.astype(index_type).tobytes(), 34963), "componentType": 5123 if index_type is np.uint16 else 5125,
         "count": triangles.size, "type": "SCALAR"},
    ]
    image_view = add(jpeg)
    while len(blob) % 4:
        blob.append(0)
    gltf = {
        "asset": {"version": "2.0", "generator": "scripts/extract_plate.py", "extras": extras},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "photo-plate"}],
        "meshes": [{"name": "photo-plate", "extras": mesh_extras,
                    "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{"name": "photo-plate", "doubleSided": True,
                       "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.85}}],
        "textures": [{"sampler": 0, "source": 0}],
        "images": [{"bufferView": image_view, "mimeType": "image/jpeg"}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    with open(path, "wb") as out:
        out.write(struct.pack("<III", 0x46546C67, 2, total))
        out.write(struct.pack("<II", len(text), 0x4E4F534A) + text)
        out.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    return total


def main(source, target):
    gltf, positions, normals, uvs, triangles, texture = read_glb(source)
    _, labels = components(len(positions), triangles)
    lowest = np.full(labels.max() + 1, np.inf)
    np.minimum.at(lowest, labels, positions[:, 2])
    holder = triangles[lowest[labels[triangles[:, 0]]] >= HOLDER_Z]
    slide_label, slide = find_slide(positions, normals, holder, labels)
    plane = slide[0, 2]
    # The opening is the slide's bounding rectangle: its left end curves, and
    # the frame's face hides the photograph's corners where the curve comes in.
    x0, x1 = slide[:, 0].min(), slide[:, 0].max()
    y0, y1 = slide[:, 1].min(), slide[:, 1].max()
    holder = holder[labels[holder[:, 0]] != slide_label]
    print(f"holder: {len(holder)} triangles; slide plane z={plane:.4f}, opening x {x0:.4f}..{x1:.4f}, y {y0:.4f}..{y1:.4f}")

    # Cut the hole through everything behind the slide's plane; the lip in
    # front of it stays, framing the photograph.
    corners = positions[holder]
    behind = corners[:, :, 2].max(1) < plane - 1e-3
    crosses = ((corners[:, :, 0].max(1) > x0 + 1e-6) & (corners[:, :, 0].min(1) < x1 - 1e-6)
               & (corners[:, :, 1].max(1) > y0 + 1e-6) & (corners[:, :, 1].min(1) < y1 - 1e-6))
    straddling = crosses & ~behind & (corners[:, :, 2].min(1) < plane - 1e-3)
    if straddling.any():
        raise SystemExit(f"{straddling.sum()} triangles cross the slide's plane inside the opening")
    cut = holder[crosses & behind]
    kept = holder[~(crosses & behind)]
    back = np.median(positions[cut][:, :, 2]) if len(cut) else None
    if back is None:
        raise SystemExit("Nothing behind the opening to cut")
    vertices = [np.hstack([positions, normals, uvs])]
    faces = [kept]
    count = len(positions)
    pieces = 0
    for face in cut:
        polygon = [vertices[0][i] for i in face]
        for piece in outside(polygon, x0, x1, y0, y1):
            ring = np.array(piece)
            ring[:, 3:6] /= np.linalg.norm(ring[:, 3:6], axis=1, keepdims=True)
            vertices.append(ring)
            for i in range(1, len(ring) - 1):
                a, b, c = ring[0, :3], ring[i, :3], ring[i + 1, :3]
                if np.linalg.norm(np.cross(b - a, c - a)) > 1e-12:
                    faces.append(np.array([[count, count + i, count + i + 1]]))
            count += len(ring)
            pieces += 1
    print(f"back: cut {len(cut)} triangles into {pieces} pieces around the opening, back plane z={back:.4f}")

    # Walls lining the hole, from the photograph's plane to the back, facing
    # into it, all on one plain dark patch of the atlas.
    u, v, du, dv = plain_patch(texture, rasterize_uv(uvs, kept, texture.size))
    patch = [(u - du, v - dv), (u + du, v - dv), (u + du, v + dv), (u - du, v + dv)]
    walls = [
        ([x0, y0], [x0, y1], (1, 0)),   # left, facing +x
        ([x1, y1], [x1, y0], (-1, 0)),  # right, facing -x
        ([x1, y0], [x0, y0], (0, 1)),   # bottom, facing +y
        ([x0, y1], [x1, y1], (0, -1)),  # top, facing -y
    ]
    for (ax, ay), (bx, by), (nx, ny) in walls:
        quad = np.array([
            [ax, ay, plane, nx, ny, 0, *patch[0]],
            [ax, ay, back, nx, ny, 0, *patch[1]],
            [bx, by, back, nx, ny, 0, *patch[2]],
            [bx, by, plane, nx, ny, 0, *patch[3]],
        ])
        # Wind each wall counter-clockwise as seen from inside the hole.
        normal = np.cross(quad[1, :3] - quad[0, :3], quad[2, :3] - quad[0, :3])
        order = [0, 1, 2, 0, 2, 3] if np.dot(normal, [nx, ny, 0]) > 0 else [0, 2, 1, 0, 3, 2]
        vertices.append(quad)
        faces.append(np.array(order).reshape(2, 3) + count)
        count += 4
    vertices = np.vstack(vertices)
    faces = np.vstack(faces)

    # Drop the vertices nothing uses any more: the slide's and the gadgets'.
    used_vertices, faces = np.unique(faces, return_inverse=True)
    faces = faces.reshape(-1, 3)
    vertices = vertices[used_vertices]

    # Nine-slice in x: only the opening's span stretches to 4:3, so the
    # borders, the rail and the handle keep their widths.
    stretch = ASPECT * (y1 - y0) / (x1 - x0)
    x = vertices[:, 0].copy()
    inside, right = (x > x0) & (x < x1), x >= x1
    vertices[inside, 0] = x0 + (x[inside] - x0) * stretch
    vertices[right, 0] += (x1 - x0) * (stretch - 1)
    vertices[inside, 3] /= stretch
    vertices[:, 3:6] /= np.linalg.norm(vertices[:, 3:6], axis=1, keepdims=True)
    width = (x1 - x0) * stretch
    centre = np.array([x0 + width / 2, (y0 + y1) / 2, plane])
    vertices[:, :3] = (vertices[:, :3] - centre) / width
    print(f"opening stretched x{stretch:.4f}; normalized bounds {vertices[:, :3].min(0).round(4)} .. {vertices[:, :3].max(0).round(4)}")

    used = rasterize_uv(vertices[:, 6:8], faces, texture.size)
    image = pad_texture(texture, used)
    if image.size != (TEXTURE_SIZE, TEXTURE_SIZE):
        image = image.resize((TEXTURE_SIZE, TEXTURE_SIZE), Image.LANCZOS)
    jpeg = io.BytesIO()
    image.save(jpeg, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=False)
    opening = [-0.5, -0.375, 0.5, 0.375]
    extras = {"source": "Tripo model tripo_convert_2cc39e33-e84b-44c5-bd1f-e3ed96df046c, plate holder only"}
    if "extras" in gltf.get("asset", {}):
        extras["sourceExtras"] = gltf["asset"]["extras"]
    total = write_glb(target, vertices[:, :3], vertices[:, 3:6], vertices[:, 6:8], faces, jpeg.getvalue(),
                      extras, {"opening": opening, "photoPlane": 0})
    print(f"wrote {target}: {len(vertices)} vertices, {len(faces)} triangles, texture {len(jpeg.getvalue()) // 1024} KB, {total // 1024} KB in all")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
