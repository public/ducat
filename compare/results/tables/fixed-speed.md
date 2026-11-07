**node 24.22.2 (V8 13.6.233.17-node.63)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 133 | 11.9 | 93.7 | 185 | 7.86 | 33.5 |
| dnum 2.18.1 | 362 | 29.4 | 358 | 289 | 23.8 | 334 |
| ethers FixedNumber 6.17.0 | 2.5 µs | 1.9 µs | 6.6 µs | 6.1 µs | 10.1 | 5.74 |
| js-big-decimal 2.2.0 | 69.6 | 1.9 µs | 1.7 µs | 44.5 µs | 818 | 5.03 |
| bigdecimal.js 1.7.2 | 51.6 | 16.9 | 85.9 | 64.9 | 9.80 | 42.9 |
| @formatjs/bigdecimal 0.2.10 | 131 | 39.9 | n/a | n/a | 26.6 | 56.8 |
| bigint-money 2.0.1 | 619 | 54.4 | 3.1 µs | 3.0 µs | 15.5 | 527 |

**bun 1.4.4** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 103 | 13.9 | 79.7 | 527 | 8.63 | 86.4 |
| dnum 2.18.1 | 425 | 46.0 | 552 | 348 | 36.3 | 725 |
| ethers FixedNumber 6.17.0 | 2.8 µs | 1.9 µs | 7.0 µs | 7.0 µs | 9.99 | 3.92 |
| js-big-decimal 2.2.0 | 39.7 | 2.5 µs | 2.7 µs | 58.0 µs | 758 | 1.70 |
| bigdecimal.js 1.7.2 | 34.9 | 16.1 | 64.8 | 37.3 | 8.55 | 109 |
| @formatjs/bigdecimal 0.2.10 | 247 | 53.7 | n/a | n/a | 20.1 | 155 |
| bigint-money 2.0.1 | 408 | 55.8 | 2.7 µs | 2.6 µs | 21.5 | 531 |

**deno 2.9.8 (V8 15.0.245.2-rusty)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 144 | 10.5 | 96.5 | 157 | 7.41 | 34.4 |
| dnum 2.18.1 | 396 | 27.4 | 287 | 222 | 23.1 | 320 |
| ethers FixedNumber 6.17.0 | 2.6 µs | 2.0 µs | 6.7 µs | 6.4 µs | 9.84 | 5.53 |
| js-big-decimal 2.2.0 | 73.4 | 1.8 µs | 1.6 µs | 22.9 µs | 650 | 5.41 |
| bigdecimal.js 1.7.2 | 39.5 | 14.7 | 69.3 | 55.6 | 8.88 | 39.4 |
| @formatjs/bigdecimal 0.2.10 | 130 | 31.5 | n/a | n/a | 22.6 | 58.9 |
| bigint-money 2.0.1 | 536 | 59.3 | 2.4 µs | 2.2 µs | 14.7 | 345 |
