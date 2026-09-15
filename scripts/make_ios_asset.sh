#!/usr/bin/env bash
# Produce the iOS app's splat asset from SHARP's PLY output.
#
# Must be MetalSplatter's own SplatConverter, NOT splat-transform. The two write
# incompatible files under the same .spz extension:
#
#   splat-transform  -> SPZ version 4, uncompressed
#   spz-swift 2.1.0  -> reads versions 1-3, and always gunzips first
#
# Feeding the app a splat-transform .spz fails inside loadSpzPacked before any
# of our code runs, which on device showed up as an unexplained SIGKILL.
set -euo pipefail

cd "$(dirname "$0")/.."

PLY=${1:-output/chop_suey.ply}
OUT=ios/Resources/chop_suey.spz

[ -f "$PLY" ] || { echo "Input PLY not found: $PLY"; exit 1; }
[ -d vendor-metalsplatter ] || {
  echo "vendor-metalsplatter checkout missing; clone https://github.com/scier/MetalSplatter"
  exit 1
}

mkdir -p ios/Resources
( cd vendor-metalsplatter && swift run -c release SplatConverter \
    "../$PLY" -o "../$OUT" -f spz )

# Sanity check the two properties that actually matter.
MAGIC=$(xxd -p -l 2 "$OUT")
[ "$MAGIC" = "1f8b" ] || { echo "ERROR: $OUT is not gzip (got $MAGIC)"; exit 1; }

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1)), gzip header verified"
