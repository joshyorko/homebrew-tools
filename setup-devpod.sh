#!/bin/bash
set -e

# DevPod Desktop setup for Bluefin/Universal Blue via distrobox
# This automates the AppImage extraction method that actually works

CONTAINER_NAME="devpod-box"
CONTAINER_IMAGE="fedora:39"
DEVPOD_DIR="$HOME/DevPod"

echo "=== DevPod Desktop Setup for Bluefin ==="

# Step 1: Create distrobox container if needed
if ! distrobox list 2>/dev/null | grep -q "$CONTAINER_NAME"; then
    echo "Creating distrobox container '$CONTAINER_NAME'..."
    distrobox create --name "$CONTAINER_NAME" --image "$CONTAINER_IMAGE" --yes
fi

# Step 2: Install dependencies and download DevPod inside the container
echo "Setting up DevPod inside distrobox..."
distrobox enter "$CONTAINER_NAME" -- bash -c '
    set -e

    # Install dependencies
    sudo dnf install -y webkit2gtk4.1 gtk3 libappindicator-gtk3 fuse fuse-libs desktop-file-utils xdg-utils 2>/dev/null || true

    # Download latest AppImage
    echo "Downloading latest DevPod AppImage..."
    curl -L -o ~/DevPod.AppImage "https://github.com/loft-sh/devpod/releases/latest/download/DevPod_linux_amd64.AppImage"
    chmod +x ~/DevPod.AppImage

    # Extract it (avoids FUSE issues)
    echo "Extracting AppImage..."
    rm -rf ~/DevPod ~/squashfs-root
    cd ~ && ~/DevPod.AppImage --appimage-extract
    mv squashfs-root DevPod
    rm ~/DevPod.AppImage

    echo "DevPod extracted to ~/DevPod"
'

# Step 3: Export to host (creates .desktop file)
echo "Exporting DevPod to host desktop..."
distrobox enter "$CONTAINER_NAME" -- distrobox-export --app ~/DevPod/AppRun 2>/dev/null || true

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To run DevPod Desktop:"
echo "  distrobox enter $CONTAINER_NAME -- ~/DevPod/AppRun"
echo ""
echo "Or just search 'DevPod' in your app menu!"
