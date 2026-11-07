| ns/op | node 24.22.2 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **10.3** (fastest other: dinero.js 2 18.2) | **9.11** (fastest other: monetra 29.4; dinero.js 2 37.7) | **9.62** (fastest other: dinero.js 2 14.0) |
| parse | **34.8** (fastest other: dinero.js 2 77.7) | **37.7** (fastest other: dinero.js 2 bigint 147; dinero.js 2 183) | **34.1** (fastest other: dinero.js 2 67.1) |
| add | **12.4** (fastest other: monetra 15.9; dinero.js 2 223) | **14.2** (fastest other: monetra 21.1; dinero.js 2 363) | **10.7** (fastest other: monetra 14.7; dinero.js 2 216) |
| mulRatio | **23.7** (fastest other: @screeny05/ts-money 168; dinero.js 2 508) | **30.6** (fastest other: js-money 85.0; dinero.js 2 880) | **23.3** (fastest other: monetra 176; dinero.js 2 489) |
| allocate3 | **53.7** (fastest other: bigint-money 490; dinero.js 2 1.2 µs) | **69.4** (fastest other: @screeny05/ts-money 313; dinero.js 2 1.9 µs) | **47.0** (fastest other: bigint-money 297; dinero.js 2 1.2 µs) |
| toDecimal | **35.7** (fastest other: ts-money 64.7; dinero.js 2 475) | 88.1 (fastest other: **@screeny05/ts-money 81.7**; dinero.js 2 694) | **37.2** (fastest other: @screeny05/ts-money 72.0; dinero.js 2 432) |
| format | 437 (fastest other: **currency.js 405**; dinero.js 2 1.2 µs) | 304 (fastest other: **currency.js 293**; dinero.js 2 1.5 µs) | **459** (fastest other: currency.js 462; dinero.js 2 1.2 µs) |
| compare | **8.10** (fastest other: currency.js 8.38; dinero.js 2 215) | 11.5 (fastest other: **currency.js 7.41**; dinero.js 2 328) | **7.54** (fastest other: @screeny05/ts-money 8.36; dinero.js 2 210) |

Measured on 2026-11-07 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, on the ducat 0.1.0 release candidate. Lower is better; the faster of ducat and the fastest other money library is in bold.
