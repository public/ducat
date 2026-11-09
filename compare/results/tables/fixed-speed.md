**node 24.22.2 (V8 13.6.233.17-node.63)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 123 | 9.98 | 79.4 | 26.2 | 7.01 | 30.3 |
| ducat Fixed | 29.6 | 10.9 | 26.6 | 28.0 | 7.43 | 29.7 |
| dnum 2.18.1 | 340 | 23.7 | 313 | 253 | 20.0 | 267 |
| ethers FixedNumber 6.17.0 | 2.2 µs | 1.6 µs | 5.5 µs | 5.3 µs | 8.99 | 5.00 |
| js-big-decimal 2.2.0 | 58.9 | 1.7 µs | 1.5 µs | 34.8 µs | 653 | 4.56 |
| bigdecimal.js 1.7.2 | 44.9 | 15.2 | 72.4 | 56.8 | 8.92 | 39.2 |
| @formatjs/bigdecimal 0.2.10 | 120 | 32.8 | n/a | n/a | 22.1 | 48.2 |
| bigint-money 2.0.1 | 532 | 46.4 | 2.8 µs | 2.6 µs | 13.6 | 472 |

**bun 1.4.4** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 91.1 | 11.5 | 53.0 | 25.3 | 8.53 | 60.7 |
| ducat Fixed | 26.9 | 12.3 | 31.0 | 28.2 | 5.75 | 56.1 |
| dnum 2.18.1 | 361 | 41.6 | 444 | 324 | 32.5 | 491 |
| ethers FixedNumber 6.17.0 | 2.1 µs | 1.6 µs | 5.7 µs | 5.0 µs | 9.24 | 4.81 |
| js-big-decimal 2.2.0 | 34.9 | 1.8 µs | 2.0 µs | 47.0 µs | 576 | 4.39 |
| bigdecimal.js 1.7.2 | 30.7 | 11.9 | 49.8 | 34.9 | 8.30 | 89.3 |
| @formatjs/bigdecimal 0.2.10 | 200 | 47.2 | n/a | n/a | 18.7 | 94.1 |
| bigint-money 2.0.1 | 349 | 46.6 | 2.4 µs | 2.3 µs | 19.3 | 405 |

**deno 2.9.8 (V8 15.0.245.2-rusty)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 134 | 8.85 | 79.3 | 22.5 | 6.58 | 31.1 |
| ducat Fixed | 29.0 | 10.2 | 23.9 | 24.5 | 6.95 | 30.7 |
| dnum 2.18.1 | 359 | 26.9 | 294 | 224 | 20.1 | 282 |
| ethers FixedNumber 6.17.0 | 2.4 µs | 1.7 µs | 6.0 µs | 5.7 µs | 9.04 | 5.17 |
| js-big-decimal 2.2.0 | 58.2 | 1.7 µs | 1.4 µs | 19.3 µs | 559 | 4.65 |
| bigdecimal.js 1.7.2 | 35.5 | 13.1 | 57.8 | 48.7 | 7.93 | 34.4 |
| @formatjs/bigdecimal 0.2.10 | 122 | 26.9 | n/a | n/a | 20.5 | 50.5 |
| bigint-money 2.0.1 | 453 | 50.9 | 2.1 µs | 2.0 µs | 12.8 | 315 |
