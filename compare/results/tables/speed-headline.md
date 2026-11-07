| ns/op | node 22.11.0 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **8.28** (fastest other: dinero.js 2 16.4) | **8.58** (fastest other: monetra 20.7; dinero.js 2 33.0) | **7.86** (fastest other: dinero.js 2 12.9) |
| parse | **43.0** (fastest other: dinero.js 2 63.2) | **30.1** (fastest other: dinero.js 2 bigint 168; dinero.js 2 174) | **29.6** (fastest other: dinero.js 2 61.4) |
| add | **11.7** (fastest other: monetra 15.1; dinero.js 2 250) | **13.4** (fastest other: monetra 19.9; dinero.js 2 327) | **10.1** (fastest other: monetra 13.2; dinero.js 2 216) |
| mulRatio | **19.8** (fastest other: @screeny05/ts-money 164; dinero.js 2 621) | **29.7** (fastest other: @screeny05/ts-money 45.6; dinero.js 2 707) | **21.3** (fastest other: monetra 168; dinero.js 2 459) |
| allocate3 | **50.6** (fastest other: bigint-money 495; dinero.js 2 1.2 µs) | **65.5** (fastest other: @screeny05/ts-money 201; dinero.js 2 1.5 µs) | **43.3** (fastest other: bigint-money 275; dinero.js 2 1.2 µs) |
| toDecimal | **33.3** (fastest other: ts-money 80.1; dinero.js 2 477) | **63.0** (fastest other: js-money 75.9; dinero.js 2 585) | **35.6** (fastest other: @screeny05/ts-money 66.4; dinero.js 2 409) |
| format | 407 (fastest other: **currency.js 372**; dinero.js 2 1.2 µs) | 284 (fastest other: **currency.js 264**; dinero.js 2 1.2 µs) | **440** (fastest other: currency.js 442; dinero.js 2 1.2 µs) |
| compare | **7.67** (fastest other: @screeny05/ts-money 8.00; dinero.js 2 247) | 10.3 (fastest other: **currency.js 7.16**; dinero.js 2 332) | **7.30** (fastest other: @screeny05/ts-money 7.79; dinero.js 2 205) |

Measured on 2026-11-07 on one AMD EPYC Genoa vCPU with Node 22.11, Bun 1.4.4 and Deno 2.9.8, using an earlier ducat build from before the module split; numbers for the current code need a new clean-machine run (compare/runner). Lower is better; the faster of ducat and the fastest other money library is in bold.
