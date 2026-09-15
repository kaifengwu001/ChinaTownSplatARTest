#!/usr/bin/env bash
# Build, install, and launch the AR window app on a connected iPhone.
#
# Requires the phone plugged in (or paired over Wi-Fi) with Developer Mode
# enabled: Settings > Privacy & Security > Developer Mode.
set -euo pipefail

cd "$(dirname "$0")/../ios"

BUNDLE_ID=com.kaifengwu.parallaxwindow
APP=~/Library/Developer/Xcode/DerivedData/Build/Products/Debug-iphoneos/ParallaxWindow.app

# Regenerate in case project.yml or the source list changed.
command -v xcodegen >/dev/null || { echo "xcodegen not installed: brew install xcodegen"; exit 1; }
xcodegen generate

DEVICE=$(xcrun devicectl list devices 2>/dev/null \
  | awk -F'  +' '/available/ && /iPhone/ {print $3; exit}')

if [ -z "$DEVICE" ]; then
  echo "No available iPhone found. Connect it via USB, unlock it, trust this Mac,"
  echo "and make sure Developer Mode is on. Current devices:"
  xcrun devicectl list devices
  exit 1
fi

echo "Building for device $DEVICE"
xcodebuild -project ParallaxWindow.xcodeproj -scheme ParallaxWindow \
  -destination "id=$DEVICE" -configuration Debug \
  -allowProvisioningUpdates build

echo "Installing"
xcrun devicectl device install app --device "$DEVICE" "$APP"

echo "Launching"
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID"
