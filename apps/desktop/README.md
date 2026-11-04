# SecretVariable desktop

A thin [Tauri](https://tauri.app) shell. On first launch you enter your server's URL; afterwards the app opens that server's web app in a native window and remembers the address. Remote pages get **no** native capabilities (see `src-tauri/capabilities/default.json`), so it is the same web app with the same permissions as in a browser.

## Build

Needs Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
cd apps/desktop
pnpm icons      # generates icons/ from app-icon.png (once)
pnpm desktop:dev    # run
pnpm desktop:build  # installers in src-tauri/target/release/bundle
```

To change server later, open `index.html?change=1` (menu entry planned).
