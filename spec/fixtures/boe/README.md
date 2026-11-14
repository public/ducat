`spot-sample.csv` is **synthetic: the Bank of England database's download format with made-up
values, not Bank of England data.** It is the sample in ducat's own BoE tests (`test/uk.test.ts`):
series codes as column titles (`DATE,XUDLUSS,…`), dates like `05 Jan 2026`, newest first, and an
empty cell for a missing value. None of its numbers is a published rate.

Why no real file: ducat ships no Bank of England data (ducat #118). The database is under the Open
Government Licence, but the Bank says selected exchange rate series are excluded from it and
reproduced under licence from third parties, without naming them.
