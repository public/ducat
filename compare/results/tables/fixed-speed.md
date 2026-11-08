**node 24.22.2 (V8 13.6.233.17-node.63)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 123 | 9.99 | 80.3 | 68.3 | 7.08 | 30.5 |
| dnum 2.18.1 | 323 | 25.1 | 292 | 251 | 21.4 | 264 |
| ethers FixedNumber 6.17.0 | 2.2 µs | 1.6 µs | 5.7 µs | 5.5 µs | 9.19 | 4.92 |
| js-big-decimal 2.2.0 | 60.9 | 1.9 µs | 1.5 µs | 36.3 µs | 658 | 4.83 |
| bigdecimal.js 1.7.2 | 45.7 | 15.1 | 75.6 | 56.9 | 9.09 | 39.9 |
| @formatjs/bigdecimal 0.2.10 | 122 | 33.7 | n/a | n/a | 22.7 | 51.1 |
| bigint-money 2.0.1 | 542 | 47.8 | 3.0 µs | 2.6 µs | 14.1 | 481 |
| ducat Fixed | not measured¹ | not measured¹ | not measured¹ | not measured¹ | not measured¹ | not measured¹ |

**bun 1.4.4** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 94.8 | 10.7 | 75.3 | 148 | 7.06 | 57.7 |
| dnum 2.18.1 | 361 | 43.3 | 488 | 330 | 33.4 | 555 |
| ethers FixedNumber 6.17.0 | 2.4 µs | 1.7 µs | 5.7 µs | 5.6 µs | 9.82 | 2.72 |
| js-big-decimal 2.2.0 | 38.5 | 2.1 µs | 2.2 µs | 51.8 µs | 700 | 1.30 |
| bigdecimal.js 1.7.2 | 30.6 | 15.2 | 61.1 | 34.8 | 8.72 | 95.2 |
| @formatjs/bigdecimal 0.2.10 | 215 | 53.9 | n/a | n/a | 20.4 | 128 |
| bigint-money 2.0.1 | 360 | 51.4 | 2.5 µs | 2.3 µs | 19.8 | 390 |
| ducat Fixed | not measured¹ | not measured¹ | not measured¹ | not measured¹ | not measured¹ | not measured¹ |

**deno 2.9.8 (V8 15.0.245.2-rusty)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 132 | 9.39 | 87.5 | 65.3 | 6.78 | 30.5 |
| dnum 2.18.1 | 357 | 25.0 | 297 | 227 | 21.4 | 289 |
| ethers FixedNumber 6.17.0 | 2.4 µs | 1.8 µs | 5.8 µs | 5.6 µs | 8.94 | 4.91 |
| js-big-decimal 2.2.0 | 59.9 | 1.7 µs | 1.4 µs | 19.0 µs | 550 | 4.60 |
| bigdecimal.js 1.7.2 | 37.0 | 13.4 | 59.5 | 47.0 | 8.00 | 34.9 |
| @formatjs/bigdecimal 0.2.10 | 121 | 25.3 | n/a | n/a | 20.4 | 54.6 |
| bigint-money 2.0.1 | 480 | 52.1 | 2.1 µs | 1.9 µs | 12.9 | 306 |
| ducat Fixed | not measured¹ | not measured¹ | not measured¹ | not measured¹ | not measured¹ | not measured¹ |

¹ Added to the benchmark after this run; the next clean-machine run of compare/runner measures it.
