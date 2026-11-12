| ns/op | node 24.22.2 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **9.39** (fastest other: dinero.js 2 14.8) | **9.48** (fastest other: monetra 22.8; dinero.js 2 34.3) | **7.93** (fastest other: monetra 28.9; dinero.js 2 108) |
| parse | **36.0** (fastest other: dinero.js 2 70.8) | **31.8** (fastest other: @screeny05/ts-money 167; dinero.js 2 181) | **30.1** (fastest other: dinero.js 2 157) |
| add | **11.6** (fastest other: monetra 15.0; dinero.js 2 195) | **13.2** (fastest other: monetra 20.4; dinero.js 2 310) | **11.1** (fastest other: monetra 13.8; dinero.js 2 425) |
| mulRatio | **24.5** (fastest other: @screeny05/ts-money 159; dinero.js 2 492) | **32.6** (fastest other: @screeny05/ts-money 41.7; dinero.js 2 815) | **23.0** (fastest other: @screeny05/ts-money 167; dinero.js 2 1.2 µs) |
| allocate3 | **50.7** (fastest other: bigint-money 439; dinero.js 2 1.2 µs) | **63.1** (fastest other: @screeny05/ts-money 202; dinero.js 2 1.6 µs) | **47.3** (fastest other: bigint-money 284; dinero.js 2 2.2 µs) |
| toDecimal | **35.6** (fastest other: @screeny05/ts-money 62.1; dinero.js 2 442) | **74.7** (fastest other: js-money 75.3; dinero.js 2 582) | **35.2** (fastest other: @screeny05/ts-money 67.5; dinero.js 2 404) |
| format | 428 (fastest other: **currency.js 396**; dinero.js 2 1.1 µs) | 286 (fastest other: **currency.js 286**; dinero.js 2 1.2 µs) | 439 (fastest other: **currency.js 425**; dinero.js 2 1.1 µs) |
| compare | 7.94 (fastest other: **ts-money 7.84**; dinero.js 2 203) | 7.60 (fastest other: **currency.js 6.48**; dinero.js 2 312) | **7.44** (fastest other: currency.js 8.13; dinero.js 2 187) |

Measured on 2026-11-12 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, on ducat at commit f7ff47c (the 0.4.0 release candidate). Lower is better; the faster of ducat and the fastest other money library is in bold.
