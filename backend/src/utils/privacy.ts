export interface PrivacyFilterableFlight {
  flightDate: string;
  isPrivate?: boolean | number | null;
  publishDelayDays?: number | null;
}

export interface PublicFlightSource extends PrivacyFilterableFlight {
  id: number;
  airlineIata: string;
  flightNumber: string;
  depAirportIata: string;
  arrAirportIata: string;
  distanceKm?: number | null;
  cabinClass?: string | null;
  aircraftType?: string | null;
}

export interface PublicFlight {
  id: number;
  flightDate: string;
  airlineIata: string;
  flightNumber: string;
  depAirportIata: string;
  arrAirportIata: string;
  distanceKm: number | null;
  cabinClass: string | null;
  aircraftType: string | null;
}

/**
 * Generates an unbiased uniform random publish delay in {3, 4, 5, 6, 7} days
 * (exact 20% probability per day) using CSPRNG with rejection sampling.
 */
export function generatePublishDelayDays(): number {
  const buf = new Uint8Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < 250) {
      return 3 + (buf[0] % 5);
    }
  }
}

/**
 * Returns YYYY-MM-DD when a flight becomes eligible for public display.
 * Malformed dates return '9999-12-31' so they fail closed.
 */
export function computePublicReleaseDate(
  flightDate: string,
  publishDelayDays?: number | null
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((flightDate || '').trim());
  if (!match) {
    return '9999-12-31';
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const delay = typeof publishDelayDays === 'number' && Number.isFinite(publishDelayDays)
    ? Math.max(0, Math.floor(publishDelayDays))
    : 5;

  const utcMs = Date.UTC(year, month - 1, day) + delay * 86_400_000;
  return new Date(utcMs).toISOString().slice(0, 10);
}

/**
 * Checks whether a flight should be exposed on public endpoints.
 * Future flights, private-flagged flights, and completed flights still inside
 * their 3-7 day randomized delay window return false.
 */
export function isFlightPubliclyVisible(
  flight: PrivacyFilterableFlight,
  todayUtc?: string
): boolean {
  if (Boolean(flight.isPrivate)) {
    return false;
  }
  const today = todayUtc ?? new Date().toISOString().slice(0, 10);
  return computePublicReleaseDate(flight.flightDate, flight.publishDelayDays) <= today;
}

/**
 * Allowlists Option B public fields ONLY.
 * Strips times, timezones, PNR, ticket numbers, seat, notes, source, and privacy metadata.
 */
export function toPublicFlight(flight: PublicFlightSource): PublicFlight {
  return {
    id: flight.id,
    flightDate: flight.flightDate,
    airlineIata: flight.airlineIata,
    flightNumber: flight.flightNumber,
    depAirportIata: flight.depAirportIata,
    arrAirportIata: flight.arrAirportIata,
    distanceKm: flight.distanceKm ?? null,
    cabinClass: flight.cabinClass ?? null,
    aircraftType: flight.aircraftType ?? null,
  };
}
