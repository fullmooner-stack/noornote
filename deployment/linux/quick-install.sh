#!/bin/bash
# NoorNote Quick Installer for Debian/Ubuntu
# Usage: bash <(curl -s https://raw.githubusercontent.com/77elements/noornote/main/deployment/linux/quick-install.sh)

set -e

echo "=== NoorNote Installer ==="
echo ""

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
    x86_64)
        DEB_ARCH="amd64"
        ;;
    aarch64|arm64)
        DEB_ARCH="arm64"
        ;;
    *)
        echo "Error: Unsupported architecture: $ARCH"
        echo "Please use the tarball installation instead."
        exit 1
        ;;
esac

echo "Detected: $ARCH ($DEB_ARCH)"
echo ""

# Get latest release version
echo "Fetching latest release..."
LATEST=$(curl -sI https://github.com/77elements/noornote/releases/latest | grep -i "location:" | sed 's/.*tag\/v//' | tr -d '\r\n')

if [ -z "$LATEST" ]; then
    echo "Error: Could not determine latest version"
    exit 1
fi

echo "Latest version: $LATEST"
echo ""

# Download .deb
DEB_URL="https://github.com/77elements/noornote/releases/download/v${LATEST}/Noornote_${LATEST}_${DEB_ARCH}.deb"
DEB_FILE="/tmp/noornote_${LATEST}_${DEB_ARCH}.deb"

echo "Downloading $DEB_URL..."
curl -L "$DEB_URL" -o "$DEB_FILE"

if [ ! -f "$DEB_FILE" ]; then
    echo "Error: Download failed"
    exit 1
fi

echo ""
echo "Installing..."
sudo apt install -y "$DEB_FILE"

# Cleanup
rm -f "$DEB_FILE"

echo ""
echo "=== Installation complete ==="
echo ""
echo "Start NoorNote with: noornote"
echo ""
