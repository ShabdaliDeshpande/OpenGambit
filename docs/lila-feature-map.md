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
