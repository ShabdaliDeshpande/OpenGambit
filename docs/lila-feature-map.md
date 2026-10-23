# lila feature map

Research notes for building an original React chess app. lila (AGPL-3.0) was used **only** to learn behavior, structure and UX. No lila code, CSS, assets or branding are copied into this project.

- Reference: `reference/lila` (shallow clone of github.com/lichess-org/lila, not modified).
- Tooling: REA MCP server (`rea-agents@6.5.0`), static JavaScript/TypeScript analysis. REA parses sources as inert text and never executes them.
- Paths below are relative to `reference/lila/ui/`.

## REA analyses (parent Evidence)

| Package | Scope | Parent evidence ID | Summary view ID |
|---|---|---|---|
| `round` | all 35 TS files | `ev_8c90e3ccc097d6c9aca4193a0a8d63278a1ddfc0f001043c8ab1b11f226f8af3` | `ev_a635ba0f66e7ba3e8032808ac77172f69b1305745950aad01f85eaf2c376184f` |
| `lib` | 15 selected files (game/clock, promotion, status, PGN, ceval) | `ev_4a2d01e63e46ea8ab6300cfc5774ffb873c989e83227c5251eac9714e4f79ad2` | `ev_2fdad3999c23b38a7c37c8d45b76d69f1f6062a34ac0828442b01da292d0d413` |
| `botPlay` | all 19 TS files | `ev_3c3b53cc8ba1f85ca4ae6e30ab17a5ed80258ac020637a8e8157b0a4c148788f` | `ev_776109e7b8e7ac43e4da94e93cd45a690bde3d66c7abc0c260c60c5011dae598` |
| `analyse` | 9 selected files | `ev_14ab53ab23f263616b8a29a92e2c1b342d1135516e52ba2b4a512ab2af8d955b` | `ev_79a7d0faa461e34253e4100f4adc67ef2fdf3c50c443515592282bb04eca32c9` |
| `lobby` (Phase 4) | 6 selected files (socket, hookRepo, seekRepo, ctrl, interfaces, filter) | `ev_1862c302f8f374d70c7465a0bb30c5b913fb8b60152444a782914259a047c93a` | `ev_ca54640336bcc860e0753f2275d0384dc471d4fadedc9bb12811a8c16b7115e9` |

### Analyses for the Phase 11–17 plan (October 22–23, 2026)

| Package | Scope | Parent evidence ID | Summary view ID | Unknowns REA reported |
|---|---|---|---|---|
| `analyse` (Phases 11, 12, 13, 15) | 20 selected files: retrospect, practice, explorer (7 files), study practice (4 files), `serverSideUnderboard`, `autoShape`, `settingsCtrl`, `nodeFinder`, `interfaces` | `ev_63443394281522a386217fb3587ccb73bfc9510db19344c1040a5035ea41905d` | `ev_524ee85e9d1d05d51fbf411ebce6a7583066705bb8d5625a9a96a75b659495f1` | 4,932 semantic; 106 files outside scope |
| `chart` (Phases 11, 14) | 6 selected files: `acpl`, `division`, `movetime`, `chart.ratingHistory`, `index`, `interface` | `ev_3b2e56ad8077804318583aebade2ac4aba177c8341b96053a036f683166c8224` | `ev_4671dc476b7415a370bcb1b9fe4a6626a20bd21fe4e07240b2758943eab1a909` | 1,092 semantic; 6 files outside scope |
| `lib` (Phase 12) | 10 selected files: `ceval/` ctrl, types, util, index, protocol, cache, winningChances, view/main, view/settings; `view/userLink` | `ev_dcd95c53230df56c68b1055315d797057105cea9187e15deb0c8a09a4e7d3cbc` | `ev_e779c2f76e982c5b25051944b940571b8b8ade7cb43f5766179b03f70751182c` | 3,717 semantic; 149 files outside scope |
| `insight` (Phase 14) | all 16 TS files | `ev_1d7a959e95bbd201b7c79e1f98fd3363a37011ae5ef6e4752b5b1d00600a6ca2` | `ev_f02b87b961a2beb74c0f47bac3b77e5aeb591bd3e418f04ace9621f0325fca7c` | 1,856 semantic |
| `learn` (Phase 15) | all 48 TS files | `ev_3f3917e2144d33576b99e43080fa2eda33ad6b23e2af0724ae7d6eef702db318` | `ev_51da31b2765faaa60ac31cc1f432557a48571e82f87cc0764b51fa169faafbd8` | 3,224 semantic |
| `botPlay` (Phase 16) | all 19 TS files (re-run, because the Phase 1 evidence is no longer retained) | `ev_61d69b21a0239a6eb89cd23507bf5636936b32be388364058753753602d7b53d` | `ev_fbc570f5243de3ff46e4288076ebde8200ff45c041270c8f7d4c5ecc76ae718d` | 1,460 semantic |
| `round` (Phase 17) | 2 selected files: `corresClock/corresClockCtrl`, `corresClockView` | `ev_cda0b7a450adb0a65420992559935d41792253a6cb9b2a6c6f68e2fb700033d4` | `ev_3136f24a378c918c72b5d35ecdc3504ac3ad2efe11ea2575b61fa5abb3b055f1` | 522 semantic; 36 application (the files outside scope) |
| `bits` (Phase 17) | 2 selected files: `flairPicker`, `bits.flairPicker` | `ev_6a23f7d27344b8eab0075f3271cdd97cc8503dbf36717418f8c00df64d83a08b` | `ev_dbbab03db0fa38399d40513a5d53fce6f5a7e005df1a29b33a44fc921c094ea0` | 752 semantic; 51 files outside scope |

For these, every `trace_application_feature` call used `direction: "outgoing"`, and the tables in §13–§19 list only the seed module's own `imports` and `exposes` edges. `list_unknowns` had no recorded unknown entries; the counts above come from each analysis summary. Server behaviour comes from reading Scala files in `reference/lila/modules/` directly. Those notes are marked **(read)**, and their paths are relative to `reference/lila/`.

### Unknowns and limits REA reported, for all features

- **Relative imports were not resolved.** Extensionless TS imports (`./util`, `./ground`, `../game`, …) come back as `not-found`, so REA did not link modules inside a package. Workspace aliases (`lib/*`, `@/…`, `chessops/*`, `@lichess-org/chessground`) are `external` or `unavailable`.
- **Traces don't follow real call paths.** Every `trace_application_feature` call with `direction: both` walked the whole package graph through the artifact root: 549 nodes in round, about 1.8 MB of output in lib. The terminal paths it reported, such as `src/premove.ts → artifact root → tests/premove.test.ts`, are containment, not call flow. Each feature is therefore mapped from the seed's direct `imports`/`exposes` edges.
- **Graph coverage is partial.** Semantic-graph unknowns: round 5,641; lib 4,403 (plus 144 files outside the selected scope); analyse 4,111 (plus 117 unselected files); botPlay 1,460. Call-flow edges are static candidates only. REA does not claim they run.
- **No runtime evidence.** Clock tick timing, socket messages and Web Worker engine traffic were not observed.
- **The rules engine and server are outside lila's `ui/`.** Draw detection, threefold, the 50-move rule and server clock authority live in scalachess and lila-ws, which were not fetched per instructions. The client only displays the status the server sends.

Behavior notes marked **(read)** come from reading source files directly after REA located them. They are not REA output.

---

## 1. Moving pieces: drag, click, premove, promotion

**What it does.** The board is the chessground library, configured by the round controller. Drag and click-to-move are both chessground features. `movable.dests` holds legal destinations, which render as dots and rings. While it's the opponent's turn, a premove can be queued; it fires as soon as the opponent's move arrives. Promotion shows a picker over the promotion square. An auto-queen preference (`Never` / `OnPremove` / `Always`) can skip the picker **(read)**. A premove that ends in promotion records a pre-promotion role (a queen by default) **(read)**.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `round/src/ground.ts` | trace `ev_d47f0d5195acedb86896d767ccc36f69f0077525c22458176520f83b3ed32204` | exposes `makeConfig`, `sync`, `reload`, `render`, `boardOrientation`, `endgameShapesForStep`; imports `@lichess-org/chessground`, `lib/game/chess`, `lib/game/endgame`, `./premove` [not-found] |
| `round/src/premove.ts` (lines 1–216) | trace `ev_5b249bd7165936ca44b9820bcbcfad00ffc6e6332a19779cb846dd3590a035bf`; module view `ev_c838c250d90d8fa6990b2ae2432e3fd5843565d5f39dc240301b66489998c13c` | exports `Premove`; imports `@lichess-org/chessground/util`, `…/types`; covered by `tests/premove.test.ts` |
| `lib/src/game/promotion.ts` | trace `ev_a6d4349eecba3378b0cf81629f57d8b96bb42283f9aece8bd776647281a63d78` | exposes `PromotionCtrl`, `promote`; imports `snabbdom`, `@/prefs` [unavailable] |
| `round/src/ctrl.ts` | trace `ev_fbcec54b694e241ab3f55c978a4361b52be373863ddca196f6a7347241173302` | imports `lib/game/promotion`, `./ground`, `./transientMove`, `keyboard-move`, `lib/game/sanWriter` (39 imports) |

**Unknown:** the premove legality rules (which premoves chessground allows) live in `@lichess-org/chessground`, which wasn't analyzed. The order of the move-to-socket round trip is not visible statically.

**React mapping.**
- `<Board>`: wraps the board component. Props: `fen`, `orientation`, `legalDests`, `lastMove`, `check`, `onMove`.
- `useBoardInput`: drag and click selection state.
- `<PromotionPicker>`: overlay on the target square.
- Premove is out of scope for Phase 1. I'll note it as a gap; it's mainly useful against a clock in online play.

## 2. Game clock

**What it does.**
- `ClockCtrl` stores remaining time per color plus `activeColor` and `lastUpdate` **(read)**.
- The display ticks with `setTimeout`. The delay is aligned to the next display boundary (`time % tickInterval`), so the digits change exactly on the second **(read)**.
- Elapsed time is `performance.now() - lastUpdate`, so it doesn't drift **(read)**.
- An emergency threshold, derived from the initial time and increment, triggers a low-time sound once and re-arms when time rises above 1.5× the threshold **(read)**.
- `onFlag()` is a callback that fires when a clock hits zero.
- In botPlay, `Game.computeEnd()` turns a clock at ≤ 0 into `status: 'outoftime'` and gives the win to the other side **(read)**. The clock only starts after both sides have moved (`moves.length < 2` means not ticking) **(read)**.
- The increment comes from `ClockConfig.increment` (seconds).

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `lib/src/game/clock/clockCtrl.ts` (lines 1–199) | trace `ev_5095ede9c866eb920c524b9f153948d5b49aa45309ad2c4b2f4a2000c7671313`; module view `ev_f73625ff3c12a111454307d1810b9b4a47bf3ab7effaff5e1188a4cf4040a98f` | exports `ClockCtrl`; type exports `ClockConfig`, `ClockData`, `ClockElements`, `ClockOpts`, `ClockPref`, `SetData`; imports `./clockView` [not-found], `chessops` |
| `round/src/view/clock.ts` | trace `ev_a5a9f6ba691a6d4e2d89bb53746f30d4bcc80a1a6aa29ecd22a01827cb51bcae` | exposes `anyClockView`; imports `lib/game/clock/clockView`, `../corresClock/corresClockView`, `./button` |
| `lib/src/game/clock/clockView.ts` | in lib parent evidence | not traced separately |

**Unknown:**
- In online play, the server is authoritative for time; lag compensation is in lila-ws and was not fetched.
- REA's timer family found only 2 timer relations in lib, with 142 unknown.

**React mapping.**
- A pure `clock.ts` model (`createClock`, `press(color, now)`, `remaining(color, now)`, `isFlagged`), tested with an injected `now`.
- A `useClock` hook that drives the display with `requestAnimationFrame` or `setTimeout`.
- `<ClockDisplay>` with a low-time style.
- Presets: 1+0, 3+2, 5+0, 10+0, 15+10.

## 3. Move-list navigation

**What it does.**
- `replay.ts` renders the move list in pairs (move number, white, black) and the result line (`renderResult`) **(read)**.
- Clicking a move jumps to that ply.
- Keyboard: ←/k = previous, →/j = next, ↑/0/Home = first, ↓/$/End = last, f = flip board **(read, `round/src/keyboard.ts`)**.
- In the analysis board, `Navigate` moves along a tree of variations.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `round/src/view/replay.ts` | trace `ev_b36f65fb1c4c3603e9a0de4b5ebf950094f120932d3e6ca08e939f191b370edb` | exposes `render`, `renderResult`, `analysisButton`; imports `lib/game/view/status`, `lib/game/router`, `./boardMenu` [not-found] |
| `round/src/keyboard.ts` | trace `ev_8bcf3598f465b9fd2029c2b7c3517a13694ed0c6c382d7f01c8b45718a401712` | exposes `init`, `prev`, `next`, `view`; imports `lib/pubsub`, `lib/view` |
| `lib/src/game/sanWriter.ts` | in lib parent evidence | SAN formatting (not traced separately) |

**Unknown:** auto-scroll of the active move isn't shown in REA's graph. botPlay has `play/view/autoScroll.ts`, which I didn't trace.

**React mapping.**
- `<MoveList>` with SAN pairs and a highlighted current ply.
- The game state keeps `viewPly` separate from the live position, so stepping back never changes the game.
- A `useKeyboardNav` hook for ←/→/Home/End and `f`.

## 4. Game-end handling

**What it does.**
- Status codes are numeric: `mate 30`, `resign 31`, `stalemate 32`, `timeout 33`, `draw 34`, `outoftime 35`, `insufficientMaterialClaim 39`, and others **(read, `lib/src/game/status.ts`)**.
- The status view splits `draw` into fifty-move, threefold, insufficient material and mutual agreement, using flags that come with the game data **(read)**.
- `button.ts` provides the resign and draw-offer confirmations and a threefold claim button: on lila, threefold is claimed rather than automatic.
- botPlay's `endOnTheBoard` uses the rules library's `isEnd`, `isCheckmate`, `isStalemate` and `outcome` **(read)**.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `lib/src/game/status.ts` | trace `ev_a9032d9f0ee0f6a11cac41229098b8db6ee25d6e108c13d334868cd4260d970b` | exposes `status`, `started`, `playing`, `finished`, `aborted`, `statusOf` |
| `lib/src/game/view/status.ts` | in lib parent evidence | human-readable result text |
| `round/src/view/button.ts` | trace `ev_b5970cd713378405aee4b12221dd56d66cb41812f3abac972dd2b41a5f90d323` | exposes `resignConfirm`, `drawConfirm`, `claimThreefold`, `threefoldSuggestion`, `followUp`, `moretime`, `opponentGone` |
| `botPlay/src/game.ts` | trace `ev_fdf0a55445696840bb46b0f55cd0f860213de3011f50a48900afc1a47325ef98` | exposes `Game`; imports `chessops/chess`, `chessops/pgn`, `chessops/san`, `./clock` [not-found] |

**Unknown:** server-side adjudication (scalachess). The exact rules for when threefold is offered versus applied automatically were not analyzed.

**React mapping.**
- A pure `detectGameEnd(chess, clocks)` that returns `{ result: '1-0' | '0-1' | '1/2-1/2', reason }`. Reasons: checkmate, stalemate, threefold, fifty-move, insufficient material, timeout, resign, agreement.
- For Phase 1, threefold and the 50-move rule end the game automatically. This is simpler than lila's claim flow, and I'll document the difference.
- `<GameControls>` (resign, offer draw, accept/decline).
- `<ResultBanner>`.
- Timeout against a side with only a bare king is a draw, as with the FIDE rule. I'll include this and cover it with a test.

## 5. Playing against the computer

**What it does.**
- `PlayCtrl` owns a `Game`, a `ClockCtrl` and a `PromotionCtrl` **(REA imports)**.
- After a human move, it asks a `MoveSource` for a bot move through `requestBotMove`. If the engine answers faster than `movetime`, the move is held back with `setTimeout` so it doesn't arrive instantly **(read)**.
- Bots are configured in `lib/src/bot/*`: filters, movetime and an opening book.
- The engine runs in a Web Worker: Stockfish WASM through `lib/src/ceval/engines`.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `botPlay/src/play/playCtrl.ts` | trace `ev_08cb28b54fef6f1acd890cd6a228e7cdca8833a1f24bcf795a4a395b14047e9a` | exposes default; imports `lib/game/clock/clockCtrl`, `lib/game/promotion`, `chessops`, `./botMove`, `../game` [not-found] |
| `botPlay/src/play/botMove.ts` (lines 1–65) | trace `ev_72ccf648c41de68bacd7d17e3f656373edb48c9859c866c33113e80174c5a1a6`; module view `ev_2cb31dd257bc34fcd5a4c2333549b4d895ac6780a61ce71575b4205ee446ab11` | exports `requestBotMove`; imports `chessops/fen`, `chessops/san`, `lib/game/hash` |
| `lib/src/ceval/ctrl.ts` | trace `ev_1893785aa4b0deec1581a809d84e447a26cdce6cccb37638e64030365ec6024a` | exposes `CevalCtrl`; calls `ceval.threads`, `ceval.hash-size`; imports `./engines/engines` [not-found] |

**Unknown:**
- Worker creation and the UCI message flow were not recovered. `engines.ts` was in scope, but its links show as not-found.
- The Stockfish build is GPL-3.0, a license issue for this project.

**React mapping.**
- `engine.worker.ts`: an original, non-GPL engine with alpha-beta search, piece-square tables and quiescence. It lives in a Web Worker and talks to the UI through `postMessage({ fen, level })` → `{ move }`.
- 8 levels that vary search depth, time budget and random move noise.
- A `useEngine` hook.
- A minimum display delay, the same idea as botMove's movetime hold.
- Stockfish would be a Phase 2 decision, and I'll ask before adding it because it's GPL.

## 6. Analysis board

**What it does.**
- The analysis controller holds a move tree (`lib/tree`) with variations; `Navigate` moves through it.
- `pgnImport` and `pgnExport` turn the tree into and out of PGN, with `renderNodesPgn` and `renderFullTxt`.
- The ceval panel shows engine lines and eval bars (`winningChances.ts` maps centipawns to a win probability).
- `autoShape.ts` draws best-move arrows on the board.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `analyse/src/ctrl.ts` | trace `ev_65f19a7c9ad9ebd4fb250ea194268ae2887b9f00fd005f11aae9c324c74267ff` | 42 imports including `lib/tree`, `lib/ceval`, `./pgnImport`, `./navigate`, `./treeView/treeView`, `./explorer/explorerCtrl`, `./practice/practiceCtrl`, `./retrospect/retroCtrl` |
| `analyse/src/navigate.ts` | trace `ev_db73a48ceb64ea26c000941ea273205d9a21007a8c8342037b5eaab8455b7da2` | exposes default `Navigate`; imports `lib/tree/tree` [unavailable] |
| `analyse/src/pgnExport.ts` | trace `ev_bfbfabcb7af99f2739471a9859bdf6679d6d826b9483166ad0ad8de3becc7388` | exposes `renderNodesPgn`, `renderFullTxt`, `renderNodesHtml`; imports `lib/game/nodePGN`, `chessops/fen` |
| `lib/src/ceval/ctrl.ts`, `winningChances.ts`, `view/main.ts` | lib parent `ev_4a2d01e63e46ea8ab6300cfc5774ffb873c989e83227c5251eac9714e4f79ad2` | see §5 |

**Unknown:** `lib/tree/*` was outside the selected lib scope, so the tree data structure wasn't analyzed. Explorer, practice and retrospect are out of scope.

**React mapping (Phase 2):**
- `<AnalysisBoard>`
- a `MoveTree` model with variations
- `<EvalBar>`
- `<EngineLines>`
- best-move arrows

In Phase 1, PGN/FEN import and export use the rules library's PGN support.

---

## Overall React architecture

```
src/
  chess/      gameState.ts, gameEnd.ts, clock.ts, pgn.ts  (pure, unit-tested)
  engine/     search.ts, engine.worker.ts, levels.ts
  components/ Board, PromotionPicker, ClockDisplay, MoveList, GameControls,
              ResultBanner, SetupPanel, PgnFenPanel, ThemeToggle
  hooks/      useGame, useClock, useEngine, useKeyboardNav
  App.tsx     layout: board left, side panel right; stacked below 800px
```

## 7. Online play (Phase 4)

**Sources.** The lobby client was analysed with REA (`lobby` row above). The server-side rules come from reading Scala files in the local clone directly: `modules/round/src/main/RoundAsyncActor.scala`, `RoundSocket.scala`, `Drawer.scala`, `modules/core/src/main/game/Game.scala` and `modules/game/src/main/Game.scala`. The WebSocket layer (lila-ws) and the clock and lag code (scalachess) aren't in this clone, so those parts were designed independently.

**Behaviour taken over (as rules, not code):**
- **Lobby seeks.** Your own seek shows as "cancel" and others' as "join" (`hookRepo.init`). The server sends a full list plus add and remove events, and seeks leave the lobby when their owner does (`hookIn` and `hookOut` in `socket.ts`).
- **Abort.** A game is abortable while fewer than 2 plies have been played (`Game.abortable`).
- **First-move time.** Each side gets a limited time for its first move: 20 s in bullet, 25 s in blitz and 30 s for slower games. If it runs out, the game is cancelled with no result (`timeForFirstMove`, `NoStart`).
- **Disconnects.** The base timeout is 30 s, multiplied by 1, 2, 4 or 10 for bullet, blitz, rapid and classical. It is never shorter than 10 s, and it is 10 s when the player left on purpose ("bye"). After the timeout the opponent can force a win or a draw, but only once the game is no longer abortable (`RoundSocket.povDisconnectTimeout`, `ragequitTimeout`, `forceDrawable`).
- **Draw offers.** The offer is stored with the ply it was made at, and the client allows a new offer only 20 plies after the previous one (`ctrl.ts`, `Drawer.offerDraw`).

**Unknown:** the exact lag-compensation formula (lila-ws and scalachess `LagTracker`). This app uses its own simple model, described in the README.

## 8. Ratings (Phase 5)

**Sources.** I read `modules/rating/src/main/Glicko.scala` and `Perf.scala` in the local clone. The Glicko-2 calculation itself is in scalachess, which isn't in this clone, so it was written from Glickman's published description and checked against his worked example.

**Behaviour taken over (as numbers and rules, not code):**
- **Start and limits:** a new rating is 1500 with deviation 500 and volatility 0.09. Deviation is kept between 45 and 500, volatility at most 0.1, and ratings at 400 or more. One game moves a rating by at most 700 points.
- **Growing uncertainty:** deviation grows over time without games, at 0.21436 rating periods per day ("a typical player's RD goes from 60 to 110 in 1 year").
- **Provisional:** a rating is provisional while its deviation is 110 or more.
- **Categories:** ratings are kept per speed (bullet, blitz, rapid, classical), using the same speed categories as the lobby.

**Not taken over:** lila's colour-advantage adjustment, its rating regulator, rankable-deviation leaderboards and its `recent` rating history.

## 9. Tournaments (Phase 6)

**Sources.** I read the local clone directly:
- **Arena:** `modules/tournament/src/main/arena/ArenaSheet.scala` (scoring), `arena/PairingSystem.scala` and `arena/AntmaPairing.scala` (pairing), and `Pairing.scala` (the quick-draw and berserk thresholds).
- **Swiss:** `modules/swiss/src/main/SwissSheet.scala` and `SwissPlayer.scala`.
- **Player-facing rules:** the rules text in `translation/source/arena.xml` and `swiss.xml`.

lila's Swiss pairing runs the external bbpPairings program, which isn't in the clone; this app uses its own simplified version instead.

**Behaviour taken over (as rules, not code):**
- **Arena points:** win 2, draw 1, loss 0. A player is "on fire" after two wins in a row: then a win scores 4 and a draw 2. A draw under 20 plies scores 0. A draw in a game under 60 plies scores 0 when the player's previous non-loss result was also a draw.
- **Berserk:** halves the clock (and drops the increment). A win of at least 14 plies earns +1.
- **Arena pairing:** the first wave is paired by rating. After that, a minimum-weight matching with cost = rank gap × rank factor (300 at the bottom, 2000 at the top) + rating gap. You never meet the opponent you just played, unless only two players are active, and two players who both had the same colour three times running aren't paired together.
- **Arena end:** games in progress at the end don't count.
- **All tournament games:** missing your first move forfeits the game.
- **Swiss:** win 1, draw ½. A bye is worth 1, given when no pairing is found. No draws before move 30. Late join is open until more than half the rounds have started. Sonneborn–Berger breaks ties. The tournament ends early when every possible pairing has been played.

**Not taken over:** team battles, scheduled and shield tournaments, entry conditions, forbidden or manual pairings, chat, the "absent after a missed game" rules beyond pausing the player, and the full FIDE Dutch pairing rules.

## 10. Puzzle ratings (Phase 8)

**Sources.** I read `modules/puzzle/src/main/PuzzleFinisher.scala`, `PuzzleDifficulty.scala`, `PuzzleDashboard.scala` and `DailyPuzzle.scala`, and the strings in `translation/source/puzzle.xml`, all in the local clone.

**Behaviour taken over (as rules, not code):**
- **Rating:** a puzzle counts as a game between you and the puzzle (Glicko-2). Only your first play of a puzzle is rated.
- **Theme training:** results count for less when you train a theme, because it hints at the answer. That's 0.1 for a won obvious theme like a mate (0.4 lost), 0.2 / 0.7 for hinting tactical themes, and 0.7 / 0.8 for non-hinting ones like endgame. A mix counts fully.
- **Difficulty:** offsets from your rating of −600, −300, 0, +300 and +600.
- **Dashboard:** a theme's performance is its average puzzle rating − 500 + 1000 × your first-try success rate. A theme is an improvement area with 3+ failures below your overall performance, and a strength with 3+ first-try wins above it.
- **Daily puzzle:** one per day.

**Not taken over:** puzzles have their own changing ratings in lila; here they're fixed. Also left out: the puzzle streak and storm modes, replays of failed puzzles, opening-based puzzle selection, and lila's "dubious player" checks.

## 11. Accounts & leaderboards (Phase 9)

**Sources.** I read `modules/user/src/main/RankingApi.scala` (who appears on leaderboards) and `modules/lobby/src/main/Hook.scala` (rating ranges on seeks) in the local clone.

**Behaviour taken over (as rules, not code):**
- **Leaderboards:** only established ratings with at least 2 games count. lila requires a deviation of 75 or less. This app uses its "not provisional" line (under 110) so a small community still has a leaderboard.
- **Seek rating ranges:** two seeks pair only if each rating fits the other's range. A seek with a range can't be taken by a guest, who has no rating.

**Designed independently:** password change (signs out other sessions) and account deletion (games kept with the name replaced). lila's account closing works differently, and wasn't studied here.

## 12. Puzzle Streak & Storm (Phase 10)

**Sources.** I read `ui/storm/src/config.ts`, `ui/lib/src/puz/combo.ts`, `ui/puzzle/src/streak.ts`, `modules/storm/src/main/StormSelector.scala`, `StormHigh.scala`, `StormForm.scala` and `modules/puzzle/src/main/PuzzleStreak.scala`, plus the streak strings in `translation/source/puzzle.xml`, all in the local clone.

**Behaviour taken over (as rules and numbers, not code):**
- **Storm clock:** a 3-minute clock and a 10-second penalty for a wrong move.
- **Combo bonuses:** +3 s at 5, +5 at 12, +7 at 20 and +10 at 30, then +10 every 10 more.
- **Storm mistakes:** a wrong move resets the combo and moves on to the next puzzle.
- **Storm scores:** the score is puzzles solved. Best scores are kept per day and all time, with no leaderboard because scores come from the browser.
- **Streak:** puzzles get harder, there's no clock, one wrong move ends it, and there's one skip per run.

**Not taken over:** lila's large rating-bucketed puzzle pools (this app has 65 built-in puzzles, plus any imported set), weekly and monthly highs, and the signed run data lila uses to check runs.

---

# Plan for Phases 11–17 (paid-site features, all free here)

These sections plan the features the brief lists from chess.com's public feature list. chess.com is used only as a list of features: nothing is taken from it (no code, text, icons, colours, sounds, bot or coach names, branding). lila is used to learn behaviour, as before.

## 13. Game Review (Phase 11)

**What it does in lila.**
- **Move verdicts (read, `modules/tree/src/main/Advice.scala`).**
  - Winning chances are `2 / (1 + e^(−0.00368208·cp)) − 1`.
  - A drop for the mover of at least 0.3 is a blunder, 0.2 a mistake and 0.1 an inaccuracy.
  - Allowing a forced mate is a blunder; it's only a mistake if the mover was already at −700 or worse, and an inaccuracy at −1000 or worse.
  - Losing your own forced mate is a blunder; it's a mistake if you're still above +700, and an inaccuracy above +1000.
  - A slower mate isn't judged.
  - The comment reads "Mistake. Nf3 was best."
- **Move accuracy (read, `modules/analyse/src/main/AccuracyPercent.scala`).**
  - 100 if the mover's win % didn't fall.
  - Otherwise `103.1668·e^(−0.043544·drop) − 3.1669`, plus 1 for engine uncertainty, kept between 0 and 100.
- **Game accuracy (read).**
  - The average of a volatility-weighted mean and the harmonic mean of the move accuracies.
  - A move's weight is the standard deviation of win % over a sliding window (moves ÷ 10, between 2 and 8), kept between 0.5 and 12, so moves in sharp positions count more.
- **Phase accuracy (read).**
  - The same formula is applied to the opening, middlegame and endgame separately.
  - The split comes from the game's *division* (the plies where the middlegame and endgame begin), which scalachess computes.
- **Average centipawn loss (read, `AccuracyCP.scala`).** Per side, each loss floored at 0.
- **Eval graph (REA, `acpl.ts`).**
  - A line chart of winning chances per ply; clicking a point selects that ply (`selectPly`).
  - `division.ts` adds vertical opening, middlegame and endgame lines.
- **Learn from your mistakes (REA: `retroCtrl` imports `evalSwings` and `winningChances`).**
  - Candidates are the player's moves where winning chances swing by more than 0.1, or where a mate in 3 or less was lost (read, `nodeFinder.ts`).
  - The board goes back to the position before the mistake and the player tries again.
  - A try is accepted if it's within 0.04 of the evaluation before the mistake (read).
  - The states are find, eval, win, fail, view and off-track (read).
  - In the opening, a mistake that appears in the masters explorer with more than one game is skipped as theory (read).
- **Server analysis (REA, `serverSideUnderboard.ts`).** The request button and the panel under the board. It runs on lila's Stockfish network, which isn't relevant here.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `analyse/src/retrospect/retroCtrl.ts` | trace `ev_9ed539153ab5b9fae657f745e5fdc5ccc1223afc8db3c8430f0ed55860635a8a` | exposes `make`; imports `lib/ceval` {winningChances}, `../nodeFinder` {evalSwings} [not-found], `lib/api` {api}, `lib/tree/tree` {path}, `lib` {prop, isEmpty}, `@lichess-org/chessground/util` {opposite} |
| `analyse/src/serverSideUnderboard.ts` | trace `ev_7603bdb8fab7f5fdc7d64262b5ba7ec1003deab67f0f532dc43ddb7f3d2a9e2f` | exposes default, `stockfishName`; imports `lib/xhr` {url, textRaw}, `lib/view` {domDialog, spinnerHtml, confirm, alert}, `lib/pubsub`, `lib/storage`, `./view/util` {baseUrl} [not-found] |
| `chart/src/acpl.ts` | trace `ev_590e0daecafbf9eeaa596ee6a925e87ce6fb37f6450ff74049b2701fc3577187` | exposes default; imports `chart.js` {Chart, LineController, LineElement, PointElement, LinearScale, Filler, Tooltip}, `chartjs-plugin-datalabels`, `./index` {selectPly, plyLine, maybeChart, …} [not-found], `./division` [not-found], `lib/ceval` {winningChances, renderEval}, `lib/game/chess` {plyToTurn} |
| `chart/src/division.ts` | trace `ev_a135d53fb6f68a2e96edf9f08237da2c6ad7559db1f3160f77d874d006d28368` | exposes default; imports `./index` {chartYMax, chartYMin} [not-found] |

**Unknown:**
- The division algorithm is scalachess's `Divider`, which isn't in the clone.
- REA didn't link `retroCtrl` to `nodeFinder` (relative import not found), so the swing rule comes from reading.
- lila has no brilliant, great, best, excellent, good, book or miss classes, no performance estimate and no written explanations. Those are designed here from the brief.

**React mapping (OpenGambit design).**
- **Starting point.** Phase 11 builds on commit 569e324 (not pushed yet). It already has `src/analysis/review.ts` with lila's thresholds, a 3-worker review hook and `ReviewPanel`.
- **Move classes.** A pure `classify()` checks these in order:
  - **book:** the move is a Masters move with more than one game. This needs the Phase 13 data; until then no move is marked book.
  - **blunder, mistake, inaccuracy:** lila's rules above, unchanged.
  - **miss:** the opponent's previous move was a mistake or blunder, and this move gives back at least 0.1 of what it offered without being a blunder. A lost forced mate while still clearly winning also counts (lila calls that an inaccuracy).
  - **brilliant:** the engine's move (or within 0.02 of it) that gives up material by static exchange, at least a minor piece. The mover must not already have been completely winning (below 0.8 before) and must not be worse after.
  - **great:** the engine's move when the second-best move loses at least 0.2 (an only move). This needs 2 engine lines per position.
  - **best:** the engine's move, or a drop of 0.01 or less. **Excellent** is a drop under 0.04, **good** under 0.1.
- **Accuracy.** Switch to lila's volatility-weighted game accuracy with the +1 bonus, and add accuracy per phase.
- **Phase divider (original).**
  - The middlegame starts once most minor pieces have left their starting squares, or at ply 30.
  - The endgame starts when non-pawn material totals 26 or less (queen 9, rook 5, minor piece 3).
- **Estimated performance rating.**
  - A fixed, increasing curve from game accuracy (adjusted by the opponent's rating when known) to a rating.
  - The curve's anchor points are our own choice, not measured from rated players.
  - It's labelled a rough estimate, never shown as a rating.
- **Eval graph.**
  - An original SVG chart (no chart library) of winning chances per ply.
  - Tap or click jumps to the move.
  - Phase lines, and marks on mistakes.
- **Key moments.** Up to 5 of the largest swings, each with its explanation; clicking one jumps to it.
- **Phase summaries.** Accuracy and class counts per side for each phase, with a one-line summary.
- **Explanations without an LLM.**
  - A pure `explain()` builds sentences from facts: material won or lost compared with the best line, a piece left hanging, a mate allowed or missed (in N), forks, pins, checks, promotions, castling rights lost.
  - An example: "Best was Bxf7+, which wins a pawn and exposes the king."
  - The templates are unit-tested with fixed positions.
- **Retry mistakes.**
  - The board steps through your inaccuracies, mistakes, misses and blunders in turn, as lila's candidates do (swings over 0.1), and accepts a try within 0.04.
  - Controls: show answer, skip, and progress n of m. Book moves are skipped.
- **Saving.**
  - A new `game_reviews` table stores one review per finished online game: per-move class and eval, and per side the accuracy and estimated rating, plus the engine version.
  - The client runs the review and posts it. The server accepts it only from one of the two players, and checks it covers every move of the stored game.
  - Profile game history shows each side's accuracy and links to the review.
  - Guests' reviews work on the board but aren't saved.
- **Tests and smoke script.**
  - Unit tests: classify, accuracy, divider, explain, retry and the performance curve.
  - Server tests for the endpoint.
  - `scripts/smoke-review.ts`: two accounts play a short game, post a review, and read it on the profile.

## 14. Analysis settings and engine strength (Phase 12)

**What it does in lila.**
- **Stored engine settings (REA: `CevalCtrl`).**
  - Number of lines: `ceval.multipv`, default 1 (read).
  - Search time: `ceval.search-ms`, default 8000 ms, can be infinite (read).
  - Threads, kept within the engine's limits (read).
  - A search is finished when it reaches the time and has every requested line (read, `isFinished`).
- **Threat mode (read).** Analyses the position as if the side to move passed, which shows what the opponent threatens.
- **Settings view (REA exposes `searchTicks`, `renderCevalSettings`, `engineSelect`, `hashSetting`).** Time steps are 2, 4, 6, 8, 10, 12, 15, 20 and 30 s, plus 60, 120, 300 s and infinite on desktop (read).
- **Board arrows (REA: `autoShape` exposes `compute`, `makeShapesFromUci`; imports `winningChances` and glyph shapes).** Best-move arrows, threat arrows and move-glyph shapes.
- **Drawn arrows and circles.** These come from the chessground board library, which wasn't analysed. In PGN they're stored as `[%cal …]` and `[%csl …]` comments.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `lib/src/ceval/ctrl.ts` | trace `ev_c6ab4a82d1c2473cb272a271c6d384ac3c8812e8329d7fdcc49e8101624b558c` | exposes `CevalCtrl`; imports `@/storage` {storedIntProp, storedStringProp, storedMap, storage}, `./engines/engines` {Engines} [not-found], `./winningChances` {povChances} [not-found], `./util` {sanIrreversible, showEngineError, …} [not-found], `@/async` {throttleWithFlush}, `@/algo` {clamp}, `chessops/fen` {parseFen} |
| `lib/src/ceval/view/settings.ts` | trace `ev_51accf605bb679390b2ce7487761e2786b82e5b6bcdf0966ee7a669cc0dae5d6` | exposes `engineSelect`, `searchTicks`, `renderCevalSettings`, `hashSetting`; imports `@/view` {rangeConfig, select, input, label, …}, `@/device` {isChrome, isMobile}, `@/algo` {clamp} |
| `analyse/src/autoShape.ts` | trace `ev_4f8e5ca8d74b76e4b9d0beff411704710ab9876d55880d10e6e08553c727e081` | exposes `compute`, `makeShapesFromUci`; imports `lib/ceval` {winningChances}, `lib/game/glyphs` {annotationShapes, analysisGlyphs}, `lib/game/endgame` {endgameShapesForNode}, `chessops/attacks` {ray, between, knightAttacks}, `chessops/util` {parseUci, makeSquare} |

**Unknown:**
- lila's engine is Stockfish (GPL), which isn't used or studied.
- Which keys pick which shape colour is decided inside chessground, which wasn't analysed. Ours are our own.
- The `[%cal]` and `[%csl]` syntax follows the common PGN comment convention; lila writes it from scalachess, which isn't in the clone.

**React mapping.**
- **Settings panel** on the analysis board, kept in the browser:
  - search by time (1–30 s or infinite) or by depth (1–30);
  - infinite analysis;
  - 1–5 lines;
  - threads;
  - threat mode (off while in check);
  - arrows on or off, separately for best move, threat and drawn shapes.
- **Threads.**
  - Our engine runs one search per Web Worker. Sharing memory between workers needs cross-origin isolation headers, which break some hosting and embedding.
  - So threads means the number of workers. In live analysis the root moves are split between workers and their lines merged; in review, positions are spread over workers, as now.
- **Stronger engine (original code in `src/engine`).**
  - Search improvements: principal variation search, null-move pruning, late-move reductions, history heuristic and aspiration windows.
  - Evaluation improvements: a tapered middlegame/endgame evaluation with our own piece-square values, passed pawns, king safety, mobility, bishop pair and rooks on open files.
  - Repetition draws inside the search.
- **Measuring strength.**
  - `scripts/engine-match.ts` plays the new engine against the current one from our own start positions and reports the score.
  - Unit tests use original mate and tactic positions.
  - The 8 levels are re-tuned so they stay spread out.
  - **Result (built):** +20 =3 −1 against the Phase 11 engine at 150 ms a move (89.6%, about +370 Elo). In a 2-game-per-pair ladder, each level beat the one below it.
- **Opening book.** I propose moving it to Phase 13, since it needs the same imported games as the explorer (see "Order" below).
- **Server analysis queue (optional, off by default).**
  - `ANALYSIS_QUEUE=1` runs our engine in a Node worker thread, one game at a time, for signed-in players who ask for it.
  - It saves the result as a Phase 11 review.
  - It stays off on the live site unless you turn it on, because free hosting CPUs are slow.
- **Drawn shapes.**
  - Right-click and drag draws an arrow; right-click a square draws a circle.
  - Shift, Alt or Ctrl picks one of four colours (our own palette). Right-clicking the same shape removes it, and a left click clears all.
  - Shapes are kept per move and written to PGN as `[%cal Ge2e4,Rd7d5]` and `[%csl Gd4]` in the move comment. They're read back on import, and the comment text is kept.
- **Tests.** Settings, root-move splitting and merging, shapes to and from PGN, and engine checks (finds mates, no illegal moves, repetition). The engine match is a script, not part of `npm run test`.

## 15. Opening Explorer (Phase 13)

**What it does in lila.**
- **Controller (REA: `explorerCtrl`).** Exposes `tablebaseGuaranteed`, fetches through `explorerXhr` with debounce, and keeps a config per database.
- **Config (REA: `explorerConfig` exposes `ExplorerConfigCtrl`).**
  - Databases: masters (standard chess only), lichess and player (read).
  - Filters: speeds; rating buckets 400, 1000, 1200 … 2500; a month range (since and until); for player, also name, colour and rated or casual (read).
- **Data (read, `explorer/interfaces.ts`).**
  - Totals per position (white, draws, black).
  - Per move: uci, san, white, draws, black, average rating, and the opening (ECO code and name).
  - Top and recent games.
  - Tablebase moves with a category (win, draw, loss…), plus distance to zeroing (DTZ) and distance to mate (DTM).
- **Server.**
  - The explorer is a separate service that isn't in the clone; `modules/explorer` only fetches a master game's PGN from it (read, `ExplorerImporter.scala`).
  - Opening names come from scalachess's opening database (not in the clone). `modules/opening` finds the closest named opening along the moves (read, `OpeningQuery.closestOpening`).

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `analyse/src/explorer/explorerCtrl.ts` | trace `ev_af11c7891241c4b8ce86af92cc39527bbeaed09674ec1bd859cd68300326c44c` | exposes `tablebaseGuaranteed`, default; imports `./explorerXhr` {*} [not-found], `./explorerConfig` {ExplorerConfigCtrl} [not-found], `./explorerUtil` {winnerOf, MAX_ANALYSE_DEPTH} [not-found], `./explorerView` {clearLastShow} [not-found], `lib/async` {sync, debounce, defer}, `lib/storage` {storedBooleanProp}, `lib/game/chess` {fenColor, pieceCount} |
| `analyse/src/explorer/explorerConfig.ts` | trace `ev_7f5a7abaa679eff0297641230ebf7035844368863744869b517a7478f132e8c1` | exposes `ExplorerConfigCtrl`, `view`; imports `lib/storage` {storedJsonProp, storedStringProp, storedProp}, `lib/view/userComplete`, `lib/game/perfIcons`, `lib/view` {snabDialog, bind, …}, `./explorerUtil` {ucfirst} [not-found] |
| `analyse/src/explorer/tablebaseView.ts` | trace `ev_1e20347155aa380496a735c96fa8f3a0ddd7c8814d278fdabd9e371df298d03d` | exposes `showTablebase`; imports `./explorerUtil` {winnerOf, moveArrowAttributes} [not-found], `snabbdom` {h} |

**Unknown:** how the explorer service indexes games (rating and month buckets, counting) and the tablebase service are both external, so ours are designed independently.

**React mapping.**
- **Position key.** The FEN without move counters, with the en-passant square only when a capture is possible.
- **New tables.**
  - `explorer_moves`: source (`masters` imported, or `site` for OpenGambit games, updated when a game ends), key, move, white, draws, black and rating totals.
  - `explorer_mine`: user, key, move, colour, speed, month and results, for My games.
  - `openings`: key, ECO code and name.
- **Importers** (the user downloads the files, as with `npm run puzzles:import`):
  - `npm run explorer:import -- path/to/games.pgn [--min-rating 2200] [--plies 30]` streams the PGN, keeps the first plies of each game and adds them up into the database (SQLite or `DATABASE_URL`).
  - `npm run openings:import -- path/to/openings.tsv` reads a TSV with ECO, name and moves columns, such as the CC0 opening-name lists.
  - `npm run explorer:index-site` indexes games already in the database.
- **Explorer tab** in the analysis side panel.
  - Tabs: Masters, OpenGambit and My games.
  - Per move: games, a white/draw/black bar with percentages, and average rating. Clicking a move plays it.
  - My games filters by colour, speed and month range.
  - The opening name and ECO code show above the board; if the position has no name, the nearest earlier named one is shown.
  - Guests get Masters and OpenGambit; My games needs an account.
  - Endpoint: `GET /api/explorer?source=…&fen=…` with the filters.
- **Book moves in review.** A move is book when it's a Masters move with more than one game, as in lila's retry flow. Retry mistakes skips book moves.
- **Engine opening book (moved from Phase 12).** When the data exists, the computer and the bots choose from Masters moves weighted by games for the first plies.
- **Tablebases (optional; the largest item in the plan).** An original reader for Syzygy files of 3–5 pieces that the user supplies. If it turns out too big for this phase, I'll stop and ask before dropping it.
- **Tests and smoke script.** Position keys, PGN streaming and adding up, filters, opening-name lookup and the book-move check. The smoke script imports a small PGN and queries the API.

## 16. Insights (Phase 14)

**What it does in lila.**
- **Client (REA: insight `ctrl`).** Posts a question (a metric, a dimension and filters) with `xhr.json` and redraws. `presets` holds ready-made questions, and `chart.ts` draws bars with sample sizes.
- **Dimensions (read, `modules/insight/src/main/InsightDimension.scala`):**
  - period, date and speed;
  - game phase, result, termination and colour;
  - opening family and variation, and opponent strength relative to you;
  - piece moved, move-time range, castling (yours and your opponent's), queen trade and material balance;
  - time variance, centipawn-loss range, eval range, accuracy range, win % range, clock % left, and game source.
- **Computation (read).**
  - Metrics live in `InsightMetric.scala`.
  - A MongoDB aggregation runs over one entry per game and per move (`AggregationPipeline.scala`, `PovToEntry.scala`).
  - Some dimensions need a computer analysis (`requiresAnalysis`).
- **Charts (REA).** `chart.ratingHistory` draws rating over time with zoom and a range slider; `movetime` draws time per move.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `insight/src/ctrl.ts` | trace `ev_0b6728346390055b3102c1dbfc67dfe5d2230f0d94674f6f952f121e6f8aa781` | exposes default; imports `lib/xhr` {json}, `lib/async` {throttlePromiseDelay}, `./util` {isLandscapeLayout} [not-found] |
| `insight/src/presets.ts` | trace `ev_3f6e220a94aeafda1c3f2df5b26cc0beb89c1958a69663840aca771cf8a46700` | exposes default; imports `snabbdom` {h}, `lib/licon`, `lib/view` {bind, dataIcon} |
| `insight/src/chart.ts` | trace `ev_9798233491b64e7b89e489e3cdeb1d8f3984d8d141448aeeb8b639ac8064e06b` | exposes default; imports `chart.js` {Chart, BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip}, `chartjs-plugin-datalabels`, `chart` {colorSeries, …}, `./table` {formatNumber} [not-found] |
| `chart/src/chart.ratingHistory.ts` | trace `ev_9b1e45de32d55b2a75508b1c9d46dc97a33462ae984b7b3b6b4f1f2b42a23103` | exposes `initModule`; imports `chart.js` {TimeScale, …}, `chartjs-plugin-zoom`, `nouislider` {create, PipsMode}, `dayjs` and plugins, `lib/game/perf` {perfName} |
| `chart/src/movetime.ts` | trace `ev_2a4c2bee5e69876b7ed63d14dd6645021dfdaca2a6daa753c96533cb18a1f687` | exposes default; imports `chart.js` {BarController, BarElement, …}, `./division` [not-found], `chessops` {COLORS} |

**Unknown:** where lila records per-move clock times (scalachess game data) and its exact time-trouble ranges weren't studied. Our games table has no per-move clock times yet.

**React mapping.**
- **A fixed dashboard of cards, not a question builder.** It's simpler, and each card answers one thing in the brief.
- **Rating history** per speed, from the ratings already stored with each game.
- **Results** split five ways:
  - by colour;
  - by opening (names when Phase 13 data is imported, otherwise the first moves);
  - by time control;
  - by time of day, in the viewer's time zone;
  - by opponent rating relative to yours, in bands from −200 to +200.
- **From the Phase 11 saved reviews:** accuracy over time, accuracy per phase, and blunders per game. Each card says how many games were reviewed.
- **Time.**
  - Average time per move, and time trouble: how often you fell below 10% of the starting clock, and how those games ended.
  - This needs a new `clocks` column holding the time left after each move, saved from Phase 14 on. Older games are left out of these cards.
- **Most-played openings**, with results.
- **Server.**
  - `GET /api/insights/:username?speed=…&since=…` adds up the player's games, reviews and clocks in plain TS.
  - The result is cached until the player's next game.
  - Insights are private by default, with a setting to make them public.
  - They need an account; guests see a sign-up prompt.
- **Charts.** Original SVG components (line, bar, stacked result bar), no chart library.
- **Tests and smoke script.** Aggregation functions are tested on fixed games; the smoke script plays and reads insights.

## 17. Learning (Phase 15)

**What it does in lila.**
- **Lessons (REA: `LearnCtrl` imports `RunCtrl`, `stage/list` {byId}, `SideCtrl`, `score` {gtz}).**
  - Lessons are stages (one per topic) made of levels, and progress is kept per level.
- **Levels (REA: `LevelCtrl` imports `score` {apple, capture, scenario, pieceValue, getLevelBonus}, `apple` {makeAppleShape}, `scenario` and `sound`).**
  - A level has items to collect on the board and an optional scripted line.
  - The score counts collected items and captures, plus a level bonus.
- **Practice chapters (read, `study/practice/studyPracticeSuccess.ts`).**
  - Each chapter has a goal checked after every move: mate, mate in N, draw in N, equalise in N (eval within ±150), reach an eval in N, or promote.
- **Practice with the computer (read, `practice/practiceCtrl.ts`).**
  - From any position, each move is judged by its drop in winning chances: under 0.025 good, under 0.06 inaccuracy, under 0.14 mistake, otherwise blunder.
- **Video library (read, `modules/video`).** Read from a spreadsheet with title, author, level, tags, language and start time (`CsvParser.scala`, `VideoSheet.scala`).

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `learn/src/ctrl.ts` | trace `ev_cfff4bee739a63854327c49e8901bd245ea3209aea9ac1078ba97353ba642fb4` | exposes `LearnCtrl`; imports `./run/runCtrl` {RunCtrl}, `./stage/list` {byId}, `./sideCtrl` {SideCtrl}, `./hashRouting` {extractHashParameters}, `./timeouts` {clearTimeouts}, `./score` {gtz} (all [not-found]) |
| `learn/src/levelCtrl.ts` | trace `ev_a9db4e74f6ef72ad5578ae19ca3dd6e0bc0b2791ad56266b09d806993eb0505e` | exposes `LevelCtrl`; imports `./score` {apple, capture, scenario, pieceValue, getLevelBonus}, `./apple` {makeAppleShape}, `./scenario`, `./sound` {move, take, failure, levelStart, levelEnd}, `./promotionCtrl`, `./item` {ctrl}, `chessops` {makeUci, parseSquare, opposite} |
| `learn/src/score.ts` | trace `ev_e1b69c563a3e95424e5e7ced3a871e0c4a0dfa14d22e72f67083d6b3b272da40` | exposes `apple`, `capture`, `scenario`, `gtz`, `pieceValue`, `getLevelBonus`, `getLevelRank`, `getStageRank`; imports `./util` {readKeys} [not-found] |
| `analyse/src/practice/practiceCtrl.ts` | trace `ev_b0c7702bc8660ea160831d57a353dbf51650d6020172719f2674ff9da517fcbd` | exposes `make`; imports `lib/ceval` {winningChances}, `@/explorer/explorerCtrl` {tablebaseGuaranteed}, `@/nodeFinder` {detectThreefold}, `lib/storage` {storedBooleanPropWithEffect}, `chessops/san` {makeSan}, `./practiceView` [not-found] |
| `analyse/src/study/practice/studyPracticeCtrl.ts` | trace `ev_d35a694808a04d0ab077f6026babde58d377ae9f613f36e8d9b0cf10e8c2344e` | exposes default; imports `../studyXhr` {practiceComplete} [not-found], `./studyPracticeSuccess` [not-found], `lib/storage` {storedBooleanProp}, `lib/api` |

**Unknown:** lila's lesson content, texts and score constants weren't read; they're lila's own and aren't used. lila has nothing that explains the daily puzzle.

**React mapping.**
- **Lessons.**
  - Original lessons, written as TS data: from how the pieces move to basic mates and special moves.
  - Each step is a position plus a goal: reach squares, capture targets, give check, mate, or follow a scripted reply. Goals are checked by a pure `checkStep`.
  - Stars depend on the moves used. Progress is kept in the browser, and on the account when signed in.
- **Timed drills.** Short sets of original, engine-checked positions (mate in 1, win the loose piece, find the fork) against a clock. Best times are kept.
- **Endgame practice.** Original positions with lila's goal types (mate, mate in N, draw in N, hold equality, promote), played against our engine and judged with lila's practice thresholds.
- **Daily puzzle explanation.** Phase 11's `explain()` runs on each solution move once the puzzle is solved, or on request.
- **Video library.**
  - A `videos.json` file the user fills in: title, link, author, level, tags, language and duration. It ships empty, with a documented format.
  - A page with search and filters.
  - YouTube links open in the privacy-enhanced embed; other links open in a new tab.
- **Guests get everything**, with progress kept in the browser.
- **Tests.** Lesson goals, drill timing and scoring, endgame goals, and checks on the video file's format.

## 18. Bots (Phase 16)

**What it does in lila.**
- **`BotCtrl` (REA).** Imports `BotLoader`, `setupCtrl`, `playCtrl` and `storage` {loadCurrentGame, saveCurrentGame}. It loads the bot list, runs setup then the game, and keeps the game in progress in the browser.
- **Bot definition (read, `ui/lib/src/bot/types.ts`).**
  - Fields: id, name, description, version, ratings per speed, image, opening books with weights (optionally per colour), sounds per event (each with a chance, delay and mix), move filters, and engine search settings (lines and depth or nodes).
  - On the server, bots are stored as JSON documents (read, `modules/jsBot/src/main/JsBotRepo.scala`).

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `botPlay/src/botCtrl.ts` | trace `ev_9c5bed3b9dd6504c793fbad0e92a64c94aace6b81749e007d8466da749333afc` | exposes `BotCtrl`; imports `lib/bot/botLoader` {BotLoader}, `./setup/setupCtrl` [not-found], `./play/playCtrl` [not-found], `./play/view/playView` [not-found], `./setup/view/setupView` [not-found], `./storage` {loadCurrentGame, saveCurrentGame} [not-found], `./game` {Game} [not-found], `lib/bot/types`, `lib/pubsub`, `lib/view` {alert} |
| `botPlay/src/setup/setupCtrl.ts` | trace `ev_413096fc42190c3d5e17a73a5988f2dd7bcbcec14409aa808d5fc6e4880f2481` | exposes default; imports `lib/setup/timeControl` {timeControlFromStoredValues}, `lib/storage` {storedJsonProp}, `lib` {prop, propWithEffect}, `../game` [not-found], `lib/bot/types` |
| `botPlay/src/play/playCtrl.ts` | trace `ev_b775c08ab25a0493f1fb1d55e65f041c25ef0b7b0df8ed8585c314bc736a5f09` | exposes default; imports `./botMove` {requestBotMove} [not-found], `lib/game/clock/clockCtrl` {ClockCtrl}, `lib/game/promotion` {PromotionCtrl}, `../ground` [not-found], `./sound` {playMoveSounds} [not-found], `./keyboard` [not-found], `chessops/chess` {normalizeMove} |

**Unknown:** `ui/lib/src/bot/*` (filters, move timing, books) was outside every REA scope; only `types.ts` was read. lila's bot names, images, sounds and texts are its own and aren't used.

**React mapping.**
- **Gallery.**
  - About 10 original bots, each with a name, description and chat lines written for OpenGambit.
  - Avatars are drawn as SVG in code.
  - Each bot shows an approximate rating, a style and a short repertoire.
- **Style.**
  - Strength: search depth, time and randomness.
  - Evaluation weights: an attacker values king attack and checks, a defender values king safety and trades, and a tricky bot prefers moves that set traps, taken from the engine's other lines.
  - Repertoire: a few move lines written by hand, plus the Phase 13 book when data exists.
- **Chat lines.** Shown at the start, on captures and checks, after your blunders (using Phase 11's classes) and at the end. Each event has a chance, so bots don't chatter.
- **Assisted mode.** Toggles for hints (the piece to move), takebacks, eval bar, threats and best-move arrow.
- **Challenge mode.** No assists; a win is recorded on the bot's card.
- **Ratings.** Approximate, set by a script that plays the bots against each other and against the engine levels.
- **Guests get everything**, with results kept in the browser and on the account when signed in.
- **Tests.** Bot definitions are checked; move choice per style is tested with a seeded random; plus chat triggers and assists.

## 19. Daily chess and flair (Phase 17)

**What it does in lila.**
- **Correspondence clock (REA: `corresClockCtrl` exposes `CorresClockController` and type `CorresClockData`, no imports).**
  - The client keeps both sides' seconds from the server and ticks the side to move once a second.
  - A bar shows the share of time left, and `onFlag` fires at zero (read).
  - The data is days per turn, increment, white and black (read).
- **Days per move.** The choices are 1, 2, 3, 5, 7, 10 and 14 (read, `modules/setup/src/main/Mappings.scala`); the brief asks for 1, 2, 3, 5, 7 and 14.
- **Reminder (read, `modules/round/src/main/CorresAlarm.scala`).** After each move, an alarm is set for when 80% of the player's remaining time has passed. It's cleared when the game ends.
- **Conditional moves (read, `modules/round/src/main/Forecast.scala` and `ForecastApi.scala`; lila calls them forecasts).**
  - A list of lines, each alternating the opponent's move and your reply, with at most 30 lines of 30 moves.
  - When the opponent moves, matching lines advance and your reply is played automatically; lines that don't match are dropped.
  - Saving fails if the lines don't start at the current move.
- **Flair (read, `modules/user/src/main/FlairApi.scala`; REA `flairPicker`).**
  - One flair per user, from a fixed list of names in a text file; a few are admin-only.
  - lila's flair images are lila assets and aren't used. `flairPicker` lazily loads a picker.
- **Daily tournaments.** lila has none for correspondence. It does schedule Arenas that repeat every day (read, `modules/tournament/src/main/Schedule.scala`, `Freq.Daily`). It has no vacation feature.

| File | REA evidence | Seed edges (REA) |
|---|---|---|
| `round/src/corresClock/corresClockCtrl.ts` | trace `ev_0533e51c6534b0ba5cfee162673223d2c135902f15f3e83337818a9ec9cb2b5a` | exposes `CorresClockController` (type `CorresClockData`); no imports |
| `bits/src/flairPicker.ts` | trace `ev_d61343f2c9c27b9a029adb600e27194298e2385f50f47116a44af419737c1c69` | exposes default (`flairPickerLoader`); imports `lib` {frag} |

**Unknown:** the correspondence clock itself (scalachess) and how lila delivers email and push notifications weren't studied.

**React mapping.**
- **Stored games.**
  - Daily games are kept in the database while they're played, in a new `daily_games` table: players, days per move, moves, deadline, status, draw offer and each player's conditional lines.
  - Today's online games live only in server memory.
  - Moves are checked by the same server rules as live games.
- **Lobby.**
  - Daily seeks at 1, 2, 3, 5, 7 or 14 days per move, and challenges to a named player.
  - Daily games need an account, because they last days.
- **My daily games.** A list with the games where it's your move first; play as many as you like.
- **Notifications.**
  - An in-app badge and list: your move, opponent moved, and time running out (at 80% used, as in lila).
  - Optional browser notifications through the existing service worker.
  - No email, because there's no mail server.
- **Timeouts.** A server check every minute ends games past their deadline. That's a loss on time, or a draw if the opponent has only a king, as in live games.
- **Conditional moves.** lila's rules above, edited on an analysis board.
- **Vacation (designed independently).**
  - 14 days a year.
  - While it's on, your clocks in all daily games pause (deadlines move forward) and you can't start new daily games.
  - Days are used whole.
- **Daily tournaments (decided: correspondence).** Swiss and Arena at days-per-move time controls. A Swiss round lasts as long as its games. An Arena runs for a fixed number of days, and you start a new game whenever one ends.
- **Flair.**
  - Pick one emoji from an allowed list of standard Unicode emoji. They're drawn by the device's font, so there are no image files.
  - Shown next to your name in the lobby, games, leaderboards and profiles.
  - Checked by the server.
- **Tests and smoke script.**
  - Unit tests: deadlines and vacation maths, advancing conditional lines, the timeout check and flair validation.
  - The smoke script: two accounts, a move each, an automatic conditional reply, and a timeout with a test clock.

## Order and dependencies (Phases 11–17)

- **11 Review:** first, because later phases reuse its verdicts, explanations and saved reviews (insights, explanations in learning, bot chat).
- **12 Engine:** second. A stronger engine improves every later phase.
- **13 Explorer:** adds book moves to the review, and the engine's opening book.
- **14 Insights:** needs saved reviews (11) and opening names (13).
- **15 Learning, 16 Bots, 17 Daily chess:** these don't depend on each other.
- **One change from the brief (approved):** the engine's opening book moves from Phase 12 to Phase 13, so one PGN importer feeds both.
- **Tablebases (approved as a stretch goal):** the rest of Phase 13 comes first.
- **No new dependencies** are planned in any phase: charts are SVG, and the PGN reader, Syzygy reader and engine are our own code. If one turns out necessary, I'll ask first.
