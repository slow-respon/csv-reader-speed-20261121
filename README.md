# csv-reader-speed-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/slow-respon/csv-reader-speed-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/slow-respon/csv-reader-speed-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0: it reads broken CSV files and answers exactly as the reference does — same `{columns, rows, errors}` on every case — several times faster. It handles the reference's whole broken-row policy: a dropped BOM, blank lines that are no records, stray CRs outside quotes, quoted fields with doubled quotes and line breaks inside them, junk after a closing quote, quotes that never close, and short/long rows padded or cut to the first record's width.

## How it is fast

The reference builds every field one character at a time. This reader never does:

- A record whose line holds no quote and no stray CR is split by the engine in one go (`String.split`), after the line is cut out once as a view and checked with the engine's own search.
- Every other field is cut out with slices once its end is known; a quoted field is found with `indexOf` instead of a character walk whenever it holds no doubled quote and no line break inside it.
- The slow paths — doubled quotes, line breaks inside quotes, stray CRs, junk after a closing quote, unterminated quotes — walk only the field they belong to, and keep the reference's exact line counting and error order.

On the kit's practice set (6 cases, 10.2 MB of CSV) the parser runs in ~95 ms against the reference's ~400–500 ms on this machine, about 3–5x faster, with byte-identical answers. The full driver run is ~0.9 s against the baseline's ~1.5 s, the rest being the JSON parse of the cases and the JSON write of the answers, which both entries pay.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

Node.js 22.18 or later, standard library only, no network, no dependencies. `main.ts` reads `/input/cases.json` (a JSON array of `{id, input}`), answers each case alone with `run` from `solve.js`, and writes `/output/answers.json`. Run it twice and the outputs are byte-identical.

## Files

- `solve.js` — the reader: `run(input)` returns csv-reader 1.0.0's answer for `{text, header}`.
- `main.ts` — the driver the harness runs (`node /bot/main.ts`).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
