import type { FlightReminder } from '../types';
import { addDaysToYmd, formatFlightRef } from './flightFormat';

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

export function getLocalYmdInTz(utcMs: number, timeZone = 'UTC'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone.trim() || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date(utcMs));
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return new Date(utcMs).toISOString().slice(0, 10);
  }
}

export function formatLocalDateTime(isoUtc: string, timeZone = 'UTC'): string {
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) return isoUtc;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone.trim() || 'UTC',
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

function formatGcalUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatCompactYmd(ymd: string): string {
  return ymd.replace(/-/g, '');
}

function escapeIcsText(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function getCalendarTitle(reminder: FlightReminder): string {
  if (!reminder.flight) return reminder.title;
  const ref = formatFlightRef(reminder.flight.airlineIata, reminder.flight.flightNumber);
  if (reminder.title.toUpperCase().includes(ref.toUpperCase())) return reminder.title;
  return `${ref}: ${reminder.title}`;
}

export function buildGoogleCalendarUrl(
  reminder: FlightReminder,
  homeTz?: string | null
): string {
  const title = getCalendarTitle(reminder);
  const safeUrl = sanitizeHttpsUrl(reminder.actionUrl);
  const pnrLine = reminder.flight?.bookingRef ? `PNR: ${reminder.flight.bookingRef}` : null;
  const routeLine = reminder.flight
    ? `${reminder.flight.depAirportIata} -> ${reminder.flight.arrAirportIata} (${reminder.flight.flightDate})`
    : null;
  const desc = [routeLine, pnrLine, reminder.details?.trim(), safeUrl ? `Link: ${safeUrl}` : null]
    .filter(Boolean)
    .join('\n');

  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', title);
  if (desc) url.searchParams.set('details', desc);

  const refMs = Date.parse(reminder.eventAtUtc || reminder.remindAtUtc);
  const safeMs = Number.isNaN(refMs) ? Date.now() : refMs;

  if (reminder.granularity === 'exact') {
    url.searchParams.set('dates', `${formatGcalUtc(safeMs)}/${formatGcalUtc(safeMs + 15 * 60_000)}`);
  } else {
    const ymd = getLocalYmdInTz(safeMs, homeTz || 'UTC');
    const nextYmd = addDaysToYmd(ymd, 1);
    url.searchParams.set('dates', `${formatCompactYmd(ymd)}/${formatCompactYmd(nextYmd)}`);
  }

  return url.toString();
}

export function buildReminderIcsContent(
  reminder: FlightReminder,
  homeTz?: string | null
): string {
  const title = getCalendarTitle(reminder);
  const safeUrl = sanitizeHttpsUrl(reminder.actionUrl);
  const pnrLine = reminder.flight?.bookingRef ? `PNR: ${reminder.flight.bookingRef}` : null;
  const routeLine = reminder.flight
    ? `${reminder.flight.depAirportIata} -> ${reminder.flight.arrAirportIata} (${reminder.flight.flightDate})`
    : null;
  const desc = [routeLine, pnrLine, reminder.details?.trim(), safeUrl ? `Link: ${safeUrl}` : null]
    .filter(Boolean)
    .join('\n');

  const refMs = Date.parse(reminder.eventAtUtc || reminder.remindAtUtc);
  const safeMs = Number.isNaN(refMs) ? Date.now() : refMs;
  const dtStamp = formatGcalUtc(Date.now());
  const summary = escapeIcsText(title);
  const isExact = reminder.granularity === 'exact';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AeroLog//Flight Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:aerolog-rem-${reminder.id}@flights.cyblocker.com`,
    `DTSTAMP:${dtStamp}`,
  ];

  if (isExact) {
    lines.push(`DTSTART:${formatGcalUtc(safeMs)}`);
    lines.push(`DTEND:${formatGcalUtc(safeMs + 15 * 60_000)}`);
  } else {
    const ymd = getLocalYmdInTz(safeMs, homeTz || 'UTC');
    const nextYmd = addDaysToYmd(ymd, 1);
    lines.push(`DTSTART;VALUE=DATE:${formatCompactYmd(ymd)}`);
    lines.push(`DTEND;VALUE=DATE:${formatCompactYmd(nextYmd)}`);
  }

  lines.push(`SUMMARY:${summary}`);
  if (desc) lines.push(`DESCRIPTION:${escapeIcsText(desc)}`);
  if (safeUrl) lines.push(`URL:${safeUrl}`);

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

export function downloadReminderIcs(reminder: FlightReminder, homeTz?: string | null): void {
  const content = buildReminderIcsContent(reminder, homeTz);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `aerolog-reminder-${reminder.id}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
