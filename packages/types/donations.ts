export const DONATION_CURRENCIES = ['BTC', 'LTC', 'XMR'] as const;
export type DonationCurrency = typeof DONATION_CURRENCIES[number];
export const DONATION_COINS = {
  BTC: { name: 'Bitcoin', decimals: 8, scheme: 'bitcoin', amountParameter: 'amount' },
  LTC: { name: 'Litecoin', decimals: 8, scheme: 'litecoin', amountParameter: 'amount' },
  XMR: { name: 'Monero', decimals: 12, scheme: 'monero', amountParameter: 'tx_amount' },
} as const;
export const DONATION_STATUSES = ['pending', 'confirmed', 'rejected', 'reversed'] as const;
export type DonationStatus = typeof DONATION_STATUSES[number];

/** Store and compare integer atomic units; never round money through Number. */
export function donationAtomicAmount(currency: DonationCurrency, input: string): string {
  const precision = DONATION_COINS[currency].decimals;
  if (typeof input !== 'string' || !new RegExp('^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,' + precision + '})?$').test(input.trim())) {
    throw new Error('Enter a positive ' + currency + ' amount with at most ' + precision + ' decimal places.');
  }
  const [whole, fraction = ''] = input.trim().split('.');
  const atomic = BigInt(whole!) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0'));
  if (atomic <= 0n) throw new Error('The donation amount must be greater than zero.');
  return atomic.toString();
}

export function donationDisplayAmount(currency: DonationCurrency, atomic: string): string {
  const precision = DONATION_COINS[currency].decimals;
  const value = BigInt(atomic);
  if (value < 0n) throw new Error('Donation totals cannot be negative.');
  const scale = 10n ** BigInt(precision);
  const fraction = (value % scale).toString().padStart(precision, '0').replace(/0+$/, '');
  return (value / scale).toString() + (fraction ? '.' + fraction : '');
}

export function donationPaymentUri(currency: DonationCurrency, address: string, amount?: string): string {
  const coin = DONATION_COINS[currency];
  return coin.scheme + ':' + address + (amount
    ? '?' + coin.amountParameter + '=' + donationDisplayAmount(currency, donationAtomicAmount(currency, amount)) : '');
}

export interface DonationWallet {
  currency: DonationCurrency;
  address: string;
  enabled: boolean;
  updatedAt: string | null;
}
export interface DonationPublicData {
  leaderboardEnabled: boolean;
  wallets: DonationWallet[];
  currency: DonationCurrency;
  period: 'all' | 'month';
  totalAmount: string;
  confirmedCount: number;
  leaders: { rank: number; name: string; amount: string; donationCount: number }[];
}
export interface DonationRecord {
  id: string;
  currency: DonationCurrency;
  walletAddress: string;
  declaredAmount: string;
  amount: string | null;
  status: DonationStatus;
  publicCredit: boolean;
  transactionId: string | null;
  donorNote: string;
  decisionReason: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DonationIdentity {
  mode: 'account' | 'pseudonym';
  pseudonym: string | null;
  name: string;
}
export interface DonationSettings { leaderboardEnabled: boolean; updatedAt: string | null }
export interface DonationAccountData { donations: DonationRecord[]; identity: DonationIdentity }
export interface DonationAdminData {
  settings: DonationSettings;
  wallets: DonationWallet[];
  donations: (DonationRecord & { donor: { name: string; email: string } | null })[];
  total: number;
  page: number;
  counts: { status: DonationStatus; count: number }[];
}
