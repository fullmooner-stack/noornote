#!/bin/bash
set -e

# NoorNote Linux Installer
# For tarball installations on Arch, Fedora, etc.

echo "=== NoorNote Installer ==="
echo ""

# Detect package manager and install dependencies
install_deps() {
    if command -v pacman &> /dev/null; then
        echo "Detected Arch Linux (pacman)"
        echo "Installing dependencies..."
        sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsecret
    elif command -v dnf &> /dev/null; then
        echo "Detected Fedora/RHEL (dnf)"
        echo "Installing dependencies..."
        sudo dnf install -y webkit2gtk4.1 gtk3 libsecret
    elif command -v apt &> /dev/null; then
        echo "Detected Debian/Ubuntu (apt)"
        echo "Installing dependencies..."
        sudo apt install -y libwebkit2gtk-4.1-0 libgtk-3-0 libsecret-1-0
    else
        echo "Unknown package manager. Please install manually:"
        echo "  - webkit2gtk 4.1"
        echo "  - gtk3"
        echo "  - libsecret"
        exit 1
    fi
}

# Check if dependencies are installed
check_deps() {
    local missing=0

    if ! ldconfig -p | grep -q libwebkit2gtk-4.1; then
        echo "Missing: webkit2gtk-4.1"
        missing=1
    fi

    if ! ldconfig -p | grep -q libgtk-3; then
        echo "Missing: gtk3"
        missing=1
    fi

    if ! ldconfig -p | grep -q libsecret-1; then
        echo "Missing: libsecret"
        missing=1
    fi

    return $missing
}

# Install NoorNote
install_noornote() {
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    INSTALL_DIR="$HOME/.local/bin"

    mkdir -p "$INSTALL_DIR"

    # Copy binaries
    cp "$SCRIPT_DIR/noornote" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/noornote"

    # Copy NoorSigner (find the sidecar file)
    SIDECAR=$(find "$SCRIPT_DIR" -name "noorsigner-*" -type f | head -1)
    if [ -n "$SIDECAR" ]; then
        cp "$SIDECAR" "$INSTALL_DIR/"
        chmod +x "$INSTALL_DIR/$(basename "$SIDECAR")"
    fi

    echo ""
    echo "Installed to: $INSTALL_DIR"
    echo ""

    # Check if ~/.local/bin is in PATH
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        echo "Add this to your .bashrc or .zshrc:"
        echo '  export PATH="$HOME/.local/bin:$PATH"'
        echo ""
    fi

    echo "Run NoorNote with: noornote"
}

# Main
echo "Checking dependencies..."
if ! check_deps; then
    echo ""
    read -p "Install missing dependencies? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_deps
    else
        echo "Please install dependencies manually and run this script again."
        exit 1
    fi
fi

echo "Dependencies OK"
echo ""

read -p "Install NoorNote to ~/.local/bin? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    install_noornote
    echo "=== Installation complete ==="
else
    echo "Aborted."
fi
