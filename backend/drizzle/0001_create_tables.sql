-- Migration: 0001_create_tables.sql
-- Created for flight-records-manager D1 database

CREATE TABLE IF NOT EXISTS flights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_date TEXT NOT NULL,
  airline_iata TEXT NOT NULL,
  flight_number TEXT NOT NULL,
  dep_airport_iata TEXT NOT NULL,
  arr_airport_iata TEXT NOT NULL,
  dep_time TEXT,
  arr_time TEXT,
  distance_km INTEGER,
  ticket_number TEXT,
  booking_ref TEXT,
  cabin_class TEXT,
  seat TEXT,
  aircraft_type TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(flight_date);
CREATE INDEX IF NOT EXISTS idx_flights_dep ON flights(dep_airport_iata);
CREATE INDEX IF NOT EXISTS idx_flights_arr ON flights(arr_airport_iata);
CREATE INDEX IF NOT EXISTS idx_flights_airline ON flights(airline_iata);

CREATE TABLE IF NOT EXISTS airports (
  iata_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  country_code TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL
);
