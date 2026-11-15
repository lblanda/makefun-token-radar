# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lblanda/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lblanda/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks every pre-token protocol by an implied value its own model derives from TVL, seven-day growth, age with no token and chain breadth, and hands each one a concrete farm plan with costs and times. The dashboard is a static page — sortable, filterable, with a per-protocol detail view and a model sandbox that re-ranks the board live.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json` with the vendored make.fun library.

The model (`lib/model.ts`, version `radar-2`): implied value is `round(1,000,000 x (TVL in $M)^0.85 x growth x momentum x maturity x chains)`. TVL enters sub-linearly because token valuations compress as protocols grow; growth is the clamped seven-day change; momentum adds credit above +25% weekly growth; maturity humps over age with no token (peaks near two years, then decays slowly); chain breadth adds a small diversification factor. No protocol name is ever special-cased. Live-token protocols are set aside with their market caps shown, never mixed into the ranking.

---

<sub>Entered on [make.fun](https://make.fun/?ref=3zwarjv0&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
