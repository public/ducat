**node 24.22.2 (V8 13.6.233.17-node.63)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 139 | 10.9 | 89.2 | 33.3 | 7.63 | 32.1 |
| ducat Fixed | 32.8 | 13.1 | 27.2 | 31.4 | 8.65 | 33.0 |
| dnum 2.18.1 | 364 | 27.2 | 336 | 293 | 23.5 | 291 |
| ethers FixedNumber 6.17.0 | 2.4 µs | 1.8 µs | 6.2 µs | 6.1 µs | 9.41 | 5.27 |
| js-big-decimal 2.2.0 | 70.1 | 1.8 µs | 1.6 µs | 42.1 µs | 678 | 5.10 |
| bigdecimal.js 1.7.2 | 48.9 | 16.5 | 80.8 | 63.7 | 9.58 | 41.8 |
| @formatjs/bigdecimal 0.2.10 | 141 | 38.6 | n/a | n/a | 23.9 | 55.2 |
| bigint-money 2.0.1 | 628 | 56.1 | 3.3 µs | 2.9 µs | 15.9 | 524 |

**bun 1.4.4** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 103 | 9.75 | 72.4 | 29.1 | 9.94 | 86.5 |
| ducat Fixed | 29.5 | 15.8 | 30.4 | 29.2 | 6.26 | 88.8 |
| dnum 2.18.1 | 408 | 44.8 | 540 | 375 | 34.2 | 638 |
| ethers FixedNumber 6.17.0 | 2.6 µs | 1.9 µs | 6.8 µs | 6.0 µs | 9.58 | 5.01 |
| js-big-decimal 2.2.0 | 38.8 | 2.2 µs | 2.5 µs | 54.5 µs | 696 | 4.62 |
| bigdecimal.js 1.7.2 | 33.5 | 14.4 | 59.6 | 38.8 | 9.05 | 102 |
| @formatjs/bigdecimal 0.2.10 | 255 | 49.9 | n/a | n/a | 20.6 | 146 |
| bigint-money 2.0.1 | 362 | 53.4 | 2.6 µs | 2.6 µs | 21.8 | 492 |

**deno 2.9.8 (V8 15.0.245.2-rusty)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 144 | 10.7 | 90.3 | 29.2 | 7.57 | 33.9 |
| ducat Fixed | 33.1 | 11.0 | 27.0 | 28.8 | 7.90 | 32.8 |
| dnum 2.18.1 | 417 | 26.5 | 306 | 241 | 22.4 | 305 |
| ethers FixedNumber 6.17.0 | 2.8 µs | 1.9 µs | 7.2 µs | 6.6 µs | 9.78 | 5.48 |
| js-big-decimal 2.2.0 | 64.6 | 1.8 µs | 1.5 µs | 21.7 µs | 633 | 5.45 |
| bigdecimal.js 1.7.2 | 39.5 | 14.8 | 63.5 | 50.5 | 9.44 | 37.0 |
| @formatjs/bigdecimal 0.2.10 | 131 | 27.8 | n/a | n/a | 23.3 | 55.2 |
| bigint-money 2.0.1 | 537 | 57.1 | 2.2 µs | 2.1 µs | 13.8 | 342 |
