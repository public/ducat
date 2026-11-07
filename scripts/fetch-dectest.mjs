#!/usr/bin/env node
// Fetches the General Decimal Arithmetic test cases (Cowlishaw's decTest files, as shipped with
// CPython) into test/vectors/dectest/, which is git-ignored: the files are IBM copyright and are
// not redistributed here. Pinned to a CPython tag and checked by SHA-256, so the vectors never
// change silently.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAG = 'v3.13.0';
const BASE = `https://raw.githubusercontent.com/python/cpython/${TAG}/Lib/test/decimaltestdata`;
const FILES = {
  'add.decTest': 'c807ff5789d9236766419d5da5e6e2b07229a255f3bb5746169d3e1b00ddfc6a',
  'divide.decTest': '489bc96d1116a30f307df03858b93b9771b444ade53cd13799995d5883f92528',
  'multiply.decTest': 'c7fe6fd25c1984823d905ce7a72eb1f5a8e80c79ec324b1c51cf6bb26ee59caf',
  'quantize.decTest': 'ea5946871cb24c521b7947e587a3dceef06f1a26c773a3b442dff87d99d291dc',
  'rounding.decTest': '3dd55b5e9c7428026370098b9afd67c64921ce78b7c6f193fe8612da3120de00',
};
const dir = join(import.meta.dirname, '..', 'test', 'vectors', 'dectest');
mkdirSync(dir, { recursive: true });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fetchVerified(name, expectedHash) {
  const path = join(dir, name);
  if (existsSync(path) && sha256(readFileSync(path)) === expectedHash) {
    return;
  }

  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) {
    throw new Error(`${name}: HTTP ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const actualHash = sha256(body);
  if (actualHash !== expectedHash) {
    throw new Error(`${name}: sha256 ${actualHash}, expected ${expectedHash}`);
  }

  writeFileSync(path, body);
  console.log(`fetched ${name}`);
}

await Promise.all(Object.entries(FILES).map(([name, hash]) => fetchVerified(name, hash)));
