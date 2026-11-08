| ns/op | node 24.22.2 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **9.29** (fastest other: dinero.js 2 14.5) | **9.22** (fastest other: monetra 24.4; dinero.js 2 35.6) | **8.42** (fastest other: monetra 26.4; dinero.js 2 86.6) |
| parse | **30.9** (fastest other: dinero.js 2 62.1) | **34.8** (fastest other: dinero.js 2 bigint 135; dinero.js 2 150) | **29.3** (fastest other: dinero.js 2 134) |
| add | **11.5** (fastest other: monetra 14.6; dinero.js 2 200) | **11.1** (fastest other: monetra 19.6; dinero.js 2 308) | **9.44** (fastest other: monetra 12.3; dinero.js 2 321) |
| mulRatio | **24.0** (fastest other: @screeny05/ts-money 151; dinero.js 2 497) | **29.0** (fastest other: @screeny05/ts-money 68.0; dinero.js 2 757) | **20.8** (fastest other: @screeny05/ts-money 155; dinero.js 2 1.1 µs) |
| allocate3 | **48.6** (fastest other: bigint-money 457; dinero.js 2 1.3 µs) | **65.4** (fastest other: @screeny05/ts-money 274; dinero.js 2 1.6 µs) | **41.3** (fastest other: bigint-money 270; dinero.js 2 2.0 µs) |
| toDecimal | **34.7** (fastest other: ts-money 58.6; dinero.js 2 429) | **55.5** (fastest other: ts-money 74.3; dinero.js 2 580) | **30.6** (fastest other: @screeny05/ts-money 63.5; dinero.js 2 370) |
| format | 413 (fastest other: **currency.js 379**; dinero.js 2 1.1 µs) | **268** (fastest other: currency.js 274; dinero.js 2 1.2 µs) | 398 (fastest other: **currency.js 386**; dinero.js 2 1.0 µs) |
| compare | **7.49** (fastest other: ts-money 8.06; dinero.js 2 202) | 10.3 (fastest other: **currency.js 6.68**; dinero.js 2 324) | **6.88** (fastest other: @screeny05/ts-money 7.49; dinero.js 2 171) |

Measured on 2026-11-08 on one-vCPU AMD EPYC Genoa machines (Node 24.22.2 and Bun 1.4.4 on one, Deno 2.9.8 on a second of the same plan), on the ducat 0.2.0 release candidate (commit ea9160b). Lower is better; the faster of ducat and the fastest other money library is in bold.
