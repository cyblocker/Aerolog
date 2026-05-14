export type Flight = {
  id: number;
  flightDate: string;
  airlineIata: string;
  flightNumber: string;
  depAirportIata: string;
  arrAirportIata: string;
  depTime: string | null;
  arrTime: string | null;
  depTimezone?: string;
  distanceKm: number | null;
  cabinClass: string | null;
  aircraftType?: string;
  notes?: string;
};

export type Airport = {
  iataCode: string;
  name: string;
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

export type Stats = {
  totalFlights: number;
  completedFlights: number;
  upcomingFlights: number;
  uniqueAirports: number;
  uniqueAirlines: number;
  countriesVisited: number;
  totalDistanceKm: number;
};
