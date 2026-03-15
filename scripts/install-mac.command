#!/bin/bash
# Collet — macOS Installer
# Double-click this file to install Collet automatically.
# It handles the Gatekeeper quarantine flag so no Terminal commands are needed.

set -e

echo ""
echo "╔══════════════════════════════════╗"
echo "║       Collet — Mac Installer     ║"
echo "╚══════════════════════════════════╝"
echo ""

# Find the DMG in Downloads
DMG=$(ls -t ~/Downloads/collet-*.dmg 2>/dev/null | head -1)

if [ -z "$DMG" ]; then
  echo "❌  No Collet DMG found in ~/Downloads."
  echo "    Please download Collet from https://collet-web.vercel.app/downloads"
  echo ""
  read -rp "Press Enter to exit..."
  exit 1
fi

echo "✔  Found: $DMG"
echo ""

# Remove quarantine from DMG
echo "→  Clearing Gatekeeper quarantine..."
xattr -cr "$DMG"

# Mount DMG silently
echo "→  Mounting disk image..."
MOUNT_POINT=$(hdiutil attach "$DMG" -nobrowse -noautoopen | grep /Volumes | awk '{print $3}')

if [ -z "$MOUNT_POINT" ]; then
  echo "❌  Could not mount DMG. Please try again."
  read -rp "Press Enter to exit..."
  exit 1
fi

echo "→  Mounted at: $MOUNT_POINT"

# Copy to Applications
echo "→  Installing to /Applications..."
cp -R "$MOUNT_POINT/Collet.app" /Applications/

# Remove quarantine from installed app
echo "→  Clearing quarantine from installed app..."
xattr -rd com.apple.quarantine /Applications/Collet.app 2>/dev/null || true

# Unmount
echo "→  Unmounting disk image..."
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

echo ""
echo "✅  Collet installed successfully!"
echo "    Launching now..."
echo ""

open /Applications/Collet.app

exit 0
