import type { Airport, Flight } from '../types';

export function formatFlightRef(airlineIata: string, flightNumber: string): string {
  const airline = (airlineIata || '').trim().toUpperCase();
  const num = (flightNumber || '').trim().toUpperCase();
  if (!airline) return num;
  if (num.startsWith(airline)) return num;
  return `${airline}${num}`;
}

export function getUtcTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysToYmd(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').trim());
  if (!match) return ymd;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function diffDaysYmd(targetYmd: string, baseYmd: string): number | null {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec((targetYmd || '').trim());
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec((baseYmd || '').trim());
  if (!m1 || !m2) return null;
  const ms1 = Date.UTC(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  const ms2 = Date.UTC(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  return Math.round((ms1 - ms2) / 86_400_000);
}

export function formatDisplayDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').trim());
  if (!match) return ymd;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
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
  flightDate: string,
  timeStr?: string | null,
  timeZone?: string | null
): number {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec((flightDate || '').trim());
  if (!dateMatch) return 0;

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec((timeStr || '').trim());
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
  if (!tz) return naiveUtcMs;

  // Two-pass refinement handles DST transitions cleanly
  const offset1 = getTimezoneOffsetMs(naiveUtcMs, tz);
  const guess1 = naiveUtcMs - offset1;
  const offset2 = getTimezoneOffsetMs(guess1, tz);
  return naiveUtcMs - offset2;
}

export function getShortTzLabel(timeZone?: string | null, refMs?: number): string {
  const tz = (timeZone || '').trim();
  if (!tz) return 'LCL';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date(refMs ?? Date.now()));
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    return tzPart || 'LCL';
  } catch {
    return 'LCL';
  }
}

export function estimateArrivalTiming(
  flight: Flight,
  depAirport?: Airport,
  arrAirport?: Airport
): { dayOffset: number; durationMinutes: number | null } {
  if (!flight.depTime || !flight.arrTime) {
    return { dayOffset: 0, durationMinutes: null };
  }

  const depTz = flight.depTimezone || depAirport?.timezone || 'UTC';
  const arrTz = flight.arrTimezone || arrAirport?.timezone || 'UTC';
  const depUtcMs = toAirportUtcMs(flight.flightDate, flight.depTime, depTz);

  const expectedHours =
    flight.distanceKm && flight.distanceKm > 0 ? flight.distanceKm / 800 + 0.5 : null;

  const candidates = [0, 1, -1, 2].map((offset) => {
    const arrDate = addDaysToYmd(flight.flightDate, offset);
    const arrUtcMs = toAirportUtcMs(arrDate, flight.arrTime, arrTz);
    const durationMinutes = Math.round((arrUtcMs - depUtcMs) / 60_000);
    return { offset, durationMinutes };
  });

  const plausible = candidates.filter(
    (c) => c.durationMinutes >= 20 && c.durationMinutes <= 22 * 60
  );

  if (plausible.length === 0) {
    return { dayOffset: 0, durationMinutes: null };
  }

  if (expectedHours !== null) {
    plausible.sort(
      (a, b) =>
        Math.abs(a.durationMinutes / 60 - expectedHours) -
        Math.abs(b.durationMinutes / 60 - expectedHours)
    );
    return { dayOffset: plausible[0].offset, durationMinutes: plausible[0].durationMinutes };
  }

  // Without distance, prefer same-day if plausible, else +1
  const sameDay = plausible.find((c) => c.offset === 0);
  const chosen = sameDay ?? plausible[0];
  return { dayOffset: chosen.offset, durationMinutes: chosen.durationMinutes };
}

export function formatDurationMinutes(totalMinutes: number): string {
  if (totalMinutes < 0) return '';
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m`;
  }
  return `${mins}m`;
}

export function computeConnectionSummary(
  prevFlight: Flight,
  nextFlight: Flight,
  airportMap: Map<string, Airport>
): string | null {
  const prevDep = airportMap.get(prevFlight.depAirportIata);
  const prevArr = airportMap.get(prevFlight.arrAirportIata);
  const nextDep = airportMap.get(nextFlight.depAirportIata);

  const cityName = prevArr?.city || prevFlight.arrAirportIata;
  const sameCity = prevFlight.arrAirportIata === nextFlight.depAirportIata || prevArr?.city === nextDep?.city;

  if (prevFlight.depTime && prevFlight.arrTime && nextFlight.depTime) {
    const timing = estimateArrivalTiming(prevFlight, prevDep, prevArr);
    const arrDate = addDaysToYmd(prevFlight.flightDate, timing.dayOffset);
    const prevArrUtc = toAirportUtcMs(
      arrDate,
      prevFlight.arrTime,
      prevFlight.arrTimezone || prevArr?.timezone || 'UTC'
    );
    const nextDepUtc = toAirportUtcMs(
      nextFlight.flightDate,
      nextFlight.depTime,
      nextFlight.depTimezone || nextDep?.timezone || 'UTC'
    );
    const gapMins = Math.round((nextDepUtc - prevArrUtc) / 60_000);
    if (gapMins >= 15 && gapMins <= 24 * 60) {
      return sameCity
        ? `${formatDurationMinutes(gapMins)} layover in ${prevFlight.arrAirportIata}`
        : `${formatDurationMinutes(gapMins)} transfer`;
    }
    if (gapMins > 24 * 60) {
      const days = Math.max(1, Math.round(gapMins / (60 * 24)));
      return sameCity ? `${days} day${days > 1 ? 's' : ''} in ${cityName}` : `${days}d gap before next leg`;
    }
  }

  const dayDiff = diffDaysYmd(nextFlight.flightDate, prevFlight.flightDate);
  if (dayDiff !== null && dayDiff > 0) {
    return sameCity ? `${dayDiff} day${dayDiff > 1 ? 's' : ''} in ${cityName}` : `${dayDiff}d until next leg`;
  }
  if (dayDiff === 0 && sameCity) {
    return `Connection in ${prevFlight.arrAirportIata}`;
  }
  return null;
}

export function sortFlightsChronologically(
  flights: Flight[],
  airportMap: Map<string, Airport>,
  direction: 'asc' | 'desc' = 'asc'
): Flight[] {
  return [...flights].sort((a, b) => {
    const tzA = a.depTimezone || airportMap.get(a.depAirportIata)?.timezone || 'UTC';
    const tzB = b.depTimezone || airportMap.get(b.depAirportIata)?.timezone || 'UTC';
    const tsA = toAirportUtcMs(a.flightDate, a.depTime || '00:00', tzA);
    const tsB = toAirportUtcMs(b.flightDate, b.depTime || '00:00', tzB);
    return direction === 'asc' ? tsA - tsB || a.id - b.id : tsB - tsA || b.id - a.id;
  });
}

export function getFlightPrivacyBadge(
  flight: Flight,
  todayUtc: string
): { label: string; kind: 'private' | 'upcoming' | 'delayed' | 'public' } {
  if (flight.isPrivate) {
    return { label: 'Private', kind: 'private' };
  }
  if (flight.flightDate >= todayUtc) {
    return { label: 'Upcoming', kind: 'upcoming' };
  }
  if (flight.isPublicNow) {
    return { label: 'Public', kind: 'public' };
  }
  const releaseDate = flight.publicReleaseDate;
  const daysLeft = releaseDate ? diffDaysYmd(releaseDate, todayUtc) : null;
  if (daysLeft !== null && daysLeft > 0) {
    return { label: `Public in ${daysLeft}d`, kind: 'delayed' };
  }
  return { label: 'Delayed', kind: 'delayed' };
}
