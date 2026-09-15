#!/usr/bin/env bash
# Create a local venv able to run `sharp predict` on Apple Silicon (MPS).
#
# gsplat is a hard dependency of the sharp package but is CUDA-only and is
# imported at module load. Prediction never calls into it -- only `--render`
# does -- so we install everything else and drop in a stub module.
set -euo pipefail

cd "$(dirname "$0")/.."
PY=/opt/homebrew/bin/python3

[ -d .venv ] || "$PY" -m venv .venv
./.venv/bin/pip install -q -U pip wheel

# Versions pinned to match vendor-ml-sharp/requirements.txt
./.venv/bin/pip install -q \
  torch==2.8.0 torchvision==0.23.0 timm==1.0.20 \
  plyfile==1.1.2 scipy==1.16.2 numpy==2.3.3 \
  "imageio[ffmpeg]==2.37.0" imageio-ffmpeg==0.6.0 \
  pillow-heif==1.1.1 matplotlib==3.10.6 click==8.3.0

# Stub gsplat so `import gsplat` succeeds without CUDA.
SITE=$(./.venv/bin/python -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')
mkdir -p "$SITE/gsplat"
cat > "$SITE/gsplat/__init__.py" <<'STUB'
"""Stub for the CUDA-only gsplat package.

apple/ml-sharp imports gsplat at module load but only uses it for the
`--render` video path, which requires CUDA. Prediction on MPS/CPU never
touches it. Any real attribute access raises, so accidental use is loud.
"""


def __getattr__(name):
    raise RuntimeError(
        f"gsplat.{name} was accessed, but gsplat is stubbed out on this machine "
        "(CUDA-only). Rendering via --render is unavailable; prediction works."
    )
STUB

# Install the sharp package itself without re-resolving deps (avoids gsplat).
./.venv/bin/pip install -q --no-deps -e vendor-ml-sharp

./.venv/bin/python - <<'CHECK'
import torch
print("torch", torch.__version__, "| MPS available:", torch.backends.mps.is_available())
import gsplat  # noqa: F401  (stub must import cleanly)
print("gsplat stub imports OK")
CHECK

echo "ENV READY"
