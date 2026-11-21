import { addDaysToYmd, getLocalYmdInTz } from './time';

export function sanitizeHttpsUrl(raw?: string | null): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatGcalUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatIcsDateCompact(ymd: string): string {
  return ymd.replace(/-/g, '');
}

function escapeIcsText(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

export function buildGoogleCalendarUrl(params: {
  title: string;
  details?: string | null;
  actionUrl?: string | null;
  granularity: 'exact' | 'day' | string;
  eventAtUtc?: string | null;
  remindAtUtc: string;
  homeTz?: string | null;
}): string {
  const safeUrl = sanitizeHttpsUrl(params.actionUrl);
  const rawDetails = params.details?.trim() || '';
  const cappedDetails =
    rawDetails.length > 400 ? `${rawDetails.slice(0, 399)}…` : rawDetails;
  const descParts = [cappedDetails || null, safeUrl ? `Link: ${safeUrl}` : null].filter(Boolean);
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', params.title.trim() || 'AeroLog Reminder');
  if (descParts.length > 0) {
    url.searchParams.set('details', descParts.join('\n\n'));
  }

  const refIso = params.eventAtUtc || params.remindAtUtc;
  const refMs = Date.parse(refIso);
  const safeMs = Number.isNaN(refMs) ? Date.now() : refMs;

  if (params.granularity === 'exact') {
    const start = formatGcalUtc(safeMs);
    const end = formatGcalUtc(safeMs + 15 * 60_000);
    url.searchParams.set('dates', `${start}/${end}`);
  } else {
    const ymd = getLocalYmdInTz(safeMs, params.homeTz || 'UTC');
    const nextYmd = addDaysToYmd(ymd, 1);
    url.searchParams.set('dates', `${formatIcsDateCompact(ymd)}/${formatIcsDateCompact(nextYmd)}`);
  }

  return url.toString();
}

export function buildReminderIcs(params: {
  id: number;
  title: string;
  details?: string | null;
  actionUrl?: string | null;
  granularity: 'exact' | 'day' | string;
  eventAtUtc?: string | null;
  remindAtUtc: string;
  homeTz?: string | null;
}): string {
  const safeUrl = sanitizeHttpsUrl(params.actionUrl);
  const descParts = [params.details?.trim(), safeUrl ? `Link: ${safeUrl}` : null].filter(Boolean);
  const description = descParts.join('\n\n');

  const refIso = params.eventAtUtc || params.remindAtUtc;
  const refMs = Date.parse(refIso);
  const safeMs = Number.isNaN(refMs) ? Date.now() : refMs;
  const dtStamp = formatGcalUtc(Date.now());
  const summary = escapeIcsText(params.title.trim() || 'AeroLog Reminder');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AeroLog//Flight Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:aerolog-rem-${params.id}@flights.cyblocker.com`,
    `DTSTAMP:${dtStamp}`,
  ];

  const isExact = params.granularity === 'exact';
  if (isExact) {
    lines.push(`DTSTART:${formatGcalUtc(safeMs)}`);
    lines.push(`DTEND:${formatGcalUtc(safeMs + 15 * 60_000)}`);
  } else {
    const ymd = getLocalYmdInTz(safeMs, params.homeTz || 'UTC');
    const nextYmd = addDaysToYmd(ymd, 1);
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDateCompact(ymd)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDateCompact(nextYmd)}`);
  }

  lines.push(`SUMMARY:${summary}`);
  if (description) {
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  }
  if (safeUrl) {
    lines.push(`URL:${safeUrl}`);
  }

  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary}`,
    isExact ? 'TRIGGER:-PT30M' : 'TRIGGER:-PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  );

  return lines.join('\r\n') + '\r\n';
}
