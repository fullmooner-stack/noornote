NoorNote - Nostr Desktop Client
================================

Installation
------------

Option 1: Run install.sh (recommended)
  chmod +x install.sh
  ./install.sh

Option 2: Manual installation
  1. Install dependencies:

     Arch Linux:
       sudo pacman -S webkit2gtk-4.1 gtk3 libsecret

     Fedora/RHEL:
       sudo dnf install webkit2gtk4.1 gtk3 libsecret

     Debian/Ubuntu:
       sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libsecret-1-0

  2. Copy binaries to your PATH:
       cp noornote ~/.local/bin/
       cp noorsigner-* ~/.local/bin/
       chmod +x ~/.local/bin/noornote ~/.local/bin/noorsigner-*

  3. Run:
       noornote


Support
-------
GitHub: https://github.com/77elements/noornote
Issues: https://github.com/77elements/noornote/issues
