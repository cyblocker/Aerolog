export type Flight = {
  id: number;
  flightDate: string;
  airlineIata: string;
  flightNumber: string;
  depAirportIata: string;
  arrAirportIata: string;
  depTime?: string | null;
  arrTime?: string | null;
  depTimezone?: string | null;
  arrTimezone?: string | null;
  distanceKm: number | null;
  ticketNumber?: string | null;
  bookingRef?: string | null;
  cabinClass: string | null;
  seat?: string | null;
  aircraftType?: string | null;
  source?: string;
  notes?: string | null;
  isPrivate?: boolean;
  publishDelayDays?: number;
  publicReleaseDate?: string;
  isPublicNow?: boolean;
};

export type Airport = {
  iataCode: string;
  name: string;
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone?: string | null;
};

export type Stats = {
  totalFlights: number;
  completedFlights: number;
  upcomingFlights?: number;
  privateFlights?: number;
  uniqueAirports: number;
  uniqueAirlines: number;
  countriesVisited: number;
  totalDistanceKm: number;
};
