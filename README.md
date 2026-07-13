# 🎴 Kaboo Scorekeeper

Tiny single-page web app to track scores for the card game **Kaboo** (aka Cabo).

Sensible defaults baked in for Kaboo:
- Lowest total wins
- Target 100 (player who hits 100 first loses the match)
- Negative scores allowed (e.g. Joker = −2)

Features:
- Add players, start a new set of games, log scores per round
- Stores everything in your browser's `localStorage` — nothing leaves your device
- Stats: leaderboard, win rate, avg points/game and /round, best & worst rounds, top rivalry
- Undo last round, end game, rematch from history, import/export JSON
- Import completed two-player games from newline text (two names, then alternating scores)
- Mobile-friendly, works offline once loaded

## Run locally

Open `index.html` in any browser. No build step.

## Deploy

Hosted on GitHub Pages at **https://bravostation.github.io/kaboo-scorekeeper/**.

```sh
git push origin main
```

Pages picks it up from `main` (root).
