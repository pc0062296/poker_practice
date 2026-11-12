# Poker Cash Game Practice

A single-player trainer for 9-max No-Limit Hold'em cash games, built to prepare for
live games. The interface is in Traditional Chinese.

The full plan and the status of each stage are in [docs/PLAN.md](docs/PLAN.md).

## Run it

```bash
npm install
npm run dev
```

Then open the address that the dev server prints.

## Other commands

```bash
npm test            # unit tests
npm run test:full   # also the exhaustive 7-card check and a million-hand simulation
npm run typecheck
npm run build       # production build in dist/
```

## Windows app

The same app also runs as a Windows program (Electron), with its data kept in the app's
own profile folder.

```bash
npm run app        # build and open the desktop window
npm run dist:win   # build release/PokerPractice-<version>-portable.exe and an installer
```

Building the installer needs Windows (or Wine). Every push also builds both files on a
Windows runner (`.github/workflows/windows-app.yml`); download them from the run's
Artifacts. The files are not code-signed, so Windows SmartScreen asks for confirmation
the first time ("More info", then "Run anyway").

## Deploy

Pushing to `main` builds the app and publishes it to GitHub Pages
(`.github/workflows/pages.yml`). Enable it once under
Settings > Pages > Build and deployment > Source: GitHub Actions.
On a phone, open the page and choose "Add to Home Screen" to install it;
after the first visit it also works offline.

## Screens

- **Table**: 2-9 players, opponents of different live-game types, practice spots,
  position lock, live mode (hidden pot, pot-size questions, typed bet amounts).
  Every decision is graded after the hand.
- **Preflop drill**: rapid questions from the range charts, filtered by spot and position.
- **Ranges**: view, paint, edit as text, import and export the preflop charts.
- **Tools**: equity calculator and mental math quizzes for live play.
- **Real hand review**: type in a hand played live; see each opponent's estimated range
  after every action and grades for every decision.
- **Records and report**: results, all-in adjusted results, leaks by situation, statistics
  against reference ranges, progress charts, replays, a mistake notebook with spaced
  repetition, and backups.

## How decisions are graded

- **Preflop**: against the range charts (built-in approximations, or your own).
- **Postflop**: the expected value of each option against the opponents' strategies,
  computed by walking the game tree with their estimated ranges. Rivers and heads-up
  turns are exact; flops are sampled and show an error estimate; later streets of
  multiway pots are valued as checked down.
- **GTO reference**: heads-up turn and river decisions can also be solved with a
  Discounted CFR solver over a small set of bet sizes.

## Limits to know about

- The built-in ranges are approximations, not solver output.
- Opponent types are assumptions about common live players, not measured data.
- Postflop baseline play is rule based; only heads-up turns and rivers have a solver reference.
- Grading uses estimated ranges and simplified trees, so treat small differences as noise.
