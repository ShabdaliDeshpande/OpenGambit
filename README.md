# Open Chess Board

A browser chess app built with React and TypeScript. You can play two-player on one device, against a built-in computer opponent, or online against other people through a small Node server, with clocks, move navigation, and PGN/FEN import and export.

This is an original implementation. Its behavior and UX were studied from the open-source lila project (see [docs/lila-feature-map.md](docs/lila-feature-map.md)), but no lila code, styles, images, sounds or branding are used. See [ROADMAP.md](ROADMAP.md) for the planned phases.

## Running it

Requirements: Node.js 20 or newer (developed on Node 24) and npm.

```sh
npm install        # install dependencies
npm run dev        # start the dev server at http://localhost:5173 (includes the online game server)
npm run build      # type-check (strict) and build to dist/
npm start          # serve dist/ and the online game server at http://localhost:8787
npm run preview    # serve the production build at http://localhost:4173 (also includes the game server)
npm run test       # run the unit tests once
npm run test:watch # run tests in watch mode
```

## Features (Phase 1)

| Area | What you get |
|---|---|
| Board | Drag-to-move and click-to-move, dots on legal moves (rings on captures), last-move and check highlights, a promotion picker (Esc cancels), flip board (button or `f`), coordinates |
| Modes | Two players on one device, or vs Computer at levels 1–8, playing White, Black or a random color |
| Engine | An original alpha-beta engine in a Web Worker ([src/engine](src/engine)) |
| Clocks | 1+0, 3+2, 5+0, 10+0, 15+10, or unlimited. The increment is added after each move, and running out of time loses. If the opponent cannot possibly checkmate, a timeout is a draw. |
| Moves | SAN move list. Click a move, or use ←/→ (Home/End or ↑/↓ jump to the first or last move), to step through the game. |
| Game end | Checkmate, stalemate, threefold repetition, 50-move rule, insufficient material, timeout, resign (with confirmation), draw offer (accept or decline; the offer lapses if the opponent moves) |
| PGN / FEN | Copy the PGN of the game or the FEN of the shown position; load a PGN (it becomes an untimed game you can replay or continue) or a FEN (starts a new game from that position) |
| Layout | Board on the left and side panel on the right; they stack below 800px wide. Light and dark themes; the default follows the OS and your choice is remembered. |

## Features (Phase 2: Analysis board)

Open it from the **Analysis board** tab, or press **Analyse this game** on the Play screen to load the current game.

| Area | What you get |
|---|---|
| Move tree | Play moves on the board to add them. A move from an earlier position starts a variation, and replaying an existing move just follows it. Click any move to jump there; ←/→ step through, and Home/End go to the start or the end of the current line. |
| Editing lines | **Promote** moves a variation up one level, **Main line** makes it the main line, and **Delete from here** removes a move and everything after it |
| Engine | Runs in a Web Worker and restarts on every position change. Shows 1–5 best lines (multi-PV) with depth and speed, an eval bar on the board, and arrows for the best and second-best moves. Click any move in an engine line to play the line up to that move into the tree. The engine on/off switch and line count are remembered. |
| Annotations | Move glyphs (!, ?, !!, ??, !?, ?!) and position glyphs (+−, ±, ⩲, =, ∞, ⩱, ∓, −+), plus a comment on any move |
| PGN | Import and export keep variations (nested to any depth), comments and glyphs. Load a FEN to analyse from any position. |

Evaluations are always shown from White's side: `+1.2` means White is better, `#3` means White mates in 3, and `#−2` means Black mates in 2.

## Features (Phase 3: Puzzles)

Open the **Puzzles** tab. Find the best move for the side shown at the bottom.

| Area | What you get |
|---|---|
| Solving | Correct moves are followed automatically by the opponent's reply. On the final move, any checkmate counts, not only the stored one. A wrong move is marked; take it back (button or ←) and keep trying. |
| Help | **Hint** highlights the piece to move, and **Show solution** plays out the rest. Either one means the puzzle doesn't count as solved. |
| After solving | **Next puzzle** (or →), **Retry**, or **Analyse**, which opens the solution on the analysis board |
| Choosing | Filter by theme (mate in 1/2/3/4, win material, fork, sacrifice, promotion, endgame) and by difficulty. Puzzles you haven't tried come first. |
| Progress | Puzzles solved, current streak and best streak, kept in this browser's local storage. **Reset progress** clears them. |

### Built-in puzzles

The bundled set of 65 puzzles in [src/puzzles/builtin.ts](src/puzzles/builtin.ts) is original: 16 mate in 1, 3 mate in 2, 1 mate in 3, 8 mate in 4 and 37 win-material puzzles. Some positions I composed using standard mating patterns; the rest came from games the engine played against itself from random openings.

Every solution was worked out by the engine with [src/puzzles/derive.ts](src/puzzles/derive.ts). A position was rejected if more than one move works, if there is more than one way to mate, or if the win isn't clear. The test suite checks each bundled puzzle again with the engine (`builtin.test.ts`). Ratings are estimates based on solution length and type. You can link to a puzzle by id, for example `http://localhost:5173/?puzzle=b017`.

### Importing more puzzles

You can add puzzles from any CSV in the common layout `id,fen,moves,rating,…,themes,…`, where `moves` are space-separated UCI moves and the first move is the opponent's setup move. One such file is the CC0-licensed puzzle database published by the Lichess project. Download it yourself; this project never downloads it.

```sh
npm run puzzles:import -- path/to/puzzles.csv                 # 5,000 random puzzles
npm run puzzles:import -- path/to/puzzles.csv.zst --limit 20000 --min 1200 --max 2000 --themes fork,pin
```

The script streams the file, so very large files are fine, and it reads `.zst` directly. It keeps a uniform random sample and writes `public/puzzles/imported.json`, which the Puzzles tab loads on its next reload. A source selector then appears. That file is git-ignored. Imported puzzles keep their own ratings and themes; the game link column is dropped.

### Strength levels

| Level | Search depth (plies) | Time limit | Random noise |
|---|---|---|---|
| 1 | 1, no capture search | 0.3 s | ±350 cp |
| 2 | 1 | 0.4 s | ±200 cp |
| 3 | 2 | 0.6 s | ±120 cp |
| 4 | 3 | 0.8 s | ±60 cp |
| 5 | 4 | 1.2 s | ±30 cp |
| 6 | 4 | 1.5 s | ±12 cp |
| 7 | 5 | 2 s | none |
| 8 | up to 12 (reaches about 6 in middlegames) | 4 s | none |

All levels play a forced mate when they see one. The computer accepts a draw offer only when it judges its own position to be at least 1.5 pawns worse.

## Features (Phase 4: Online play)

Open the **Play online** tab. No account is needed: each browser tab gets a guest name such as "Guest 4821" and a secret token kept in that tab's session storage, so reloading the tab keeps you in your game. To try it alone, open the app in two tabs.

| Area | What it does |
|---|---|
| Lobby | Pick your colour (random, White or Black) and a time control to post a seek. Everyone in the lobby sees the open seeks and can press **Play** to accept one; you can **Cancel** your own. Posting a seek that matches someone else's (same time control, compatible colours) pairs you at once. Seeks disappear when their owner leaves the lobby. |
| Game room | The server checks every move and keeps the official clock. The move you make shows at once and is replaced by the server's version when it answers. |
| Clocks and lag | Clocks start once both sides have made their first move. Each side has 20–30 s for that first move, or the game is aborted. The server measures each connection's lag with pings and credits it back on every move, up to 1 s per move and limited by a small budget that refills with each move. |
| Ending a game | Checkmate, stalemate, repetition, the 50-move rule, insufficient material and flagging end the game automatically. Players can **Abort** until both have moved, then **Resign** or **Offer draw**. Moving instead of answering declines a draw offer, and you can't offer again within 20 plies. |
| Disconnects | If your opponent's connection drops, you see a countdown: 30 s in bullet, 1 min in blitz, 2 min in rapid, or 10 s if they closed the page. After it you can **Claim victory** or **Call it a draw**. If they come back first, the game simply continues. |
| Spectators | **Games in progress** in the lobby lists running games to **Watch**. Spectators see moves and clocks live, and players see how many people are watching. A game can also be shared as a `?game=<id>` link. |
| After the game | **Analyse this game** opens it on the analysis board. |

The server keeps everything in memory, in one Node process: [server/hub.ts](server/hub.ts) holds the players, seeks and rooms, [server/room.ts](server/room.ts) runs one game, and [server/transport.ts](server/transport.ts) connects them to WebSockets at `/ws`. The same server runs inside `npm run dev` (as a Vite plugin) and in `npm start`. Set `PORT` and `HOST` to change where `npm start` listens. It binds to 127.0.0.1 by default; use `HOST=0.0.0.0` to play across your local network.

## Deploying

The app is one Node process that serves the built files and the game WebSocket, so it needs a host that runs a long-lived server with WebSockets. Static-only hosts won't work for online play.

- **[Dockerfile](Dockerfile):** builds the app and runs `node server/index.ts` on port 8787 (`PORT` overrides it). It works on any Docker host.
- **[render.yaml](render.yaml):** a Render Blueprint for this Dockerfile, on the free plan, with the `/healthz` health check. Push the project to a GitHub repository, then in Render choose **New → Blueprint** and pick the repository. Render provides the HTTPS address.
- **Behind a proxy**, set `TRUST_PROXY=1` so the per-address connection limit sees real client addresses (render.yaml already sets it). `MAX_CONNS_PER_IP` (default 20) changes that limit.

Things to know about hosting it:
- Games live in memory. A restart or redeploy ends running games.
- Render's free plan stops the service after about 15 minutes without visitors, and the next visit takes a while to start it again.
- The server accepts WebSocket connections only from pages on its own host. It limits sockets per address and messages per connection. It has no accounts or moderation.

## Project layout

```
src/
  chess/        rules glue and pure game logic (unit-tested)
    clock.ts      time controls and clock math (time is injected, so tests are deterministic)
    gameEnd.ts    end-of-game detection and result text
    game.ts       game state reducer, plus PGN export/import and FEN validation
  analysis/     analysis board logic (pure, unit-tested)
    tree.ts       immutable move tree with variations, comments and glyphs
    pgn.ts        PGN reader and writer for trees (variations, comments, NAGs)
    analysisState.ts  reducer for the analysis board
    evalFormat.ts eval text, eval-bar share, and engine lines in SAN
  engine/
    board.ts      fast 0x88 move generator for the search (checked by perft), two Zobrist hashes
    search.ts     negamax with alpha-beta, transposition table, quiescence, killer moves,
                  evaluation, play levels and multi-line analysis
    engine.worker.ts  runs a move search or an analysis in a Web Worker
  components/   Board (with arrows), Piece, PromotionPicker, ClockDisplay, MoveList, GameControls,
                SetupPanel, PgnFenPanel, PlayView
    analysis/     AnalysisView, EvalBar, EngineLines, TreeView, NodeTools
  hooks/        useEngine, useAnalysis, useKeyboardNav, useTheme
  online/       client side of online play
    protocol.ts   message types shared with the server
    client.ts     the WebSocket client (reconnects and re-subscribes by itself)
    view.ts       clock countdown, replaying moves, PGN export
  components/online/  OnlineView, Lobby, OnlineGame
  App.tsx       tabs and theme; all screens stay mounted so a running game keeps its clock
server/         the online game server (Node, run directly from TypeScript)
  hub.ts        players, lobby seeks, pairing, message checks and rate limits
  room.ts       one game: move validation, clocks with lag compensation, draws, aborts, disconnects
  transport.ts  WebSocket endpoint at /ws on an existing HTTP server
  index.ts      standalone server for `npm start`
  config.ts     timeouts and limits
```

chess.js is the single source of truth for rules, SAN, PGN and FEN. The engine has its own move generator only because chess.js is too slow for searching: about 2,000 positions per second, compared with hundreds of thousands. Perft tests check the engine's generator against the standard published node counts.

## Dependencies and licenses

This project has no GPL or AGPL dependencies.

### Runtime (shipped in the app)

| Package | Version | License |
|---|---|---|
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| scheduler (dependency of react-dom) | 0.28.0 | MIT |
| chess.js | 1.4.0 | BSD-2-Clause |
| ws (game server only) | 8.18.3 | MIT |

### Development and build only (not shipped)

| Package | Version | License |
|---|---|---|
| vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| vitest | 5.0.5 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @types/ws | 8.18.1 | MIT |
| @types/node | 24.10.1 | MIT |

Transitive development packages:

- **MIT:** undici-types, rolldown, @rolldown/binding-win32-x64-msvc, @rolldown/pluginutils, @oxc-project/types, postcss, nanoid, magic-string, @jridgewell/resolve-uri, @jridgewell/sourcemap-codec, @jridgewell/trace-mapping, @vitest/mocker, @vitest/spy, chai, assertion-error, @types/chai, @types/deep-eql, @types/estree, csstype, es-module-lexer, estree-walker, fdir, obug, picomatch, std-env, tinybench, tinyexec, tinyglobby, why-is-node-running
- **Apache-2.0:** @typescript/typescript-win32-x64, detect-libc, expect-type
- **BSD-3-Clause:** source-map-js
- **ISC:** picocolors
- **MPL-2.0:** lightningcss, lightningcss-win32-x64-msvc. This is a CSS minifier that runs only at build time; MPL-2.0 is file-level copyleft and applies only if you modify and redistribute lightningcss itself.

Chess pieces are drawn with standard Unicode chess symbols in the system font. No image or font assets are bundled.

## Known gaps

- **Online games live only in server memory.** Restarting the server ends every game, and finished games are forgotten after 15 minutes.
- **No accounts or ratings yet** (that is Phase 5). Guests are per tab, so opening a game link in a new tab makes you a spectator.
- **No chat, rematch, takebacks, premoves or extra time** in online games.
- **Basic protection only.** The server checks messages and origins and limits connections and message rates. It has no TLS of its own (use a host or reverse proxy that provides HTTPS), no accounts and no moderation.
- **Lag compensation is a simple model**: half the measured round trip, capped per move and by a refilling budget.

- **No premoves, sounds or move animation.**
- **Threefold and the 50-move rule end the game automatically.** There is no claim step as in over-the-board rules or on lila.
- **The clock follows a simplified start rule.** White's first move starts Black's clock, and no increment is added for that first move.
- **Pieces depend on system fonts.** They're Unicode glyphs, so they look slightly different between operating systems.
- **The engine is modest.** It has no opening book or advanced pruning; level 8 is roughly club-player strength.
- **The Play screen's PGN import keeps only the main line.** The Analysis board keeps everything.
- **Secondary engine lines are shallower than the best line,** and their continuations can be short. Each extra line is searched separately with the remaining moves.
- **Analysis stops after 15 seconds per position;** it isn't infinite.
- **No server-side analysis, opening explorer or tablebases,** and no drawn arrows or highlights.
- **The analysis tree is not saved.** It's lost on reload; export the PGN to keep it.
- **The built-in puzzle set is small (65)** and leans towards mates and simple material wins. Ratings are estimates, not measured from players. Import a CSV for variety.
- **Puzzle ratings and your stats are not linked.** There is no personal puzzle rating, and progress lives only in this browser.
- **Built-in puzzles start at the solver's move.** Only imported puzzles play an opponent setup move first.
