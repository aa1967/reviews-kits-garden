import { createHash, createHmac } from 'node:crypto';

export function textFingerprint(text: string): string {
  return createHash('sha256').update(text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).digest('hex');
}

export function networkFingerprint(address: string | undefined): string | null {
  if (!address || address === 'unknown') return null;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required for abuse-signal protection.');
  return createHmac('sha256', secret).update('review-network:' + address).digest('hex');
}

export function similarity(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  const aa = tokens(a), bb = tokens(b);
  if (Math.min(aa.size, bb.size) < 8) return 0;
  const intersection = [...aa].filter((t) => bb.has(t)).length;
  return intersection / (aa.size + bb.size - intersection);
}

export function assessRisk(input: {
  email: string; accountAgeMs: number; isBusinessMember: boolean; duplicate: boolean;
  similar: boolean; recentAccountReviews: number; recentNetworkAccounts: number;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
  if (input.isBusinessMember) add(60, 'Reviewer also manages this business');
  if (input.duplicate) add(40, 'Repeated review text across accounts');
  else if (input.similar) add(25, 'Highly similar wording to another review');
  if (input.accountAgeMs < 24 * 60 * 60 * 1000) add(10, 'Account created within the past day');
  if (input.recentAccountReviews >= 3) add(30, 'Several reviews from this account in one hour');
  if (input.recentNetworkAccounts >= 3) add(25, 'Several accounts recently used the same network (weak signal)');
  if (['mailinator.com', 'guerrillamail.com', 'tempmail.com', '10minutemail.com'].includes(input.email.split('@')[1] ?? '')) {
    add(20, 'Known disposable email provider');
  }
  return { score: Math.min(score, 100), reasons };
}
