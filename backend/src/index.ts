import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { flights, airports } from './db/schema';
import PostalMime from 'postal-mime';
import { extractFlightsFromEmail, getAirportDetails, isValidIataCode, type InlineAttachmentPart } from './utils/gemini';
import { FlightBot } from './bot';
import { calculateDistance } from './utils/geo';
import {
  AIRPORT_REVIEW_HTML,
  FLIGHT_CARD_HTML,
  buildAirportReviewPublicData,
  buildFlightCardPublicData,
  formatFlightRef,
} from './widgets';
import {
  computePublicReleaseDate,
  generatePublishDelayDays,
  isFlightPubliclyVisible,
  toPublicFlight,
} from './utils/privacy';
import { verifyOwnerRequest } from './utils/auth';

function runWaitUntil(c: any, promise: Promise<unknown>) {
  const safe = promise.catch((err) => console.error('Background notification error:', err));
  try {
    const ctx = c.executionCtx;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(safe);
      return;
    }
  } catch {
    // ExecutionContext may be omitted in unit tests
  }
}

function toNullableString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) {
    const joined = val.map(v => String(v ?? '').trim()).filter(Boolean).join(', ');
    return joined || null;
  }
  const str = String(val).trim();
  return str.length > 0 ? str : null;
}

function bytesToBase64(content: ArrayBuffer | Uint8Array | string, encoding?: string): string {
  if (typeof content === 'string') {
    return encoding === 'base64' ? content : btoa(unescape(encodeURIComponent(content)));
  }
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function bytesToText(content: ArrayBuffer | Uint8Array | string): string {
  if (typeof content === 'string') return content;
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  return new TextDecoder('utf-8').decode(bytes);
}

function isPdfAttachment(mimeType: string, filename: string | null, content: ArrayBuffer | Uint8Array | string): boolean {
  if (mimeType === 'application/pdf') return true;
  if (filename && filename.toLowerCase().endsWith('.pdf')) return true;
  if (typeof content !== 'string') {
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
    if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2D) {
      return true;
    }
  }
  return false;
}

export type Env = {
  DB: D1Database;
  GEMINI_API_KEY: string;
  AUTHORIZED_SENDER: string;
  BOT?: Fetcher;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  AUTHORIZED_CHAT_ID?: string;
  DEV_BYPASS_AUTH?: string;
};

const app = new Hono<{ Bindings: Env }>();

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

type FlightRow = typeof flights.$inferSelect;
type AirportRow = typeof airports.$inferSelect;

function buildStatsPayload(
  flightRows: FlightRow[],
  airportMap: Map<string, AirportRow>,
  options: { includeOwnerCounts: boolean; todayUtc: string }
) {
  const uniqueAirports = new Set<string>();
  const uniqueAirlines = new Set<string>();
  const uniqueCountries = new Set<string>();
  let totalDistance = 0;

  const cabinClasses: Record<string, number> = {};
  const monthlyTrends: Record<string, number> = {};
  const yearlyTrends: Record<string, number> = {};

  for (const f of flightRows) {
    uniqueAirports.add(f.depAirportIata);
    uniqueAirports.add(f.arrAirportIata);
    uniqueAirlines.add(f.airlineIata);
    if (f.distanceKm) totalDistance += f.distanceKm;

    const depAirport = airportMap.get(f.depAirportIata);
    const arrAirport = airportMap.get(f.arrAirportIata);
    if (depAirport) uniqueCountries.add(depAirport.countryCode);
    if (arrAirport) uniqueCountries.add(arrAirport.countryCode);

    if (f.cabinClass) {
      cabinClasses[f.cabinClass] = (cabinClasses[f.cabinClass] || 0) + 1;
    }

    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.flightDate || '');
    if (dateMatch) {
      const year = dateMatch[1];
      const monthIdx = Number(dateMatch[2]) - 1;
      const monthName = MONTH_NAMES[monthIdx];
      if (monthName) {
        monthlyTrends[monthName] = (monthlyTrends[monthName] || 0) + 1;
      }
      yearlyTrends[year] = (yearlyTrends[year] || 0) + 1;
    }
  }

  const basePayload = {
    totalFlights: flightRows.length,
    completedFlights: options.includeOwnerCounts
      ? flightRows.filter((f) => f.flightDate < options.todayUtc).length
      : flightRows.length,
    uniqueAirports: uniqueAirports.size,
    uniqueAirlines: uniqueAirlines.size,
    countriesVisited: uniqueCountries.size,
    totalDistanceKm: totalDistance,
    cabinClassData: Object.entries(cabinClasses).map(([type, value]) => ({ type, value })),
    monthlyTrendData: MONTH_NAMES.map((m) => ({
      month: m,
      count: monthlyTrends[m] || 0,
    })),
    yearlyTrendData: Object.entries(yearlyTrends)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, count]) => ({ year, count })),
  };

  if (!options.includeOwnerCounts) {
    return basePayload;
  }

  return {
    ...basePayload,
    upcomingFlights: flightRows.filter((f) => f.flightDate >= options.todayUtc).length,
    privateFlights: flightRows.filter((f) => Boolean(f.isPrivate)).length,
  };
}

app.use('/api/*', cors());

app.use(
  '/admin/api/*',
  cors({
    origin: (origin, c) => {
      if (!origin) return '';
      try {
        const originUrl = new URL(origin);
        const reqHost = new URL(c.req.url).hostname;
        if (
          originUrl.hostname === reqHost ||
          originUrl.hostname === 'localhost' ||
          originUrl.hostname === '127.0.0.1'
        ) {
          return origin;
        }
      } catch {
        return '';
      }
      return '';
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Cf-Access-Jwt-Assertion'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

app.use('/admin/api/*', async (c, next) => {
  const auth = await verifyOwnerRequest(c);
  if (!auth.ok) {
    return c.json({ error: auth.error }, auth.status);
  }
  await next();
});

// Public Handlers (Option B: completed flights after 3-7d randomized delay, non-private, stripped PII)
async function handlePublicFlights(c: Context<{ Bindings: Env }>) {
  const db = drizzle(c.env.DB);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const all = await db.select().from(flights).all();
  const visible = all
    .filter((f) => isFlightPubliclyVisible(f, todayUtc))
    .sort((a, b) => b.flightDate.localeCompare(a.flightDate) || b.id - a.id)
    .map(toPublicFlight);

  return c.json(visible);
}

async function handlePublicAirports(c: Context<{ Bindings: Env }>) {
  const db = drizzle(c.env.DB);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const [allFlights, allAirports] = await Promise.all([
    db.select().from(flights).all(),
    db.select().from(airports).all(),
  ]);

  const visitedIatas = new Set<string>();
  for (const f of allFlights) {
    if (isFlightPubliclyVisible(f, todayUtc)) {
      visitedIatas.add(f.depAirportIata);
      visitedIatas.add(f.arrAirportIata);
    }
  }

  return c.json(allAirports.filter((a) => visitedIatas.has(a.iataCode)));
}

async function handlePublicStats(c: Context<{ Bindings: Env }>) {
  const db = drizzle(c.env.DB);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const [allFlights, airportList] = await Promise.all([
    db.select().from(flights).all(),
    db.select().from(airports).all(),
  ]);

  const publicFlights = allFlights.filter((f) => isFlightPubliclyVisible(f, todayUtc));
  const airportMap = new Map(airportList.map((a) => [a.iataCode, a]));
  return c.json(buildStatsPayload(publicFlights, airportMap, { includeOwnerCounts: false, todayUtc }));
}

app.get('/api/flights', handlePublicFlights);
app.get('/api/public/flights', handlePublicFlights);
app.get('/api/airports', handlePublicAirports);
app.get('/api/public/airports', handlePublicAirports);
app.get('/api/stats', handlePublicStats);
app.get('/api/public/stats', handlePublicStats);

// Owner Read Endpoints (/admin/api/* - protected by Cloudflare Zero Trust)
app.get('/admin/api/flights', async (c) => {
  const db = drizzle(c.env.DB);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const all = await db
    .select({
      flight: flights,
      depTimezone: airports.timezone,
    })
    .from(flights)
    .leftJoin(airports, eq(flights.depAirportIata, airports.iataCode))
    .all();

  const enriched = all.map((row) => ({
    ...row.flight,
    isPrivate: Boolean(row.flight.isPrivate),
    depTimezone: row.depTimezone,
    publicReleaseDate: computePublicReleaseDate(row.flight.flightDate, row.flight.publishDelayDays),
    isPublicNow: isFlightPubliclyVisible(row.flight, todayUtc),
  }));

  return c.json(enriched);
});

app.get('/admin/api/airports', async (c) => {
  const db = drizzle(c.env.DB);
  const all = await db.select().from(airports).all();
  return c.json(all);
});

app.get('/admin/api/stats', async (c) => {
  const db = drizzle(c.env.DB);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const [allFlights, airportList] = await Promise.all([
    db.select().from(flights).all(),
    db.select().from(airports).all(),
  ]);
  const airportMap = new Map(airportList.map((a) => [a.iataCode, a]));
  return c.json(buildStatsPayload(allFlights, airportMap, { includeOwnerCounts: true, todayUtc }));
});

// POST /admin/api/flights -> Create a flight manually
app.post('/admin/api/flights', async (c) => {
  try {
    const body = await c.req.json();
    const db = drizzle(c.env.DB);

    const flightDate = toNullableString(body.flightDate);
    const airlineIata = toNullableString(body.airlineIata)?.toUpperCase() || null;
    const flightNumber = toNullableString(body.flightNumber)?.toUpperCase().replace(/\s+/g, '') || null;
    const depAirportIata = toNullableString(body.depAirportIata)?.toUpperCase() || null;
    const arrAirportIata = toNullableString(body.arrAirportIata)?.toUpperCase() || null;

    if (!flightDate || !airlineIata || !flightNumber || !depAirportIata || !arrAirportIata) {
      return c.json({ error: 'flightDate, airlineIata, flightNumber, depAirportIata, and arrAirportIata are required.' }, 400);
    }

    let distanceKm = typeof body.distanceKm === 'number' && Number.isFinite(body.distanceKm) && body.distanceKm > 0
      ? Math.round(body.distanceKm)
      : null;

    if (!distanceKm) {
      const [depAirport] = await db.select().from(airports).where(eq(airports.iataCode, depAirportIata)).limit(1);
      const [arrAirport] = await db.select().from(airports).where(eq(airports.iataCode, arrAirportIata)).limit(1);
      if (depAirport && arrAirport) {
        distanceKm = calculateDistance(
          depAirport.latitude,
          depAirport.longitude,
          arrAirport.latitude,
          arrAirport.longitude
        );
      }
    }

    const publishDelayDays =
      typeof body.publishDelayDays === 'number' &&
      Number.isInteger(body.publishDelayDays) &&
      body.publishDelayDays >= 3 &&
      body.publishDelayDays <= 7
        ? body.publishDelayDays
        : generatePublishDelayDays();

    const [inserted] = await db.insert(flights).values({
      flightDate,
      airlineIata,
      flightNumber,
      depAirportIata,
      arrAirportIata,
      depTime: toNullableString(body.depTime),
      arrTime: toNullableString(body.arrTime),
      distanceKm,
      ticketNumber: toNullableString(body.ticketNumber),
      bookingRef: toNullableString(body.bookingRef),
      cabinClass: toNullableString(body.cabinClass),
      seat: toNullableString(body.seat),
      aircraftType: toNullableString(body.aircraftType),
      source: toNullableString(body.source) || 'manual',
      notes: toNullableString(body.notes),
      isPrivate: Boolean(body.isPrivate),
      publishDelayDays,
      createdAt: new Date(),
    }).returning();
    return c.json(inserted, 201);
  } catch (err: any) {
    console.error('Error creating flight:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// PUT /admin/api/flights/:id -> Update a flight
app.put('/admin/api/flights/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    const {
      id: _id,
      createdAt: _createdAt,
      depTimezone: _depTz,
      publicReleaseDate: _prd,
      isPublicNow: _ipn,
      ...rawFields
    } = await c.req.json();
    const db = drizzle(c.env.DB);

    // Fetch the existing flight to get current details
    const [existingFlight] = await db.select().from(flights).where(eq(flights.id, id)).limit(1);
    if (!existingFlight) return c.json({ error: 'Not found' }, 404);

    const updateFields: Partial<typeof flights.$inferInsert> = {};

    if (rawFields.flightDate !== undefined) {
      const val = toNullableString(rawFields.flightDate);
      if (!val) return c.json({ error: 'flightDate cannot be empty.' }, 400);
      updateFields.flightDate = val;
    }
    if (rawFields.airlineIata !== undefined) {
      const val = toNullableString(rawFields.airlineIata)?.toUpperCase();
      if (!val) return c.json({ error: 'airlineIata cannot be empty.' }, 400);
      updateFields.airlineIata = val;
    }
    if (rawFields.flightNumber !== undefined) {
      const val = toNullableString(rawFields.flightNumber)?.toUpperCase().replace(/\s+/g, '');
      if (!val) return c.json({ error: 'flightNumber cannot be empty.' }, 400);
      updateFields.flightNumber = val;
    }
    if (rawFields.depAirportIata !== undefined) {
      const val = toNullableString(rawFields.depAirportIata)?.toUpperCase();
      if (!val) return c.json({ error: 'depAirportIata cannot be empty.' }, 400);
      updateFields.depAirportIata = val;
    }
    if (rawFields.arrAirportIata !== undefined) {
      const val = toNullableString(rawFields.arrAirportIata)?.toUpperCase();
      if (!val) return c.json({ error: 'arrAirportIata cannot be empty.' }, 400);
      updateFields.arrAirportIata = val;
    }
    if (rawFields.depTime !== undefined) updateFields.depTime = toNullableString(rawFields.depTime);
    if (rawFields.arrTime !== undefined) updateFields.arrTime = toNullableString(rawFields.arrTime);
    if (rawFields.ticketNumber !== undefined) updateFields.ticketNumber = toNullableString(rawFields.ticketNumber);
    if (rawFields.bookingRef !== undefined) updateFields.bookingRef = toNullableString(rawFields.bookingRef);
    if (rawFields.cabinClass !== undefined) updateFields.cabinClass = toNullableString(rawFields.cabinClass);
    if (rawFields.seat !== undefined) updateFields.seat = toNullableString(rawFields.seat);
    if (rawFields.aircraftType !== undefined) updateFields.aircraftType = toNullableString(rawFields.aircraftType);
    if (rawFields.source !== undefined) updateFields.source = toNullableString(rawFields.source) || existingFlight.source;
    if (rawFields.notes !== undefined) updateFields.notes = toNullableString(rawFields.notes);
    if (rawFields.isPrivate !== undefined) updateFields.isPrivate = Boolean(rawFields.isPrivate);
    if (
      typeof rawFields.publishDelayDays === 'number' &&
      Number.isInteger(rawFields.publishDelayDays) &&
      rawFields.publishDelayDays >= 3 &&
      rawFields.publishDelayDays <= 7
    ) {
      updateFields.publishDelayDays = rawFields.publishDelayDays;
    }

    let distanceKm = typeof rawFields.distanceKm === 'number' && Number.isFinite(rawFields.distanceKm) && rawFields.distanceKm > 0
      ? Math.round(rawFields.distanceKm)
      : undefined;
    const depAirportIata = updateFields.depAirportIata || existingFlight.depAirportIata;
    const arrAirportIata = updateFields.arrAirportIata || existingFlight.arrAirportIata;

    const airportsChanged =
      (updateFields.depAirportIata !== undefined && updateFields.depAirportIata !== existingFlight.depAirportIata) ||
      (updateFields.arrAirportIata !== undefined && updateFields.arrAirportIata !== existingFlight.arrAirportIata);

    if (!distanceKm && (airportsChanged || !existingFlight.distanceKm) && depAirportIata && arrAirportIata) {
      const [depAirport] = await db.select().from(airports).where(eq(airports.iataCode, depAirportIata)).limit(1);
      const [arrAirport] = await db.select().from(airports).where(eq(airports.iataCode, arrAirportIata)).limit(1);
      if (depAirport && arrAirport) {
        distanceKm = calculateDistance(
          depAirport.latitude,
          depAirport.longitude,
          arrAirport.latitude,
          arrAirport.longitude
        );
      }
    }

    if (distanceKm !== undefined) {
      updateFields.distanceKm = distanceKm || null;
    } else if (rawFields.distanceKm === null) {
      updateFields.distanceKm = null;
    } else if (airportsChanged) {
      updateFields.distanceKm = null;
    }

    const [updated] = await db.update(flights).set(updateFields).where(eq(flights.id, id)).returning();
    return c.json(updated);
  } catch (err: any) {
    console.error('Error updating flight:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// DELETE /admin/api/flights/:id -> Delete a flight
app.delete('/admin/api/flights/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const db = drizzle(c.env.DB);
  await db.delete(flights).where(eq(flights.id, id));
  return c.json({ success: true });
});

// POST /admin/api/airports -> Add a new airport
app.post('/admin/api/airports', async (c) => {
  try {
    const body = await c.req.json();
    const db = drizzle(c.env.DB);

    const { iataCode, name, city, countryCode, latitude, longitude, timezone } = body;
    if (!iataCode || iataCode.length !== 3) {
      return c.json({ error: 'IATA Code must be exactly 3 characters.' }, 400);
    }
    if (!name) return c.json({ error: 'Airport Name is required.' }, 400);
    if (!city) return c.json({ error: 'City is required.' }, 400);
    if (!countryCode) return c.json({ error: 'Country code is required.' }, 400);

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return c.json({ error: 'Latitude must be a valid number between -90 and 90.' }, 400);
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      return c.json({ error: 'Longitude must be a valid number between -180 and 180.' }, 400);
    }

    // Check unique constraint manually
    const [existing] = await db.select().from(airports).where(eq(airports.iataCode, iataCode.toUpperCase())).limit(1);
    if (existing) {
      return c.json({ error: `Airport with IATA code ${iataCode.toUpperCase()} already exists.` }, 400);
    }

    const [inserted] = await db.insert(airports).values({
      iataCode: iataCode.toUpperCase(),
      name,
      city,
      countryCode: countryCode.toUpperCase(),
      latitude: lat,
      longitude: lng,
      timezone: timezone || null
    }).returning();
    return c.json(inserted, 201);
  } catch (err: any) {
    console.error('Error adding airport:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// PUT /admin/api/airports/:iata -> Update an airport
app.put('/admin/api/airports/:iata', async (c) => {
  try {
    const iata = c.req.param('iata').toUpperCase();
    const body = await c.req.json();
    const { iataCode: _iata, ...updateFields } = body;
    const db = drizzle(c.env.DB);

    const { name, city, countryCode, latitude, longitude } = updateFields;
    if (name !== undefined && !name) return c.json({ error: 'Airport Name cannot be empty.' }, 400);
    if (city !== undefined && !city) return c.json({ error: 'City cannot be empty.' }, 400);
    if (countryCode !== undefined && !countryCode) return c.json({ error: 'Country code cannot be empty.' }, 400);

    if (latitude !== undefined) {
      const lat = parseFloat(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return c.json({ error: 'Latitude must be a valid number between -90 and 90.' }, 400);
      }
      updateFields.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = parseFloat(longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return c.json({ error: 'Longitude must be a valid number between -180 and 180.' }, 400);
      }
      updateFields.longitude = lng;
    }

    const [updated] = await db.update(airports).set(updateFields).where(eq(airports.iataCode, iata)).returning();
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json(updated);
  } catch (err: any) {
    console.error('Error updating airport:', err);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
  }
});

// DELETE /admin/api/airports/:iata -> Delete an airport
app.delete('/admin/api/airports/:iata', async (c) => {
  const iata = c.req.param('iata').toUpperCase();
  const db = drizzle(c.env.DB);
  await db.delete(airports).where(eq(airports.iataCode, iata));
  return c.json({ success: true });
});

// POST /admin/api/airports/auto-lookup/:iata -> Trigger Gemini lookup and save
app.post('/admin/api/airports/auto-lookup/:iata', async (c) => {
  const iata = c.req.param('iata').trim().toUpperCase();
  if (!isValidIataCode(iata)) {
    return c.json({ error: 'Invalid IATA code' }, 400);
  }
  const db = drizzle(c.env.DB);
  
  // 1. Check if already exists
  const [existing] = await db.select().from(airports).where(eq(airports.iataCode, iata)).limit(1);
  if (existing) return c.json(existing);

  // 2. Lookup with Gemini
  try {
    const details = await getAirportDetails(iata, c.env.GEMINI_API_KEY);
    const [inserted] = await db.insert(airports).values({
      iataCode: details.iataCode,
      name: details.name,
      city: details.city,
      countryCode: details.countryCode,
      latitude: details.latitude,
      longitude: details.longitude,
      timezone: details.timezone,
    }).returning();

    // 3. Notify user
    if (c.env.BOT) {
      let msg = `✨ *New Airport Discovered*: ${details.iataCode} - ${details.name}`;
      if (details.confidence === 'low') {
        msg += `\n⚠️ *Warning*: Gemini is not 100% sure about these coordinates.\nReasoning: ${details.reasoning}`;
      }
      const airportPublicData = buildAirportReviewPublicData({
        iataCode: details.iataCode,
        name: details.name,
        city: details.city,
        countryCode: details.countryCode,
        latitude: details.latitude,
        longitude: details.longitude,
        timezone: details.timezone,
        confidence: details.confidence,
        reasoning: details.reasoning,
      });
      runWaitUntil(
        c,
        c.env.BOT.fetch(new Request("http://bot/api/notify-admin", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html: AIRPORT_REVIEW_HTML,
            public_data: airportPublicData,
            chat_data: '{"st":"new"}',
            allow_queries: true,
            caption: `✨ New Airport Discovered: ${details.iataCode} - ${details.name}`,
            fallback_text: msg,
            fallback_parse_mode: 'Markdown',
          }),
        }))
      );
    }

    return c.json(inserted);
  } catch (err) {
    return c.json({ error: 'Failed to lookup airport' }, 500);
  }
});

// Internal bot handler for the unified Telegram router
app.post('/internal/bot-handler', async (c) => {
  const body = await c.req.json();
  
  if (!c.env.BOT) {
    return c.json({ error: 'Bot not configured' }, 500);
  }
  const bot = new FlightBot(c.env.BOT, c.env.DB, c.env.AUTHORIZED_CHAT_ID);
  const result = await bot.handleUpdate(body);
  
  return c.json(result || { status: 'ok' });
});

export { app };

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    // 1. Authenticate Sender
    if (message.from !== env.AUTHORIZED_SENDER) {
      console.warn(`Unauthorized email sender: ${message.from}`);
      return;
    }

    try {
      // 2. Parse Raw Email & Attachments
      const parser = new PostalMime();
      const rawEmail = await new Response(message.raw).arrayBuffer();
      const email = await parser.parse(rawEmail);

      const inlineAttachments: InlineAttachmentPart[] = [];
      const attachmentTexts: string[] = [];

      for (const att of email.attachments || []) {
        const mime = (att.mimeType || '').toLowerCase();
        if (isPdfAttachment(mime, att.filename, att.content)) {
          inlineAttachments.push({
            mimeType: 'application/pdf',
            base64Data: bytesToBase64(att.content, att.encoding),
            filename: att.filename || undefined,
          });
        } else if (
          mime.startsWith('text/') ||
          mime === 'application/ics' ||
          (att.filename && /\.(ics|txt|csv|html?)$/i.test(att.filename))
        ) {
          attachmentTexts.push(`Attachment (${att.filename || mime}):\n${bytesToText(att.content)}`);
        } else if (mime.startsWith('image/') && !att.related && att.disposition === 'attachment') {
          inlineAttachments.push({
            mimeType: mime,
            base64Data: bytesToBase64(att.content, att.encoding),
            filename: att.filename || undefined,
          });
        }
      }

      const contentToParse = `
        Subject: ${email.subject}
        From: ${email.from?.address || 'Unknown'}
        Date: ${email.date}
        ---
        Body:
        ${email.text || 'No text content'}
        ---
        HTML:
        ${email.html || 'No HTML content'}
        ${attachmentTexts.length > 0 ? `---\nText Attachments:\n${attachmentTexts.join('\n---\n')}` : ''}
      `;

      // 3. Extract Data with Gemini
      console.log(`Sending email content to Gemini for extraction (${inlineAttachments.length} binary attachments)...`);
      const extractedFlights = await extractFlightsFromEmail(contentToParse, env.GEMINI_API_KEY, inlineAttachments);

      if (extractedFlights.length === 0) {
        console.log('No flights identified in email.');
        return message.setReject('No flight details found.');
      }

      // 4. Save to D1
      const db = drizzle(env.DB);
      let savedCount = 0;

      for (const flight of extractedFlights) {
        const depIata = toNullableString(flight.dep_airport_iata)?.toUpperCase() || '';
        const arrIata = toNullableString(flight.arr_airport_iata)?.toUpperCase() || '';

        // --- AUTO-INGEST MISSING AIRPORTS ---
        const airportsToCheck = [depIata, arrIata].filter(isValidIataCode);
        for (const iata of airportsToCheck) {
          const [exists] = await db.select().from(airports).where(eq(airports.iataCode, iata)).limit(1);
          if (!exists) {
            console.log(`Missing airport ${iata}, fetching from Gemini...`);
            try {
              const details = await getAirportDetails(iata, env.GEMINI_API_KEY, contentToParse, inlineAttachments);
              await db.insert(airports).values({
                iataCode: details.iataCode,
                name: details.name,
                city: details.city,
                countryCode: details.countryCode,
                latitude: details.latitude,
                longitude: details.longitude,
                timezone: details.timezone || null,
              });

              if (env.BOT) {
                let msg = `✨ *Auto-Ingested New Airport*: ${details.iataCode} - ${details.name}`;
                if (details.confidence === 'low') {
                  msg += `\n⚠️ *Warning*: Gemini is not 100% sure about these coordinates.\nReasoning: ${details.reasoning}`;
                }
                const airportPublicData = buildAirportReviewPublicData({
                  iataCode: details.iataCode,
                  name: details.name,
                  city: details.city,
                  countryCode: details.countryCode,
                  latitude: details.latitude,
                  longitude: details.longitude,
                  timezone: details.timezone,
                  confidence: details.confidence,
                  reasoning: details.reasoning,
                });
                ctx.waitUntil(
                  env.BOT.fetch(new Request("http://bot/api/notify-admin", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      html: AIRPORT_REVIEW_HTML,
                      public_data: airportPublicData,
                      chat_data: '{"st":"new"}',
                      allow_queries: true,
                      caption: `✨ Auto-Ingested New Airport: ${details.iataCode} - ${details.name}`,
                      fallback_text: msg,
                      fallback_parse_mode: 'Markdown',
                    }),
                  }))
                );
              }
            } catch (lookupErr) {
              console.error(`Failed to auto-ingest airport ${iata}:`, lookupErr);
            }
          }
        }
        // --- END AUTO-INGEST ---

        try {
          const flightDate = toNullableString(flight.flight_date);
          let airlineIata = toNullableString(flight.airline_iata)?.toUpperCase() || null;
          let flightNumber = toNullableString(flight.flight_number)?.toUpperCase().replace(/\s+/g, '') || null;

          // Infer airline_iata from flight_number (e.g. "XJ601" -> "XJ") if missing
          if (!airlineIata && flightNumber) {
            const match = flightNumber.match(/^([A-Z0-9]{2})\d+/);
            if (match) {
              airlineIata = match[1];
            }
          }

          if (!flightDate || !airlineIata || !flightNumber || !isValidIataCode(depIata) || !isValidIataCode(arrIata)) {
            throw new Error(
              `Missing or invalid required flight fields (date=${flightDate}, airline=${airlineIata}, flight=${flightNumber}, dep=${depIata}, arr=${arrIata})`
            );
          }

          let distanceKm =
            typeof flight.distance_km === 'number' && !isNaN(flight.distance_km) && flight.distance_km > 0
              ? Math.round(flight.distance_km)
              : null;

          if (!distanceKm) {
            try {
              const [depAirport] = await db.select().from(airports).where(eq(airports.iataCode, depIata)).limit(1);
              const [arrAirport] = await db.select().from(airports).where(eq(airports.iataCode, arrIata)).limit(1);
              if (depAirport && arrAirport) {
                distanceKm = calculateDistance(
                  depAirport.latitude,
                  depAirport.longitude,
                  arrAirport.latitude,
                  arrAirport.longitude
                );
              }
            } catch (geoErr) {
              console.error('Failed to calculate distance for email flight:', geoErr);
            }
          }

          const depTime = toNullableString(flight.dep_time);
          const arrTime = toNullableString(flight.arr_time);
          const ticketNumber = toNullableString(flight.ticket_number);
          const bookingRef = toNullableString(flight.booking_ref);
          const cabinClass = toNullableString(flight.cabin_class);
          const seat = toNullableString(flight.seat);
          const aircraftType = toNullableString(flight.aircraft_type);

          const [insertedFlight] = await db.insert(flights).values({
            flightDate,
            airlineIata,
            flightNumber,
            depAirportIata: depIata,
            arrAirportIata: arrIata,
            depTime,
            arrTime,
            distanceKm,
            ticketNumber,
            bookingRef,
            cabinClass,
            seat,
            aircraftType,
            source: 'email',
            notes: toNullableString(flight.notes) || `Imported via email: ${email.subject}`,
            isPrivate: false,
            publishDelayDays: generatePublishDelayDays(),
            createdAt: new Date(),
          }).returning({ id: flights.id });
          savedCount++;

          if (env.BOT) {
            let depCity: string | null = null;
            let arrCity: string | null = null;
            try {
              const [depAp] = await db.select().from(airports).where(eq(airports.iataCode, depIata)).limit(1);
              const [arrAp] = await db.select().from(airports).where(eq(airports.iataCode, arrIata)).limit(1);
              depCity = depAp?.city ?? null;
              arrCity = arrAp?.city ?? null;
            } catch {}

            const flightRef = formatFlightRef(airlineIata, flightNumber);
            let flightMsg = `✈️ *New Flight Added via Email*\n\n` +
              `• *Date:* ${flightDate}\n` +
              `• *Flight:* ${flightRef}${aircraftType ? ` (${aircraftType})` : ''}\n` +
              `• *Route:* ${depIata} → ${arrIata}${distanceKm ? ` (${distanceKm} km)` : ''}\n` +
              `• *Time:* ${depTime || 'TBD'} → ${arrTime || 'TBD'}`;
            if (cabinClass || seat) {
              flightMsg += `\n• *Cabin/Seat:* ${[cabinClass, seat].filter(Boolean).join(' / ')}`;
            }
            if (bookingRef) {
              flightMsg += `\n• *PNR:* \`${bookingRef}\``;
            }

            const cardPublicData = buildFlightCardPublicData({
              kind: 'import',
              id: insertedFlight?.id,
              flight: {
                id: insertedFlight?.id ?? 0,
                flightDate,
                airlineIata,
                flightNumber,
                depAirportIata: depIata,
                arrAirportIata: arrIata,
                depTime,
                arrTime,
                distanceKm,
                bookingRef,
                cabinClass,
                seat,
                aircraftType,
              },
              depCity,
              arrCity,
            });

            ctx.waitUntil(
              env.BOT.fetch(new Request("http://bot/api/notify-admin", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  html: FLIGHT_CARD_HTML,
                  public_data: cardPublicData,
                  chat_data: '{"del":0}',
                  allow_queries: true,
                  caption: `✈️ Imported ${flightRef}: ${depIata} → ${arrIata} on ${flightDate}`,
                  fallback_text: flightMsg,
                  fallback_parse_mode: 'Markdown',
                }),
              }))
            );
          }
        } catch (dbError: any) {
          console.error('Failed to insert extracted flight:', dbError);
          if (env.BOT) {
            const errMsg = `❌ *Failed to Import Flight from Email*\nSubject: ${email.subject || 'Unknown'}\nReason: ${dbError?.message || String(dbError)}`;
            ctx.waitUntil(
              env.BOT.fetch(new Request("http://bot/api/notify-admin", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: errMsg }),
              }))
            );
          }
        }
      }

      console.log(`Successfully merged ${savedCount} flights from email.`);
    } catch (error) {
      console.error('Email Worker processing failed:', error);
    }
  },
  async scheduled(event: any, env: Env, ctx: ExecutionContext) {
    const db = drizzle(env.DB);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Find flights departing tomorrow
    const upcoming = await db.select()
      .from(flights)
      .where(eq(flights.flightDate, tomorrowStr))
      .all();

    if (upcoming.length > 0 && env.BOT) {
      const airportList = await db.select().from(airports).all();
      const cityMap = new Map(airportList.map(a => [a.iataCode, a.city]));

      for (const flight of upcoming) {
        const flightRef = formatFlightRef(flight.airlineIata, flight.flightNumber);
        const msg = `✈️ *Upcoming Flight Reminder (Tomorrow)*\n\n` +
          `*Flight*: ${flightRef}\n` +
          `*Route*: ${flight.depAirportIata} → ${flight.arrAirportIata}\n` +
          `*Time*: ${flight.depTime || 'TBD'}\n\n` +
          `Safe travels!`;

        const cardPublicData = buildFlightCardPublicData({
          kind: 'remind',
          id: flight.id,
          flight,
          depCity: cityMap.get(flight.depAirportIata) ?? null,
          arrCity: cityMap.get(flight.arrAirportIata) ?? null,
        });

        await env.BOT.fetch(new Request("http://bot/api/notify-admin", {
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
          }),
        }));
      }
    }
  }
};
