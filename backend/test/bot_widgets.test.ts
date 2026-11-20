import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { airports, flightAnalysisJobs, flightReminders, flights, ownerProfile } from '../src/db/schema';
import { FlightBot, resetWidgetGateCache } from '../src/bot';
import worker, { app } from '../src/index';
import { computeCheckinRemindAtUtc } from '../src/utils/time';
import { buildGoogleCalendarUrl } from '../src/utils/calendar';
import { runScheduledReminders } from '../src/utils/scheduler';
import {
  enqueueFlightsForAnalysis,
  getAnalysisStatus,
  processAnalysisQueueWave,
} from '../src/utils/analysisQueue';
import {
  AIRPORT_REVIEW_HTML,
  FLIGHT_CARD_HTML,
  FLIGHT_DASHBOARD_HTML,
  buildAirportReviewPublicData,
  buildFlightCardPublicData,
  buildFlightListData,
  buildFlightStatsData,
  buildUpcomingFlightData,
  utf8ByteLength,
} from '../src/widgets';

function pythonZlibSize(html: string): number {
  const out = execFileSync(
    'python',
    ['-c', 'import sys, zlib; print(len(zlib.compress(sys.stdin.buffer.read(), 9)))'],
    { input: Buffer.from(html, 'utf8'), encoding: 'utf8' }
  );
  return parseInt(out.trim(), 10);
}

function assertWidgetProfileCompliant(name: string, html: string) {
  assert.ok(!html.includes('\0'), `${name}: must not contain NUL byte`);
  const rawBytes = utf8ByteLength(html);
  assert.ok(rawBytes >= 1 && rawBytes <= 32768, `${name}: raw UTF-8 bytes ${rawBytes} exceeds 32768`);
  const compressed = pythonZlibSize(html);
  assert.ok(compressed <= 4096, `${name}: zlib-9 compressed size ${compressed} exceeds 4096`);

  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/<\s*(input|select|textarea|form|label|progress|meter|dialog|iframe|embed|object)\b/i, 'forbidden HTML control'],
    [/overflow\s*:\s*(auto|scroll)/i, 'overflow auto/scroll'],
    [/position\s*:\s*sticky/i, 'position sticky'],
    [/\d+(vh|dvh|svh)\b/i, 'viewport height units'],
    [/:has\(|:focus/i, 'forbidden pseudo-selector'],
    [/text-shadow|-webkit-line-clamp|clip-path/i, 'forbidden CSS property'],
    [/margin-inline|padding-inline|padding-block|inset-inline/i, 'logical CSS property'],
    [/\b(fetch|XMLHttpRequest|navigator\.clipboard|window\.open)\b|\b(alert|confirm|prompt)\s*\(/, 'forbidden JS API'],
  ];

  for (const [re, desc] of forbiddenPatterns) {
    assert.ok(!re.test(html), `${name}: contains ${desc} (${re})`);
  }
}

function createMemoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  const mig0 = fs.readFileSync(path.resolve('drizzle/0000_typical_spiral.sql'), 'utf8');
  const mig2 = fs.readFileSync(path.resolve('drizzle/0002_add_flight_privacy.sql'), 'utf8');
  const mig3 = fs.readFileSync(path.resolve('drizzle/0003_traveler_profile_and_reminders.sql'), 'utf8');
  const mig4 = fs.readFileSync(path.resolve('drizzle/0004_async_reminder_analysis.sql'), 'utf8');
  for (const stmt of (mig0 + '\n' + mig2 + '\n' + mig3 + '\n' + mig4).split(/--> statement-breakpoint|;/)) {
    const trimmed = stmt.trim();
    if (trimmed) sqlite.exec(trimmed);
  }

  const norm = (v: unknown) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return Math.floor(v.getTime() / 1000);
    if (v instanceof Uint8Array || typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
    return String(v);
  };

  const wrap = (sqlStr: string, params: unknown[] = []): any => ({
    bind: (...p: unknown[]) => wrap(sqlStr, p.map(norm)),
    all: async () => ({ success: true, results: sqlite.prepare(sqlStr).all(...(params as any[])) }),
    run: async () => ({ success: true, meta: sqlite.prepare(sqlStr).run(...(params as any[])) }),
    first: async (col?: string) => {
      const row = sqlite.prepare(sqlStr).get(...(params as any[])) as Record<string, unknown> | undefined;
      if (!row) return null;
      return col ? row[col] : row;
    },
    raw: async () => {
      const stmt = sqlite.prepare(sqlStr);
      stmt.setReturnArrays(true);
      return stmt.all(...(params as any[]));
    },
  });

  const d1 = { prepare: (sqlStr: string) => wrap(sqlStr) } as unknown as D1Database;
  return { d1, sqlite };
}

function makeBotMock(opts: { failSendWidget?: boolean; failWidgetDesc?: string } = {}) {
  const calls: Array<{ url: string; body: any }> = [];
  const fetcher = {
    async fetch(req: Request): Promise<Response> {
      const body = await req.json().catch(() => null);
      calls.push({ url: req.url, body });
      if (req.url.endsWith('/api/sendWidget') && opts.failSendWidget) {
        return Response.json({ ok: false, description: opts.failWidgetDesc || 'widget disabled' }, { status: 400 });
      }
      return Response.json({ ok: true, result: { message_id: 99 } });
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

function dateOffsetDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

async function seedFlightsAndAirports(d1: D1Database) {
  const db = drizzle(d1);
  await db.insert(airports).values([
    { iataCode: 'HND', name: 'Tokyo Haneda International', city: '東京羽田国際空港', countryCode: 'JP', latitude: 35.5494, longitude: 139.7798, timezone: 'Asia/Tokyo' },
    { iataCode: 'KIX', name: 'Kansai International', city: '大阪関西国際空港', countryCode: 'JP', latitude: 34.432, longitude: 135.2304, timezone: 'Asia/Tokyo' },
    { iataCode: 'PEK', name: 'Beijing Capital', city: '北京首都国际机场', countryCode: 'CN', latitude: 40.0799, longitude: 116.6031, timezone: 'Asia/Shanghai' },
    { iataCode: 'YVR', name: 'Vancouver International', city: 'Vancouver', countryCode: 'CA', latitude: 49.1967, longitude: -123.1815, timezone: 'America/Vancouver' },
  ]);

  const tomorrow = dateOffsetDays(1);
  const nextWeek = dateOffsetDays(7);
  const past1 = dateOffsetDays(-10);
  const past2 = dateOffsetDays(-30);

  await db.insert(flights).values([
    { flightDate: tomorrow, airlineIata: 'JL', flightNumber: 'JL25', depAirportIata: 'HND', arrAirportIata: 'PEK', depTime: '17:20', arrTime: '20:15', distanceKm: 2094, bookingRef: 'PNR111', cabinClass: 'Business', seat: '4A', aircraftType: 'B787-9', source: 'email' },
    { flightDate: nextWeek, airlineIata: 'AC', flightNumber: 'AC4', depAirportIata: 'KIX', arrAirportIata: 'YVR', depTime: '18:00', arrTime: '11:30', distanceKm: 7900, bookingRef: 'PNR222', cabinClass: 'Economy', seat: '21C', aircraftType: 'B787-8', source: 'manual' },
    { flightDate: past1, airlineIata: 'NH', flightNumber: 'NH100', depAirportIata: 'HND', arrAirportIata: 'KIX', depTime: '08:00', arrTime: '09:15', distanceKm: 450, bookingRef: 'PNR333', cabinClass: 'Economy', seat: '12A', aircraftType: 'A321', source: 'manual' },
    { flightDate: past2, airlineIata: 'JL', flightNumber: 'JL11', depAirportIata: 'YVR', arrAirportIata: 'HND', depTime: '12:00', arrTime: '14:30', distanceKm: 7550, bookingRef: 'PNR444', cabinClass: 'Premium Economy', seat: '18D', aircraftType: 'B777-300ER', source: 'import' },
  ]);
}

test('flight-records-manager widgets obey Bot API 10.4 Widget Profile and size caps', () => {
  assertWidgetProfileCompliant('FLIGHT_DASHBOARD_HTML', FLIGHT_DASHBOARD_HTML);
  assertWidgetProfileCompliant('FLIGHT_CARD_HTML', FLIGHT_CARD_HTML);
  assertWidgetProfileCompliant('AIRPORT_REVIEW_HTML', AIRPORT_REVIEW_HTML);
});

test('flight state builders stay <= 1024 UTF-8 bytes even with CJK cities and long reasoning', () => {
  const cityMap = new Map([
    ['HND', 'とても長い日本の都市名テスト'.repeat(5)],
    ['PEK', '超级长的中国城市名称测试'.repeat(5)],
  ]);
  const sampleFlight = {
    id: 1,
    flightDate: '2026-12-01',
    airlineIata: 'JL',
    flightNumber: 'JL25',
    depAirportIata: 'HND',
    arrAirportIata: 'PEK',
    depTime: '17:20',
    arrTime: '20:15',
    distanceKm: 2094,
    bookingRef: 'VERYLONGPNR123456',
    cabinClass: 'Business Class Suite',
    seat: '1A',
    aircraftType: 'Boeing 787-9 Dreamliner',
  };

  const up = buildUpcomingFlightData([sampleFlight], 0, cityMap, '2026-11-19');
  assert.ok(utf8ByteLength(up) <= 1024, `upcoming data was ${utf8ByteLength(up)} bytes`);

  const stats = buildFlightStatsData({
    totalFlights: 999,
    totalDistanceKm: 1234567,
    uniqueAirports: 88,
    countriesVisited: 24,
    uniqueAirlines: 18,
    upcomingFlights: 5,
    monthlyCounts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    cabinBreakdown: [['Business Class Super Long Name', 40], ['Economy Plus Long', 30], ['First', 5], ['Premium', 10]],
  });
  assert.ok(utf8ByteLength(stats) <= 1024, `stats data was ${utf8ByteLength(stats)} bytes`);

  const list = buildFlightListData('srch', Array.from({ length: 10 }, (_, i) => ({ ...sampleFlight, id: i + 1 })), 0, '東京羽田検索クエリ長すぎテスト'.repeat(4));
  assert.ok(utf8ByteLength(list) <= 1024, `list data was ${utf8ByteLength(list)} bytes`);

  const card = buildFlightCardPublicData({
    kind: 'import',
    id: 1,
    flight: sampleFlight,
    depCity: 'とても長い出発都市名'.repeat(10),
    arrCity: 'とても長い到着都市名'.repeat(10),
  });
  assert.ok(utf8ByteLength(card) <= 1024, `card public_data was ${utf8ByteLength(card)} bytes`);

  const ap = buildAirportReviewPublicData({
    iataCode: 'XXX',
    name: 'Long Airport Name '.repeat(12),
    city: 'Long City Name '.repeat(12),
    countryCode: 'JP',
    latitude: 35.123456,
    longitude: 139.654321,
    timezone: 'Asia/Tokyo',
    confidence: 'low',
    reasoning: 'Uncertain coordinates because '.repeat(40),
  });
  assert.ok(utf8ByteLength(ap) <= 1024, `airport review public_data was ${utf8ByteLength(ap)} bytes`);
});

test('FlightBot enforces AUTHORIZED_CHAT_ID across message, callback_query, and widget_query', async () => {
  const { d1 } = createMemoryD1();
  const botMock = makeBotMock();
  const bot = new FlightBot(botMock.fetcher, d1, '123456');

  const unauthMsg = await bot.handleUpdate({ message: { chat: { id: 999 }, from: { id: 999 }, text: '/flight' } });
  assert.equal(unauthMsg.status, 'unauthorized');
  assert.match(botMock.calls[0].url, /\/api\/sendMessage$/);
  assert.match(botMock.calls[0].body.text, /Unauthorized/);

  botMock.calls.length = 0;
  const unauthWq = await bot.handleUpdate({ widget_query: { id: 'wq_bad', chat: { id: 999 }, from: { id: 999 }, data: 'flight:tab:stats' } });
  assert.equal(unauthWq.status, 'unauthorized');
  assert.match(botMock.calls[0].url, /\/api\/answerWidgetQuery$/);
  assert.deepEqual(JSON.parse(botMock.calls[0].body.data), { error: 'Unauthorized' });

  botMock.calls.length = 0;
  const authRes = await bot.handleUpdate({ message: { chat: { id: 123456 }, from: { id: 123456 }, text: '/flight' } });
  assert.equal(authRes.status, 'ok');
  assert.match(botMock.calls[0].url, /\/api\/sendWidget$/);
});

test('FlightBot dashboard handles tabs, next pagination, ForceReply search, flight delete, and airport review actions', async () => {
  const { d1 } = createMemoryD1();
  await seedFlightsAndAirports(d1);
  const botMock = makeBotMock();
  const bot = new FlightBot(botMock.fetcher, d1, '123456');

  // 1. /flight shows upcoming flight 0
  await bot.handleUpdate({ message: { chat: { id: 123456 }, from: { id: 123456 }, text: '/flight' } });
  assert.match(botMock.calls[0].url, /\/api\/sendWidget$/);
  const up0 = JSON.parse(botMock.calls[0].body.chat_data);
  assert.equal(up0.v, 'next');
  assert.equal(up0.tot, 2);
  assert.equal(up0.f.fn, 'JL25');

  // 2. flight:next:1 switches to AC4
  botMock.calls.length = 0;
  await bot.handleUpdate({ widget_query: { id: 'wq1', chat: { id: 123456 }, from: { id: 123456 }, message_id: 99, data: 'flight:next:1' } });
  assert.match(botMock.calls[0].url, /\/api\/editMessageWidgetData$/);
  assert.match(botMock.calls[1].url, /\/api\/answerWidgetQuery$/);
  const up1 = JSON.parse(botMock.calls[0].body.chat_data);
  assert.equal(up1.i, 1);
  assert.equal(up1.f.fn, 'AC4');

  // 3. flight:tab:stats returns 12-month array and cabin counts
  botMock.calls.length = 0;
  await bot.handleUpdate({ widget_query: { id: 'wq2', chat: { id: 123456 }, from: { id: 123456 }, message_id: 99, data: 'flight:tab:stats' } });
  const stats = JSON.parse(botMock.calls[0].body.chat_data);
  assert.equal(stats.v, 'stats');
  assert.equal(stats.tot, 4);
  assert.equal(stats.ap, 4);
  assert.equal(stats.co, 3);
  assert.equal(stats.mo.length, 12);
  assert.equal(stats.cb.find((x: any) => x[0] === 'Economy')[1], 2);

  // 4. flight:tab:hist shows past flights
  botMock.calls.length = 0;
  await bot.handleUpdate({ widget_query: { id: 'wq3', chat: { id: 123456 }, from: { id: 123456 }, message_id: 99, data: 'flight:tab:hist' } });
  const hist = JSON.parse(botMock.calls[0].body.chat_data);
  assert.equal(hist.v, 'hist');
  assert.equal(hist.n, 2);

  // 5. flight:ask_search -> ForceReply -> search results -> flight:srch:0:HND
  botMock.calls.length = 0;
  await bot.handleUpdate({ widget_query: { id: 'wq4', chat: { id: 123456 }, from: { id: 123456 }, message_id: 99, data: 'flight:ask_search' } });
  assert.match(botMock.calls[1].url, /\/api\/sendMessage$/);
  const searchPrompt = botMock.calls[1].body.text;

  botMock.calls.length = 0;
  await bot.handleUpdate({
    message: {
      chat: { id: 123456 },
      from: { id: 123456 },
      text: 'HND',
      reply_to_message: { text: searchPrompt },
    },
  });
  assert.match(botMock.calls[0].url, /\/api\/sendWidget$/);
  const srch = JSON.parse(botMock.calls[0].body.chat_data);
  assert.equal(srch.v, 'srch');
  assert.equal(srch.n, 3);

  // 6. flight:del:<id> removes row from SQLite
  const flightIdToDelete = srch.items[0].id;
  botMock.calls.length = 0;
  await bot.handleUpdate({
    widget_query: { id: 'wq5', chat: { id: 123456 }, from: { id: 123456 }, message_id: 101, data: `flight:del:${flightIdToDelete}` },
  });
  assert.equal(botMock.calls[0].body.chat_data, '{"del":1}');
  const db = drizzle(d1);
  const remaining = await db.select().from(flights).where(eq(flights.id, flightIdToDelete)).all();
  assert.equal(remaining.length, 0);

  // 7. airport:keep and airport:del
  botMock.calls.length = 0;
  await bot.handleUpdate({ widget_query: { id: 'wq6', chat: { id: 123456 }, from: { id: 123456 }, message_id: 102, data: 'airport:keep:PEK' } });
  assert.equal(botMock.calls[0].body.chat_data, '{"st":"kept"}');

  botMock.calls.length = 0;
  await bot.handleUpdate({ widget_query: { id: 'wq7', chat: { id: 123456 }, from: { id: 123456 }, message_id: 102, data: 'airport:del:YVR' } });
  assert.equal(botMock.calls[0].body.chat_data, '{"st":"deleted"}');
  const yvrAfter = await db.select().from(airports).where(eq(airports.iataCode, 'YVR')).all();
  assert.equal(yvrAfter.length, 0);
});

test('scheduled cron sends FLIGHT_CARD_HTML widget and sendWidget falls back to sendMessage on error', async () => {
  const { d1 } = createMemoryD1();
  await seedFlightsAndAirports(d1);

  const todayUtc = new Date().toISOString().split('T')[0];
  const scheduledMs = Date.parse(`${todayUtc}T10:00:00.000Z`);
  const botMock = makeBotMock();
  await worker.scheduled(
    { scheduledTime: scheduledMs },
    { DB: d1, BOT: botMock.fetcher, GEMINI_API_KEY: '', AUTHORIZED_SENDER: '' },
    {} as any
  );
  assert.equal(botMock.calls.length, 1);
  assert.match(botMock.calls[0].url, /\/api\/notify-admin$/);
  assert.equal(botMock.calls[0].body.html, FLIGHT_CARD_HTML);
  assert.equal(JSON.parse(botMock.calls[0].body.public_data).k, 'remind');
  assert.equal(JSON.parse(botMock.calls[0].body.public_data).fn, 'JL25');
  assert.equal(botMock.calls[0].body.fallback_reply_markup.inline_keyboard[0][0].copy_text.text, 'PNR111');
  assert.equal(botMock.calls[0].body.fallback_reply_markup.inline_keyboard[1][0].callback_data, 'flight_next:0');

  // Second 30-min cron tick must NOT duplicate notification
  botMock.calls.length = 0;
  await worker.scheduled(
    { scheduledTime: scheduledMs + 30 * 60_000 },
    { DB: d1, BOT: botMock.fetcher, GEMINI_API_KEY: '', AUTHORIZED_SENDER: '' },
    {} as any
  );
  assert.equal(botMock.calls.length, 0);

  resetWidgetGateCache();
  const failingBot = makeBotMock({ failSendWidget: true });
  const bot = new FlightBot(failingBot.fetcher, d1);
  await bot.handleUpdate({ message: { chat: { id: 123456 }, from: { id: 123456 }, text: '/flight_stats' } });
  assert.equal(failingBot.calls.length, 2);
  assert.match(failingBot.calls[0].url, /\/api\/sendWidget$/);
  assert.match(failingBot.calls[1].url, /\/api\/sendMessage$/);
});

test('non-widget fallback flows: Flight Menu, Prev/Next upcoming navigation, copy PNR, paginated history/search, delete & airport callbacks', async () => {
  resetWidgetGateCache();
  const { d1 } = createMemoryD1();
  await seedFlightsAndAirports(d1);
  const db = drizzle(d1);
  // Seed extra past flights so history has > 1 page (total 7 past flights)
  for (let i = 1; i <= 5; i++) {
    await db.insert(flights).values({
      flightDate: dateOffsetDays(-40 - i),
      airlineIata: 'JL',
      flightNumber: `JL${900 + i}`,
      depAirportIata: 'HND',
      arrAirportIata: 'KIX',
      bookingRef: `H${i}`,
      source: 'manual',
    });
  }

  const botMock = makeBotMock({
    failSendWidget: true,
    failWidgetDesc: 'Bad Request: INPUT_MEDIA_WIDGET_NOT_ALLOWED',
  });
  const bot = new FlightBot(botMock.fetcher, d1, '123456');

  try {
    // 1. /flight shows AeroLog Flight Menu in fallback mode and caches widget block
    await bot.handleUpdate({ message: { chat: { id: 123456 }, from: { id: 123456 }, text: '/flight' } });
    assert.equal(botMock.calls.length, 2);
    assert.match(botMock.calls[1].body.text, /AeroLog — Flight Menu/);
    const menuBtns = botMock.calls[1].body.reply_markup.inline_keyboard.flat();
    assert.ok(menuBtns.some((b: any) => b.callback_data === 'flight_next:0'));
    assert.ok(menuBtns.some((b: any) => b.callback_data === 'flight_stats'));
    assert.ok(menuBtns.some((b: any) => b.callback_data === 'flight_recent:0'));
    assert.ok(menuBtns.some((b: any) => b.callback_data === 'flight_search_prompt'));

    // 2. flight_next:0 shows JL25 with Copy PNR, Next Flight -> (1), Back to Menu
    botMock.calls.length = 0;
    await bot.handleUpdate({
      callback_query: { id: 'cb1', from: { id: 123456 }, message: { chat: { id: 123456 }, message_id: 99 }, data: 'flight_next:0' },
    });
    const up0 = botMock.calls.find((c) => c.url.endsWith('/api/editMessageText'));
    assert.ok(up0);
    assert.match(up0.body.text, /JL25/);
    const btns0 = up0.body.reply_markup.inline_keyboard.flat();
    assert.ok(btns0.some((b: any) => b.copy_text?.text === 'PNR111'));
    assert.ok(btns0.some((b: any) => b.callback_data === 'flight_next:1'));
    assert.ok(!btns0.some((b: any) => b.callback_data === 'flight_next:-1'));
    assert.ok(btns0.some((b: any) => b.callback_data === 'flight_menu'));

    // 3. flight_next:1 shows AC4 with Prev Flight (0)
    botMock.calls.length = 0;
    await bot.handleUpdate({
      callback_query: { id: 'cb2', from: { id: 123456 }, message: { chat: { id: 123456 }, message_id: 99 }, data: 'flight_next:1' },
    });
    const up1 = botMock.calls.find((c) => c.url.endsWith('/api/editMessageText'));
    assert.ok(up1);
    assert.match(up1.body.text, /AC4/);
    const btns1 = up1.body.reply_markup.inline_keyboard.flat();
    assert.ok(btns1.some((b: any) => b.callback_data === 'flight_next:0'));
    assert.ok(btns1.some((b: any) => b.copy_text?.text === 'PNR222'));

    // 4. flight_recent:1 shows Page 2/2 slice instead of repeating page 1
    botMock.calls.length = 0;
    await bot.handleUpdate({
      callback_query: { id: 'cb3', from: { id: 123456 }, message: { chat: { id: 123456 }, message_id: 99 }, data: 'flight_recent:1' },
    });
    const hist2 = botMock.calls.find((c) => c.url.endsWith('/api/editMessageText'));
    assert.ok(hist2);
    assert.match(hist2.body.text, /Page 2\/2/);
    assert.ok(hist2.body.reply_markup.inline_keyboard.flat().some((b: any) => b.callback_data === 'flight_recent:0'));

    // 5. flight_search_prompt -> ForceReply -> search page 0 & page 1
    botMock.calls.length = 0;
    await bot.handleUpdate({
      callback_query: { id: 'cb4', from: { id: 123456 }, message: { chat: { id: 123456 }, message_id: 99 }, data: 'flight_search_prompt' },
    });
    const promptMsg = botMock.calls.find((c) => c.url.endsWith('/api/sendMessage'));
    assert.ok(promptMsg?.body?.reply_markup?.force_reply);

    botMock.calls.length = 0;
    await bot.handleUpdate({
      message: {
        chat: { id: 123456 },
        from: { id: 123456 },
        text: 'HND',
        reply_to_message: { text: promptMsg!.body.text },
      },
    });
    const srchMsg = botMock.calls.find((c) => c.url.endsWith('/api/sendMessage'));
    assert.ok(srchMsg);
    assert.match(srchMsg.body.text, /Search Results for "HND" \(8/);
    assert.ok(srchMsg.body.reply_markup.inline_keyboard.flat().some((b: any) => b.callback_data === 'flight_srch:1:HND'));

    // 6. flight_del_ask -> flight_del removes row; airport:del deletes airport
    const allRows = await db.select().from(flights).all();
    const targetFlightId = allRows[0].id;
    botMock.calls.length = 0;
    await bot.handleUpdate({
      callback_query: { id: 'cb5', from: { id: 123456 }, message: { chat: { id: 123456 }, message_id: 200 }, data: `flight_del_ask:${targetFlightId}` },
    });
    const askEdit = botMock.calls.find((c) => c.url.endsWith('/api/editMessageText'));
    assert.ok(askEdit?.body.reply_markup.inline_keyboard.flat().some((b: any) => b.callback_data === `flight_del:${targetFlightId}`));

    await bot.handleUpdate({
      callback_query: { id: 'cb6', from: { id: 123456 }, message: { chat: { id: 123456 }, message_id: 200 }, data: `flight_del:${targetFlightId}` },
    });
    const afterDel = await db.select().from(flights).where(eq(flights.id, targetFlightId)).all();
    assert.equal(afterDel.length, 0);

    await bot.handleUpdate({
      callback_query: { id: 'cb7', from: { id: 123456 }, message: { chat: { id: 123456 }, message_id: 201 }, data: 'airport:del:YVR' },
    });
    const yvrAfter = await db.select().from(airports).where(eq(airports.iataCode, 'YVR')).all();
    assert.equal(yvrAfter.length, 0);

    // 7. flight_menu does not call /api/sendWidget while cached and edits back to menu
    botMock.calls.length = 0;
    await bot.handleUpdate({
      callback_query: { id: 'cb8', from: { id: 123456 }, message: { chat: { id: 123456 }, message_id: 99 }, data: 'flight_menu' },
    });
    assert.ok(!botMock.calls.some((c) => c.url.endsWith('/api/sendWidget')));
    const backMenu = botMock.calls.find((c) => c.url.endsWith('/api/editMessageText'));
    assert.match(backMenu!.body.text, /AeroLog — Flight Menu/);
  } finally {
    resetWidgetGateCache();
  }
});

test('check-in 30-60 min lead window across all minute offsets and daily digest batching', async () => {
  const minuteCases = [0, 1, 15, 29];
  const baseDate = dateOffsetDays(5);

  for (const mm of minuteCases) {
    const { d1 } = createMemoryD1();
    await seedFlightsAndAirports(d1);
    const db = drizzle(d1);
    const allFlights = await db.select().from(flights).all();
    const ac4 = allFlights.find((f) => f.flightNumber === 'AC4')!;

    const openIso = `${baseDate}T10:${String(mm).padStart(2, '0')}:00.000Z`;
    const openMs = Date.parse(openIso);
    const remindIso = computeCheckinRemindAtUtc(openMs);

    await db.insert(flightReminders).values({
      flightId: ac4.id,
      category: 'checkin',
      title: `Online check-in opens (mm=${mm})`,
      details: 'Choose free bulkhead seats.',
      actionUrl: 'https://www.aircanada.com/',
      granularity: 'exact',
      eventAtUtc: openIso,
      remindAtUtc: remindIso,
      status: 'pending',
      source: 'ai',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Simulate 30-min cron ticks from T-90m to T-0m
    const botMock = makeBotMock();
    const ticks = [
      Date.parse(`${baseDate}T08:30:00.000Z`),
      Date.parse(`${baseDate}T09:00:00.000Z`),
      Date.parse(`${baseDate}T09:30:00.000Z`),
      Date.parse(`${baseDate}T10:00:00.000Z`),
    ];

    let firedAtMs: number | null = null;
    for (const tickMs of ticks) {
      const before = botMock.calls.length;
      await runScheduledReminders(
        { DB: d1, BOT: botMock.fetcher, AUTHORIZED_CHAT_ID: '123456' },
        new Date(tickMs)
      );
      if (botMock.calls.length > before) {
        assert.equal(firedAtMs, null, `Check-in mm=${mm} must fire only once`);
        firedAtMs = tickMs;
      }
    }

    assert.notEqual(firedAtMs, null, `Check-in mm=${mm} must fire`);
    const leadMins = (openMs - firedAtMs!) / 60_000;
    assert.ok(leadMins >= 30 && leadMins <= 60, `Expected 30-60m lead for mm=${mm}, got ${leadMins}m`);
    const msgCall = botMock.calls[0];
    assert.match(msgCall.url, /\/api\/sendMessage$/);
    assert.equal(msgCall.body.chat_id, '123456');
    assert.match(msgCall.body.text, /Check-In Window Alert/);
    const btns = msgCall.body.reply_markup.inline_keyboard.flat();
    assert.ok(btns.some((b: any) => String(b.url || '').includes('calendar.google.com/calendar/render')));
    assert.ok(btns.some((b: any) => String(b.callback_data || '').startsWith('rem_snooze:')));
  }

  // Test daily digest batching + past-flight stale silencing
  const { d1 } = createMemoryD1();
  await seedFlightsAndAirports(d1);
  const db = drizzle(d1);
  const rows = await db.select().from(flights).all();
  const futureFlight = rows.find((f) => f.flightNumber === 'AC4')!;
  const pastFlight = rows.find((f) => f.flightDate < dateOffsetDays(0))!;
  const dayRemindAt = `${dateOffsetDays(2)}T09:00:00.000Z`;

  await db.insert(flightReminders).values([
    {
      flightId: futureFlight.id,
      category: 'meal',
      title: 'Book special meal',
      granularity: 'day',
      remindAtUtc: dayRemindAt,
      status: 'pending',
      source: 'ai',
    },
    {
      flightId: futureFlight.id,
      category: 'border',
      title: 'Complete eTA / Arrival card',
      granularity: 'day',
      remindAtUtc: dayRemindAt,
      status: 'pending',
      source: 'ai',
    },
    {
      flightId: pastFlight.id,
      category: 'seat',
      title: 'Stale past flight seat task',
      granularity: 'day',
      remindAtUtc: `${dateOffsetDays(-20)}T09:00:00.000Z`,
      status: 'pending',
      source: 'rule',
    },
  ]);

  const botMock = makeBotMock();
  const res = await runScheduledReminders(
    { DB: d1, BOT: botMock.fetcher, AUTHORIZED_CHAT_ID: '123456' },
    new Date(`${dateOffsetDays(2)}T09:05:00.000Z`)
  );
  assert.equal(res.processed, 2);
  assert.equal(botMock.calls.length, 1, 'Multiple day items should bundle into 1 daily digest');
  assert.match(botMock.calls[0].body.text, /Daily Pre-Flight Digest/);
  assert.match(botMock.calls[0].body.text, /Book special meal/);
  assert.match(botMock.calls[0].body.text, /Complete eTA \/ Arrival card/);
  assert.ok(!botMock.calls[0].body.text.includes('Stale past flight seat task'));

  // Confirm stale past-flight reminder got notified_at set so next run processes 0
  const staleCheck = await db.select().from(flightReminders).all();
  const staleRow = staleCheck.find((r) => r.title === 'Stale past flight seat task')!;
  assert.ok(staleRow.notifiedAt, 'Stale past-flight reminder should be silenced');
});

test('Telegram /reminders command, rem_done, rem_dis, rem_snooze callbacks and authorization gate', async () => {
  const { d1 } = createMemoryD1();
  await seedFlightsAndAirports(d1);
  const db = drizzle(d1);
  const futureFlight = (await db.select().from(flights).all()).find((f) => f.flightNumber === 'AC4')!;

  const inserted = await db
    .insert(flightReminders)
    .values([
      {
        flightId: futureFlight.id,
        category: 'seat',
        title: 'Pick JAL seat',
        granularity: 'day',
        remindAtUtc: `${dateOffsetDays(1)}T09:00:00.000Z`,
        status: 'pending',
        source: 'rule',
      },
      {
        flightId: futureFlight.id,
        category: 'checkin',
        title: 'Online check-in opens',
        granularity: 'exact',
        eventAtUtc: `${dateOffsetDays(6)}T10:00:00.000Z`,
        remindAtUtc: `${dateOffsetDays(6)}T09:00:00.000Z`,
        status: 'pending',
        source: 'ai',
      },
    ])
    .returning();

  const botMock = makeBotMock({ failSendWidget: true });
  const bot = new FlightBot(botMock.fetcher, d1, '123456');

  // Unauthorized /reminders rejected
  await bot.handleUpdate({ message: { chat: { id: 999999 }, from: { id: 999999 }, text: '/reminders' } });
  assert.match(botMock.calls[0].body.text, /Unauthorized/i);

  // Authorized /reminders lists pending items with GCal & Done/Dismiss buttons
  botMock.calls.length = 0;
  await bot.handleUpdate({ message: { chat: { id: 123456 }, from: { id: 123456 }, text: '/reminders' } });
  const listCall = botMock.calls.find((c) => c.url.endsWith('/api/sendMessage'));
  assert.ok(listCall);
  assert.match(listCall.body.text, /Pre-Flight Checklist \(2 pending\)/);
  const listBtns = listCall.body.reply_markup.inline_keyboard.flat();
  assert.ok(listBtns.some((b: any) => b.callback_data === `rem_done:${inserted[0].id}`));
  assert.ok(listBtns.some((b: any) => String(b.url || '').includes('calendar.google.com')));

  // rem_done marks first item done
  botMock.calls.length = 0;
  await bot.handleUpdate({
    callback_query: {
      id: 'cb_done',
      from: { id: 123456 },
      message: { chat: { id: 123456 }, message_id: 50 },
      data: `rem_done:${inserted[0].id}`,
    },
  });
  const [doneRow] = await db.select().from(flightReminders).where(eq(flightReminders.id, inserted[0].id));
  assert.equal(doneRow.status, 'done');
  assert.ok(doneRow.completedAt);

  // rem_snooze:id:30 shifts remindAtUtc forward and clears notifiedAt
  await bot.handleUpdate({
    callback_query: {
      id: 'cb_snz',
      from: { id: 123456 },
      message: { chat: { id: 123456 }, message_id: 51 },
      data: `rem_snooze:${inserted[1].id}:30`,
    },
  });
  const [snoozedRow] = await db.select().from(flightReminders).where(eq(flightReminders.id, inserted[1].id));
  assert.equal(snoozedRow.status, 'pending');
  assert.equal(snoozedRow.notifiedAt, null);
  assert.ok(Date.parse(snoozedRow.remindAtUtc) > Date.parse(`${dateOffsetDays(6)}T09:00:00.000Z`));

  // rem_dis marks item dismissed
  await bot.handleUpdate({
    callback_query: {
      id: 'cb_dis',
      from: { id: 123456 },
      message: { chat: { id: 123456 }, message_id: 52 },
      data: `rem_dis:${inserted[1].id}`,
    },
  });
  const [disRow] = await db.select().from(flightReminders).where(eq(flightReminders.id, inserted[1].id));
  assert.equal(disRow.status, 'dismissed');
});

test('privacy isolation, Traveler Profile API, seat auto-completion & ICS calendar export', async () => {
  const { d1 } = createMemoryD1();
  await seedFlightsAndAirports(d1);
  const env = {
    DB: d1,
    GEMINI_API_KEY: '',
    AUTHORIZED_SENDER: '',
    DEV_BYPASS_AUTH: 'true',
  } as any;
  const noBypassEnv = { DB: d1, GEMINI_API_KEY: '', AUTHORIZED_SENDER: '' } as any;

  // 1. Unauthorized requests to /admin/api/profile or /admin/api/reminders are rejected (both Mode A & Mode B)
  const unauthProd = await app.request(
    'https://flights.cyblocker.com/admin/api/profile',
    {},
    noBypassEnv
  );
  assert.equal(unauthProd.status, 401);
  const unauthModeA = await app.request(
    'http://localhost/admin/api/reminders',
    {},
    { ...noBypassEnv, CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' }
  );
  assert.equal(unauthModeA.status, 401);

  // 2. Owner updates optional profile fields (sensitive citizenship/residency)
  const putRes = await app.request(
    'http://localhost/admin/api/profile',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        citizenships: 'JP',
        residencyCountry: 'JP',
        residencyStatus: 'Permanent Resident',
        homeTimezone: 'Asia/Tokyo',
        dailyReminderHour: 8,
      }),
    },
    env
  );
  assert.equal(putRes.status, 200);
  const savedProfile: any = await putRes.json();
  assert.equal(savedProfile.citizenships, 'JP');
  assert.equal(savedProfile.homeTimezone, 'Asia/Tokyo');
  assert.equal(savedProfile.dailyReminderHour, 8);

  // Confirm public API never leaks profile or reminder strings
  const [pubFlights, pubStats] = await Promise.all([
    app.request('http://localhost/api/flights', {}, noBypassEnv).then((r) => r.text()),
    app.request('http://localhost/api/stats', {}, noBypassEnv).then((r) => r.text()),
  ]);
  assert.ok(!pubFlights.includes('Permanent Resident'));
  assert.ok(!pubStats.includes('Asia/Tokyo'));

  // 3. Creating flight with blank seat auto-creates rule seat & departure reminders, updating seat auto-completes seat reminder
  const futureDate = dateOffsetDays(10);
  const createRes = await app.request(
    'http://localhost/admin/api/flights',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightDate: futureDate,
        airlineIata: 'LX',
        flightNumber: 'LX161',
        depAirportIata: 'HND',
        arrAirportIata: 'YVR',
        depTime: '11:00',
        bookingRef: 'SWISS1',
        seat: '',
      }),
    },
    env
  );
  assert.equal(createRes.status, 201);
  const createdFlight: any = await createRes.json();

  const listRemRes = await app.request(
    `http://localhost/admin/api/reminders?flightId=${createdFlight.id}`,
    {},
    env
  );
  const remsForFlight: any[] = await listRemRes.json();
  const seatRem = remsForFlight.find((r) => r.category === 'seat');
  assert.ok(seatRem, 'Seat reminder should be created automatically when seat is empty');
  assert.equal(seatRem.status, 'pending');

  const updateRes = await app.request(
    `http://localhost/admin/api/flights/${createdFlight.id}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat: '14A' }),
    },
    env
  );
  assert.equal(updateRes.status, 200);
  const updatedFlight: any = await updateRes.json();
  assert.equal(updatedFlight.autoCompletedSeatReminders, 1);

  const afterSeatList: any[] = await app
    .request(`http://localhost/admin/api/reminders?flightId=${createdFlight.id}`, {}, env)
    .then((r) => r.json());
  assert.equal(afterSeatList.find((r) => r.id === seatRem.id).status, 'done');

  // 4. Custom exact check-in reminder + ICS download + Google Calendar link
  const customRes = await app.request(
    'http://localhost/admin/api/reminders',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightId: createdFlight.id,
        category: 'checkin',
        title: 'SWISS Check-In',
        details: 'Choose exit row',
        actionUrl: 'https://www.swiss.com/',
        granularity: 'exact',
        eventDate: dateOffsetDays(9),
        eventTime: '11:00',
        eventTimezone: 'Asia/Tokyo',
      }),
    },
    env
  );
  assert.equal(customRes.status, 201);
  const customRem: any = await customRes.json();
  assert.equal(customRem.granularity, 'exact');

  const icsRes = await app.request(`http://localhost/admin/api/reminders/${customRem.id}/ics`, {}, env);
  assert.equal(icsRes.status, 200);
  assert.match(icsRes.headers.get('content-type') || '', /text\/calendar/);
  const icsText = await icsRes.text();
  assert.match(icsText, /BEGIN:VCALENDAR/);
  assert.match(icsText, /TRIGGER:-PT30M/);
  assert.match(icsText, /SUMMARY:LX161: SWISS Check-In/);

  const gcal = buildGoogleCalendarUrl(customRem, 'Asia/Tokyo');
  assert.match(gcal, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(gcal, /dates=\d{8}T\d{6}Z%2F\d{8}T\d{6}Z/);
});

test('async analysis queue lock, stale lock recovery, empty completion & light-fare seat-to-checkin conversion', async () => {
  const { d1 } = createMemoryD1();
  await seedFlightsAndAirports(d1);
  const db = drizzle(d1);
  const env = { DB: d1, GEMINI_API_KEY: '', AUTHORIZED_SENDER: '', DEV_BYPASS_AUTH: 'true' } as any;
  const prodNoAuthEnv = { DB: d1, GEMINI_API_KEY: '', AUTHORIZED_SENDER: '' } as any;

  // 1. Unauthorized GET /admin/api/reminders/analysis-status rejected
  const unauthStatus = await app.request(
    'https://flights.cyblocker.com/admin/api/reminders/analysis-status',
    {},
    prodNoAuthEnv
  );
  assert.equal(unauthStatus.status, 401);

  // 2. Concurrent / duplicate POST /admin/api/reminders/generate-all returns 202 and deduplicates active jobs
  const gen1Res = await app.request(
    'http://localhost/admin/api/reminders/generate-all',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    env
  );
  assert.equal(gen1Res.status, 202);
  const gen1Body: any = await gen1Res.json();
  assert.equal(gen1Body.accepted, true);
  assert.equal(gen1Body.enqueuedCount, 2);
  assert.equal(gen1Body.status.isActive, true);
  assert.equal(gen1Body.status.queued, 2);

  // Duplicate trigger while queued skips already-queued flights
  const gen2Res = await app.request(
    'http://localhost/admin/api/reminders/generate-all',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    env
  );
  assert.equal(gen2Res.status, 202);
  const gen2Body: any = await gen2Res.json();
  assert.equal(gen2Body.alreadyRunning, true);
  assert.equal(gen2Body.enqueuedCount, 0);

  // 3. Stale 'running' lock (>2 min old) auto-recovers to 'queued'
  const allJobs = await db.select().from(flightAnalysisJobs).all();
  const staleTime = new Date(Date.now() - 3 * 60_000).toISOString();
  await db
    .update(flightAnalysisJobs)
    .set({ status: 'running', startedAt: staleTime, updatedAt: staleTime })
    .where(eq(flightAnalysisJobs.flightId, allJobs[0].flightId));

  const recoveredStatus = await getAnalysisStatus(db);
  assert.equal(recoveredStatus.queued, 2);
  assert.equal(recoveredStatus.running, 0);

  // 4. Empty-result AI completion marks 'completed' so subsequent generate-all (force=false) skips
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      candidates: [{ content: { parts: [{ text: '[]' }] } }],
    })) as any;

  try {
    const wave = await processAnalysisQueueWave({ DB: d1, GEMINI_API_KEY: 'test-key' });
    assert.equal(wave.processed, 2);
    assert.equal(wave.failed, 0);
    assert.equal(wave.remainingQueued, 0);
  } finally {
    globalThis.fetch = origFetch;
  }

  const afterDone = await app.request('http://localhost/admin/api/reminders/analysis-status', {}, env);
  const afterStatus: any = await afterDone.json();
  assert.equal(afterStatus.isActive, false);
  assert.equal(afterStatus.completed, 2);

  const gen3Res = await app.request(
    'http://localhost/admin/api/reminders/generate-all',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    env
  );
  const gen3Body: any = await gen3Res.json();
  assert.equal(gen3Body.enqueuedCount, 0);
  assert.equal(gen3Body.alreadyRunning, false);

  // 5. Enqueue skip check when running non-stale
  await db
    .update(flightAnalysisJobs)
    .set({ status: 'running', startedAt: new Date().toISOString() })
    .where(eq(flightAnalysisJobs.flightId, allJobs[0].flightId));
  const { skippedActiveIds } = await enqueueFlightsForAnalysis(db, [allJobs[0].flightId]);
  assert.deepEqual(skippedActiveIds, [allJobs[0].flightId]);

  // 6. NH40-style flight (empty seat -> convert-to-checkin API & Telegram rem_to_chk)
  const nhRes = await app.request(
    'http://localhost/admin/api/flights',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightDate: dateOffsetDays(6),
        airlineIata: 'NH',
        flightNumber: 'NH40',
        depAirportIata: 'HND',
        arrAirportIata: 'KIX',
        depTime: '20:20',
        seat: '',
      }),
    },
    env
  );
  const nhFlight: any = await nhRes.json();
  const nhRems: any[] = await app
    .request(`http://localhost/admin/api/reminders?flightId=${nhFlight.id}`, {}, env)
    .then((r) => r.json());
  const nhSeatRem = nhRems.find((r) => r.category === 'seat');
  assert.ok(nhSeatRem);

  const convRes = await app.request(
    `http://localhost/admin/api/reminders/${nhSeatRem.id}/convert-to-checkin`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    env
  );
  assert.equal(convRes.status, 200);
  const convBody: any = await convRes.json();
  assert.equal(convBody.created, true);
  assert.equal(convBody.checkinReminder.category, 'checkin');
  assert.equal(convBody.checkinReminder.granularity, 'exact');
  const openMs = Date.parse(convBody.checkinReminder.eventAtUtc);
  const remMs = Date.parse(convBody.checkinReminder.remindAtUtc);
  assert.equal(openMs - remMs, 60 * 60_000, 'Remind time must be 60m prior to T-24h check-in open');

  // 7. Light fare note suppresses rule seat reminder & creates check-in reminder automatically
  const lightRes = await app.request(
    'http://localhost/admin/api/flights',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightDate: dateOffsetDays(8),
        airlineIata: 'NH',
        flightNumber: 'NH42',
        depAirportIata: 'HND',
        arrAirportIata: 'KIX',
        depTime: '18:00',
        seat: '',
        notes: 'ANA Simple fare - seat at check-in',
      }),
    },
    env
  );
  const lightFlight: any = await lightRes.json();
  const lightRems: any[] = await app
    .request(`http://localhost/admin/api/reminders?flightId=${lightFlight.id}`, {}, env)
    .then((r) => r.json());
  assert.ok(!lightRems.some((r) => r.category === 'seat'), 'Light/Simple fare must not create seat task');
  assert.ok(
    lightRems.some((r) => r.category === 'checkin' && r.granularity === 'exact'),
    'Light/Simple fare should create exact check-in task automatically'
  );

  // 8. Telegram rem_to_chk callback switches a pending seat task
  const jlManualFlight = await app
    .request(
      'http://localhost/admin/api/flights',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flightDate: dateOffsetDays(9),
          airlineIata: 'JL',
          flightNumber: 'JL111',
          depAirportIata: 'HND',
          arrAirportIata: 'KIX',
          depTime: '15:00',
          seat: '',
        }),
      },
      env
    )
    .then((r) => r.json() as Promise<any>);
  const jlRems: any[] = await app
    .request(`http://localhost/admin/api/reminders?flightId=${jlManualFlight.id}`, {}, env)
    .then((r) => r.json());
  const jlSeat = jlRems.find((r) => r.category === 'seat')!;

  const botMock = makeBotMock({ failSendWidget: true });
  const bot = new FlightBot(botMock.fetcher, d1, '123456');
  await bot.handleUpdate({
    callback_query: {
      id: 'cb_conv',
      from: { id: 123456 },
      message: { chat: { id: 123456 }, message_id: 77 },
      data: `rem_to_chk:${jlSeat.id}`,
    },
  });
  const editMsg = botMock.calls.find((c) => c.url.endsWith('/api/editMessageText'));
  assert.ok(editMsg);
  assert.match(editMsg.body.text, /Switched to Check-In Reminder/);
});
