**node 24.22.2 (V8 13.6.233.17-node.63)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 137 | 10.9 | 88.0 | 27.6 | 7.44 | 32.5 |
| ducat Fixed | 31.9 | 14.1 | 30.5 | 30.8 | 8.02 | 33.3 |
| dnum 2.18.1 | 354 | 29.1 | 308 | 258 | 22.8 | 283 |
| ethers FixedNumber 6.17.0 | 2.7 µs | 1.7 µs | 6.0 µs | 5.7 µs | 9.55 | 5.22 |
| js-big-decimal 2.2.0 | 63.2 | 1.8 µs | 1.6 µs | 40.0 µs | 691 | 4.87 |
| bigdecimal.js 1.7.2 | 51.3 | 17.5 | 78.7 | 62.6 | 9.79 | 42.0 |
| @formatjs/bigdecimal 0.2.10 | 137 | 35.5 | n/a | n/a | 24.6 | 55.7 |
| bigint-money 2.0.1 | 582 | 50.5 | 3.3 µs | 2.9 µs | 15.3 | 505 |

**bun 1.4.4** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 98.3 | 9.52 | 73.3 | 26.9 | 8.79 | 86.7 |
| ducat Fixed | 31.4 | 12.5 | 31.8 | 29.2 | 6.00 | 79.0 |
| dnum 2.18.1 | 376 | 44.6 | 536 | 340 | 33.8 | 547 |
| ethers FixedNumber 6.17.0 | 2.3 µs | 1.6 µs | 6.0 µs | 5.8 µs | 9.80 | 5.05 |
| js-big-decimal 2.2.0 | 41.4 | 2.5 µs | 2.4 µs | 51.3 µs | 669 | 4.64 |
| bigdecimal.js 1.7.2 | 35.2 | 15.3 | 58.9 | 36.8 | 8.60 | 109 |
| @formatjs/bigdecimal 0.2.10 | 244 | 52.7 | n/a | n/a | 19.4 | 147 |
| bigint-money 2.0.1 | 356 | 53.6 | 2.6 µs | 2.5 µs | 20.3 | 475 |

**deno 2.9.8 (V8 15.0.245.2-rusty)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 143 | 9.91 | 87.7 | 29.3 | 7.13 | 32.1 |
| ducat Fixed | 29.9 | 11.5 | 25.4 | 26.3 | 7.57 | 33.7 |
| dnum 2.18.1 | 392 | 26.1 | 314 | 222 | 22.9 | 297 |
| ethers FixedNumber 6.17.0 | 2.6 µs | 1.8 µs | 6.4 µs | 6.3 µs | 9.71 | 5.28 |
| js-big-decimal 2.2.0 | 60.8 | 1.7 µs | 1.6 µs | 19.9 µs | 644 | 4.88 |
| bigdecimal.js 1.7.2 | 36.7 | 14.9 | 62.3 | 50.7 | 8.46 | 37.0 |
| @formatjs/bigdecimal 0.2.10 | 124 | 27.1 | n/a | n/a | 22.2 | 53.8 |
| bigint-money 2.0.1 | 481 | 55.4 | 2.3 µs | 2.0 µs | 13.5 | 329 |
