#!/usr/bin/env bash
# Produce the Mattercraft splat assets from the decimated SHARP PLYs.
#
# Older releases of @zcomponent/three-gaussian-splatting do not read .sog, so
# these are gzip SPZ version 3, the standard Niantic format. They must come
# from MetalSplatter's SplatConverter: splat-transform writes version 4 without
# gzip, which is not the same format despite the shared extension.
set -euo pipefail

cd "$(dirname "$0")/.."

OUT_DIR=output/mattercraft
[ -d vendor-metalsplatter ] || {
  echo "vendor-metalsplatter checkout missing; clone https://github.com/scier/MetalSplatter"
  exit 1
}

mkdir -p "$OUT_DIR"
for pct in 50 25; do
  ply=output/decimated/chop_suey_${pct}.ply
  out=$OUT_DIR/chop_suey_${pct}.spz
  [ -f "$ply" ] || { echo "Input PLY not found: $ply"; exit 1; }

  ( cd vendor-metalsplatter && swift run -c release SplatConverter "../$ply" -o "../$out" -f spz )

  magic=$(xxd -p -l 2 "$out")
  [ "$magic" = "1f8b" ] || { echo "ERROR: $out is not gzip (got $magic)"; exit 1; }
  echo "Wrote $out ($(du -h "$out" | cut -f1))"
done
