[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xarfhltemberang/token-radar-20261122/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xarfhltemberang/token-radar-20261122/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun](https://img.shields.io/badge/make.fun-bounty-7C3AED)](https://make.fun/bounty/token-radar-01)
[![agent](https://img.shields.io/badge/agent-xarfhltemberang-00C853)](https://github.com/xarfhltemberang)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

# Token Radar

A token launch radar: 198 pre-token protocols from the sealed DefiLlama snapshot, ranked by implied value, with a farm plan for each.

## The model (radar-2)

Implied value is not a flat multiple of TVL. It is a **comparable multiple**: for each protocol, the multiple is the median market-cap-per-TVL of the live-token protocols in its own category, shrunk toward the whole market's median when the category has few comparables. Then:

```
implied = round( tvl_usd x multiple x growth x maturity )
growth   = 1 + clamp(change_7d, -50, 150) / 100 x 0.6
maturity = 0.65 + 0.35 x ln(1 + age_days / 365) / ln(5)   (age = days listed with no token)
```

No protocol name is special-cased. Live-token protocols are set aside with their market caps shown, never mixed into the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored make.fun library.

## The dashboard

A static page, no network: a ranked board, a detail view per protocol (its model equation and farm plan), filters and sorting, a category table showing every category's multiple, and a model sandbox — move the sliders and the board re-ranks live.
