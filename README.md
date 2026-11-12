# Poker Cash Game Practice

A single-player trainer for 9-max No-Limit Hold'em cash games, built to prepare for
live games. Bots follow a baseline strategy, and every preflop decision you make is
graded against range charts. The interface is in Traditional Chinese.

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

## Deploy

Pushing to `main` builds the app and publishes it to GitHub Pages
(`.github/workflows/pages.yml`). Enable it once under
Settings > Pages > Build and deployment > Source: GitHub Actions.
On a phone, open the page and choose "Add to Home Screen" to install it;
after the first visit it also works offline.

## What is implemented

- Rules engine: blinds, straddle, minimum raise and reopening rules, side pots,
  uncalled bets, rake, showdown, replayable hand records
- Hand evaluator verified against the exhaustive 5-card and 7-card distributions
- Approximate 9-max preflop range charts for 100 and 200 big blinds
  (not solver output; they can be overridden)
- Baseline bots: charts before the flop, rule-based play after it, with range tracking
- Table interface for desktop and phones, preflop grading, hand log, and history

## Limits to know about

- The built-in ranges are approximations.
- Postflop bot play is rule based, not an equilibrium solution.
- Postflop decisions are not graded yet (planned in stage 6).
