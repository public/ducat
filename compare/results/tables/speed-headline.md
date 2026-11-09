| ns/op | node 24.22.2 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **8.68** (fastest other: dinero.js 2 13.7) | **11.6** (fastest other: monetra 20.0; dinero.js 2 30.7) | **7.32** (fastest other: monetra 26.5; dinero.js 2 89.1) |
| parse | **29.7** (fastest other: dinero.js 2 63.2) | **31.7** (fastest other: dinero.js 2 bigint 123; dinero.js 2 137) | **27.4** (fastest other: dinero.js 2 146) |
| add | **10.7** (fastest other: monetra 13.9; dinero.js 2 189) | **12.2** (fastest other: monetra 19.1; dinero.js 2 296) | **9.74** (fastest other: monetra 12.9; dinero.js 2 335) |
| mulRatio | **24.1** (fastest other: @screeny05/ts-money 143; dinero.js 2 459) | **28.3** (fastest other: @screeny05/ts-money 57.0; dinero.js 2 741) | **21.3** (fastest other: @screeny05/ts-money 159; dinero.js 2 1.1 µs) |
| allocate3 | **46.7** (fastest other: bigint-money 419; dinero.js 2 1.1 µs) | **60.1** (fastest other: @screeny05/ts-money 265; dinero.js 2 1.6 µs) | **43.4** (fastest other: bigint-money 265; dinero.js 2 2.0 µs) |
| toDecimal | **33.7** (fastest other: @screeny05/ts-money 57.6; dinero.js 2 435) | **49.9** (fastest other: ts-money 70.9; dinero.js 2 559) | **33.1** (fastest other: ts-money 63.4; dinero.js 2 367) |
| format | 375 (fastest other: **currency.js 371**; dinero.js 2 1.1 µs) | **266** (fastest other: currency.js 267; dinero.js 2 1.2 µs) | 411 (fastest other: **currency.js 389**; dinero.js 2 1.0 µs) |
| compare | **7.05** (fastest other: currency.js 7.46; dinero.js 2 194) | 9.90 (fastest other: **currency.js 6.50**; dinero.js 2 307) | **6.99** (fastest other: @screeny05/ts-money 7.39; dinero.js 2 174) |

Measured on 2026-11-09 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, on ducat at commit 01753e5 (the 0.3.0 release candidate). Lower is better; the faster of ducat and the fastest other money library is in bold.
