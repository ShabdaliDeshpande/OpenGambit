# OpenGambit

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
| Engine | Runs in Web Workers and restarts on every position change. Shows 1–5 best lines (multi-PV) with depth and speed, an eval bar on the board, and arrows for the best and second-best moves. Click any move in an engine line to play the line up to that move into the tree. Search time, depth, threads, threat mode and arrows are set under ⚙ (Phase 12) and remembered. |
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
| 6 | 5 | 1.5 s | ±12 cp |
| 7 | 6 | 2 s | none |
| 8 | up to 20 (as deep as 4 s allows) | 4 s | none |

Each level beat the one below it in `npm run engine:match -- --ladder` (Phase 12). All levels play a forced mate when they see one. The computer accepts a draw offer only when it judges its own position to be at least 1.5 pawns worse.

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

## Features (Phase 5: Accounts and ratings)

| Area | What it does |
|---|---|
| Accounts | **Sign in** in the top bar opens a dialog to sign in or create an account (username of 3–20 letters, digits, `_` or `-`; password of at least 8 characters). Guests can still play casual games without an account. |
| Rated games | When you're signed in, the lobby's **Mode** choice lets you post a **Rated** or **Casual** seek. Rated seeks pair only with rated seeks, and only signed-in players can accept them. Names in the lobby and the game show ratings ("1500?" while provisional), and the rating change appears when a rated game ends. |
| Ratings | Glicko-2, kept separately for bullet, blitz, rapid and classical. A new rating starts at 1500 ± 500. Its uncertainty shrinks as you play and grows back slowly while you don't. The rating is shown as provisional ("?") while the uncertainty is 110 or more. One game can't move a rating by more than 700 points, and ratings never drop below 400. |
| Profiles | Click your name in the top bar, or any player's name, for their profile: ratings per category with uncertainty and number of games, and their game history (opponent, result and how it ended, time control, rating change). **Analyse** opens any saved game on the analysis board. A profile can also be shared as a `?user=<name>` link. |
| What gets saved | Finished games with at least one signed-in player. Aborted games and guest-only games are not saved. |

**Security.**
- **Passwords** are hashed with scrypt and a random salt per password.
- **Sessions** are random tokens in an `HttpOnly`, `SameSite=Lax` cookie, which is `Secure` over HTTPS. The database stores only a hash of each token. Sessions last 30 days.
- **Requests that change data** must be JSON and come from the same site.
- **Failed logins** are limited per username (10 in 15 minutes) and per address (30). New accounts are limited to 5 per address per hour.

**Database.** If `DATABASE_URL` is set to a PostgreSQL connection string, the server uses it. Otherwise it uses a SQLite file at `data/chess.db` (change it with `SQLITE_PATH`) through Node's built-in `node:sqlite`. The server creates and upgrades the tables by itself on start.

## Features (Phase 6: Tournaments)

Open **Play online → 🏆 Tournaments**. Signed-in players can create a tournament: pick Arena or Swiss, an optional name, a time control, when it starts (1–60 minutes from now) and whether it's rated. Anyone signed in can join. Guests can watch.

| | Arena | Swiss |
|---|---|---|
| Length | A fixed duration (10 minutes to 2 hours). | A fixed number of rounds (3–15), with a pause between rounds (10 s to 5 min). |
| Pairing | As soon as your game ends you're paired again with someone close to you in the standings and rating, never the opponent you just played. The first wave is paired by rating. | Each round pairs players with similar scores who haven't met yet, top half against bottom half within a score group, balancing colours. Nobody gets the same colour three times in a row. |
| Points | Win 2, draw 1, loss 0. After two wins in a row you're on fire 🔥: wins count 4 and draws 2. Draws under 10 moves score nothing, and so does a short draw that follows another draw. | Win 1, draw ½, loss 0. The odd player out gets a bye worth 1 (the lowest-ranked player who hasn't had one). |
| Extras | Berserk (optional, ⚡): before your first move you can halve your clock and give up the increment; a win of at least 7 moves then earns 1 extra point. | No draw offers before move 30. Late joining is open until more than half the rounds have started; missed rounds count as 0. |
| Ties | Performance rating, then who joined first. | Sonneborn–Berger, then Buchholz, then rating. |
| End | When time is up. Games still running don't count. | After the last round, or earlier when no new pairing is possible. |

In both formats:
- **No-shows:** tournament games can't be aborted. If you don't make your first move in time (20–30 s), you lose that game and are paused.
- **Leaving and pausing:** **Leave** before the start takes you out. **Pause** later keeps your score, and **Rejoin** brings you back.
- **The live page:** it shows a countdown, standings with each player's results, and the games being played, each of which you can watch. When the next pairing comes, your own game opens by itself.
- **After the end:** finished tournaments are saved with their final standings, and **Recently finished** lists them. Rated tournaments update ratings like any rated game.

The pairing engine is in [server/tournament/](server/tournament/). Both formats solve a minimum-cost matching ([matching.ts](server/tournament/matching.ts)): it's exact up to 18 waiting players and uses a greedy start with swap improvements above that.

## Features (Phase 7: Play-feel polish)

| | What it does |
|---|---|
| Move animation | Pieces slide to their new square, and the rook slides too when castling. Pieces you drag aren't animated (you already put them there), and nothing animates when you jump around a game or load one. Turned off if your system asks for reduced motion. |
| Sounds | Moves, captures, checks, game start, game end and a beep when your clock drops under 10 seconds. They're synthesised in the browser with the Web Audio API, so no sound files are shipped. **🔊** in the top bar turns them off, and the choice is remembered. |
| Premoves | During the opponent's turn (online, or against the computer), drag or click one of your pieces to queue a move: its squares turn orange. It's played the instant your turn comes if it's still legal, and dropped if not. Promotions become a queen. Click elsewhere or right-click to cancel. |
| Rematch | After an online game, **↻ Rematch** offers a new game with the same time control and colours swapped. The opponent can accept or decline, and you can withdraw the offer. Tournament games have no rematch. |
| Install as an app | OpenGambit has a web app manifest, its own icon and a service worker, so browsers offer **Install**. Once installed or visited, playing the computer, puzzles and the analysis board work offline. Online play needs a connection. The service worker is only active in production builds (`npm run build`), never in `npm run dev`. |

## Features (Phase 8: Puzzle ratings & training)

| | What it does |
|---|---|
| Puzzle rating | Signed-in players get a Glicko-2 puzzle rating, kept separate from game ratings. Only your **first try** at each puzzle counts; later tries are practice. A wrong move, a hint or showing the solution counts as a miss. The new rating and its change appear right after each puzzle, and on your profile. |
| Honest solves | The browser sends the moves you played, and the server checks them against the real solution (any checkmate counts on the last move) before it changes your rating. |
| Theme training | When you train one theme, a result counts for less because the theme hints at the answer: 10% for a solved mate (40% missed), 20% (70%) for tactics like forks, 70% (80%) for endgames. "Any theme" counts fully. |
| Difficulty | Signed in, difficulty is relative to your rating: Easiest −600, Easier −300, Normal, Harder +300, Hardest +600. Puzzles are picked from the nearest ones you haven't tried. Guests keep the fixed Easy, Medium and Hard ranges. |
| Daily puzzle | **📅 Daily puzzle** is the same for everyone each day (UTC) and cycles through the whole built-in set. It shows ✓ once you've solved today's. |
| Dashboard | **📈 Dashboard** shows your rating chart, the number of rated puzzles, your first-try success rate and performance. **Strengths** are themes with 3+ first-try wins above your average; **improvement areas** are themes with 3+ misses below it. It also lists your recent puzzles with **↻ Replay**. A theme's performance is its average puzzle rating − 500 + 1000 × your first-try success rate. |

While a puzzle rating is new and provisional ("?"), it moves a lot: a couple of hundred points per puzzle at first. The swings shrink as the uncertainty (±) comes down.

## Features (Phase 9: Accounts & leaderboards)

| | What it does |
|---|---|
| Change password | On your own profile, under **Account settings**. You need your current password. Changing it signs out your other devices, and the one you're on stays signed in. |
| Delete account | Also under **Account settings**: enter your password and type your username. Your sign-in, sessions, ratings and puzzle history are deleted, and you're signed out. Games you played stay for your opponents, with your name shown as "[deleted]". The username becomes free again. |
| Leaderboards | **Play online → 🏅 Leaderboard** shows the top 10 for bullet, blitz, rapid, classical and puzzles. Only established ratings are listed: not provisional and at least 2 rated games. Since uncertainty grows while a player is away, inactive players drop off by themselves. |
| Seek rating range | Signed in, you can limit who may accept your seek: within ±100, ±200, ±300 or ±500 of your rating in that time control. The lobby shows the range, and **Play** is greyed out if yours is outside it. Automatic pairing needs both players' ranges to fit. Guests (no rating) can't take a seek with a range. |

Password changes and account deletion are protected like logins: a wrong current password counts as a failed login attempt.

## Features (Phase 10: Puzzle Streak & Storm)

Open **Puzzles** and pick **🔥 Streak** or **⚡ Storm**, or share a link: `?streak` or `?storm`.

| | Streak | Storm |
|---|---|---|
| Goal | Solve as many puzzles in a row as you can. | Solve as many puzzles as you can in 3 minutes. |
| Clock | None. | 3:00, starting with your first move. Combos of correct moves add time: +3 s at 5 in a row, +5 s at 12, +7 s at 20, +10 s at 30 and every 10 after. |
| Mistakes | One wrong move ends the streak. **⏭ Skip** plays the right move for you, once per run. | A wrong move costs 10 seconds, breaks the combo and moves on to the next puzzle. |
| Puzzles | Easiest first, getting harder, with a little shuffling within each rating band. | The same. |
| After | Your score and personal best. | Score, moves, accuracy, best combo and mistakes, plus your best. |

Your best and today's best (UTC) for each mode are saved with your account and shown on your profile. Guests' bests are kept in the browser. Runs are scored in the browser, so, as on lila, there's no leaderboard for them: the server only rejects impossible scores.

## Features (Phase 11: Game Review)

On the analysis board, **📊 Review game** runs the engine over every position of the main line: up to 3 positions at once in Web Workers, 0.6 s each, with two lines per position. A game sent from **Analyse this game** (Play or online) or from a profile is reviewed automatically.

| | What you get |
|---|---|
| Move classes | Every move gets one of ten classes: **!! Brilliant**, **! Great**, **★ Best**, **✓✓ Excellent**, **✓ Good**, **≡ Book**, **?! Inaccuracy**, **? Mistake**, **× Miss** or **?? Blunder**. The mark appears next to the move in the move list. |
| Summary | Per player: accuracy, an estimated performance, and how many moves fell in each class. ◀ ▶ buttons jump between a player's errors. |
| Eval graph | White's chances over the whole game, with dots on errors and brilliant or great moves, and lines where the middlegame and endgame start. Click anywhere to jump to that move. |
| Phases | Accuracy per player in the opening, middlegame and endgame, and one sentence each: where they played best and their costliest move. |
| Key moments | Up to six turning points (the biggest errors, plus brilliant and great moves). Click one to go there. |
| Explanations | The selected move's class, the evaluation before and after, and a plain-language explanation built from rules, with no AI model. For example: "Qg4 is a blunder. It leaves your queen on g4 hanging: Bxg4 wins it. Best was exd5, which keeps the material level." **Play … on the board** adds the better move as a variation. |
| Retry mistakes | **🔁 Retry …'s mistakes** goes back to the position before each of that player's errors. Find a better move. The engine's move counts at once; any other move counts if it keeps the evaluation within 0.04 of the best. You can try again, see the answer, or skip. The engine stays hidden while you try. |
| Saved reviews | When you review your own finished online game while signed in, the review is saved with the game. Your profile's game history then shows both players' accuracy, and the game opens with its saved review instead of running the engine again. |

**How moves are classed:**
- **Inaccuracy, mistake, blunder:** lila's rules. The drop in the mover's winning chances (on a −1…1 curve) is at least 0.1, 0.2 or 0.3. Walking into a forced mate, or letting one slip, is judged separately.
- **Book:** a move that's in imported master games. Until the Opening Explorer (Phase 13) brings those, no move is marked book.
- **Miss:** your opponent's last move was a mistake or blunder, and your move gives back at least 0.1 of what it offered, without being a blunder. A lost forced mate while still clearly winning is also a miss.
- **Brilliant:** the engine's move (or within 0.02 of it) that gives up material: by static exchange, at least a piece for a pawn. You must not already have been completely winning, and not be worse after it.
- **Great:** the engine's move when its second choice would lose at least 0.2. In other words, the only move that holds.
- **Best, excellent, good:** the engine's move or a drop of 0.01 or less; under 0.04; under 0.1.

**How the summary is worked out:**
- **Accuracy:** lila's formulas. Each move scores 0–100 from the drop in win percentage. The game score is the average of a volatility-weighted mean (moves in sharp positions count more) and the harmonic mean.
- **Phases:** this app's own rule, because lila's is in a library that isn't in its repository. The middlegame starts once most minor pieces have left their starting squares, or at move 15. The endgame starts when the pieces other than pawns and kings add up to 26 or less (queen 9, rook 5, bishop or knight 3).
- **Estimated performance:** a fixed curve from accuracy to a rating, nudged a quarter of the way towards the opponent's rating when it's known (at most 200 points). It's a rough estimate, not a rating, and is left out below 8 moves.
- **Saved reviews:** the server checks a saved review against the stored game and works out the accuracy itself from the scores. It keeps the review that gave the engine more time.

## Features (Phase 12: Analysis settings and a stronger engine)

On the analysis board, **⚙** next to the engine switch opens the engine settings. They're remembered in the browser.

| Setting | What it does |
|---|---|
| Search by time or depth | Time per position from 1 to 30 s (default 15 s), or a fixed depth from 1 to 30. |
| Infinite analysis | Keeps searching until you move to another position. |
| Lines | 1 to 5 engine lines. |
| Threads | How many engine workers share the search, up to one less than your device's cores. Each worker takes a share of the first moves, and their lines are merged. |
| Show threat | Also analyses the position as if it were the other side's move, and shows what they'd play: a red dashed arrow and a **Threat:** line under the engine lines. It's off while you're in check. |
| Arrows | Turn the best-move arrows, the threat arrow and your drawn shapes on or off. |

**Drawing on the board:**
- **Arrows and circles:** right-click and drag to draw an arrow; right-click a square to circle it.
- **Colours:** hold Shift, Alt or Ctrl (⌘ on a Mac) for red, blue or yellow instead of green.
- **Removing:** drawing the same shape again removes it, and a left click clears them all.
- **Saving:** shapes belong to the move you drew them on. They're saved in the PGN as `[%cal …]` (arrows) and `[%csl …]` (circles) comments, which most chess software reads, and loaded back from PGNs that have them.

**A stronger engine** (still this app's own code):
- **Search:** principal variation search, null-move pruning, late-move reductions, history move ordering and aspiration windows. The quiescence search now also answers checks.
- **Evaluation:** it now blends middlegame and endgame values as pieces come off. It counts pawn structure (passed, doubled and isolated pawns), piece mobility, the pawn shelter in front of a castled king, rooks on open files and the bishop pair, and it knows that a lone minor piece can't win.
- **Measured strength:** `npm run engine:match` plays the working copy against a committed version, taken from git (`--baseline <ref>`, default `HEAD`), from 12 openings with each colour. Against the Phase 11 engine at 150 ms a move, the new engine scored +20 =3 −1 (89.6%, about +370 Elo). `npm run engine:match -- --ladder` checks that each play level beats the one below.

**Server-side analysis (optional, off by default).**
- **Turning it on:** start the server with `ANALYSIS_QUEUE=1` (and optionally `ANALYSIS_MS`, the engine time per position, default 600).
- **Using it:** signed-in players get **☁ Analyse on the server instead** on reviews of their own online games. The game waits in a queue and is analysed in a worker thread on the server, one game at a time. The review is saved with the game, so you can close the page; the board loads it when it's done.
- **The live site:** it's off there, because free hosting has slow, shared CPUs.

## Features (Phase 13: Opening Explorer)

The **Opening explorer** panel on the analysis board shows what was played from the position on the board. Click a move to play it. **Hide** folds the panel away, and the panel remembers your choices.

| Tab | What it counts |
|---|---|
| Masters | Master games you imported (see below). Shows games, White/draw/Black %, and the players' average rating. |
| OpenGambit | Every game finished on this server, as it ends. |
| My games | Your own games, as White or as Black, filtered by speed and by month range. Needs an account. |

**Also new:**
- **Opening names:** the name of the opening reached (for example **C60** Spanish opening) shows above the engine lines, once opening names are imported. Past the last named position, the name of the nearest earlier one stays.
- **Book moves in the review:** a move is **≡ Book** when it's a master move played in more than one imported game. Retry mistakes skips book moves. This works for reviews in the browser and on the server.
- **Opening book for the computer:** from level 3 up, the computer plays master moves for the first 16 plies (8 moves each). It picks them in proportion to how often masters played them, each needing at least two games. If the server has no master games, or you're offline, it plays its own moves as before.

The explorer covers games from the standard starting position only.

### Importing master games and opening names

Nothing is bundled: you download the files yourself and import them into the server's database, which is SQLite, or PostgreSQL when `DATABASE_URL` is set. Stop the server first when using SQLite.

```
npm run explorer:import -- games.pgn [more.pgn …] [--min-rating 2200] [--plies 30]
npm run openings:import -- openings.tsv [more.tsv …]
npm run explorer:index-site
```

- **`explorer:import`** reads PGN files (or `.pgn.zst` on a Node version with zstd support) one game at a time, however large. It keeps the first 30 moves (plies) of each game from the standard start.
  - With `--min-rating`, both players need at least that rating.
  - Games set up from another position, other variants and games without a result are skipped.
  - Importing the same file twice counts its games twice.
- **`openings:import`** reads TSV files with a header row naming `eco`, `name` and `pgn` columns, for example `C60⇥Spanish opening⇥1. e4 e5 2. Nf3 Nc6 3. Bb5`. Public-domain opening-name lists in this format exist. When two names reach the same position, the first one read is kept.
- **`explorer:index-site`** rebuilds the OpenGambit and My games data from games saved before the explorer existed. New games are added as they finish, so you need it only once.

## Playing the computer from an empty lobby

**Nobody to play online?** When nobody else in the lobby is looking for a game, the lobby offers **🤖 Play the computer**, with a level choice and your last time control. If your own seek has waited 15 seconds with no taker, the same offer appears next to it, and taking it withdraws your seek. The game starts on the Play tab.

## Deploying

The app is one Node process that serves the built files, the account API and the game WebSocket, so it needs a host that runs a long-lived server with WebSockets. Static-only hosts won't work for online play.

- **[Dockerfile](Dockerfile):** builds the app and runs `node server/index.ts` on port 8787 (`PORT` overrides it). It works on any Docker host.
- **[render.yaml](render.yaml):** a Render Blueprint for this Dockerfile, on the free plan, with the `/healthz` health check. Push the project to a GitHub repository, then in Render choose **New → Blueprint** and pick the repository. Render provides the HTTPS address.
- **Database for a deployed site:** create a PostgreSQL database, for example a free one at [Neon](https://neon.tech). Copy its connection string (`postgresql://…?sslmode=require`) and give it to Render as `DATABASE_URL`. The Blueprint asks for it; later you can change it under the service's **Environment** settings. Without it, accounts are stored in the container and wiped on every restart or deploy.
- **Opening explorer data:** run the importers (Phase 13) with the same `DATABASE_URL` as the deployed site, from your own computer, to fill a PostgreSQL database.
- **Server-side analysis** is off unless `ANALYSIS_QUEUE=1` is set (see Phase 12). Each queued game keeps one CPU core busy for about `ANALYSIS_MS` × its number of positions.
- **Behind a proxy**, set `TRUST_PROXY=1` so limits see real client addresses and session cookies are marked `Secure` (render.yaml already sets it). `MAX_CONNS_PER_IP` (default 20) changes the socket limit.

Things to know about hosting it:
- Running games live in memory. A restart or redeploy ends them. Accounts, ratings and finished games are kept in the database.
- Render's free plan stops the service after about 15 minutes without visitors, and the next visit takes a while to start it again.
- The server accepts WebSocket connections and changes only from pages on its own host. It limits sockets per address, messages per connection, logins and sign-ups. It has no moderation.

## Project layout

```
src/
  chess/        rules glue and pure game logic (unit-tested)
    clock.ts      time controls and clock math (time is injected, so tests are deterministic)
    gameEnd.ts    end-of-game detection and result text
    game.ts       game state reducer, plus PGN export/import and FEN validation
    premove.ts    premove targets and checking a premove when the turn comes
  puzzles/runs.ts  Streak and Storm rules: run order, the Storm clock, combo bonuses
    animation.ts  which pieces slide, and which sound a move makes
  analysis/     analysis board logic (pure, unit-tested)
    tree.ts       immutable move tree with variations, comments and glyphs
    pgn.ts        PGN reader and writer for trees (variations, comments, NAGs)
    analysisState.ts  reducer for the analysis board
    evalFormat.ts eval text, eval-bar share, and engine lines in SAN
    accuracy.ts   winning chances and accuracy (lila's formulas); also used by the server
    review.ts     move classes, from lila's bad-move rules plus brilliant, great, best … miss
    gameReview.ts a whole game's review: classes, accuracy, phases, performance, key moments
    material.ts   static exchange, hanging pieces, forks and pins
    explain.ts    plain-language explanations of moves, from rules
    divider.ts    opening / middlegame / endgame split
    performance.ts  the rough performance estimate
    retry.ts      retry-your-mistakes rules
    engineSettings.ts  analysis board engine settings (time or depth, lines, threads, threat, arrows)
    rootSplit.ts  sharing the first moves between engine workers, merging their lines; the threat position
    shapes.ts     drawn arrows and circles, and their [%cal]/[%csl] PGN form
    reviewData.ts the saved review format, checked by the server; savedReview.ts converts to it
  engine/
    board.ts      fast 0x88 move generator for the search (checked by perft), two Zobrist hashes
    search.ts     principal variation search with null-move pruning, late-move reductions,
                  transposition table, quiescence, killer and history ordering; tapered
                  evaluation, play levels and multi-line analysis
    engine.worker.ts  runs a move search or an analysis in a Web Worker
  components/   Board (with arrows), Piece, PromotionPicker, ClockDisplay, MoveList, GameControls,
                SetupPanel, PgnFenPanel, PlayView
    analysis/     AnalysisView, EvalBar, EngineLines, TreeView, NodeTools, ReviewPanel, EvalGraph, ExplorerPanel
  hooks/        useEngine, useAnalysis, useKeyboardNav, useTheme, useOnline, useAccount, useGameSounds
  sound/sounds.ts  synthesised game sounds (Web Audio) and the on/off setting
  explorer/     key.ts (position keys shared with the server), book.ts (the computer's opening book),
                format.ts (result percentages), fetchBookMove.ts
  online/       client side of online play
    protocol.ts   message types shared with the server
    client.ts     the WebSocket client (reconnects and re-subscribes by itself)
    view.ts       clock countdown, replaying moves, PGN export
  components/online/  OnlineView, Lobby, OnlineGame, Tournaments (list and create form), TournamentPage, Leaderboard
  account/api.ts  calls to the account API
  components/account/  AccountDialog (sign in / create account), ProfileView, AccountSettings
  App.tsx       tabs, theme and account; all screens stay mounted so a running game keeps its clock
server/         the server (Node, run directly from TypeScript)
  backend.ts    opens the database and wires the API and game server together
  hub.ts        players and accounts, lobby seeks, pairing, saving finished games, message checks
  room.ts       one game: move validation, clocks with lag compensation, draws, aborts, disconnects
  transport.ts  WebSocket endpoint at /ws, with origin check, limits and session lookup
  api.ts        account API at /api: sign-up, login, logout, profiles, game history
  auth.ts       password hashing, input checks, cookies, login rate limits
  store.ts      users, sessions, ratings and games on top of the database
  rating/glicko2.ts  the Glicko-2 rating system
  puzzles.ts    puzzle catalogue for the server, solve checking, daily puzzle, theme weights
  puzzleDashboard.ts  dashboard statistics (strengths, improvement areas, chart, history)
  analysisQueue.ts  optional server-side game analysis: the queue, and saving the result as a review
  analysisWorker.ts the worker thread that runs the engine over a game
  explorer/     explorerStore.ts (move counts, My games, opening names, book moves), importer.ts,
                pgnGames.ts (reads large PGN files and replays SAN quickly on the engine board)
  tournament/   manager.ts (lifecycle, timers, live pages), arena.ts (scoring, pairing),
                swiss.ts (pairing, byes, tie-breaks), matching.ts (minimum-cost matching)
  db/           one interface over SQLite (node:sqlite) and PostgreSQL (pg), plus migrations
  index.ts      standalone server for `npm start`
  config.ts     timeouts and limits
scripts/smoke-accounts.ts  end-to-end check of accounts and rated play against a running server
public/         manifest.webmanifest, icons/, sw.js (service worker for install and offline play)
scripts/smoke-tournament.ts  end-to-end check: four accounts play a 3-round Swiss on a running server
scripts/smoke-puzzles.ts  end-to-end check of puzzle ratings, the dashboard and the daily puzzle
scripts/smoke-account-settings.ts  end-to-end check of password change, leaderboard and account deletion
scripts/smoke-review.ts  end-to-end check: two accounts play, one saves a review, accuracy shows in both histories
scripts/smoke-server-analysis.ts  end-to-end check of the server analysis queue (server started with ANALYSIS_QUEUE=1)
scripts/engine-match.ts  plays the engine against a committed version of itself, or each level against the next
scripts/import-explorer.ts, import-openings.ts, index-site-explorer.ts  the explorer's importers (npm run explorer:import, openings:import, explorer:index-site)
scripts/smoke-explorer.ts  end-to-end check of the explorer tabs, opening names and book moves
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
| ws (server only) | 8.18.3 | MIT |
| pg (server only, PostgreSQL client) | 8.16.3 | MIT |
| pg's dependencies (server only) | pg-pool 3.14.0, pg-protocol 1.16.1, pg-types 2.2.0, pg-connection-string 2.14.1, pgpass 1.0.5, pg-cloudflare 1.4.1, postgres-array 2.0.0, postgres-bytea 1.0.1, postgres-date 1.0.7, postgres-interval 1.2.0, xtend 4.0.2 | MIT |
| pg's dependencies (server only) | pg-int8 1.0.1, split2 4.2.0 | ISC |

SQLite comes from Node's built-in `node:sqlite` module, so no extra package is needed for it.

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
| @types/pg | 8.15.5 | MIT |

Transitive development packages:

- **MIT:** undici-types, rolldown, @rolldown/binding-win32-x64-msvc, @rolldown/pluginutils, @oxc-project/types, postcss, nanoid, magic-string, @jridgewell/resolve-uri, @jridgewell/sourcemap-codec, @jridgewell/trace-mapping, @vitest/mocker, @vitest/spy, chai, assertion-error, @types/chai, @types/deep-eql, @types/estree, csstype, es-module-lexer, estree-walker, fdir, obug, picomatch, std-env, tinybench, tinyexec, tinyglobby, why-is-node-running
- **Apache-2.0:** @typescript/typescript-win32-x64, detect-libc, expect-type
- **BSD-3-Clause:** source-map-js
- **ISC:** picocolors
- **MPL-2.0:** lightningcss, lightningcss-win32-x64-msvc. This is a CSS minifier that runs only at build time; MPL-2.0 is file-level copyleft and applies only if you modify and redistribute lightningcss itself.

Chess pieces are drawn with standard Unicode chess symbols in the system font. No image or font assets are bundled.

## Known gaps

- **Running online games and tournaments live only in server memory.** Restarting the server ends them. Finished games with a signed-in player, and finished tournaments, are saved in the database.
- **Tournaments are basic.** There's no tournament chat (left out on purpose: it would need moderation), no team battles, no scheduled or recurring events, no private or password-protected tournaments, no editing after creation, and no notifications outside the open tab.
- **The Swiss pairing is a simplified version of the Dutch system,** not the full FIDE rules. It does keep the main guarantees: no rematches, similar scores, colour balance and fair byes.
- **Guests are per tab.** Opening a game link in a new tab as a guest makes you a spectator. Signed-in players are the same player in every tab.
- **No chat, takebacks or extra time** in online games, and only one premove can be queued at a time.
- **Offline play needs one visit first.** The service worker saves files as they are used, so the computer opponent works offline only after you have played it once online.
- **No password reset or email.** A forgotten password can't be recovered, because accounts have no email address. You can change your password while signed in.
- **Deleting an account during a running game:** that game's result can't be saved afterwards, though the opponent's other games are unaffected.
- **The PostgreSQL code path hasn't been run in this project's tests,** because no Postgres server was available. The same store tests run against it when `TEST_DATABASE_URL` points to an empty test database.
- **Basic protection only.** The server checks messages and origins and limits connections, messages, logins and sign-ups. It has no TLS of its own (use a host or reverse proxy that provides HTTPS) and no moderation.
- **Lag compensation is a simple model**: half the measured round trip, capped per move and by a refilling budget.

- **Threefold and the 50-move rule end the game automatically.** There is no claim step as in over-the-board rules or on lila.
- **The clock follows a simplified start rule.** White's first move starts Black's clock, and no increment is added for that first move.
- **Pieces depend on system fonts.** They're Unicode glyphs, so they look slightly different between operating systems.
- **The engine is still modest.** It's much stronger than before Phase 12 but far from top engines. Its opening book needs imported master games.
- **Review verdicts are only as good as a 0.6-second search** by that engine. Close calls, and deep sacrifices it doesn't see through, can be misjudged. Brilliant moves are found by static exchange, so a sacrifice that only pays off much later may be called best instead.
- **Book moves need imported master games.** Without any (see Phase 13), no move is marked book and the computer has no opening book.
- **Explanations are rule-based.** They name material, hanging pieces, mates, forks, pins and similar concrete reasons, and fall back to "makes your position worse" for quieter positional errors.
- **Only signed-in players' own online games keep their review.** Reviews of games against the computer, imported PGNs or a guest's games stay on the board until you leave it.
- **The performance estimate is a rough guide,** from a fixed curve chosen for this app, not measured from rated players.
- **The Play screen's PGN import keeps only the main line.** The Analysis board keeps everything.
- **Secondary engine lines are shallower than the best line,** and their continuations can be short. Each extra line is searched separately with the remaining moves.
- **Threads share the first moves, not memory.** Workers can't share a transposition table without cross-origin isolation headers, so more threads search each share deeper but don't combine their knowledge, and the reported depth is the shallowest worker's.
- **The threat search starts fresh** from the position with the other side to move, so it doesn't see repetitions in the game so far.
- **No endgame tablebases.** Server-side analysis exists but is off unless the server is started with `ANALYSIS_QUEUE=1`, and its queue lives in memory: a restart drops games still waiting.
- **Drawn shapes need a mouse.** Touch screens can't right-click, so there's no way to draw on a phone or tablet yet.
- **The analysis tree is not saved.** It's lost on reload; export the PGN to keep it.
- **The built-in puzzle set is small (65)** and leans towards mates and simple material wins. Ratings are estimates, not measured from players. Import a CSV for variety.
- **Puzzle ratings and your stats are not linked.** There is no personal puzzle rating, and progress lives only in this browser.
- **Built-in puzzles start at the solver's move.** Only imported puzzles play an opponent setup move first.
