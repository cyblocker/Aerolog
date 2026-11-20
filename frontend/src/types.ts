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

export type ReminderCategory = 'departure' | 'seat' | 'checkin' | 'meal' | 'border' | 'custom';
export type ReminderGranularity = 'day' | 'exact';
export type ReminderStatus = 'pending' | 'done' | 'dismissed';

export type ReminderLinkedFlight = {
  id: number;
  flightDate: string;
  airlineIata: string;
  flightNumber: string;
  depAirportIata: string;
  arrAirportIata: string;
  depTime?: string | null;
  depTimezone?: string | null;
  bookingRef?: string | null;
  seat?: string | null;
};

export type FlightReminder = {
  id: number;
  flightId: number | null;
  category: ReminderCategory;
  title: string;
  details: string | null;
  actionUrl: string | null;
  granularity: ReminderGranularity;
  eventAtUtc: string | null;
  remindAtUtc: string;
  status: ReminderStatus;
  source: 'rule' | 'ai' | 'manual';
  notifiedAt: string | null;
  completedAt: string | null;
  flight?: ReminderLinkedFlight | null;
};

export type OwnerProfile = {
  id: number;
  citizenships: string | null;
  residencyCountry: string | null;
  residencyStatus: string | null;
  visasAndPrograms: string | null;
  frequentFlyerStatuses: string | null;
  mealPreferences: string | null;
  homeTimezone: string | null;
  dailyReminderHour: number | null;
};

export type AnalysisJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type AnalysisJobInfo = {
  flightId: number;
  status: AnalysisJobStatus;
  completedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type AnalysisStatus = {
  isActive: boolean;
  totalUpcoming: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  activeFlightIds: number[];
  jobs: AnalysisJobInfo[];
};
