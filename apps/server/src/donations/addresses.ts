import { createBase58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import type { DonationCurrency } from '@reviewskits/types';

const base58 = createBase58check(sha256);
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const moneroSizes = [0, 2, 3, 5, 6, 7, 9, 10, 11];

// Monero encodes independent eight-byte blocks, unlike Bitcoin Base58Check.
function moneroDecode(address: string): Uint8Array {
  const decoded: number[] = [];
  for (let offset = 0; offset < address.length; offset += 11) {
    const block = address.slice(offset, offset + 11);
    const size = moneroSizes.indexOf(block.length);
    if (size < 1) throw new Error('Invalid Monero block length');
    let value = 0n;
    for (const char of block) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) throw new Error('Invalid Monero alphabet');
      value = value * 58n + BigInt(digit);
    }
    if (value >= 1n << BigInt(size * 8)) throw new Error('Monero block overflow');
    const bytes = new Array<number>(size);
    for (let i = size - 1; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
    decoded.push(...bytes);
  }
  return new Uint8Array(decoded);
}

export function validDonationAddress(currency: DonationCurrency, address: string): boolean {
  if (address.length < 14 || address.length > 120 || address !== address.trim()) return false;
  try {
    if (currency === 'XMR') {
      if (![95, 106].includes(address.length)) return false;
      const decoded = moneroDecode(address);
      if (!((decoded.length === 69 && [18, 42].includes(decoded[0]!)) || (decoded.length === 77 && decoded[0] === 19))) return false;
      const digest = keccak_256(decoded.subarray(0, -4));
      return decoded.subarray(-4).every((byte, i) => byte === digest[i]);
    }
    const prefix = currency === 'BTC' ? 'bc' : 'ltc';
    if (address.toLowerCase().startsWith(prefix + '1')) {
      for (const codec of [bech32, bech32m]) {
        try {
          const decoded = codec.decode(address as Parameters<typeof codec.decode>[0], 120);
          const version = decoded.words[0]!;
          const program = codec.fromWords(decoded.words.slice(1));
          if (decoded.prefix !== prefix || version > 16 || program.length < 2 || program.length > 40) continue;
          if (version === 0) return codec === bech32 && [20, 32].includes(program.length);
          return codec === bech32m;
        } catch { /* Try the other checksum variant. */ }
      }
      return false;
    }
    const decoded = base58.decode(address);
    return decoded.length === 21 && (currency === 'BTC' ? [0, 5] : [48, 50]).includes(decoded[0]!);
  } catch { return false; }
}
