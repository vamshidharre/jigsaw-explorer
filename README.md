# Jigsaw Explorer

Online jigsaw puzzles you can solve on your own or together with friends in
real time. Pick a picture (or upload your own), choose anything from 6 to
1,000 pieces, optionally turn on piece rotation, and play with a mouse,
trackpad, touch screen or keyboard. Multiplayer rooms are server-authoritative:
every move is arbitrated on the server and broadcast to everyone in the room.

## Features

**Puzzle play**
- Classic interlocking piece shapes generated from a seed (every puzzle is different, every player in a room sees the same cut).
- Drag single pieces or joined groups; pieces snap to each other off the board and lock onto the board.
- Snap animation, lifted-piece shadows, optional bevel and outlines.
- Rotation mode: pieces start turned in 90° steps (right-click, double-click/double-tap, second finger while dragging, or `R`).
- Zoom (wheel, pinch, buttons), pan (drag the table, trackpad scroll, space + drag), fit-all and fit-board, edge scrolling while dragging.
- Edge-pieces-only filter, faint guide picture on the board with adjustable opacity, floating reference image, shuffle loose pieces.
- Timer that starts with your first move, progress (pieces connected), pause, auto-pause in background tabs, completion summary with time, moves and personal best.
- Full keyboard play (`N` select, `Enter` pick up/drop, arrows move, `R` rotate, `Esc` cancel) with screen-reader announcements.

**Puzzles and images**
- 23 curated, self-hosted pictures in four categories, with blurred placeholders and lazy-loaded thumbnails.
- Difficulty presets (Easy → Master) plus a custom piece count; the grid is chosen for near-square pieces, and the maximum is capped by the image's resolution so pieces stay sharp.
- Upload your own photo (drag & drop or file picker). It is validated, EXIF-rotated and downscaled in the browser; solo puzzles keep it on your device.

**Multiplayer**
- Create a room from any picture/difficulty, share a link or 6-character code, join from the lobby or the link.
- Live cursors with names, coloured highlights on pieces other players are holding, smooth interpolation of their drags.
- Player list with host crown, online/away/reconnecting status and how many pieces each player connected; join/leave toasts.
- Host can start a new puzzle for everyone and change the room size; host role migrates when the host leaves.
- Automatic reconnection with backoff; a refresh keeps your seat; a dropped network shows a banner and pauses interaction until the state is re-synchronised.
- Rooms persist to disk and survive a server restart; empty rooms expire.

**Persistence**
- Settings and theme (localStorage), solo puzzles with progress, timer and moves (IndexedDB), personal best times. Home page lists unfinished puzzles with remove/undo.

## Technology

| Area | Choice |
| --- | --- |
| Client | React 19, TypeScript, Vite 7, React Router 7, Zustand, Radix UI primitives, Sonner, Lucide icons, Inter |
| Rendering | Canvas 2D with a pre-rendered piece atlas (ImageBitmap), mip levels and a cached static layer |
| Server | Node 20+/22, Express 5, `ws`, `sharp` (image validation/re-encoding), `zod` (message validation), Helmet |
| Shared | TypeScript puzzle model and protocol used by both client and server |
| Tests | Vitest (unit + server integration), Playwright (end-to-end, touch emulation), axe-core (accessibility) |

## Architecture

```
src/
  shared/              Code used by both client and server
    puzzle/spec.ts       Puzzle spec, difficulty presets, grid selection
    puzzle/shapes.ts     Seeded Bézier piece outlines
    puzzle/model.ts      Groups, transforms, snapping/merging, layout, completion
    protocol.ts          WebSocket message types, room codes, name sanitising
    catalog.ts           Gallery metadata (generated JSON + helpers)
  client/
    engine/              Canvas engine (no React): GameEngine, Renderer, PieceAtlas, Camera, InputController
    features/            Screens: home, library (+ setup dialog), game, multiplayer, settings
    components/          UI primitives (Radix-based), layout, puzzle cards, hero art
    net/RoomConnection   Reconnecting WebSocket client
    persistence/         IndexedDB saved games, personal bests
    lib/                 Image loading/processing, API client, sound synthesis, formatting
  server/
    http/app.ts          REST API, static files, security headers, rate limits
    ws/gateway.ts        WebSocket upgrade, origin check, handshake, validation, heartbeats
    rooms/Room.ts        Authoritative room state and rules
    rooms/RoomManager.ts Room creation, expiry, persistence scheduling
    images/uploadStore   Upload validation, re-encoding, cleanup
    persistence/         Atomic JSON snapshots of rooms
```

**Puzzle model.** Pieces live in groups. Each group has one rigid transform
`world = R(rot)·solved + (x, y)`. A group is correctly placed when `rot = 0` and
`(x, y) = (0, 0)`; two neighbouring groups fit when their transforms match within
a tolerance. Snapping is therefore a cheap transform comparison, merges cascade,
and all locked pieces form a single board group. The same code resolves drops in
single-player mode and on the server.

**Rendering.** Every piece is drawn once into atlas pages (image clipped to the
outline, bevel and outline baked in) plus a blurred shadow atlas, then frozen
into `ImageBitmap`s. Frames are only drawn when something changes. Each texture
has a lazily built mip chain so zoomed-out views sample small textures. While a
piece is moving on a still camera, everything else is rendered once into a
cached layer and each frame only redraws the moving groups. Placed pieces are
merged into a single board bitmap. Remote cursors are DOM elements, so they never
trigger canvas redraws. React never re-renders during a drag.

## Multiplayer design

- Transport: one WebSocket per player (`/ws`), JSON messages, protocol version check.
- Handshake: `hello { code, name, resume?, hostKey? }`. New players get a server-generated id and a secret token, kept in `sessionStorage` per tab, so a refresh resumes the same seat (and colour, contributions, host role) while a second tab is a separate player. The room creator gets a `hostKey` from `POST /api/rooms`.
- Authority: a group can be held by one player at a time (`grab` → `held` broadcast or `denied`). Only the holder's `move`s are accepted (coordinates are bounds-checked). `drop` is resolved on the server with the shared snapping code, skipping groups other players are holding, and the result (`update` with changed and removed groups) is broadcast to everyone, so all clients converge. Holds are released on drop, disconnect, or after 30 s of inactivity.
- Traffic: drags are throttled to ~30 messages/s per client, cursors to 20/s; the server batches drag positions and cursors into 20 Hz `tick`s; authoritative changes are sent immediately and in order.
- Resilience: heartbeats on both sides, exponential reconnect backoff with jitter, browser online/offline events, full state snapshot on every (re)join, a 60 s seat grace period, host migration, room snapshots on disk (restored after restarts), rooms expire after 60 minutes without anyone connected.
- Abuse protection: zod validation of every message, 32 KB message cap, token-bucket rate limiting per connection, per-IP connection and join limits, origin check on the upgrade, room-code format validation, HTTP rate limits on room creation, lookups and uploads, uploads re-encoded by sharp with size, pixel and aspect limits.

## Settings

| Section | Setting | Effect |
| --- | --- | --- |
| Gameplay | Snapping (Precise / Normal / Forgiving) | Snap tolerance (13 % / 22 % / 34 % of a piece); also sent with multiplayer drops |
| | Faint picture on the board + opacity | Guide image drawn under the pieces |
| | Show timer / Show progress | Hide or show the HUD items |
| | Pause when I switch tabs | Solo clock stops while the page is hidden |
| | Scroll at screen edges | Camera pans while dragging near the edge |
| | Sound effects + volume | Synthesised Web Audio effects |
| | Your name | Name shown to other players (updates live in rooms) |
| Appearance | Theme (System / Light / Dark) | Whole UI |
| | Table (Slate, Green felt, Walnut, Linen, Charcoal) | Table background and board colours |
| | Piece outlines (None / Subtle / Bold) | Re-renders the piece atlas |
| | Bevelled edges | Re-renders the piece atlas |
| | Piece shadows | Shadow pass on/off (faster on slow devices) |
| | Interface density | Control sizes and spacing |
| Accessibility | Motion (System / Reduced / Full) | Disables snap slides, camera animation and the completion sweep |
| | Screen reader announcements | Live-region announcements for snaps and selection |

All settings persist across reloads and can be reset to defaults.

## Running locally

Requirements: Node 20.11+ (22 recommended).

```bash
npm install          # .npmrc enables legacy-peer-deps for the test tooling
npm run dev          # API + WebSocket server on :3001, Vite on http://localhost:5173
```

Production build:

```bash
npm run build        # client to dist/client, server bundle to dist/server
NODE_ENV=production npm start   # http://localhost:3000
```

### Tests

```bash
npm test             # unit tests + server integration tests (Vitest)
npm run typecheck    # client, server and e2e TypeScript projects
npm run test:e2e     # builds, starts a throwaway server and runs Playwright
```

Playwright uses Chromium. If your Playwright browsers live elsewhere, set
`PW_CHROMIUM_PATH` to a Chromium executable.

## Deploying

The app is a single Node process that serves the built client, the REST API and
the WebSocket endpoint on one port. Room state lives in memory (with periodic
snapshots to `DATA_DIR`), so run **one instance**.

### Render

`render.yaml` is a Blueprint for a Node web service with a 1 GB persistent
disk at `/var/data`. In Render: *New → Blueprint*, select the repository and
apply. Without a disk (e.g. on the free plan) the app still works, but rooms and
uploaded photos do not survive deploys. Render's proxy supports WebSockets with
no extra configuration.

### Docker

```bash
docker build -t jigsaw-explorer .
docker run -p 3000:3000 -v jigsaw-data:/data jigsaw-explorer
```

The image sets `TRUST_PROXY=1`; set it to `0` if the container is exposed
directly to the internet without a reverse proxy, so client IPs used for rate
limiting cannot be spoofed via `X-Forwarded-For`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |
| `NODE_ENV` | — | `production` enables HSTS |
| `DATA_DIR` | `./data` | Room snapshots and uploaded images |
| `TRUST_PROXY` | `1` in production, else `0` | Number of proxy hops to trust for client IPs |
| `ALLOWED_ORIGINS` | — | Extra origins allowed to open WebSockets (same-origin always allowed) |
| `MAX_ROOMS` | `500` | Upper limit on concurrent rooms |
| `ROOM_EMPTY_TTL_MINUTES` | `60` | How long a room survives with nobody connected |
| `RECONNECT_GRACE_SECONDS` | `60` | How long a disconnected player keeps their seat |
| `UPLOAD_MAX_MB` | `15` | Maximum upload size |
| `UPLOAD_TTL_HOURS` | `48` | Minimum age before unused uploads are deleted |
| `MAX_CONNECTIONS_PER_IP` | `24` | Concurrent WebSockets per client IP |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` (JSON lines on stdout/stderr) |

## Known limitations

- Single server instance: horizontal scaling would need sticky routing by room code and a shared store (e.g. Redis) for room state.
- No accounts: identities are per browser tab; personal bests and saved puzzles are per browser/device.
- Saved solo puzzles that use your own photo only open in the browser where you started them.
- The gallery's resolution caps some pictures below 1,000 pieces (shown in the setup dialog).
- See `CREDITS.md` for gallery image licensing to confirm before a commercial launch.
