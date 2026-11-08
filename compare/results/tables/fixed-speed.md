**node 24.22.2 (V8 13.6.233.17-node.63)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 128 | 9.86 | 78.2 | 28.1 | 6.92 | 30.3 |
| ducat Fixed | 30.1 | 10.9 | 29.4 | 69.3 | 7.45 | 30.6 |
| dnum 2.18.1 | 325 | 24.3 | 282 | 229 | 20.6 | 267 |
| ethers FixedNumber 6.17.0 | 2.2 µs | 1.6 µs | 5.8 µs | 5.4 µs | 8.99 | 4.93 |
| js-big-decimal 2.2.0 | 59.9 | 1.7 µs | 1.5 µs | 36.1 µs | 626 | 4.57 |
| bigdecimal.js 1.7.2 | 45.1 | 16.1 | 78.4 | 57.0 | 8.98 | 38.8 |
| @formatjs/bigdecimal 0.2.10 | 120 | 32.2 | n/a | n/a | 22.7 | 48.5 |
| bigint-money 2.0.1 | 547 | 46.6 | 2.8 µs | 2.6 µs | 13.7 | 481 |

**bun 1.4.4** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 88.1 | 10.2 | 54.7 | 26.4 | 5.56 | 59.0 |
| ducat Fixed | 26.7 | 12.3 | 33.9 | 147 | 4.68 | 58.6 |
| dnum 2.18.1 | 352 | 43.4 | 438 | 326 | 30.0 | 495 |
| ethers FixedNumber 6.17.0 | 2.2 µs | 1.5 µs | 5.2 µs | 4.9 µs | 7.53 | 4.80 |
| js-big-decimal 2.2.0 | 35.5 | 1.9 µs | 1.9 µs | 44.9 µs | 592 | 4.40 |
| bigdecimal.js 1.7.2 | 28.9 | 11.9 | 47.4 | 34.1 | 7.78 | 75.9 |
| @formatjs/bigdecimal 0.2.10 | 192 | 47.3 | n/a | n/a | 17.4 | 98.6 |
| bigint-money 2.0.1 | 341 | 47.2 | 2.3 µs | 2.2 µs | 20.5 | 407 |

**deno 2.9.8 (V8 15.0.245.2-rusty)** (multiply by 1.075 and divide by 3, rounded halfExpand to 2 decimals; median of 5 rounds, 150 ms warm-up per cell)

| ns/op | parse | add | multiply | divide | compare | toString |
|---|--:|--:|--:|--:|--:|--:|
| ducat Money | 126 | 8.92 | 82.6 | 25.6 | 6.58 | 30.4 |
| ducat Fixed | 28.7 | 10.2 | 23.7 | 60.3 | 6.76 | 30.8 |
| dnum 2.18.1 | 349 | 24.1 | 288 | 214 | 19.7 | 261 |
| ethers FixedNumber 6.17.0 | 2.4 µs | 1.7 µs | 5.8 µs | 5.6 µs | 8.84 | 4.79 |
| js-big-decimal 2.2.0 | 58.2 | 1.6 µs | 1.4 µs | 20.2 µs | 590 | 4.80 |
| bigdecimal.js 1.7.2 | 36.0 | 13.7 | 62.3 | 47.0 | 7.97 | 34.9 |
| @formatjs/bigdecimal 0.2.10 | 118 | 24.9 | n/a | n/a | 20.6 | 50.8 |
| bigint-money 2.0.1 | 490 | 51.5 | 2.2 µs | 2.0 µs | 13.3 | 315 |
