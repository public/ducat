| ns/op | node 24.22.2 | bun 1.4.4 | deno 2.9.8 |
|---|--:|--:|--:|
| fromMinor | **8.86** (fastest other: dinero.js 2 14.0) | **7.21** (fastest other: monetra 21.5; dinero.js 2 30.0) | **8.29** (fastest other: dinero.js 2 11.7) |
| parse | **29.6** (fastest other: dinero.js 2 60.3) | **29.6** (fastest other: dinero.js 2 bigint 126; dinero.js 2 131) | **29.2** (fastest other: dinero.js 2 57.1) |
| add | **10.4** (fastest other: monetra 13.5; dinero.js 2 183) | **10.5** (fastest other: monetra 18.4; dinero.js 2 302) | **9.36** (fastest other: monetra 12.4; dinero.js 2 179) |
| mulRatio | **23.7** (fastest other: @screeny05/ts-money 145; dinero.js 2 470) | **27.9** (fastest other: js-money 77.0; dinero.js 2 726) | **20.5** (fastest other: monetra 152; dinero.js 2 434) |
| allocate3 | **47.7** (fastest other: bigint-money 409; dinero.js 2 1.1 µs) | **63.7** (fastest other: @screeny05/ts-money 261; dinero.js 2 1.6 µs) | **41.2** (fastest other: bigint-money 255; dinero.js 2 1.1 µs) |
| toDecimal | **32.6** (fastest other: @screeny05/ts-money 56.4; dinero.js 2 393) | **47.1** (fastest other: @screeny05/ts-money 72.5; dinero.js 2 547) | **31.4** (fastest other: @screeny05/ts-money 62.6; dinero.js 2 366) |
| format | 376 (fastest other: **currency.js 364**; dinero.js 2 1.1 µs) | 265 (fastest other: **currency.js 253**; dinero.js 2 1.1 µs) | 400 (fastest other: **currency.js 387**; dinero.js 2 1.0 µs) |
| compare | **7.07** (fastest other: currency.js 7.60; dinero.js 2 182) | 7.90 (fastest other: **currency.js 6.51**; dinero.js 2 283) | **6.70** (fastest other: @screeny05/ts-money 7.26; dinero.js 2 176) |

Measured on 2026-11-08 on one AMD EPYC Genoa vCPU with Node 24.22.2, Bun 1.4.4 and Deno 2.9.8, on unreleased ducat at commit f927311 (the 0.3 line). Lower is better; the faster of ducat and the fastest other money library is in bold.
