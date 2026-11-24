# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zhliu2878-cell/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zhliu2878-cell/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of 758 DeFi protocols (TVL, 7-day growth, listing date, whether a token is recorded), ranks the 200 pre-token protocols by an implied token value derived only from the snapshot's own figures, and gives every protocol a concrete farm plan — what to do, what it costs, how long it takes. The dashboard is a static page (no network, no framework): a sortable, filterable board, a detail view per protocol, and a separate live-token view for protocols whose token already trades.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Node 22.18 or later, standard library only. `main.ts` reads the snapshot, writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data), copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json` (the summary the judge reads). Verify the gate locally with `node verify-gate.mjs`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=vy9jb75h&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
