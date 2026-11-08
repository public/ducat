**node 24.22.2 (V8 13.6.233.17-node.63)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 133 | 10.2 | 78.3 | 29.9 | 7.14 | 31.1 |
| ducat Fixed | 32.0 | 11.5 | 30.1 | 72.3 | 7.71 | 30.9 |
| dnum 2.18.1 | 339 | 26.0 | 297 | 253 | 21.5 | 273 |
| ethers FixedNumber 6.17.0 | 2.3 µs | 1.7 µs | 5.8 µs | 5.5 µs | 9.15 | 5.10 |
| js-big-decimal 2.2.0 | 63.3 | 1.8 µs | 1.6 µs | 37.7 µs | 671 | 4.90 |
| bigdecimal.js 1.7.2 | 46.3 | 15.6 | 77.8 | 59.7 | 10.0 | 40.2 |
| @formatjs/bigdecimal 0.2.10 | 122 | 33.5 | n/a | n/a | 24.4 | 52.6 |
| bigint-money 2.0.1 | 545 | 46.7 | 3.0 µs | 2.8 µs | 14.3 | 508 |

**bun 1.4.4** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 96.4 | 12.3 | 71.2 | 27.2 | 7.34 | 73.7 |
| ducat Fixed | 29.8 | 13.4 | 34.9 | 154 | 6.45 | 80.9 |
| dnum 2.18.1 | 380 | 43.2 | 491 | 307 | 33.0 | 554 |
| ethers FixedNumber 6.17.0 | 2.3 µs | 1.7 µs | 7.2 µs | 5.6 µs | 9.43 | 4.83 |
| js-big-decimal 2.2.0 | 37.7 | 2.2 µs | 2.1 µs | 54.3 µs | 713 | 4.65 |
| bigdecimal.js 1.7.2 | 32.9 | 13.3 | 58.5 | 38.9 | 8.81 | 100 |
| @formatjs/bigdecimal 0.2.10 | 242 | 56.3 | n/a | n/a | 20.1 | 134 |
| bigint-money 2.0.1 | 350 | 49.8 | 2.6 µs | 2.5 µs | 20.3 | 438 |

**deno 2.9.8 (V8 15.0.245.2-rusty)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 127 | 8.75 | 82.6 | 25.3 | 6.63 | 31.1 |
| ducat Fixed | 28.4 | 9.88 | 23.6 | 61.6 | 6.86 | 30.9 |
| dnum 2.18.1 | 328 | 23.1 | 289 | 219 | 19.1 | 266 |
| ethers FixedNumber 6.17.0 | 2.4 µs | 1.6 µs | 5.8 µs | 5.6 µs | 8.72 | 4.93 |
| js-big-decimal 2.2.0 | 56.8 | 1.6 µs | 1.4 µs | 19.2 µs | 568 | 4.59 |
| bigdecimal.js 1.7.2 | 35.1 | 12.8 | 58.2 | 46.4 | 7.74 | 33.2 |
| @formatjs/bigdecimal 0.2.10 | 115 | 27.0 | n/a | n/a | 20.2 | 48.8 |
| bigint-money 2.0.1 | 467 | 26.8 | 2.1 µs | 1.9 µs | 18.3 | 306 |
