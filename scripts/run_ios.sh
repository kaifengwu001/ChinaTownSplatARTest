#!/usr/bin/env bash
# Build, install, and launch the AR window app on a connected iPhone.
#
# Requires the phone plugged in and unlocked with Developer Mode enabled:
# Settings > Privacy & Security > Developer Mode.
set -euo pipefail

cd "$(dirname "$0")/../ios"

BUNDLE_ID=com.kaifengwu.parallaxwindow
APP=~/Library/Developer/Xcode/DerivedData/Build/Products/Debug-iphoneos/ParallaxWindow.app

command -v xcodegen >/dev/null || { echo "xcodegen not installed: brew install xcodegen"; exit 1; }
xcodegen generate

# Columns are separated by runs of spaces. Match the state field exactly, since
# a substring match on "available" also matches "unavailable".
DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk -F'  +' '
  { for (i = 1; i <= NF; i++) gsub(/^ +| +$/, "", $i) }
  $4 ~ /^available/ && $5 ~ /iPhone/ { print $3; exit }')

if [ -z "$DEVICE" ]; then
  echo "No available iPhone found. Connect it via USB, unlock it, trust this Mac,"
  echo "and make sure Developer Mode is on. Current devices:"
  xcrun devicectl list devices
  exit 1
fi

# CoreDevice reports a device as available before a pairing record exists, and
# install fails with RemotePairingError until one does. Pairing is idempotent.
xcrun devicectl manage pair --device "$DEVICE" --quiet 2>/dev/null || true

# Built for a generic device rather than this specific one: xcodebuild resolves
# destinations by UDID while devicectl reports a CoreDevice UUID, and the two do
# not match. devicectl handles targeting at install time instead.
echo "Building"
xcodebuild -project ParallaxWindow.xcodeproj -scheme ParallaxWindow \
  -destination 'generic/platform=iOS' -configuration Debug \
  -allowProvisioningUpdates build

echo "Installing on $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP"

echo "Launching"
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID"
