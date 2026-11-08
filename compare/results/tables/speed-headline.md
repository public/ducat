| ns/op | node 24.22.2 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **9.60** (fastest other: dinero.js 2 15.2) | **8.82** (fastest other: monetra 25.0; dinero.js 2 35.1) | **9.43** (fastest other: dinero.js 2 13.7) |
| parse | **30.9** (fastest other: dinero.js 2 68.5) | **37.4** (fastest other: dinero.js 2 bigint 152; dinero.js 2 161) | **33.2** (fastest other: dinero.js 2 64.9) |
| add | **11.3** (fastest other: monetra 15.6; dinero.js 2 204) | **13.4** (fastest other: monetra 20.3; dinero.js 2 334) | **10.8** (fastest other: monetra 14.8; dinero.js 2 205) |
| mulRatio | **24.4** (fastest other: @screeny05/ts-money 157; dinero.js 2 505) | **23.2** (fastest other: ts-money 84.0; dinero.js 2 826) | **21.7** (fastest other: @screeny05/ts-money 174; dinero.js 2 496) |
| allocate3 | **53.3** (fastest other: bigint-money 465; dinero.js 2 1.2 µs) | **63.8** (fastest other: @screeny05/ts-money 303; dinero.js 2 1.6 µs) | **48.1** (fastest other: bigint-money 277; dinero.js 2 1.1 µs) |
| toDecimal | **36.2** (fastest other: @screeny05/ts-money 61.9; dinero.js 2 449) | **61.8** (fastest other: ts-money 78.0; dinero.js 2 582) | **36.8** (fastest other: ts-money 67.7; dinero.js 2 397) |
| format | 413 (fastest other: **currency.js 404**; dinero.js 2 1.2 µs) | 291 (fastest other: **currency.js 282**; dinero.js 2 1.3 µs) | 451 (fastest other: **currency.js 435**; dinero.js 2 1.2 µs) |
| compare | **7.63** (fastest other: ts-money 8.23; dinero.js 2 204) | 8.57 (fastest other: **currency.js 6.98**; dinero.js 2 347) | **7.26** (fastest other: @screeny05/ts-money 7.97; dinero.js 2 208) |

Measured on 2026-11-08 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, on ducat 0.2.2 (commit cae9189). Lower is better; the faster of ducat and the fastest other money library is in bold.
