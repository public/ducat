# Benchmark results

**Indicative only.** Machine: 4 vCPU Intel Core Processor (Broadwell, no TSX, IBRS) (shared, noisy VPS). Each figure is the median of 5 short samples after a short warm-up; run-to-run variation on this box is often ±20-30% and occasionally 2x, so compare orders of magnitude and relative positions, not exact numbers. Generated 2026-11-07 by `npm run bench`.

## Library comparison

### node 22.11.0 (V8 12.4.254.21-node.21)

| ns/op (lower is better) | this lib | dinero.js 2 | currency.js | big.js | decimal.js | Prisma.Decimal | ts-money |
|---|---:|---:|---:|---:|---:|---:|---:|
| fromMinor | 17.0 | 108 | 439 | 2022 | 1469 | 1508 | 1399 |
| parse | 106 | 442 | 1998 | 451 | 964 | 1166 | 2519 |
| add | 21.3 | 2275 | 641 | 314 | 561 | 768 | 866 |
| mulRatio | 74.3 | 3533 | 686 | 981 | 4366 | 3164 | 1059 |
| allocate3 | 156 | 10949 | 2579 | 29831 | 17762 | 24186 | 5687 |
| toDecimal | 74.8 | 4548 | 328 | 531 | 1462 | 1676 | 240 |
| format | 1531 | 3115 | 940 | 3496 | 3913 | 3760 | 2487 |
| compare | 7.18 | 1606 | 19.3 | 150 | 402 | 207 | 33.6 |


### deno 2.9.8 (V8 15.0.245.2-rusty)

| ns/op (lower is better) | this lib | dinero.js 2 | currency.js | big.js | decimal.js | Prisma.Decimal | ts-money |
|---|---:|---:|---:|---:|---:|---:|---:|
| fromMinor | 14.8 | 78.2 | 783 | 2464 | 622 | 583 | 736 |
| parse | 63.0 | 217 | 3612 | 848 | 710 | 730 | 1640 |
| add | 12.8 | 1031 | 742 | 629 | 356 | 316 | 647 |
| mulRatio | 64.3 | 1656 | 1158 | 1664 | 3131 | 2127 | 1397 |
| allocate3 | 125 | 4839 | 3462 | 28904 | 8578 | 10976 | 3136 |
| toDecimal | 139 | 2661 | 227 | 466 | 750 | 983 | 183 |
| format | 1558 | 4792 | 1710 | 2611 | 1819 | 2813 | 1614 |
| compare | 7.61 | 1719 | 17.9 | 182 | 154 | 208 | 23.4 |


### bun 1.4.4 (JSC)

| ns/op (lower is better) | this lib | dinero.js 2 | currency.js | big.js | decimal.js | Prisma.Decimal | ts-money |
|---|---:|---:|---:|---:|---:|---:|---:|
| fromMinor | 0.79 | 1.73 | 574 | 1545 | 1541 | 1717 | 299 |
| parse | 134 | 504 | 1939 | 624 | 1307 | 1145 | 872 |
| add | 19.0 | 4537 | 780 | 365 | 247 | 367 | 433 |
| mulRatio | 60.4 | 3190 | 814 | 974 | 2373 | 1591 | 341 |
| allocate3 | 230 | 9026 | 3529 | 13609 | 14995 | 17311 | 1805 |
| toDecimal | 111 | 2563 | 277 | 425 | 1041 | 1241 | 239 |
| format | 784 | 7391 | 710 | 1532 | 3133 | 1825 | 1076 |
| compare | 6.72 | 2536 | 4.93 | 93.0 | 162 | 92.0 | 46.8 |


### SpiderMonkey shell (jsvu)

| ns/op (lower is better) | this lib | dinero.js 2 | currency.js | big.js | decimal.js | Prisma.Decimal | ts-money |
|---|---:|---:|---:|---:|---:|---:|---:|
| fromMinor | 78.6 | 117 | 529 | 2427 | 472 | 615 | 437 |
| parse | 116 | 310 | 2620 | 428 | 730 | 585 | 975 |
| add | 46.2 | 1230 | 1078 | 419 | 284 | 304 | 422 |
| mulRatio | 116 | 1804 | 1413 | 1237 | 1706 | 1336 | 470 |
| allocate3 | 471 | 3608 | 4507 | 21748 | 7685 | 8111 | 1664 |
| toDecimal | 87.8 | 1394 | 268 | 341 | 610 | 477 | 137 |
| format | 684 | 2086 | 1125 | 1025 | 1533 | 1229 | 846 |
| compare | 21.1 | 1064 | 21.1 | 180 | 134 | 133 | 45.4 |


### JavaScriptCore shell (jsvu)

| ns/op (lower is better) | this lib | dinero.js 2 | currency.js | big.js | decimal.js | Prisma.Decimal | ts-money |
|---|---:|---:|---:|---:|---:|---:|---:|
| fromMinor | 0.73 | 1.04 | 476 | 2550 | 1080 | 1085 | 365 |
| parse | 70.3 | 515 | 2195 | 595 | 1467 | 1065 | 892 |
| add | 15.7 | 3353 | 723 | 318 | 303 | 176 | 471 |
| mulRatio | 55.9 | 3350 | 743 | 974 | 1630 | 1560 | 463 |
| allocate3 | 141 | 6320 | 2920 | 26220 | 13600 | 13700 | 1795 |
| toDecimal | 135 | 3630 | 274 | 381 | 758 | 884 | 316 |
| format | 991 | 4600 | 886 | 1785 | 2110 | 2240 | 1455 |
| compare | 6.27 | 1191 | 4.67 | 131 | 103 | 77.0 | 41.7 |


## Representation choice

### node 22.11.0 (V8 12.4.254.21-node.21) — ns/op, lower is better

| op | A:number+bigint | A+freeze | B:bigint | C:string | A:bigint-path |
|---|---:|---:|---:|---:|---:|
| construct | 14.4 | 105.4 | 24.3 | 11.2 |  |
| add | 34.2 | 173.2 | 24.9 | 806.5 | 66.2 |
| mulRatio | 37.2 | 145.2 | 49.6 | 443.8 | 314.8 |
| allocate3 | 90.9 | 788.4 | 300.5 | 1122.0 |  |
| format | 90.1 | 106.3 | 286.0 | 2.0 |  |
| parse | 128.8 | 342.0 | 344.1 | 12.3 |  |
| compare | 3.8 | 10.9 | 10.1 | 396.7 |  |

### deno 2.9.8 (V8 15.0.245.2-rusty) — ns/op, lower is better

| op | A:number+bigint | A+freeze | B:bigint | C:string | A:bigint-path |
|---|---:|---:|---:|---:|---:|
| construct | 16.5 | 121.0 | 24.7 | 11.6 |  |
| add | 12.4 | 123.9 | 31.2 | 838.3 | 72.6 |
| mulRatio | 22.8 | 245.7 | 48.7 | 415.2 | 361.9 |
| allocate3 | 109.0 | 583.8 | 287.5 | 1130.8 |  |
| format | 85.5 | 89.0 | 186.4 | 1.4 |  |
| parse | 142.5 | 257.5 | 202.2 | 11.1 |  |
| compare | 3.3 | 5.3 | 9.5 | 735.2 |  |

### bun 1.4.4 (JSC) — ns/op, lower is better

| op | A:number+bigint | A+freeze | B:bigint | C:string | A:bigint-path |
|---|---:|---:|---:|---:|---:|
| construct | 0.8 | 59.8 | 47.0 | 0.8 |  |
| add | 23.9 | 73.2 | 58.6 | 1107.6 | 78.3 |
| mulRatio | 18.9 | 123.6 | 262.1 | 1506.5 | 573.1 |
| allocate3 | 173.0 | 528.1 | 698.7 | 4100.0 |  |
| format | 165.7 | 327.0 | 280.3 | 1.4 |  |
| parse | 385.9 | 509.0 | 287.1 | 0.7 |  |
| compare | 7.3 | 3.7 | 9.8 | 589.3 |  |

### SpiderMonkey shell (jsvu) — ns/op, lower is better

| op | A:number+bigint | A+freeze | B:bigint | C:string | A:bigint-path |
|---|---:|---:|---:|---:|---:|
| construct | 32.3 | 313.1 | 35.4 | 24.2 |  |
| add | 57.4 | 265.0 | 46.5 | 600.3 | 128.4 |
| mulRatio | 70.1 | 292.0 | 83.8 | 574.2 | 330.6 |
| allocate3 | 329.5 | 1271.4 | 390.8 | 1299.5 |  |
| format | 89.3 | 86.6 | 129.2 | 1.7 |  |
| parse | 191.7 | 387.5 | 224.7 | 25.4 |  |
| compare | 7.0 | 4.8 | 10.8 | 472.4 |  |

### JavaScriptCore shell (jsvu) — ns/op, lower is better

| op | A:number+bigint | A+freeze | B:bigint | C:string | A:bigint-path |
|---|---:|---:|---:|---:|---:|
| construct | 1.1 | 97.3 | 28.5 | 0.9 |  |
| add | 16.4 | 66.8 | 38.0 | 1275.0 | 89.7 |
| mulRatio | 15.6 | 115.3 | 223.1 | 1085.0 | 325.6 |
| allocate3 | 115.9 | 330.0 | 473.7 | 2250.0 |  |
| format | 345.0 | 233.8 | 494.4 | 1.4 |  |
| parse | 480.0 | 490.0 | 338.8 | 0.7 |  |
| compare | 8.0 | 3.9 | 13.0 | 1033.7 |  |

