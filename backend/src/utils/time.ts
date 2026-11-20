export function isValidIanaTimeZone(tz: string): boolean {
  const trimmed = tz.trim();
  if (!trimmed) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function getTimezoneOffsetMs(utcRefMs: number, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(new Date(utcRefMs));
    const lookup: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') lookup[p.type] = p.value;
    }
    const wallUtcMs = Date.UTC(
      Number(lookup.year),
      Number(lookup.month) - 1,
      Number(lookup.day),
      Number(lookup.hour),
      Number(lookup.minute),
      Number(lookup.second)
    );
    return wallUtcMs - utcRefMs;
  } catch {
    return 0;
  }
}

export function toAirportUtcMs(
  ymd: string,
  hhmm?: string | null,
  timeZone?: string | null
): number {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').trim());
  if (!dateMatch) return 0;

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;

  const naiveUtcMs = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hour,
    minute,
    0
  );

  const tz = (timeZone || '').trim();
  if (!tz || tz.toUpperCase() === 'UTC') return naiveUtcMs;

  // Two-pass refinement handles DST transitions accurately
  const offset1 = getTimezoneOffsetMs(naiveUtcMs, tz);
  const guess1 = naiveUtcMs - offset1;
  const offset2 = getTimezoneOffsetMs(guess1, tz);
  return naiveUtcMs - offset2;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').trim());
  if (!match) return ymd;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function getLocalYmdInTz(utcMs: number, timeZone = 'UTC'): string {
  const tz = isValidIanaTimeZone(timeZone) ? timeZone.trim() : 'UTC';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date(utcMs));
    const lookup: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') lookup[p.type] = p.value;
    }
    return `${lookup.year}-${lookup.month}-${lookup.day}`;
  } catch {
    return new Date(utcMs).toISOString().slice(0, 10);
  }
}

export function computeDayRemindAtUtc(targetYmd: string, homeTz = 'UTC', dailyHour = 9): string {
  const safeTz = isValidIanaTimeZone(homeTz) ? homeTz.trim() : 'UTC';
  const clampedHour = Number.isFinite(dailyHour)
    ? Math.max(0, Math.min(23, Math.floor(dailyHour)))
    : 9;
  const hhmm = `${String(clampedHour).padStart(2, '0')}:00`;
  const ms = toAirportUtcMs(targetYmd, hhmm, safeTz);
  if (!ms) {
    return new Date().toISOString();
  }
  return new Date(ms).toISOString();
}

/**
 * Compute reminder fire timestamp for an exact check-in window opening.
 * Subtracting 60 minutes aligns with a 30-minute cron schedule (every 30 mins)
 * so the notification fires strictly 30-60 minutes before check-in opens.
 */
export function computeCheckinRemindAtUtc(checkInOpenUtcMs: number, _nowMs?: number): string {
  return new Date(checkInOpenUtcMs - 60 * 60_000).toISOString();
}

export function formatLocalDateTime(isoUtc: string, timeZone = 'UTC'): string {
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) return isoUtc;
  const tz = isValidIanaTimeZone(timeZone) ? timeZone.trim() : 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}
