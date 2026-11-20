import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { airports, flights } from '../src/db/schema';
import { FlightBot, resetWidgetGateCache } from '../src/bot';
import worker from '../src/index';
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
  for (const stmt of (mig0 + '\n' + mig2).split(/--> statement-breakpoint|;/)) {
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

  const botMock = makeBotMock();
  await worker.scheduled({}, { DB: d1, BOT: botMock.fetcher, GEMINI_API_KEY: '', AUTHORIZED_SENDER: '' }, {} as any);
  assert.equal(botMock.calls.length, 1);
  assert.match(botMock.calls[0].url, /\/api\/notify-admin$/);
  assert.equal(botMock.calls[0].body.html, FLIGHT_CARD_HTML);
  assert.equal(JSON.parse(botMock.calls[0].body.public_data).k, 'remind');
  assert.equal(JSON.parse(botMock.calls[0].body.public_data).fn, 'JL25');
  assert.equal(botMock.calls[0].body.fallback_reply_markup.inline_keyboard[0][0].copy_text.text, 'PNR111');
  assert.equal(botMock.calls[0].body.fallback_reply_markup.inline_keyboard[1][0].callback_data, 'flight_next:0');

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
