import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { airports, flightReminders, flights, ownerProfile } from '../db/schema';
import {
  generateFlightLogistics,
  type TravelerProfileContext,
} from './gemini';
import { formatFlightRef } from '../widgets';
import {
  addDaysToYmd,
  computeCheckinRemindAtUtc,
  computeDayRemindAtUtc,
  getLocalYmdInTz,
  isValidIanaTimeZone,
  toAirportUtcMs,
} from './time';

export type FlightRow = typeof flights.$inferSelect;
export type AirportRow = typeof airports.$inferSelect;
export type FlightReminderRow = typeof flightReminders.$inferSelect;
export type OwnerProfileRow = typeof ownerProfile.$inferSelect;

export interface NormalizedOwnerProfile {
  id: number;
  citizenships: string | null;
  residencyCountry: string | null;
  residencyStatus: string | null;
  visasAndPrograms: string | null;
  frequentFlyerStatuses: string | null;
  mealPreferences: string | null;
  homeTimezone: string | null;
  dailyReminderHour: number | null;
  updatedAt: Date | null;
}

export function resolveProfilePrefs(profile: NormalizedOwnerProfile | null | undefined): {
  homeTz: string;
  dailyHour: number;
} {
  const rawTz = profile?.homeTimezone?.trim() || '';
  const homeTz = isValidIanaTimeZone(rawTz) ? rawTz : 'UTC';
  const rawHour = profile?.dailyReminderHour;
  const dailyHour =
    typeof rawHour === 'number' && Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23
      ? rawHour
      : 9;
  return { homeTz, dailyHour };
}

const AIRLINE_CHECKIN_HOURS: Record<string, number> = {
  SQ: 48,
  CX: 48,
  LX: 23,
  LH: 30,
  OS: 47,
  AF: 30,
  KL: 30,
  BA: 24,
  NH: 24,
  JL: 24,
};

export function getDefaultCheckinHours(airlineIata: string): number {
  const code = (airlineIata || '').trim().toUpperCase();
  return AIRLINE_CHECKIN_HOURS[code] ?? 24;
}

export function extractSafeFareNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const cleaned = notes
    .replace(/Imported via email:[^\n]*/gi, '')
    .replace(/\S+@\S+\.\S+/g, '')
    .replace(/\b\d{5,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 160);
}

export function isSeatDeferredByNotes(notes?: string | null): boolean {
  if (!notes) return false;
  const withoutEmailPrefix = notes.replace(/Imported via email:[^\n]*/gi, '').trim();
  if (!withoutEmailPrefix) return false;
  return /(^|\W)(economy\s*light|light\s*(class|fare|ticket)?|basic\s*economy|ana\s*simple|simple\s*(fare|ticket)|no\s*advance\s*seat|seat\s*(only\s*)?(at|on)\s*check-?in)(\W|$)/i.test(
    withoutEmailPrefix
  );
}

export async function getOwnerProfile(db: DrizzleD1Database): Promise<NormalizedOwnerProfile> {
  const [row] = await db.select().from(ownerProfile).where(eq(ownerProfile.id, 1)).limit(1);
  return {
    id: 1,
    citizenships: row?.citizenships ?? null,
    residencyCountry: row?.residencyCountry ?? null,
    residencyStatus: row?.residencyStatus ?? null,
    visasAndPrograms: row?.visasAndPrograms ?? null,
    frequentFlyerStatuses: row?.frequentFlyerStatuses ?? null,
    mealPreferences: row?.mealPreferences ?? null,
    homeTimezone: row?.homeTimezone ?? null,
    dailyReminderHour: row?.dailyReminderHour ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function ensureRuleRemindersForFlight(
  db: DrizzleD1Database,
  flight: FlightRow,
  airportMap: Map<string, AirportRow>,
  profile: NormalizedOwnerProfile,
  options: { now?: Date; deferSeatToTomorrow?: boolean } = {}
): Promise<FlightReminderRow[]> {
  const now = options.now ?? new Date();
  const { homeTz, dailyHour } = resolveProfilePrefs(profile);
  const todayLocal = getLocalYmdInTz(now.getTime(), homeTz);

  if (flight.flightDate < todayLocal) {
    return db
      .select()
      .from(flightReminders)
      .where(eq(flightReminders.flightId, flight.id))
      .orderBy(asc(flightReminders.remindAtUtc), asc(flightReminders.id))
      .all();
  }

  const existing = await db
    .select()
    .from(flightReminders)
    .where(eq(flightReminders.flightId, flight.id))
    .orderBy(asc(flightReminders.remindAtUtc), asc(flightReminders.id))
    .all();

  const depAirport = airportMap.get(flight.depAirportIata);
  const depTz = depAirport?.timezone || homeTz || 'UTC';
  const depUtcMs = toAirportUtcMs(flight.flightDate, flight.depTime || '09:00', depTz);
  const depUtcIso = new Date(depUtcMs || now.getTime()).toISOString();
  const flightRef = formatFlightRef(flight.airlineIata, flight.flightNumber);
  const tomorrowLocal = addDaysToYmd(todayLocal, 1);

  // Rule 1: Departure day-before briefing card
  const depDayBeforeYmd = addDaysToYmd(flight.flightDate, -1);
  const depRemindAtUtc = computeDayRemindAtUtc(depDayBeforeYmd, homeTz, dailyHour);
  const existingDep = existing.find((r) => r.category === 'departure' && r.source === 'rule')
    || existing.find((r) => r.category === 'departure');

  if (existingDep) {
    if (
      existingDep.status === 'pending' &&
      !existingDep.notifiedAt &&
      (existingDep.eventAtUtc !== depUtcIso || existingDep.remindAtUtc !== depRemindAtUtc)
    ) {
      await db
        .update(flightReminders)
        .set({
          eventAtUtc: depUtcIso,
          remindAtUtc: depRemindAtUtc,
          updatedAt: now,
        })
        .where(eq(flightReminders.id, existingDep.id));
    }
  } else if (flight.flightDate > todayLocal) {
    await db.insert(flightReminders).values({
      flightId: flight.id,
      category: 'departure',
      title: `Flight Tomorrow: ${flightRef} (${flight.depAirportIata} → ${flight.arrAirportIata})`,
      details: `Departs ${flight.depTime || 'TBD'} local from ${flight.depAirportIata}. Review PNR, seat, and airport transit.`,
      actionUrl: null,
      granularity: 'day',
      eventAtUtc: depUtcIso,
      remindAtUtc: depRemindAtUtc,
      status: 'pending',
      source: 'rule',
      createdAt: now,
      updatedAt: now,
    });
  }

  // Rule 2: Missing seat reminder on booking/import (suppressed when fare defers seats to check-in)
  const hasSeat = Boolean(flight.seat && flight.seat.trim().length > 0);
  const hasAnySeatReminder = existing.some((r) => r.category === 'seat');
  const seatDeferred = isSeatDeferredByNotes(flight.notes);

  if (!hasSeat && seatDeferred) {
    const hasCheckinReminder = existing.some((r) => r.category === 'checkin');
    if (!hasCheckinReminder) {
      const hours = getDefaultCheckinHours(flight.airlineIata);
      if (flight.depTime && flight.depTime.trim()) {
        const checkInOpenMs = depUtcMs - hours * 3600_000;
        await db.insert(flightReminders).values({
          flightId: flight.id,
          category: 'checkin',
          title: `Online check-in & seat selection (${flightRef})`,
          details: `Check-in opens ${hours}h before departure for seat selection (Light/Basic fare).`,
          actionUrl: null,
          granularity: 'exact',
          eventAtUtc: new Date(checkInOpenMs).toISOString(),
          remindAtUtc: computeCheckinRemindAtUtc(checkInOpenMs, now.getTime()),
          status: 'pending',
          source: 'rule',
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await db.insert(flightReminders).values({
          flightId: flight.id,
          category: 'checkin',
          title: `Online check-in & seat selection (${flightRef})`,
          details: `Check-in opens ${hours}h before departure for seat selection (Light/Basic fare). Add exact departure time for 30–60 min pre-open alert.`,
          actionUrl: null,
          granularity: 'day',
          eventAtUtc: null,
          remindAtUtc: computeDayRemindAtUtc(depDayBeforeYmd, homeTz, dailyHour),
          status: 'pending',
          source: 'rule',
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  } else if (!hasSeat && !hasAnySeatReminder) {
    const useTomorrow = Boolean(options.deferSeatToTomorrow && flight.flightDate > tomorrowLocal);
    const targetYmd = useTomorrow ? tomorrowLocal : todayLocal;
    await db.insert(flightReminders).values({
      flightId: flight.id,
      category: 'seat',
      title: `Select or confirm seat for ${flightRef} (${flight.depAirportIata}→${flight.arrAirportIata})`,
      details:
        'No seat was detected on this booking. Choose your seat via Manage Booking, or tap "Seat at Check-In" for Light/Basic fares.',
      actionUrl: null,
      granularity: 'day',
      eventAtUtc: depUtcIso,
      remindAtUtc: computeDayRemindAtUtc(targetYmd, homeTz, dailyHour),
      status: 'pending',
      source: 'rule',
      createdAt: now,
      updatedAt: now,
    });
  }

  return db
    .select()
    .from(flightReminders)
    .where(eq(flightReminders.flightId, flight.id))
    .orderBy(asc(flightReminders.remindAtUtc), asc(flightReminders.id))
    .all();
}

export async function generateRemindersForFlight(
  db: DrizzleD1Database,
  env: { GEMINI_API_KEY?: string },
  flight: FlightRow,
  options: { force?: boolean; deferSeatToTomorrow?: boolean; now?: Date; timeoutMs?: number } = {}
): Promise<FlightReminderRow[]> {
  const now = options.now ?? new Date();
  const [airportList, profile] = await Promise.all([
    db.select().from(airports).all(),
    getOwnerProfile(db),
  ]);
  const airportMap = new Map(airportList.map((a) => [a.iataCode, a]));

  await ensureRuleRemindersForFlight(db, flight, airportMap, profile, {
    now,
    deferSeatToTomorrow: options.deferSeatToTomorrow,
  });

  const { homeTz, dailyHour } = resolveProfilePrefs(profile);
  const todayLocal = getLocalYmdInTz(now.getTime(), homeTz);
  const tomorrowLocal = addDaysToYmd(todayLocal, 1);

  if (!env.GEMINI_API_KEY || flight.flightDate < todayLocal) {
    return db
      .select()
      .from(flightReminders)
      .where(eq(flightReminders.flightId, flight.id))
      .orderBy(asc(flightReminders.remindAtUtc), asc(flightReminders.id))
      .all();
  }

  const depAirport = airportMap.get(flight.depAirportIata);
  const arrAirport = airportMap.get(flight.arrAirportIata);
  const depTz = depAirport?.timezone || homeTz || 'UTC';
  const depUtcMs = toAirportUtcMs(flight.flightDate, flight.depTime || '09:00', depTz);
  const depUtcIso = new Date(depUtcMs || now.getTime()).toISOString();
  const isDomestic = Boolean(
    depAirport?.countryCode &&
    arrAirport?.countryCode &&
    depAirport.countryCode === arrAirport.countryCode
  );

  // Gather adjacent flights (+/- 2 days) to inform border/check-in context without exposing PII
  const allFlights = await db.select().from(flights).all();
  const windowMin = addDaysToYmd(flight.flightDate, -2);
  const windowMax = addDaysToYmd(flight.flightDate, 2);
  const connecting = allFlights
    .filter(
      (other) =>
        other.id !== flight.id &&
        other.flightDate >= windowMin &&
        other.flightDate <= windowMax
    )
    .sort((a, b) => a.flightDate.localeCompare(b.flightDate) || a.id - b.id)
    .slice(0, 4);

  const connectingLegsSummary = connecting.length > 0
    ? connecting
        .map((c) => `${c.flightDate} ${formatFlightRef(c.airlineIata, c.flightNumber)} ${c.depAirportIata}->${c.arrAirportIata}`)
        .join('; ')
    : null;

  const daysUntilFlight = Math.max(
    0,
    Math.round(
      (Date.parse(`${flight.flightDate}T00:00:00Z`) - Date.parse(`${todayLocal}T00:00:00Z`)) /
        86_400_000
    )
  );

  const profileCtx: TravelerProfileContext = {
    citizenships: profile.citizenships,
    residencyCountry: profile.residencyCountry,
    residencyStatus: profile.residencyStatus,
    visasAndPrograms: profile.visasAndPrograms,
    frequentFlyerStatuses: profile.frequentFlyerStatuses,
    mealPreferences: profile.mealPreferences,
  };

  // Call Gemini BEFORE replacing old AI rows so failed/timed-out calls never lose existing reminders
  const aiItems = await generateFlightLogistics(
    {
      airlineIata: flight.airlineIata,
      flightNumber: formatFlightRef(flight.airlineIata, flight.flightNumber),
      flightDate: flight.flightDate,
      depAirportIata: flight.depAirportIata,
      depCity: depAirport?.city ?? null,
      depCountryCode: depAirport?.countryCode ?? null,
      arrAirportIata: flight.arrAirportIata,
      arrCity: arrAirport?.city ?? null,
      arrCountryCode: arrAirport?.countryCode ?? null,
      depTime: flight.depTime,
      cabinClass: flight.cabinClass,
      aircraftType: flight.aircraftType,
      hasSeat: Boolean(flight.seat && flight.seat.trim().length > 0),
      isDomestic,
      daysUntilFlight,
      fareNotes: extractSafeFareNotes(flight.notes),
      connectingLegsSummary,
    },
    profileCtx,
    env.GEMINI_API_KEY,
    options.timeoutMs
  );

  // Atomically replace only pending, unnotified AI rows AFTER Gemini succeeded
  await db
    .delete(flightReminders)
    .where(
      and(
        eq(flightReminders.flightId, flight.id),
        eq(flightReminders.source, 'ai'),
        eq(flightReminders.status, 'pending'),
        isNull(flightReminders.notifiedAt)
      )
    );

  const remaining = await db
    .select()
    .from(flightReminders)
    .where(eq(flightReminders.flightId, flight.id))
    .all();

  const blockedCategories = new Set<string>();
  if (!options.force) {
    for (const r of remaining) {
      if (r.status === 'done' || r.status === 'dismissed') {
        blockedCategories.add(r.category);
      }
    }
  }

  let hasPendingCheckin = remaining.some((r) => r.category === 'checkin' && r.status === 'pending');
  let insertedCheckinFromAi = false;
  const seatDeferredByAi = aiItems.some((item) => item.seatDeferredToCheckin === true);

  const nowMs = now.getTime();
  for (const item of aiItems) {
    if (!options.force && blockedCategories.has(item.category)) {
      continue;
    }

    if (item.category === 'checkin') {
      if (insertedCheckinFromAi) continue;
      if (hasPendingCheckin) {
        // Replace an unnotified fallback rule check-in with richer AI check-in, otherwise keep manual/notified check-in
        const ruleCheckins = remaining.filter(
          (r) => r.category === 'checkin' && r.source === 'rule' && r.status === 'pending' && !r.notifiedAt
        );
        if (ruleCheckins.length === 0) {
          continue;
        }
        for (const rc of ruleCheckins) {
          await db.delete(flightReminders).where(eq(flightReminders.id, rc.id));
        }
      }

      if (item.hoursBeforeDeparture) {
        if (flight.depTime && flight.depTime.trim()) {
          if (depUtcMs <= nowMs) continue;
          const checkInOpenMs = depUtcMs - item.hoursBeforeDeparture * 3600_000;
          const eventAtUtc = new Date(checkInOpenMs).toISOString();
          const remindAtUtc = computeCheckinRemindAtUtc(checkInOpenMs, nowMs);
          await db.insert(flightReminders).values({
            flightId: flight.id,
            category: 'checkin',
            title: item.title,
            details: item.details,
            actionUrl: item.actionUrl,
            granularity: 'exact',
            eventAtUtc,
            remindAtUtc,
            status: 'pending',
            source: 'ai',
            createdAt: now,
            updatedAt: now,
          });
          insertedCheckinFromAi = true;
          hasPendingCheckin = true;
          continue;
        }
      }

      let targetYmd = addDaysToYmd(flight.flightDate, -1);
      if (targetYmd < todayLocal) targetYmd = todayLocal;
      const detailsWithHint =
        item.hoursBeforeDeparture && !flight.depTime?.trim()
          ? [item.details, 'Add exact departure time to enable 30–60 min pre-open alert.']
              .filter(Boolean)
              .join(' ')
          : item.details;
      await db.insert(flightReminders).values({
        flightId: flight.id,
        category: 'checkin',
        title: item.title,
        details: detailsWithHint,
        actionUrl: item.actionUrl,
        granularity: 'day',
        eventAtUtc: null,
        remindAtUtc: computeDayRemindAtUtc(targetYmd, homeTz, dailyHour),
        status: 'pending',
        source: 'ai',
        createdAt: now,
        updatedAt: now,
      });
      insertedCheckinFromAi = true;
      hasPendingCheckin = true;
      continue;
    }

    let targetYmd = addDaysToYmd(flight.flightDate, -(item.daysBeforeFlight ?? 0));
    if (targetYmd < todayLocal) {
      targetYmd =
        options.deferSeatToTomorrow && flight.flightDate > tomorrowLocal
          ? tomorrowLocal
          : todayLocal;
    }

    await db.insert(flightReminders).values({
      flightId: flight.id,
      category: item.category,
      title: item.title,
      details: item.details,
      actionUrl: item.actionUrl,
      granularity: 'day',
      eventAtUtc: item.granularity === 'exact' ? depUtcIso : null,
      remindAtUtc: computeDayRemindAtUtc(targetYmd, homeTz, dailyHour),
      status: 'pending',
      source: 'ai',
      createdAt: now,
      updatedAt: now,
    });
  }

  // If AI or notes indicate seats are deferred to check-in (e.g. Light/Simple fare), dismiss pending rule seat task
  if ((seatDeferredByAi || isSeatDeferredByNotes(flight.notes)) && hasPendingCheckin) {
    const nowIso = now.toISOString();
    await db
      .update(flightReminders)
      .set({
        status: 'dismissed',
        completedAt: nowIso,
        updatedAt: now,
      })
      .where(
        and(
          eq(flightReminders.flightId, flight.id),
          eq(flightReminders.category, 'seat'),
          eq(flightReminders.source, 'rule'),
          eq(flightReminders.status, 'pending')
        )
      );
  }

  return db
    .select()
    .from(flightReminders)
    .where(eq(flightReminders.flightId, flight.id))
    .orderBy(asc(flightReminders.remindAtUtc), asc(flightReminders.id))
    .all();
}

export async function convertSeatReminderToCheckin(
  db: DrizzleD1Database,
  reminderId: number,
  options: { hoursBeforeDeparture?: number; now?: Date } = {}
): Promise<
  | { ok: false; status: 400 | 404; error: string }
  | { ok: true; dismissedId: number; created: boolean; checkinReminder: FlightReminderRow }
> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const [rem] = await db
    .select()
    .from(flightReminders)
    .where(eq(flightReminders.id, reminderId))
    .limit(1);
  if (!rem) return { ok: false, status: 404, error: 'Reminder not found' };
  if (!rem.flightId) return { ok: false, status: 400, error: 'Reminder is not linked to a flight' };

  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, rem.flightId))
    .limit(1);
  if (!flight) return { ok: false, status: 404, error: 'Linked flight not found' };

  await db
    .update(flightReminders)
    .set({
      status: 'dismissed',
      completedAt: nowIso,
      updatedAt: now,
    })
    .where(eq(flightReminders.id, rem.id));

  const [existingCheckin] = await db
    .select()
    .from(flightReminders)
    .where(
      and(
        eq(flightReminders.flightId, flight.id),
        eq(flightReminders.category, 'checkin'),
        eq(flightReminders.status, 'pending')
      )
    )
    .limit(1);

  if (existingCheckin) {
    return { ok: true, dismissedId: rem.id, created: false, checkinReminder: existingCheckin };
  }

  const [airportList, profile] = await Promise.all([
    db.select().from(airports).all(),
    getOwnerProfile(db),
  ]);
  const airportMap = new Map(airportList.map((a) => [a.iataCode, a]));
  const { homeTz, dailyHour } = resolveProfilePrefs(profile);
  const depAirport = airportMap.get(flight.depAirportIata);
  const depTz = depAirport?.timezone || homeTz || 'UTC';
  const hours = options.hoursBeforeDeparture || getDefaultCheckinHours(flight.airlineIata);
  const flightRef = formatFlightRef(flight.airlineIata, flight.flightNumber);

  let granularity: 'day' | 'exact' = 'day';
  let eventAtUtc: string | null = null;
  let remindAtUtc: string;
  let details = `Check-in opens ${hours}h before departure for seat selection (Light/Basic fare).`;

  if (flight.depTime && flight.depTime.trim()) {
    const depUtcMs = toAirportUtcMs(flight.flightDate, flight.depTime, depTz);
    const checkInOpenMs = depUtcMs - hours * 3600_000;
    granularity = 'exact';
    eventAtUtc = new Date(checkInOpenMs).toISOString();
    remindAtUtc = computeCheckinRemindAtUtc(checkInOpenMs, now.getTime());
  } else {
    remindAtUtc = computeDayRemindAtUtc(addDaysToYmd(flight.flightDate, -1), homeTz, dailyHour);
    details += ' Add exact departure time to enable 30–60 min pre-open alert.';
  }

  const [inserted] = await db
    .insert(flightReminders)
    .values({
      flightId: flight.id,
      category: 'checkin',
      title: `Online check-in & seat selection (${flightRef})`,
      details,
      actionUrl: null,
      granularity,
      eventAtUtc,
      remindAtUtc,
      status: 'pending',
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return { ok: true, dismissedId: rem.id, created: true, checkinReminder: inserted };
}

export async function syncRemindersOnFlightUpdate(
  db: DrizzleD1Database,
  existingFlight: FlightRow,
  updatedFlight: FlightRow,
  now = new Date()
): Promise<{ autoCompletedSeatReminders: number }> {
  let autoCompletedSeatReminders = 0;

  const hadSeat = Boolean(existingFlight.seat && existingFlight.seat.trim().length > 0);
  const hasSeat = Boolean(updatedFlight.seat && updatedFlight.seat.trim().length > 0);

  if (!hadSeat && hasSeat) {
    const nowIso = now.toISOString();
    const pendingSeatRows = await db
      .select({ id: flightReminders.id })
      .from(flightReminders)
      .where(
        and(
          eq(flightReminders.flightId, updatedFlight.id),
          eq(flightReminders.category, 'seat'),
          eq(flightReminders.status, 'pending')
        )
      )
      .all();

    if (pendingSeatRows.length > 0) {
      await db
        .update(flightReminders)
        .set({
          status: 'done',
          completedAt: nowIso,
          updatedAt: now,
        })
        .where(
          and(
            eq(flightReminders.flightId, updatedFlight.id),
            eq(flightReminders.category, 'seat'),
            eq(flightReminders.status, 'pending')
          )
        );
      autoCompletedSeatReminders = pendingSeatRows.length;
    }
  }

  const timingChanged =
    existingFlight.flightDate !== updatedFlight.flightDate ||
    existingFlight.depTime !== updatedFlight.depTime ||
    existingFlight.depAirportIata !== updatedFlight.depAirportIata;

  if (timingChanged) {
    const [airportList, profile] = await Promise.all([
      db.select().from(airports).all(),
      getOwnerProfile(db),
    ]);
    const airportMap = new Map(airportList.map((a) => [a.iataCode, a]));
    await ensureRuleRemindersForFlight(db, updatedFlight, airportMap, profile, { now });
  }

  return { autoCompletedSeatReminders };
}
