import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { airports, flightAnalysisJobs, flightReminders, flights } from '../db/schema';
import { FLIGHT_CARD_HTML, buildFlightCardPublicData, formatFlightRef } from '../widgets';
import { processAnalysisQueueWave } from './analysisQueue';
import { buildGoogleCalendarUrl, sanitizeHttpsUrl } from './calendar';
import {
  getOwnerProfile,
  resolveProfilePrefs,
  type AirportRow,
  type FlightReminderRow,
  type FlightRow,
} from './logistics';
import {
  addDaysToYmd,
  computeDayRemindAtUtc,
  formatLocalDateTime,
  getLocalYmdInTz,
  toAirportUtcMs,
} from './time';

export interface SchedulerEnv {
  DB: D1Database;
  BOT?: Fetcher;
  AUTHORIZED_CHAT_ID?: string;
  GEMINI_API_KEY?: string;
}

async function drainAnalysisQueueIfPending(env: SchedulerEnv, now: Date) {
  if (!env.GEMINI_API_KEY) return;
  try {
    const db = drizzle(env.DB);
    const pendingJobs = await db
      .select({ flightId: flightAnalysisJobs.flightId })
      .from(flightAnalysisJobs)
      .where(inArray(flightAnalysisJobs.status, ['queued', 'running']))
      .limit(1)
      .all();
    if (pendingJobs.length > 0) {
      await processAnalysisQueueWave(env, { now });
    }
  } catch (err) {
    console.error('Scheduler failed draining analysis queue:', err);
  }
}

function escapeMd(text: unknown): string {
  return String(text ?? '').replace(/([_*`\[])/g, '\\$1');
}

function truncateLabel(text: string, maxLen = 24): string {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + '…';
}

function getCategoryEmoji(category: string): string {
  switch (category) {
    case 'seat':
      return '💺';
    case 'meal':
      return '🍽';
    case 'border':
      return '🛂';
    case 'checkin':
      return '🛎';
    case 'departure':
      return '✈️';
    default:
      return '📌';
  }
}

async function sendBotMessage(
  env: SchedulerEnv,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<boolean> {
  if (!env.BOT) return false;

  const chatId = env.AUTHORIZED_CHAT_ID?.trim();
  const endpoint = chatId ? 'http://bot/api/sendMessage' : 'http://bot/api/notify-admin';
  const payload: Record<string, unknown> = {
    ...(chatId ? { chat_id: chatId } : {}),
    text,
    parse_mode: 'Markdown',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };

  try {
    const res = await env.BOT.fetch(
      new Request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );
    const data: any = await res.json().catch(() => null);
    if (!res.ok || (data && data.ok === false)) {
      if (String(data?.description || '').includes("can't parse entities")) {
        const plainPayload = { ...payload };
        delete plainPayload.parse_mode;
        const retryRes = await env.BOT.fetch(
          new Request(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(plainPayload),
          })
        );
        const retryData: any = await retryRes.json().catch(() => null);
        return retryRes.ok && retryData?.ok !== false;
      }
      console.error('Scheduler Telegram error:', data?.description || `HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Scheduler failed calling BOT:', err);
    return false;
  }
}

export async function runScheduledReminders(
  env: SchedulerEnv,
  now = new Date()
): Promise<{ processed: number }> {
  const db = drizzle(env.DB);
  const profile = await getOwnerProfile(db);
  const { homeTz, dailyHour } = resolveProfilePrefs(profile);
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const todayLocal = getLocalYmdInTz(nowMs, homeTz);
  const tomorrowLocal = addDaysToYmd(todayLocal, 1);

  // Backfill rule departure reminders for legacy flights departing tomorrow (indexed by flight_date)
  const tomorrowFlights = await db
    .select()
    .from(flights)
    .where(eq(flights.flightDate, tomorrowLocal))
    .all();

  if (tomorrowFlights.length > 0) {
    const flightIds = tomorrowFlights.map((f) => f.id);
    const existingForTomorrow = await db
      .select()
      .from(flightReminders)
      .where(inArray(flightReminders.flightId, flightIds))
      .all();
    const depSet = new Set(
      existingForTomorrow.filter((r) => r.category === 'departure').map((r) => r.flightId)
    );

    const depRemindAtUtc = computeDayRemindAtUtc(todayLocal, homeTz, dailyHour);
    const missingDepFlights = tomorrowFlights.filter((f) => !depSet.has(f.id));
    if (missingDepFlights.length > 0) {
      const allAirports = await db.select().from(airports).all();
      const tzMap = new Map(allAirports.map((a) => [a.iataCode, a.timezone]));
      for (const f of missingDepFlights) {
        const depTz = tzMap.get(f.depAirportIata) || homeTz || 'UTC';
        const depUtcMs = toAirportUtcMs(f.flightDate, f.depTime || '09:00', depTz);
        const ref = formatFlightRef(f.airlineIata, f.flightNumber);
        await db.insert(flightReminders).values({
          flightId: f.id,
          category: 'departure',
          title: `Flight Tomorrow: ${ref} (${f.depAirportIata} → ${f.arrAirportIata})`,
          details: `Departs ${f.depTime || 'TBD'} local from ${f.depAirportIata}.`,
          actionUrl: null,
          granularity: 'day',
          eventAtUtc: new Date(depUtcMs || nowMs).toISOString(),
          remindAtUtc: depRemindAtUtc,
          status: 'pending',
          source: 'rule',
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // Fetch all due, unnotified, pending reminders using composite index
  const due = await db
    .select()
    .from(flightReminders)
    .where(
      and(
        eq(flightReminders.status, 'pending'),
        isNull(flightReminders.notifiedAt),
        lte(flightReminders.remindAtUtc, nowIso)
      )
    )
    .orderBy(asc(flightReminders.remindAtUtc), asc(flightReminders.id))
    .all();

  if (due.length === 0 || !env.BOT) {
    await drainAnalysisQueueIfPending(env, now);
    return { processed: 0 };
  }

  const dueFlightIds = Array.from(
    new Set(due.map((r) => r.flightId).filter((id): id is number => id !== null && id !== undefined))
  );

  const [relatedFlights, allAirports, allFlightPending] = await Promise.all([
    dueFlightIds.length > 0
      ? db.select().from(flights).where(inArray(flights.id, dueFlightIds)).all()
      : Promise.resolve([] as FlightRow[]),
    dueFlightIds.length > 0 ? db.select().from(airports).all() : Promise.resolve([] as AirportRow[]),
    dueFlightIds.length > 0
      ? db
          .select()
          .from(flightReminders)
          .where(and(eq(flightReminders.status, 'pending'), isNull(flightReminders.completedAt)))
          .all()
      : Promise.resolve([] as FlightReminderRow[]),
  ]);

  const flightMap = new Map(relatedFlights.map((f) => [f.id, f]));
  const cityMap = new Map(allAirports.map((a) => [a.iataCode, a.city]));

  // Silence stale reminders tied to past completed flights (< todayLocal) so cron skips them on future ticks
  const activeDue: FlightReminderRow[] = [];
  const staleDueIds: number[] = [];
  for (const r of due) {
    if (r.flightId) {
      const f = flightMap.get(r.flightId);
      if (f && f.flightDate < todayLocal) {
        staleDueIds.push(r.id);
        continue;
      }
    }
    activeDue.push(r);
  }

  if (staleDueIds.length > 0) {
    await db
      .update(flightReminders)
      .set({ notifiedAt: nowIso, updatedAt: now })
      .where(inArray(flightReminders.id, staleDueIds));
  }

  if (activeDue.length === 0) {
    await drainAnalysisQueueIfPending(env, now);
    return { processed: 0 };
  }

  const pendingByFlight = new Map<number, FlightReminderRow[]>();
  for (const p of allFlightPending) {
    if (p.flightId && p.category !== 'departure' && p.status === 'pending') {
      const list = pendingByFlight.get(p.flightId) || [];
      list.push(p);
      pendingByFlight.set(p.flightId, list);
    }
  }

  let processed = 0;
  const departureReminders = activeDue.filter((r) => r.category === 'departure' && r.flightId);
  const exactReminders = activeDue.filter((r) => r.category !== 'departure' && r.granularity === 'exact');
  const dayReminders = activeDue.filter((r) => r.category !== 'departure' && r.granularity !== 'exact');

  // Bucket 1: Departure reminders (preserve FLIGHT_CARD_HTML widget + fallback contract)
  for (const rem of departureReminders) {
    const flight = rem.flightId ? flightMap.get(rem.flightId) : undefined;
    if (!flight) continue;

    const flightRef = formatFlightRef(flight.airlineIata, flight.flightNumber);
    const otherPending = pendingByFlight.get(flight.id) || [];

    let msg =
      `✈️ *Upcoming Flight Reminder (Tomorrow)*\n\n` +
      `*Flight*: ${escapeMd(flightRef)}\n` +
      `*Route*: ${escapeMd(flight.depAirportIata)} → ${escapeMd(flight.arrAirportIata)}\n` +
      `*Time*: ${escapeMd(flight.depTime || 'TBD')}\n`;

    if (otherPending.length > 0) {
      msg += `\n📋 *Pending Checklist:*\n`;
      for (const item of otherPending.slice(0, 4)) {
        msg += `• ${getCategoryEmoji(item.category)} ${escapeMd(item.title)}\n`;
      }
      if (otherPending.length > 4) {
        msg += `• _+${otherPending.length - 4} more item(s)_\n`;
      }
    }
    msg += `\nSafe travels!`;

    const cardPublicData = buildFlightCardPublicData({
      kind: 'remind',
      id: flight.id,
      flight,
      depCity: cityMap.get(flight.depAirportIata) ?? null,
      arrCity: cityMap.get(flight.arrAirportIata) ?? null,
    });

    const remindRows: any[][] = [];
    const trimmedPnr = String(flight.bookingRef || '').trim();
    if (trimmedPnr.length >= 1 && trimmedPnr.length <= 256) {
      remindRows.push([{ text: `📋 Copy PNR (${trimmedPnr})`, copy_text: { text: trimmedPnr } }]);
    }
    remindRows.push([{ text: '🕒 Upcoming Flights', callback_data: 'flight_next:0' }]);
    if (otherPending.length > 0) {
      remindRows.push([{ text: `📋 Checklist (${otherPending.length})`, callback_data: 'flight_rem_list:0' }]);
    }

    try {
      const res = await env.BOT.fetch(
        new Request('http://bot/api/notify-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html: FLIGHT_CARD_HTML,
            public_data: cardPublicData,
            chat_data: '{"del":0}',
            allow_queries: false,
            caption: `⏰ Flight Tomorrow: ${flightRef} (${flight.depAirportIata} → ${flight.arrAirportIata} at ${flight.depTime || 'TBD'})`,
            fallback_text: msg,
            fallback_parse_mode: 'Markdown',
            fallback_reply_markup: { inline_keyboard: remindRows },
          }),
        })
      );
      const resData: any = await res.json().catch(() => null);
      if (res.ok && resData?.ok !== false) {
        await db
          .update(flightReminders)
          .set({ notifiedAt: nowIso, updatedAt: now })
          .where(eq(flightReminders.id, rem.id));
        processed++;
      }
    } catch (err) {
      console.error('Failed sending departure widget:', err);
    }
  }

  // Bucket 2: Exact-window reminders (e.g. Check-in T-30..60m alerts)
  for (const rem of exactReminders) {
    const flight = rem.flightId ? flightMap.get(rem.flightId) : undefined;
    const flightRef = flight ? formatFlightRef(flight.airlineIata, flight.flightNumber) : null;
    const openIso = rem.eventAtUtc || rem.remindAtUtc;
    const openMs = Date.parse(openIso);
    const diffMins = Number.isNaN(openMs) ? null : Math.round((openMs - nowMs) / 60_000);
    const countdownText =
      diffMins === null
        ? ''
        : diffMins > 0
          ? ` (in ~${diffMins} min)`
          : diffMins > -180
            ? ' (window open now)'
            : '';

    let text = `🛎 *Check-In Window Alert*\n\n`;
    if (flight && flightRef) {
      text += `*Flight:* ${escapeMd(flightRef)} (${escapeMd(flight.depAirportIata)} → ${escapeMd(flight.arrAirportIata)}) · ${escapeMd(flight.flightDate)}\n`;
    }
    text += `*Task:* ${escapeMd(rem.title)}\n`;
    text += `*Opens:* ${escapeMd(formatLocalDateTime(openIso, homeTz))}${escapeMd(countdownText)}\n`;
    if (flight?.bookingRef) {
      text += `*PNR:* \`${escapeMd(flight.bookingRef)}\`\n`;
    }
    if (rem.details) {
      text += `\n${escapeMd(rem.details)}`;
    }

    const gcalUrl = buildGoogleCalendarUrl({
      title: flightRef ? `${flightRef}: ${rem.title}` : rem.title,
      details: rem.details,
      actionUrl: rem.actionUrl,
      granularity: 'exact',
      eventAtUtc: rem.eventAtUtc,
      remindAtUtc: rem.remindAtUtc,
      homeTz,
    });
    const safeActionUrl = sanitizeHttpsUrl(rem.actionUrl);

    const rows: any[][] = [];
    const trimmedPnr = String(flight?.bookingRef || '').trim();
    if (trimmedPnr.length >= 1 && trimmedPnr.length <= 256) {
      rows.push([{ text: `📋 Copy PNR (${trimmedPnr})`, copy_text: { text: trimmedPnr } }]);
    }
    const linkRow: any[] = [];
    if (safeActionUrl) {
      linkRow.push({ text: '🔗 Check-In / Portal', url: safeActionUrl });
    }
    linkRow.push({ text: '📅 Google Calendar', url: gcalUrl });
    rows.push(linkRow);
    rows.push([
      { text: '✅ Done', callback_data: `flight_rem_done:${rem.id}` },
      { text: '⏰ +30m', callback_data: `flight_rem_snooze:${rem.id}:30` },
      { text: '❌ Dismiss', callback_data: `flight_rem_dis:${rem.id}` },
    ]);

    const ok = await sendBotMessage(env, text, { inline_keyboard: rows });
    if (ok) {
      await db
        .update(flightReminders)
        .set({ notifiedAt: nowIso, updatedAt: now })
        .where(eq(flightReminders.id, rem.id));
      processed++;
    }
  }

  // Bucket 3: Bundled Daily Pre-Flight Digest for all due day-level reminders
  if (dayReminders.length > 0) {
    const grouped = new Map<string, { header: string; items: FlightReminderRow[] }>();
    for (const rem of dayReminders) {
      const flight = rem.flightId ? flightMap.get(rem.flightId) : undefined;
      const key = flight ? `f:${flight.id}` : 'general';
      if (!grouped.has(key)) {
        const header = flight
          ? `*${escapeMd(formatFlightRef(flight.airlineIata, flight.flightNumber))}* (${escapeMd(flight.depAirportIata)}→${escapeMd(flight.arrAirportIata)}) · ${escapeMd(flight.flightDate)}${flight.bookingRef ? ` · PNR \`${escapeMd(flight.bookingRef)}\`` : ''}`
          : `*General Travel Checklist*`;
        grouped.set(key, { header, items: [] });
      }
      grouped.get(key)!.items.push(rem);
    }

    let digestText = `📋 *Daily Pre-Flight Digest* (${dayReminders.length} item${dayReminders.length > 1 ? 's' : ''})\n`;
    for (const group of grouped.values()) {
      digestText += `\n${group.header}\n`;
      for (const item of group.items) {
        digestText += `• ${getCategoryEmoji(item.category)} *${escapeMd(item.title)}*\n`;
        if (item.details) {
          digestText += `  _${escapeMd(truncateLabel(item.details, 150))}_\n`;
        }
        const safeUrl = sanitizeHttpsUrl(item.actionUrl);
        if (safeUrl) {
          digestText += `  [Official Portal](${safeUrl.replace(/\)/g, '%29')})\n`;
        }
      }
    }

    if (digestText.length > 3900) {
      digestText = digestText.slice(0, 3850) + '\n…_(open /admin or Checklist for full list)_';
    }

    const digestRows: any[][] = dayReminders.slice(0, 6).map((rem) => [
      {
        text: `✅ Done: ${truncateLabel(rem.title, 26)}`,
        callback_data: `flight_rem_done:${rem.id}`,
      },
    ]);
    digestRows.push([{ text: '📋 View Full Checklist', callback_data: 'flight_rem_list:0' }]);

    const ok = await sendBotMessage(env, digestText, { inline_keyboard: digestRows });
    if (ok) {
      await db
        .update(flightReminders)
        .set({ notifiedAt: nowIso, updatedAt: now })
        .where(inArray(flightReminders.id, dayReminders.map((r) => r.id)));
      processed += dayReminders.length;
    }
  }

  await drainAnalysisQueueIfPending(env, now);
  return { processed };
}
