# Roadmap

An original chess web app whose behavior and UX are modeled on lila's (see `docs/lila-feature-map.md`). Each phase starts only after explicit approval.

## Phase 1: Local play (done)
- Board: drag-to-move and click-to-move, dots on legal moves, last-move and check highlights, a promotion picker, flip board, coordinates.
- Modes: local two-player, and play against the computer (an original engine in a Web Worker, 8 strength levels).
- Clocks: 1+0, 3+2, 5+0, 10+0 and 15+10, with increment; a player who runs out of time loses.
- Move list in SAN; step through the game by clicking a move or with ←/→.
- Game end: checkmate, stalemate, threefold repetition, 50-move rule, insufficient material, timeout, resign, draw offer.
- PGN and FEN import and export.
- Responsive layout (stacked below 800px wide); light and dark themes.
- Stack: Vite, React, TypeScript (strict), chess.js, Vitest.

## Phase 2: Analysis board with engine evaluation (done)
- A move tree with variations: create, promote and delete lines.
- Engine evaluation in a Web Worker: eval bar, top lines (multi-PV), best-move arrow. **Decided:** use our own engine (no GPL). It was extended with a transposition table and multi-PV analysis.
- Load a game from Phase 1 or from PGN into analysis.
- Annotation glyphs (!, ?, !!, ??) and comments, kept in PGN export.

## Phase 3: Puzzles (done)
- Puzzle data source. **Decided:** 65 original, engine-verified built-in puzzles, plus an importer for a puzzle CSV the user downloads (for example the CC0 Lichess puzzle database).
- Solve flow: the opponent's move animates, then the user must find the best move.
- Retry or show the solution, then go to the next puzzle; a streak counter.
- Puzzle themes and difficulty filters.

## Phase 4: Online multiplayer (done)
- A Node WebSocket server. **Decided:** the `ws` package (MIT), games kept in memory, anonymous guests per browser tab; it runs inside `npm run dev` and standalone with `npm start`.
- Lobby: list of open seeks; create a seek (time control, color).
- Matching seeks pairs players into game rooms.
- Game rooms: the server validates moves and keeps the authoritative clock with lag compensation, and handles resign, draw offers and aborts.
- Reconnection: resume the game after a disconnect; a "claim victory" option when the opponent stays away too long.
- Spectators.

## Phase 5: Accounts with Glicko-2 ratings
- Sign-up, login and sessions.
- A database for users, games and ratings.
- Glicko-2 rating, deviation and volatility per time-control category.
- Profiles and game history.

## Phase 6: Tournaments
- Arena format (time-boxed, with berserk and streak bonuses) and Swiss format.
- Pairing engine, live standings, and tournament chat (optional).
