import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const flights = sqliteTable('flights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  flightDate: text('flight_date').notNull(),            // YYYY-MM-DD
  airlineIata: text('airline_iata').notNull(),           // e.g. JL, NH, CA
  flightNumber: text('flight_number').notNull(),         // e.g. JL25
  depAirportIata: text('dep_airport_iata').notNull(),    // e.g. HND
  arrAirportIata: text('arr_airport_iata').notNull(),    // e.g. PEK
  depTime: text('dep_time'),                             // HH:MM local
  arrTime: text('arr_time'),                             // HH:MM local
  distanceKm: integer('distance_km'),                    // nullable
  ticketNumber: text('ticket_number'),                   // nullable
  bookingRef: text('booking_ref'),                       // nullable, PNR
  cabinClass: text('cabin_class'),                       // nullable
  seat: text('seat'),                                    // nullable
  aircraftType: text('aircraft_type'),                   // nullable
  source: text('source').notNull().default('manual'),    // import / email / manual
  notes: text('notes'),                                  // nullable
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export const airports = sqliteTable('airports', {
  iataCode: text('iata_code').primaryKey(),
  name: text('name').notNull(),                          // English name
  city: text('city').notNull(),
  countryCode: text('country_code').notNull(),           // ISO 3166-1 alpha-2
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  timezone: text('timezone'),                            // e.g. Asia/Tokyo
});
