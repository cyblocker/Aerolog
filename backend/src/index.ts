import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, sql } from 'drizzle-orm';
import { flights, airports } from './db/schema';
import PostalMime from 'postal-mime';
import { extractFlightsFromEmail, getAirportDetails } from './utils/gemini';
import { FlightBot } from './bot';
import { calculateDistance } from './utils/geo';

export type Env = {
  DB: D1Database;
  GEMINI_API_KEY: string;
  AUTHORIZED_SENDER: string;
  BOT?: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

app.use('/*', cors());

// GET /api/flights -> All flights, newest first
app.get('/api/flights', async (c) => {
  const db = drizzle(c.env.DB);
  // Join with airports to get departure timezone for accurate sorting
  const all = await db
    .select({
      flight: flights,
      depTimezone: airports.timezone
    })
    .from(flights)
    .leftJoin(airports, eq(flights.depAirportIata, airports.iataCode))
    .all();
  
  // Flatten the result
  const flattened = all.map(row => ({
    ...row.flight,
    depTimezone: row.depTimezone
  }));

  return c.json(flattened);
});

// GET /api/flights/:id -> Single flight
app.get('/api/flights/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const db = drizzle(c.env.DB);
  const [flight] = await db.select().from(flights).where(eq(flights.id, id)).limit(1);
  if (!flight) return c.json({ error: 'Not found' }, 404);
  return c.json(flight);
});

// POST /admin/api/flights -> Create a flight manually
app.post('/admin/api/flights', async (c) => {
  try {
    const body = await c.req.json();
    const db = drizzle(c.env.DB);

    let distanceKm = body.distanceKm;
    if (!distanceKm && body.depAirportIata && body.arrAirportIata) {
      const [depAirport] = await db.select().from(airports).where(eq(airports.iataCode, body.depAirportIata.toUpperCase())).limit(1);
      const [arrAirport] = await db.select().from(airports).where(eq(airports.iataCode, body.arrAirportIata.toUpperCase())).limit(1);
      if (depAirport && arrAirport) {
        distanceKm = calculateDistance(
          depAirport.latitude,
          depAirport.longitude,
          arrAirport.latitude,
          arrAirport.longitude
        );
      }
    }

    const [inserted] = await db.insert(flights).values({
      ...body,
      distanceKm: distanceKm || null,
      source: body.source || 'manual',
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
    const { id: _id, createdAt: _createdAt, ...updateFields } = await c.req.json();
    const db = drizzle(c.env.DB);

    // Fetch the existing flight to get current details
    const [existingFlight] = await db.select().from(flights).where(eq(flights.id, id)).limit(1);
    if (!existingFlight) return c.json({ error: 'Not found' }, 404);

    let distanceKm = updateFields.distanceKm;
    const depAirportIata = updateFields.depAirportIata || existingFlight.depAirportIata;
    const arrAirportIata = updateFields.arrAirportIata || existingFlight.arrAirportIata;

    const airportsChanged = 
      (updateFields.depAirportIata && updateFields.depAirportIata !== existingFlight.depAirportIata) || 
      (updateFields.arrAirportIata && updateFields.arrAirportIata !== existingFlight.arrAirportIata);

    if (!distanceKm && (airportsChanged || !existingFlight.distanceKm) && depAirportIata && arrAirportIata) {
      const [depAirport] = await db.select().from(airports).where(eq(airports.iataCode, depAirportIata.toUpperCase())).limit(1);
      const [arrAirport] = await db.select().from(airports).where(eq(airports.iataCode, arrAirportIata.toUpperCase())).limit(1);
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
    } else if (airportsChanged) {
      updateFields.distanceKm = distanceKm || null;
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

// GET /api/airports -> All airports
app.get('/api/airports', async (c) => {
  const db = drizzle(c.env.DB);
  const all = await db.select().from(airports).all();
  return c.json(all);
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
  const iata = c.req.param('iata').toUpperCase();
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
      c.executionCtx.waitUntil(
        c.env.BOT.fetch(new Request("http://bot/api/notify-admin", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: msg }),
        }))
      );
    }

    return c.json(inserted);
  } catch (err) {
    return c.json({ error: 'Failed to lookup airport' }, 500);
  }
});

// GET /api/stats -> Aggregate statistics
app.get('/api/stats', async (c) => {
  const db = drizzle(c.env.DB);
  const allFlights = await db.select().from(flights).all();

  const today = new Date().toISOString().split('T')[0];
  const completed = allFlights.filter(f => f.flightDate < today);
  const upcoming = allFlights.filter(f => f.flightDate >= today);

  const uniqueAirports = new Set<string>();
  const uniqueAirlines = new Set<string>();
  const uniqueCountries = new Set<string>();
  let totalDistance = 0;

    const airportList = await db.select().from(airports).all();
    const airportMap = new Map(airportList.map(a => [a.iataCode, a]));

    const cabinClasses: Record<string, number> = {};
    const monthlyTrends: Record<string, number> = {};
    const decadeTrends: Record<string, number> = {};

    allFlights.forEach(f => {
      uniqueAirports.add(f.depAirportIata);
      uniqueAirports.add(f.arrAirportIata);
      uniqueAirlines.add(f.airlineIata);
      if (f.distanceKm) totalDistance += f.distanceKm;

      const depAirport = airportMap.get(f.depAirportIata);
      const arrAirport = airportMap.get(f.arrAirportIata);
      if (depAirport) uniqueCountries.add(depAirport.countryCode);
      if (arrAirport) uniqueCountries.add(arrAirport.countryCode);

      // Cabin Classes
      if (f.cabinClass) {
        const cabin = f.cabinClass;
        cabinClasses[cabin] = (cabinClasses[cabin] || 0) + 1;
      }

      // Monthly Trends (Summed across all years)
      if (f.flightDate) {
        const month = new Date(f.flightDate).getMonth();
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        monthlyTrends[monthNames[month]] = (monthlyTrends[monthNames[month]] || 0) + 1;
        
        const year = new Date(f.flightDate).getFullYear();
        decadeTrends[year] = (decadeTrends[year] || 0) + 1;
      }
    });

    return c.json({
      totalFlights: allFlights.length,
      completedFlights: completed.length,
      upcomingFlights: upcoming.length,
      uniqueAirports: uniqueAirports.size,
      uniqueAirlines: uniqueAirlines.size,
      countriesVisited: uniqueCountries.size,
      totalDistanceKm: totalDistance,
      cabinClassData: Object.entries(cabinClasses).map(([type, value]) => ({ type, value })),
      monthlyTrendData: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => ({
        month: m,
        count: monthlyTrends[m] || 0
      })),
      yearlyTrendData: Object.entries(decadeTrends).sort().map(([year, count]) => ({ year, count })),
    });
});

// Internal bot handler for the unified Telegram router
app.post('/internal/bot-handler', async (c) => {
  const body = await c.req.json();
  
  if (!c.env.BOT) {
    return c.json({ error: 'Bot not configured' }, 500);
  }
  const bot = new FlightBot(c.env.BOT, c.env.DB);
  const result = await bot.handleUpdate(body);
  
  return c.json(result || { status: 'ok' });
});
export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    // 1. Authenticate Sender
    if (message.from !== env.AUTHORIZED_SENDER) {
      console.warn(`Unauthorized email sender: ${message.from}`);
      return;
    }

    try {
      // 2. Parse Raw Email
      const parser = new PostalMime();
      const rawEmail = await new Response(message.raw).arrayBuffer();
      const email = await parser.parse(rawEmail);

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
      `;

      // 3. Extract Data with Gemini
      console.log('Sending email content to Gemini for extraction...');
      const extractedFlights = await extractFlightsFromEmail(contentToParse, env.GEMINI_API_KEY);

      if (extractedFlights.length === 0) {
        console.log('No flights identified in email.');
        return message.setReject('No flight details found.');
      }

      // 4. Save to D1
      const db = drizzle(env.DB);
      let savedCount = 0;

      for (const flight of extractedFlights) {
        // --- AUTO-INGEST MISSING AIRPORTS ---
        const airportsToCheck = [flight.dep_airport_iata, flight.arr_airport_iata];
        for (const iata of airportsToCheck) {
          const [exists] = await db.select().from(airports).where(eq(airports.iataCode, iata)).limit(1);
          if (!exists) {
            console.log(`Missing airport ${iata}, fetching from Gemini...`);
            try {
              const details = await getAirportDetails(iata, env.GEMINI_API_KEY);
              await db.insert(airports).values({
                iataCode: details.iataCode,
                name: details.name,
                city: details.city,
                countryCode: details.countryCode,
                latitude: details.latitude,
                longitude: details.longitude,
              });

              if (env.BOT) {
                let msg = `✨ *Auto-Ingested New Airport*: ${details.iataCode} - ${details.name}`;
                if (details.confidence === 'low') {
                  msg += `\n⚠️ *Warning*: Gemini is not 100% sure about these coordinates.\nReasoning: ${details.reasoning}`;
                }
                ctx.waitUntil(
                  env.BOT.fetch(new Request("http://bot/api/notify-admin", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: msg }),
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
          let distanceKm = flight.distance_km || null;
          if (!distanceKm && flight.dep_airport_iata && flight.arr_airport_iata) {
            try {
              const [depAirport] = await db.select().from(airports).where(eq(airports.iataCode, flight.dep_airport_iata.toUpperCase())).limit(1);
              const [arrAirport] = await db.select().from(airports).where(eq(airports.iataCode, flight.arr_airport_iata.toUpperCase())).limit(1);
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

          await db.insert(flights).values({
            flightDate: flight.flight_date,
            airlineIata: flight.airline_iata,
            flightNumber: flight.flight_number,
            depAirportIata: flight.dep_airport_iata,
            arrAirportIata: flight.arr_airport_iata,
            depTime: flight.dep_time || null,
            arrTime: flight.arr_time || null,
            distanceKm: distanceKm,
            ticketNumber: flight.ticket_number || null,
            bookingRef: flight.booking_ref || null,
            cabinClass: flight.cabin_class || null,
            seat: flight.seat || null,
            aircraftType: flight.aircraft_type || null,
            source: 'email',
            notes: flight.notes || `Imported via email: ${email.subject}`,
            createdAt: new Date(),
          });
          savedCount++;
        } catch (dbError) {
          console.error('Failed to insert extracted flight:', dbError);
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
      for (const flight of upcoming) {
        const msg = `✈️ *Upcoming Flight Reminder (Tomorrow)*\n\n` +
          `*Flight*: ${flight.airlineIata}${flight.flightNumber}\n` +
          `*Route*: ${flight.depAirportIata} → ${flight.arrAirportIata}\n` +
          `*Time*: ${flight.depTime || 'TBD'}\n\n` +
          `Safe travels!`;

        await env.BOT.fetch(new Request("http://bot/api/notify-admin", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: msg }),
        }));
      }
    }
  }
};
