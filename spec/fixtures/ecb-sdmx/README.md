The ECB Data Portal's daily euro reference rates as SDMX-CSV (dataflow EXR, key
`D.<currencies>.EUR.SP00.A`), fetched from https://data-api.ecb.europa.eu/service/data/EXR on
2026-11-08 (commit c7eb41d, ducat #108):

- `exr-d-full.csv`: observations with full detail (DECIMALS and the other attributes)
- `exr-d-dataonly.csv`: observations with `detail=dataonly`
- `exr-d-nodata.csv`: the series' attributes with `detail=nodata`
- `exr-d-last1.csv`: each series' last observation, discontinued ones included

Source: European Central Bank: free reuse with attribution, as the eurofxref files.
