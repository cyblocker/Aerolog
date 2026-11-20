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
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
  publishDelayDays: integer('publish_delay_days').notNull().default(5),
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

export const ownerProfile = sqliteTable('owner_profile', {
  id: integer('id').primaryKey(),
  citizenships: text('citizenships'),
  residencyCountry: text('residency_country'),
  residencyStatus: text('residency_status'),
  visasAndPrograms: text('visas_and_programs'),
  frequentFlyerStatuses: text('frequent_flyer_statuses'),
  mealPreferences: text('meal_preferences'),
  homeTimezone: text('home_timezone'),
  dailyReminderHour: integer('daily_reminder_hour'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const flightReminders = sqliteTable('flight_reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  flightId: integer('flight_id').references(() => flights.id, { onDelete: 'cascade' }),
  category: text('category').notNull().default('custom'),    // departure | seat | checkin | meal | border | custom
  title: text('title').notNull(),
  details: text('details'),
  actionUrl: text('action_url'),
  granularity: text('granularity').notNull().default('day'), // day | exact
  eventAtUtc: text('event_at_utc'),                          // ISO UTC timestamp of actual event/window opening
  remindAtUtc: text('remind_at_utc').notNull(),              // ISO UTC timestamp when Cron should notify
  status: text('status').notNull().default('pending'),       // pending | done | dismissed
  source: text('source').notNull().default('manual'),        // rule | ai | manual
  notifiedAt: text('notified_at'),
  completedAt: text('completed_at'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const flightAnalysisJobs = sqliteTable('flight_analysis_jobs', {
  flightId: integer('flight_id')
    .primaryKey()
    .references(() => flights.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('queued'),       // queued | running | completed | failed
  force: integer('force', { mode: 'boolean' }).notNull().default(false),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  lastError: text('last_error'),
  updatedAt: text('updated_at').notNull(),
});
