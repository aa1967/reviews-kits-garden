import type { directoryChecks, directoryIncidents, directoryMonitors } from '../infrastructure/database/schema';

type Monitor = typeof directoryMonitors.$inferSelect;
type Check = Pick<typeof directoryChecks.$inferSelect, 'result' | 'checkedAt' | 'responseMs'>;
type Incident = typeof directoryIncidents.$inferSelect;

export function monitorTransition(monitor: Pick<Monitor, 'failureStreak' | 'recoveryStreak' | 'firstFailureAt'>,
  result: 'up' | 'down' | 'unknown', at: Date, incidentOpen: boolean) {
  if (result === 'unknown') return {
    failureStreak: 0, recoveryStreak: 0, firstFailureAt: null, open: false, close: false, retrySeconds: 300,
  };
  const failureStreak = result === 'down' ? monitor.failureStreak + 1 : 0;
  const recoveryStreak = result === 'up' ? monitor.recoveryStreak + 1 : 0;
  return {
    failureStreak, recoveryStreak,
    firstFailureAt: result === 'down' ? (monitor.firstFailureAt ?? at) : null,
    open: !incidentOpen && failureStreak >= 2,
    close: incidentOpen && recoveryStreak >= 2,
    retrySeconds: (result === 'down' && failureStreak < 2) || (incidentOpen && result === 'up' && recoveryStreak < 2) ? 30 : 300,
  };
}

// Observations cover at most their next five minutes. Missed checks are unknown.
export function availability(checks: Check[], start: Date, end: Date) {
  let upMs = 0, downMs = 0;
  const sorted = [...checks].sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
  for (let i = 0; i < sorted.length; i++) {
    const check = sorted[i]!;
    const from = Math.max(start.getTime(), check.checkedAt.getTime());
    const until = Math.min(end.getTime(), check.checkedAt.getTime() + 300000, sorted[i + 1]?.checkedAt.getTime() ?? end.getTime());
    const duration = Math.max(0, until - from);
    if (check.result === 'up') upMs += duration;
    if (check.result === 'down') downMs += duration;
  }
  const span = Math.max(0, end.getTime() - start.getTime());
  const observedMs = upMs + downMs;
  return {
    uptimePercent: observedMs ? Math.round(upMs / observedMs * 10000) / 100 : null,
    coveragePercent: span ? Math.round(observedMs / span * 10000) / 100 : 0,
    observedDowntimeMinutes: Math.round(downMs / 60000), unknownMinutes: Math.round(Math.max(0, span - observedMs) / 60000),
  };
}

export function monitorSummary(monitor: Monitor | undefined, checks: Check[], incidents: Incident[], now = new Date()) {
  if (!monitor) return null;
  const fresh = monitor.enabled && monitor.lastCheckAt && now.getTime() - monitor.lastCheckAt.getTime() < 600000;
  const windows = [1, 7, 30].map((days) => {
    const start = new Date(Math.max((monitor.startedAt ?? monitor.createdAt).getTime(), now.getTime() - days * 86400000));
    return { days, ...availability(checks, start, now) };
  });
  return {
    enabled: monitor.enabled, started: !!monitor.startedAt, status: !monitor.enabled ? 'paused' : fresh ? monitor.lastResult : 'unknown', lastCheckAt: monitor.lastCheckAt,
    responseMs: fresh ? monitor.responseMs : null, tlsExpiresAt: monitor.tlsExpiresAt,
    widgetInstalled: monitor.widgetInstalled, since: monitor.startedAt ?? monitor.createdAt, windows,
    incidentCount: incidents.length, incidents: incidents.slice(0, 50),
    longestIncidentMinutes: Math.max(0, ...incidents.map((i) => Math.round(((i.endedAt ?? now).getTime() - i.startedAt.getTime()) / 60000))),
  };
}
