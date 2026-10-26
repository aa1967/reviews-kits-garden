import { describe, expect, test } from 'bun:test';
import { isPublicAddress, normalizeDomain, validateTarget } from '../../src/directory/network';
import { availability, monitorTransition } from '../../src/directory/monitoring';
import { assessRisk, similarity, textFingerprint } from '../../src/directory/fraud';
import { renderWidget } from '../../src/directory/widgets';

describe('Public directory boundaries', () => {
  test('normalizes exact hostnames without granting control of parent or shared domains', () => {
    expect(normalizeDomain('https://WWW.Example.com/path')).toBe('www.example.com');
    expect(normalizeDomain('my-site.github.io')).toBe('my-site.github.io');
    for (const input of ['github.io', 'localhost', '127.0.0.1', '[::1]', 'https://user:pass@example.com', 'https://example.com:1234', 'file:///etc/passwd']) expect(() => normalizeDomain(input)).toThrow();
  });
  test('blocks reserved addresses including mapped IPv6 and metadata destinations', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.1.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
  test('monitoring and redirects remain HTTPS on the exact verified host', () => {
    expect(validateTarget('https://example.com/health', 'example.com').pathname).toBe('/health');
    for (const url of ['http://example.com', 'https://evil.com', 'https://example.com:8443', 'https://user@example.com', 'https://example.com/#x', 'https://127.0.0.1']) expect(() => validateTarget(url, 'example.com')).toThrow();
  });
});
describe('Monitoring observations', () => {
  test('requires confirmation for incidents and recoveries, and resets failures on unknown', () => {
    const at = new Date();
    const initial = { failureStreak: 0, recoveryStreak: 0, firstFailureAt: null };
    const first = monitorTransition(initial, 'down', at, false);
    expect(first.open).toBe(false); expect(first.retrySeconds).toBe(30);
    const second = monitorTransition(first, 'down', new Date(at.getTime() + 30000), false);
    expect(second.open).toBe(true); expect(second.firstFailureAt).toEqual(at);
    const recovery = monitorTransition(second, 'up', at, true);
    expect(recovery.close).toBe(false);
    expect(monitorTransition(recovery, 'up', at, true).close).toBe(true);
    expect(monitorTransition(first, 'unknown', at, false).failureStreak).toBe(0);
  });
  test('worker downtime is unknown coverage and cannot manufacture perfect uptime', () => {
    const start = new Date('2026-01-01T00:00:00Z'), end = new Date('2026-01-01T01:00:00Z');
    const result = availability([{ result: 'up', checkedAt: start, responseMs: 20 }], start, end);
    expect(result.uptimePercent).toBe(100);
    expect(result.coveragePercent).toBe(8.33);
    expect(result.unknownMinutes).toBe(55);
    expect(availability([], start, end).uptimePercent).toBe(null);
  });
});
describe('Investigation signals and widgets', () => {
  test('similarity and owner overlap are explainable flags, not assertions of identity', () => {
    const text = 'The delivery was very quick and the support team answered all my questions';
    expect(textFingerprint(text)).toBe(textFingerprint(text.toUpperCase() + '!!!'));
    expect(similarity(text, text + ' promptly')).toBeGreaterThan(0.85);
    const result = assessRisk({ email: 'person@example.com', accountAgeMs: 86400000, isBusinessMember: false, duplicate: false, similar: false, recentAccountReviews: 0, recentNetworkAccounts: 4 });
    expect(result.score).toBe(25);
    expect(result.reasons.join(' ')).toContain('weak signal');
  });
  test('highlight widgets escape user content and retain the unfiltered overall score', () => {
    const html = renderWidget({ domain: 'example.com', name: '<script>alert(1)</script>' }, { count: 10, average: 2.5 }, [{ author: '<img src=x onerror=alert(1)>', title: 'Good', content: '<script>bad()</script>', rating: 5 }], 'highlights', false);
    expect(html).toContain('2.5 / 5');
    expect(html).toContain('Selected reviews');
    expect(html).toContain('10 published reviews');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('/business/example.com');
  });
});
