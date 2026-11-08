| ns/op | node 24.22.2 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **9.06** (fastest other: dinero.js 2 14.5) | **9.25** (fastest other: monetra 23.6; dinero.js 2 33.9) | **8.48** (fastest other: monetra 27.8; dinero.js 2 93.1) |
| parse | **31.3** (fastest other: dinero.js 2 62.2) | **35.6** (fastest other: dinero.js 2 bigint 139; dinero.js 2 152) | **30.3** (fastest other: dinero.js 2 167) |
| add | **11.9** (fastest other: monetra 14.6; dinero.js 2 187) | **10.4** (fastest other: monetra 19.9; dinero.js 2 313) | **9.92** (fastest other: monetra 13.6; dinero.js 2 398) |
| mulRatio | **23.4** (fastest other: @screeny05/ts-money 148; dinero.js 2 470) | **27.8** (fastest other: @screeny05/ts-money 64.3; dinero.js 2 767) | **19.8** (fastest other: @screeny05/ts-money 162; dinero.js 2 1.2 µs) |
| allocate3 | **47.8** (fastest other: bigint-money 415; dinero.js 2 1.2 µs) | **65.5** (fastest other: @screeny05/ts-money 268; dinero.js 2 1.6 µs) | **42.4** (fastest other: bigint-money 271; dinero.js 2 2.0 µs) |
| toDecimal | **34.6** (fastest other: @screeny05/ts-money 58.4; dinero.js 2 426) | **50.0** (fastest other: js-money 76.8; dinero.js 2 570) | **32.6** (fastest other: ts-money 64.3; dinero.js 2 380) |
| format | 411 (fastest other: **currency.js 380**; dinero.js 2 1.1 µs) | **269** (fastest other: dinero.js 1 272; dinero.js 2 1.2 µs) | 401 (fastest other: **currency.js 393**; dinero.js 2 1.1 µs) |
| compare | **7.39** (fastest other: ts-money 7.91; dinero.js 2 190) | 10.6 (fastest other: **currency.js 6.93**; dinero.js 2 303) | **6.90** (fastest other: @screeny05/ts-money 7.53; dinero.js 2 181) |

Measured on 2026-11-08 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, on ducat 0.1.1 (commit 69d7fe9). Lower is better; the faster of ducat and the fastest other money library is in bold.
