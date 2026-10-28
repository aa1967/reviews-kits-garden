import { describe, expect, test } from 'bun:test';
import { donationAtomicAmount, donationDisplayAmount, donationPaymentUri } from '@reviewskits/types';
import { validDonationAddress } from '../../src/donations/addresses';

describe('Donation amounts and wallet links', () => {
  test('keeps satoshis and piconero exact above Number safe-integer precision', () => {
    expect(donationAtomicAmount('BTC', '0.00000001')).toBe('1');
    expect(donationAtomicAmount('LTC', '12.34567890')).toBe('1234567890');
    expect(donationAtomicAmount('XMR', '0.000000000001')).toBe('1');
    const amount = '9007199254.740993';
    expect(donationAtomicAmount('BTC', amount)).toBe('900719925474099300');
    expect(donationDisplayAmount('BTC', '900719925474099301')).toBe('9007199254.74099301');
    expect(donationDisplayAmount('XMR', '123456789012345678901')).toBe('123456789.012345678901');
  });
  test('rejects zero, signs, exponent notation, excess precision, and unbounded amounts', () => {
    for (const value of ['0', '0.00000000', '-1', '+1', '1e-8', 'NaN', 'Infinity', '01', '1.000000001', '1000000000000']) {
      expect(() => donationAtomicAmount('BTC', value)).toThrow();
    }
    expect(() => donationAtomicAmount('XMR', '0.0000000000001')).toThrow();
  });
  test('uses each wallet URI standard and preserves exact decimal amounts', () => {
    expect(donationPaymentUri('BTC', 'address', '1.23000000')).toBe('bitcoin:address?amount=1.23');
    expect(donationPaymentUri('LTC', 'address')).toBe('litecoin:address');
    expect(donationPaymentUri('XMR', 'address', '0.000000000001')).toBe('monero:address?tx_amount=0.000000000001');
  });
});

// Published address-format vectors, never configured as application wallets.
// Monero/LTC: christsim/multicoin-address-validator test vectors; BTC: BIP 350.
describe('Mainnet receiving address validation', () => {
  test('accepts Bitcoin legacy, SegWit and Taproot; rejects checksum changes and testnet', () => {
    for (const address of ['1BoatSLRHtKNngkdXEeobR76b53LETtpyT', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0']) {
      expect(validDonationAddress('BTC', address)).toBe(true);
      expect(validDonationAddress('BTC', address.slice(0, -1) + (address.endsWith('1') ? '2' : '1'))).toBe(false);
    }
    expect(validDonationAddress('BTC', 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(false);
    expect(validDonationAddress('BTC', 'javascript:alert(1)')).toBe(false);
  });
  test('validates Litecoin prefixes, SegWit and checksums without confusing Bitcoin P2SH addresses', () => {
    for (const address of ['LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9', 'MQMcJhpWHYVeQArcZR3sBgyPZxxRtnH441', 'ltc1qg42tkwuuxefutzxezdkdel39gfstuap288mfea']) {
      expect(validDonationAddress('LTC', address)).toBe(true);
      expect(validDonationAddress('BTC', address)).toBe(false);
    }
    expect(validDonationAddress('LTC', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(false);
  });
  test('validates Monero standard, subaddress and integrated-address block encoding and Keccak checksums', () => {
    for (const address of [
      '47zQ5LAivg6hNCgijXSEFVLX7mke1bgM6YGLFaANDoJbgXDymcAAZvvMNt2PmMpqEe5qRy2zyfMYXdwpmdyitiFh84xnPG2',
      '88WB4JKdQVhWfkc8cBT9EEJ6vejSAqKJHbV1dXBAXdpgQovtNDNRxfKCS7wB8rHQ5D5zH2Pd1YkyMNNQDie6ZfeZ311fPgn',
      '4Gd4DLiXzBmbVX2FZZ3Cvu6fUaWACup1qDowprUCje1kSP4FmbftiJMSfV8kWZXNqmVwj4m52xqtgFNUudVmsmGkGvkLcCibWfVUfUFVB7',
    ]) {
      expect(validDonationAddress('XMR', address)).toBe(true);
      expect(validDonationAddress('XMR', address.slice(0, -1) + (address.endsWith('1') ? '2' : '1'))).toBe(false);
    }
    expect(validDonationAddress('XMR', 'A2be3UvzMtkJtxRYgcCbQt2y7Rp2eLVGqNTWfZeankrWimSMM4y7uMP6B9oAZaHsXTj8KFSerkSkkVRuEuEca9QM8VhxCNU')).toBe(false);
    expect(validDonationAddress('XMR', 'z'.repeat(95))).toBe(false);
  });
});
