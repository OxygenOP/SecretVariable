# SecretVariable desktop

A thin [Tauri](https://tauri.app) shell. On first launch you enter your server's URL; afterwards the app opens that server's web app in a native window and remembers the address. Remote pages get **no** native capabilities (see `src-tauri/capabilities/default.json`), so it is the same web app with the same permissions as in a browser.

## Build

Needs Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS. On Debian/Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev pkg-config build-essential
```

The Linux build was compiled and run (connect screen, connecting to a server, signing in) under a virtual display. macOS and Windows builds follow the standard Tauri toolchain and have not been tried by the maintainers yet.

```bash
cd apps/desktop
pnpm icons      # optional: regenerate icons/ from app-icon.png (icons are committed)
pnpm desktop:dev    # run
pnpm desktop:build  # installers in src-tauri/target/release/bundle
```

To change server later, open `index.html?change=1` (menu entry planned).
