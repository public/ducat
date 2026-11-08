| ns/op | node 24.22.2 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **8.81** (fastest other: dinero.js 2 14.9) | **11.7** (fastest other: monetra 24.0; dinero.js 2 30.2) | **8.48** (fastest other: dinero.js 2 12.0) |
| parse | **29.9** (fastest other: dinero.js 2 63.9) | **30.0** (fastest other: dinero.js 2 bigint 127; dinero.js 2 136) | **30.3** (fastest other: dinero.js 2 57.1) |
| add | **10.5** (fastest other: monetra 13.7; dinero.js 2 199) | **12.1** (fastest other: monetra 19.9; dinero.js 2 299) | **9.68** (fastest other: monetra 12.9; dinero.js 2 182) |
| mulRatio | **22.5** (fastest other: @screeny05/ts-money 144; dinero.js 2 493) | **26.3** (fastest other: @screeny05/ts-money 65.8; dinero.js 2 739) | **19.8** (fastest other: @screeny05/ts-money 154; dinero.js 2 436) |
| allocate3 | **45.9** (fastest other: bigint-money 437; dinero.js 2 1.1 µs) | **61.4** (fastest other: @screeny05/ts-money 278; dinero.js 2 1.7 µs) | **42.5** (fastest other: bigint-money 259; dinero.js 2 1.0 µs) |
| toDecimal | **34.7** (fastest other: @screeny05/ts-money 56.2; dinero.js 2 446) | **50.0** (fastest other: ts-money 70.5; dinero.js 2 578) | **34.2** (fastest other: @screeny05/ts-money 62.5; dinero.js 2 370) |
| format | **380** (fastest other: currency.js 381; dinero.js 2 1.1 µs) | 268 (fastest other: **currency.js 260**; dinero.js 2 1.1 µs) | 399 (fastest other: **currency.js 389**; dinero.js 2 1.1 µs) |
| compare | **7.31** (fastest other: ts-money 7.65; dinero.js 2 196) | 9.80 (fastest other: **currency.js 6.43**; dinero.js 2 293) | **6.92** (fastest other: @screeny05/ts-money 7.39; dinero.js 2 182) |

Measured on 2026-11-08 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, on ducat 0.2.0 (commit 7c9455a). Lower is better; the faster of ducat and the fastest other money library is in bold.
