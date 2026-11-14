`spot-sample.csv` is made up, in the format of the Bank of England database's CSV download of daily
spot rates against sterling (series codes as column titles, dates like `22 Dec 2025`). The numbers
are not the Bank's.

ducat ships no Bank of England data (commit dc3a1a6, ducat #118): the database is under the Open
Government Licence, but the Bank says selected exchange rate series are excluded from it and
reproduced under licence from third parties, without naming them. So, like ducat's own BoE tests,
this sample is invented rather than downloaded.
