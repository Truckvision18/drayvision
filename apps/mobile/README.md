# DrayVision mobile (iOS + Android)

React Native 0.88 + MapLibre React Native 11. Installed **standalone** (not an npm workspace) so
the native build tools find `node_modules` where they expect; `@drayvision/shared` is linked via
`file:../../packages/shared` and Metro watches it.

> Toolchain: React Native 0.88 needs **Node ≥ 22.11** for the mobile workspace (the API/shared
> packages support Node ≥ 20.11). Use `nvm use` at the repo root (`.nvmrc` = 22).

```bash
npm install                 # (or `make install` from the repo root)
npm start                   # Metro
npm run android             # emulator must be running
cd ios && bundle install && bundle exec pod install && cd .. && npm run ios
```

The app launches to an **empty map** on the Plan screen. Its style comes from the API at
`/tiles/style.json`: with the stack running and `MAPTILER_KEY` set you get MapTiler streets,
and with the API in mock-tiles mode you get a plain background. iOS reaches the API at
`localhost:8080` and the Android emulator at `10.0.2.2:8080` (see `src/config/index.ts`).

Ground rules:

- **No metered provider calls from the app.** `src/api/client.ts` is the only network client.
  A repo test fails if `src/` mentions a vendor host or key.
- **Tunables live in `src/config`** (safety thresholds, nav distances, refresh intervals), and
  each environment can override them.
- **Distracting UI is parked-only.** Wrap it in `<ParkedOnly feature=…>`; see `src/safety/motionGate.ts`.
  The truck-profile editor is parked-only. Without a GPS fix showing the truck stopped, it stays locked.
- **No default truck.** The app routes only for the driver's own complete profile. Profiles are
  stored server-side and cached on the device (`src/profiles`); an edit purges cached routes for
  the old version, and any route on screen is replanned.
- Shared schemas use zod 4. `babel.config.js` adds `export-namespace-from` for it, and
  `index.js` turns on `z.config({ jitless: true })` because Hermes has no `new Function`.
