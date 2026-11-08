**node 24.22.2 (V8 13.6.233.17-node.63)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 126 | 9.64 | 74.8 | 27.8 | 6.98 | 30.1 |
| ducat Fixed | 30.8 | 11.0 | 29.6 | 27.9 | 7.46 | 31.0 |
| dnum 2.18.1 | 316 | 24.7 | 252 | 270 | 20.3 | 269 |
| ethers FixedNumber 6.17.0 | 2.2 µs | 1.6 µs | 5.5 µs | 5.3 µs | 8.83 | 4.89 |
| js-big-decimal 2.2.0 | 64.1 | 1.7 µs | 1.5 µs | 36.4 µs | 657 | 4.65 |
| bigdecimal.js 1.7.2 | 44.0 | 14.9 | 72.9 | 57.4 | 8.89 | 38.7 |
| @formatjs/bigdecimal 0.2.10 | 120 | 32.1 | n/a | n/a | 22.1 | 47.9 |
| bigint-money 2.0.1 | 540 | 47.3 | 2.8 µs | 2.6 µs | 13.3 | 479 |

**bun 1.4.4** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 85.6 | 11.3 | 50.0 | 25.1 | 8.31 | 58.0 |
| ducat Fixed | 29.4 | 11.8 | 30.1 | 27.2 | 5.77 | 54.8 |
| dnum 2.18.1 | 335 | 41.0 | 416 | 318 | 32.8 | 487 |
| ethers FixedNumber 6.17.0 | 2.0 µs | 1.4 µs | 5.1 µs | 4.8 µs | 9.19 | 4.77 |
| js-big-decimal 2.2.0 | 35.6 | 1.8 µs | 1.8 µs | 43.9 µs | 540 | 4.42 |
| bigdecimal.js 1.7.2 | 30.5 | 11.8 | 49.2 | 34.6 | 8.00 | 67.4 |
| @formatjs/bigdecimal 0.2.10 | 178 | 46.9 | n/a | n/a | 18.4 | 90.3 |
| bigint-money 2.0.1 | 322 | 45.8 | 2.2 µs | 2.0 µs | 19.1 | 356 |

**deno 2.9.8 (V8 15.0.245.2-rusty)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 129 | 8.67 | 82.0 | 25.3 | 6.55 | 30.5 |
| ducat Fixed | 28.8 | 9.81 | 23.3 | 24.0 | 6.79 | 30.5 |
| dnum 2.18.1 | 356 | 23.9 | 302 | 201 | 19.4 | 285 |
| ethers FixedNumber 6.17.0 | 2.3 µs | 1.6 µs | 5.7 µs | 5.5 µs | 8.71 | 4.79 |
| js-big-decimal 2.2.0 | 57.0 | 1.6 µs | 1.3 µs | 18.8 µs | 571 | 4.52 |
| bigdecimal.js 1.7.2 | 35.0 | 12.6 | 60.3 | 46.3 | 7.74 | 33.4 |
| @formatjs/bigdecimal 0.2.10 | 112 | 23.7 | n/a | n/a | 20.0 | 48.6 |
| bigint-money 2.0.1 | 450 | 49.6 | 2.1 µs | 1.9 µs | 12.6 | 304 |
