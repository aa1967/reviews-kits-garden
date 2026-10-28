import { useCallback, useEffect, useState } from 'react';
import type { BusinessLifecycle } from '@reviewskits/types';

export type Score = { count: number; average: number | null; distribution: { rating: number; count: number }[] };
export type Business = BusinessLifecycle & { id: string; domain: string; name: string; description: string; category: string; claimed: boolean; createdAt: string; score?: Score; isOwner?: boolean; listed?: boolean };
export type Review = { id: string; title: string; content: string; rating: number; author: string; emailVerified: boolean; createdAt: string; reply: string | null; replyAt: string | null };
export type Monitoring = {
  enabled: boolean; started: boolean; status: string; lastCheckAt: string | null; responseMs: number | null; tlsExpiresAt: string | null; widgetInstalled: boolean | null;
  since: string; windows: { days: number; uptimePercent: number | null; coveragePercent: number; observedDowntimeMinutes: number; unknownMinutes: number }[];
  incidentCount: number; longestIncidentMinutes: number; incidents: { id: string; startedAt: string; confirmedAt: string; endedAt: string | null; reason: string }[];
};
export type Claim = { id: string; businessId: string; method: 'dns' | 'file'; token: string; status: string; expiresAt: string; lastError: string | null };
export type Account = {
  user: { id: string; name: string; email: string; emailVerified: boolean; isSystemAdmin: boolean };
  businesses: Business[]; claims: { claim: Claim; domain: string }[];
  reviews: { id: string; domain: string; title: string; content: string; rating: number; status: string; moderationReason: string | null; updatedAt: string; reviewsClosed: boolean; listed: boolean }[];
  alerts: { id: string; title: string; body: string | null; createdAt: string }[]; emailConfigured: boolean;
};
export type Managed = { business: Business; score: Score; reviews: Review[]; monitoring: Monitoring | null; monitor: { url: string; expectedText: string; enabled: boolean } | null; members: { id: string; name: string; email: string }[] };
export type Moderation = {
  reviews: {
    review: { id: string; title: string; content: string; rating: number; status: string; riskScore: number; riskReasons: string[]; updatedAt: string; moderationReason: string | null };
    business: { domain: string; name: string };
    reviewer: { id: string; name: string; email: string; emailVerified: boolean; createdAt: string };
  }[];
  counts: { status: string; count: number }[];
  reports: { report: { id: string; reviewId: string; kind: string; reason: string; createdAt: string }; title: string; domain: string }[];
  audit: { id: string; action: string; note: string; createdAt: string }[];
  workers: { name: string; lastSeenAt: string }[]; workerHealthy: boolean; emailConfigured: boolean;
};
export type Evidence = { reasons: string[]; score: number; notice: string; possibleConnections: { id: string; title: string; author: string; domain: string; status: string }[] };

export async function directoryRequest<T>(path: string, method = 'GET', input?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/v1/directory' + path, {
    method, credentials: 'same-origin', signal,
    ...(input !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data as T;
}

export function useDirectory<T>(path: string | null, pollMs = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (!path) return () => controller.abort();
    directoryRequest<T>(path, 'GET', undefined, controller.signal).then((result) => {
      setData(result); setError(''); setLoading(false);
    }).catch((e: Error) => {
      if (e.name !== 'AbortError') { setError(e.message); setLoading(false); }
    });
    return () => controller.abort();
  }, [path, version]);
  useEffect(() => {
    if (!pollMs) return;
    const interval = window.setInterval(reload, pollMs);
    return () => window.clearInterval(interval);
  }, [pollMs, reload]);
  return { data, error, loading, reload };
}
