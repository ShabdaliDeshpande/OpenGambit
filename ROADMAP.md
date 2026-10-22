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

## Phase 5: Accounts with Glicko-2 ratings (done)
- Sign-up, login and sessions.
- A database for users, games and ratings. **Decided:** SQLite (Node's built-in `node:sqlite`) locally, and PostgreSQL through `pg` (MIT) when `DATABASE_URL` is set, so a free host keeps accounts across redeploys. Guests keep playing casual games.
- Glicko-2 rating, deviation and volatility per time-control category.
- Profiles and game history.

## Phase 6: Tournaments (done)
- Arena format (time-boxed, with berserk and streak bonuses) and Swiss format.
- Pairing engine, live standings, and tournament chat (optional). **Decided:** our own minimum-cost matching for both formats, with a simplified Dutch-style Swiss. Tournaments need an account to create or join. Chat was left out (it needs moderation).

## Phase 7: Play-feel polish (done)
- Move animation on the board (respects "reduce motion").
- Sounds for moves, captures, checks, game start and end, and low time. They're generated in code (no audio files) and can be turned off.
- Premoves: queue a move during the opponent's turn, played the moment it becomes yours if it's still legal.
- Rematch button after online games: offer, accept or decline, with colours swapped.
- Installable app (PWA): manifest, original icons, and offline play vs the computer, puzzles and analysis.

## Phase 8: Puzzle ratings & training (done)
- A Glicko-2 puzzle rating for signed-in players. Only the first try at each puzzle counts, and a hint, a wrong move or showing the solution counts as a miss.
- The server checks each solved claim against the real solution before it changes a rating.
- Difficulty relative to your rating (easiest −600 … hardest +600), so puzzles are picked near your level.
- A daily puzzle that's the same for everyone each day.
- A puzzle dashboard: rating chart, totals, strengths and areas to improve by theme, and recent history with replay.
- The puzzle rating appears on profiles.

## Phase 9: Accounts & leaderboards (done)
- Change password (signs out your other sessions).
- Delete account: removes your sign-in, ratings and puzzle history. Your past games stay, but your name in them is replaced.
- Leaderboards: the top rated players for each speed and for puzzles. Only established (non-provisional) ratings are listed.
- Rating range on seeks: a signed-in seeker can limit who may accept, for example ±200 of their own rating.

## Phase 10: Puzzle Streak & Storm (done)
- Puzzle Streak: puzzles get harder as you go, there's no clock, and one wrong move ends the run. You can skip one move per run. Your best streak is kept.
- Puzzle Storm: solve as many puzzles as you can in 3 minutes. Combos earn extra time and mistakes cost time. Your best score and day's best are kept.
- Signed-in players' best runs are saved on the server and shown on their profile. Guests' bests are kept in the browser.

## Phase 11: Game Review (done)
- Every move gets a class: brilliant, great, best, excellent, good, book, inaccuracy, mistake, miss or blunder. The bad-move rules are lila's; the others are our own and are listed in `docs/lila-feature-map.md` §13. Book moves need the Phase 13 data.
- Accuracy % per side (lila's volatility-weighted formula), an estimated performance rating (labelled a rough estimate), and an eval graph that jumps to a move when clicked.
- Key moments, and summaries for the opening, middlegame and endgame.
- Retry your mistakes: try again from the position before each one.
- Explanations in plain language, built from rules without an LLM.
- Signed-in players' reviews are saved with the game and shown in their profile's game history.
- Builds on commit 569e324, which has the first version of the review.

## Phase 12: Analysis settings and a stronger engine (planned)
- Settings: search by time or depth, infinite analysis, 1–5 lines, worker threads, threat mode, arrows on or off.
- A stronger engine, still our own code, measured with an engine-vs-engine match script.
- Optional server-side analysis queue (off by default).
- Right-click arrows and circles, kept in PGN as `[%cal]` and `[%csl]`.
- **Decided:** the opening book moves to Phase 13, which imports the same games.

## Phase 13: Opening Explorer (planned)
- For each move: games, white/draw/black %, average rating.
- Tabs: Masters (imported), OpenGambit games, and My games (filters by colour, speed and date).
- Opening name and ECO code; book moves in the review; an opening book for the engine.
- Importers the user runs on files they download: `npm run explorer:import -- path/to/games.pgn` and `npm run openings:import -- path/to/openings.tsv`.
- Stretch goal: endgame tablebases from Syzygy files the user supplies. **Decided:** the rest of the phase comes first, and I'll ask before cutting it.

## Phase 14: Insights (planned)
- Rating history; results by colour, opening, time control, time of day and opponent rating.
- Accuracy over time and per phase; blunders per game (from saved reviews).
- Average time per move and time trouble. Per-move clock times are stored from this phase on.
- Most-played openings.
- Needs an account.

## Phase 15: Learning (planned)
- Original interactive lessons, timed drills, and endgame practice against the engine.
- An explanation for the daily puzzle.
- A video library read from a JSON file you fill in.
- Free for guests; progress kept in the browser, and on the account when signed in.

## Phase 16: Bots (planned)
- A gallery of original named bots, each with a rating, style, repertoire, avatar and chat lines.
- Assisted mode with hints, takebacks, eval, threats and best move, each toggleable. Challenge mode has no help.

## Phase 17: Daily chess and flair (planned)
- Correspondence games at 1, 2, 3, 5, 7 or 14 days per move, stored in the database.
- Notifications, many games at once, and conditional moves.
- Vacation days.
- Daily Arena and Swiss tournaments. **Decided:** correspondence tournaments played at days-per-move time controls.
- Custom flair (an emoji next to your name).
