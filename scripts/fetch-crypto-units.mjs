#!/usr/bin/env node
// Writes data/crypto-units.json: the decimals of a few common crypto currencies and tokens, each read
// from the source that defines it, pinned to a release or commit:
// - BTC: Bitcoin Core's `COIN` (satoshis per bitcoin), src/consensus/amount.h;
// - ETH: Ethereum mainnet's native currency in ethereum-lists/chains (the chainid.network data);
// - SOL: `LAMPORTS_PER_SOL` in the Solana SDK's native-token crate;
// - ERC-20 tokens: the Uniswap default token list, Ethereum mainnet (chain 1) entries. A token's
//   decimals belong to its contract, and differ between chains (USDC has 18 on BNB Chain), so the
//   table names the network and the contract.
// `pnpm gen` turns the snapshot into src/generated/crypto.ts.
//
//   node scripts/fetch-crypto-units.mjs            fetch and write the snapshot
//   node scripts/fetch-crypto-units.mjs --check    exit 1 if the snapshot differs from the sources
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BITCOIN = 'https://raw.githubusercontent.com/bitcoin/bitcoin/v28.0/src/consensus/amount.h';
const CHAINS =
  'https://raw.githubusercontent.com/ethereum-lists/chains/e17474286275730fb6b0490b1d7ea1c64a36ed9e/_data/chains/eip155-1.json';
const SOLANA =
  'https://raw.githubusercontent.com/anza-xyz/solana-sdk/dcc9f4df80afeaaa093316ab9d0dccba4ca55525/native-token/src/lib.rs';
const UNISWAP =
  'https://unpkg.com/@uniswap/default-token-list@22.34.0/build/uniswap-default.tokenlist.json';
const TOKENS = ['USDC', 'USDT', 'DAI', 'WBTC', 'EURC', 'PYUSD'];

const path = join(import.meta.dirname, '..', 'data', 'crypto-units.json');

async function text(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.text();
}

/** The number of decimals a base-unit count like 100000000 stands for, checking it is a power of 10. */
function decimalsOf(perUnit, url) {
  const digits = perUnit.replaceAll('_', '');
  if (!/^10*$/.test(digits)) {
    throw new Error(`${url}: ${perUnit} is not a power of 10`);
  }
  return digits.length - 1;
}

function match(source, pattern, url) {
  const found = pattern.exec(source);
  if (found === null) {
    throw new Error(`${url}: ${pattern} not found`);
  }
  return found[1];
}

const units = {};

const bitcoin = await text(BITCOIN);
units.BTC = {
  name: 'Bitcoin',
  decimals: decimalsOf(match(bitcoin, /static constexpr CAmount COIN = (\d+);/, BITCOIN), BITCOIN),
  baseUnit: 'satoshi',
  network: 'Bitcoin',
  source: BITCOIN,
};

const ethereum = JSON.parse(await text(CHAINS));
if (ethereum.chainId !== 1 || ethereum.nativeCurrency?.symbol !== 'ETH') {
  throw new Error(`${CHAINS}: not Ethereum mainnet's ETH`);
}
units.ETH = {
  name: ethereum.nativeCurrency.name,
  decimals: ethereum.nativeCurrency.decimals,
  baseUnit: 'wei',
  network: 'Ethereum',
  source: CHAINS,
};

const solana = await text(SOLANA);
units.SOL = {
  name: 'Solana',
  decimals: decimalsOf(
    match(solana, /pub const LAMPORTS_PER_SOL: u64 = ([\d_]+);/, SOLANA),
    SOLANA,
  ),
  baseUnit: 'lamport',
  network: 'Solana',
  source: SOLANA,
};

const tokenList = JSON.parse(await text(UNISWAP));
for (const symbol of TOKENS) {
  const entries = tokenList.tokens.filter(
    (token) => token.chainId === 1 && token.symbol === symbol,
  );
  if (entries.length !== 1) {
    throw new Error(`${UNISWAP}: ${entries.length} Ethereum mainnet entries for ${symbol}`);
  }
  const [token] = entries;
  units[symbol] = {
    name: token.name,
    decimals: token.decimals,
    network: 'Ethereum',
    contract: token.address,
    source: UNISWAP,
  };
}

for (const [code, unit] of Object.entries(units)) {
  if (!Number.isInteger(unit.decimals) || unit.decimals < 0 || unit.decimals > 30) {
    throw new Error(`${code}: invalid decimals ${unit.decimals}`);
  }
}

const snapshot = {
  note:
    'Decimals of common crypto currencies and tokens, each from the source that defines it. ' +
    "A token's decimals belong to its contract on one network: these are Ethereum mainnet's.",
  units,
};
const output = JSON.stringify(snapshot, null, 2) + '\n';

if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output) {
    console.error('data/crypto-units.json differs from its sources');
    process.exit(1);
  }
  console.log('data/crypto-units.json matches its sources');
} else {
  writeFileSync(path, output);
  console.log(`wrote ${path}`);
}
