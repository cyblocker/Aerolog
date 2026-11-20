import lookup from 'tz-lookup';
import { sanitizeHttpsUrl } from './calendar';

export type GeminiThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
export const GEMINI_MODEL = 'gemini-4-hydrogen';
export const EXTRACTION_THINKING_LEVEL: GeminiThinkingLevel = 'HIGH';
export const AIRPORT_LOOKUP_THINKING_LEVEL: GeminiThinkingLevel = 'HIGH';
const INVALID_IATA_CODES = new Set(['NUL', 'NULL', 'TBD', 'UNK', 'NAN', 'NIL', 'XXX', 'NONE']);

export function isValidIataCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  const normalized = code.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) && !INVALID_IATA_CODES.has(normalized);
}

function cleanHintContext(raw?: string, maxLength = 2000): string {
  if (!raw) return '';
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export interface InlineAttachmentPart {
  mimeType: string;
  base64Data: string;
  filename?: string;
}

export interface ExtractedFlight {
  flight_date: string; // YYYY-MM-DD
  airline_iata: string;
  flight_number: string;
  dep_airport_iata: string;
  arr_airport_iata: string;
  dep_time?: string; // HH:MM
  arr_time?: string; // HH:MM
  distance_km?: number;
  ticket_number?: string;
  booking_ref?: string;
  cabin_class?: string;
  seat?: string;
  aircraft_type?: string;
  notes?: string;
}

export interface AirportDetails {
  iataCode: string;
  name: string;
  city: string;
  countryCode: string; // 2-letter ISO
  latitude: number;
  longitude: number;
  timezone: string; // IANA Timezone
  confidence: 'high' | 'low';
  reasoning?: string;
}

const SYSTEM_PROMPT = `
You are a specialized flight data extraction assistant. 
Your task is to parse flight confirmation emails, electronic tickets, attached e-ticket PDF receipts, or itinerary texts and extract specific flight details into a structured JSON format.

### Extraction Rules:
1. **Inspect All Sources**: Carefully read both the email text/HTML and any attached PDF or image documents (e.g., airline e-ticket itinerary/receipts). Often the email body only says "Your e-ticket is attached" while the full flight itinerary (all segments, airports, times, booking reference, ticket number, cabin class, seat, aircraft) is inside the attached PDF.
2. **Dates**: Always use YYYY-MM-DD format.
3. **IATA Codes**: Extract 3-letter IATA codes for airports (e.g., LHR, JFK, PEK, HND, DEL) and 2-letter IATA codes for airlines (e.g., BA, AA, JL, NH, XJ). If only the city or airport name is provided in the text or PDF, infer the exact 3-letter IATA code (e.g., "Beijing Capital" -> PEK, "Bangkok Don Mueang" -> DMK). Never output "NUL" or "null" as an IATA code.
4. **No Route Guessing**: Do NOT guess or fabricate departure/arrival airports solely from a flight number in the email subject if no departure/arrival cities or airports appear anywhere in the email body or attachments. If no actual route information is present, return an empty JSON array [].
5. **Flight Numbers**: Always populate both "airline_iata" (e.g., JL, NH, XJ) and "flight_number" (include the airline code, e.g., JL22, NH860, XJ601).
6. **Distance**: Estimate the great-circle distance in KM if not explicitly mentioned.
7. **Multiple Flights**: If the email or attached PDF contains multiple segments (connecting flights, round-trip, or multi-city itineraries), return all segments in the array.
8. **Unknown Optional Fields**: If an optional field cannot be found, use null or omit it.
9. **Language**: The input may be in English, Chinese (Simplified/Traditional), or Japanese. Always output IATA codes in English.
10. **Fare Brand**: Keep "cabin_class" normalized as one of Economy, Premium Economy, Business, or First. If the email or PDF mentions a fare brand or seat rule (e.g., "Economy Light", "Basic Economy", "ANA Simple", "Saver", "Value", "Flex"), preserve that fare brand concisely inside "notes".

### JSON Schema:
Return a JSON array of objects with these keys:
"flight_date", "airline_iata", "flight_number", "dep_airport_iata", "arr_airport_iata", "dep_time", "arr_time", "distance_km", "ticket_number", "booking_ref", "cabin_class", "seat", "aircraft_type", "notes".

Only output the JSON array. No conversational text.
`;

function extractResponseText(data: any): string | undefined {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const answerPart = parts.find((p: any) => !p?.thought && typeof p?.text === 'string');
  return answerPart?.text ?? parts[0]?.text;
}

export async function extractFlightsFromEmail(
  content: string,
  apiKey: string,
  attachments: InlineAttachmentPart[] = []
): Promise<ExtractedFlight[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const parts: any[] = [
    { text: `${SYSTEM_PROMPT}\n\nINPUT TEXT:\n${content}` },
    ...attachments.map(att => ({
      inlineData: {
        mimeType: att.mimeType,
        data: att.base64Data,
      },
    })),
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              flight_date: { type: 'STRING', nullable: false },
              airline_iata: { type: 'STRING', nullable: false },
              flight_number: { type: 'STRING', nullable: false },
              dep_airport_iata: { type: 'STRING', nullable: false },
              arr_airport_iata: { type: 'STRING', nullable: false },
              dep_time: { type: 'STRING', nullable: true },
              arr_time: { type: 'STRING', nullable: true },
              distance_km: { type: 'INTEGER', nullable: true },
              ticket_number: { type: 'STRING', nullable: true },
              booking_ref: { type: 'STRING', nullable: true },
              cabin_class: { type: 'STRING', nullable: true },
              seat: { type: 'STRING', nullable: true },
              aircraft_type: { type: 'STRING', nullable: true },
              notes: { type: 'STRING', nullable: true },
            },
            required: [
              'flight_date',
              'airline_iata',
              'flight_number',
              'dep_airport_iata',
              'arr_airport_iata',
            ],
          },
        },
        thinkingConfig: {
          thinkingLevel: EXTRACTION_THINKING_LEVEL,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const data: any = await response.json();
  const jsonText = extractResponseText(data);

  if (!jsonText) {
    throw new Error('Gemini returned an empty response');
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.flights)) {
        return parsed.flights;
      }
      if (parsed.dep_airport_iata || parsed.arr_airport_iata || parsed.flight_number) {
        return [parsed];
      }
    }
    return [];
  } catch (e) {
    console.error('Failed to parse Gemini JSON:', jsonText);
    throw new Error('Gemini output was not valid JSON');
  }
}

export async function getAirportDetails(
  iata: string,
  apiKey: string,
  hintContext?: string,
  attachments: InlineAttachmentPart[] = []
): Promise<AirportDetails> {
  if (!isValidIataCode(iata)) {
    throw new Error(`Invalid IATA code for airport lookup: "${iata}"`);
  }
  const cleanIata = iata.trim().toUpperCase();
  const cleanedHint = cleanHintContext(hintContext, 2000);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const prompt = `
    Find the official metadata for the commercial airport with 3-letter IATA code: "${cleanIata}".
    ${cleanedHint ? `Context hint from booking/itinerary:\n"""\n${cleanedHint}\n"""` : ''}

    ### Verification Guidelines:
    1. Verify the exact 3-letter IATA code against official international aviation registries (IATA/ICAO).
    2. Do NOT confuse IATA codes with FAA location identifiers, US state abbreviations (e.g., AK = Alaska), or phonetic similarities.
       - Example: AXT = Akita Airport (Akita, Japan).
    3. Ensure latitude and longitude match the primary commercial airport for this IATA code.
    4. If the code is obscure or ambiguous, set "confidence" to "low" and explain in "reasoning".

    ### Output Schema:
    Return a JSON object with these keys: 
    "iataCode" (string, "${cleanIata}"), 
    "name" (string, official airport name), 
    "city" (string), 
    "countryCode" (string, 2-letter ISO country code), 
    "latitude" (number), 
    "longitude" (number),
    "confidence" (string, "high" or "low"),
    "reasoning" (string, explain if confidence is low or if ambiguity was resolved).

    Only return valid JSON. Do not include any markdown or extra text outside JSON.
  `;

  const parts: any[] = [
    { text: prompt },
    ...attachments.map(att => ({
      inlineData: {
        mimeType: att.mimeType,
        data: att.base64Data,
      },
    })),
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            iataCode: { type: 'STRING', nullable: false },
            name: { type: 'STRING', nullable: false },
            city: { type: 'STRING', nullable: false },
            countryCode: { type: 'STRING', nullable: false },
            latitude: { type: 'NUMBER', nullable: false },
            longitude: { type: 'NUMBER', nullable: false },
            confidence: { type: 'STRING', enum: ['high', 'low'], nullable: false },
            reasoning: { type: 'STRING', nullable: true },
          },
          required: ['iataCode', 'name', 'city', 'countryCode', 'latitude', 'longitude', 'confidence'],
        },
        thinkingConfig: {
          thinkingLevel: AIRPORT_LOOKUP_THINKING_LEVEL,
        },
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`);

  const data: any = await response.json();
  const jsonText = extractResponseText(data);
  if (!jsonText) throw new Error('Gemini returned an empty response for airport lookup');

  const airport: AirportDetails = JSON.parse(jsonText);

  const returnedCode = airport.iataCode?.trim().toUpperCase();
  if (
    !isValidIataCode(returnedCode) ||
    returnedCode !== cleanIata ||
    !airport.name?.trim() ||
    /^null\b/i.test(airport.name.trim()) ||
    !airport.city?.trim() ||
    !airport.countryCode?.trim() ||
    typeof airport.latitude !== 'number' ||
    isNaN(airport.latitude) ||
    typeof airport.longitude !== 'number' ||
    isNaN(airport.longitude)
  ) {
    throw new Error(`Invalid or unverified airport metadata returned for "${cleanIata}": ${jsonText}`);
  }

  airport.iataCode = cleanIata;
  airport.name = airport.name.trim();
  airport.city = airport.city.trim();
  airport.countryCode = airport.countryCode.trim().toUpperCase();

  console.log(`[Gemini Airport Lookup] ${cleanIata} -> ${airport.name} (${airport.city}, ${airport.countryCode}) | Confidence: ${airport.confidence}${airport.reasoning ? ` | Reasoning: ${airport.reasoning}` : ''}`);

  // High-fidelity timezone lookup from coordinates
  if (airport.latitude != null && airport.longitude != null) {
    airport.timezone = lookup(airport.latitude, airport.longitude);
  }

  return airport;
}

export interface TravelerProfileContext {
  citizenships?: string | null;
  residencyCountry?: string | null;
  residencyStatus?: string | null;
  visasAndPrograms?: string | null;
  frequentFlyerStatuses?: string | null;
  mealPreferences?: string | null;
}

export interface FlightLogisticsInput {
  airlineIata: string;
  flightNumber: string;
  flightDate: string;
  depAirportIata: string;
  depCity?: string | null;
  depCountryCode?: string | null;
  arrAirportIata: string;
  arrCity?: string | null;
  arrCountryCode?: string | null;
  depTime?: string | null;
  cabinClass?: string | null;
  aircraftType?: string | null;
  hasSeat: boolean;
  isDomestic: boolean;
  daysUntilFlight: number;
  fareNotes?: string | null;
  connectingLegsSummary?: string | null;
}

export type LogisticsCategory = 'meal' | 'border' | 'checkin' | 'seat' | 'custom';

export interface GeneratedLogisticsItem {
  category: LogisticsCategory;
  title: string;
  details: string;
  actionUrl: string | null;
  granularity: 'day' | 'exact';
  daysBeforeFlight: number | null;
  hoursBeforeDeparture: number | null;
  seatDeferredToCheckin?: boolean;
}

const ALLOWED_LOGISTICS_CATEGORIES = new Set<LogisticsCategory>([
  'meal',
  'border',
  'checkin',
  'seat',
  'custom',
]);

const LOGISTICS_RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      category: { type: 'STRING', enum: ['meal', 'border', 'checkin', 'seat', 'custom'], nullable: false },
      title: { type: 'STRING', nullable: false },
      details: { type: 'STRING', nullable: false },
      actionUrl: { type: 'STRING', nullable: true },
      granularity: { type: 'STRING', enum: ['day', 'exact'], nullable: false },
      daysBeforeFlight: { type: 'INTEGER', nullable: true },
      hoursBeforeDeparture: { type: 'INTEGER', nullable: true },
      seatDeferredToCheckin: { type: 'BOOLEAN', nullable: true },
    },
    required: ['category', 'title', 'details', 'granularity'],
  },
};

function parseJsonArrayFromText(rawText: string): unknown[] {
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).items)) {
      return (parsed as any).items;
    }
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const sliced = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(sliced)) return sliced;
    }
  }
  return [];
}

function normalizeLogisticsItems(rawItems: unknown[]): GeneratedLogisticsItem[] {
  const results: GeneratedLogisticsItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const rawCat = String(item.category || '').trim().toLowerCase() as LogisticsCategory;
    const category: LogisticsCategory = ALLOWED_LOGISTICS_CATEGORIES.has(rawCat) ? rawCat : 'custom';

    const title = String(item.title || '').trim().slice(0, 140);
    const details = String(item.details || '').trim().slice(0, 600);
    if (!title) continue;

    const granularity: 'day' | 'exact' =
      category === 'checkin' && item.granularity === 'exact' ? 'exact' : item.granularity === 'exact' ? 'exact' : 'day';

    let daysBeforeFlight: number | null = null;
    if (typeof item.daysBeforeFlight === 'number' && Number.isFinite(item.daysBeforeFlight)) {
      daysBeforeFlight = Math.max(0, Math.min(180, Math.round(item.daysBeforeFlight)));
    }

    let hoursBeforeDeparture: number | null = null;
    if (typeof item.hoursBeforeDeparture === 'number' && Number.isFinite(item.hoursBeforeDeparture)) {
      hoursBeforeDeparture = Math.max(1, Math.min(168, Math.round(item.hoursBeforeDeparture)));
    }

    const actionUrl = sanitizeHttpsUrl(typeof item.actionUrl === 'string' ? item.actionUrl : null);

    results.push({
      category,
      title,
      details,
      actionUrl,
      granularity,
      daysBeforeFlight,
      hoursBeforeDeparture,
      ...(typeof item.seatDeferredToCheckin === 'boolean'
        ? { seatDeferredToCheckin: item.seatDeferredToCheckin }
        : {}),
    });

    if (results.length >= 4) break;
  }
  return results;
}

export async function generateFlightLogistics(
  flight: FlightLogisticsInput,
  profile: TravelerProfileContext,
  apiKey: string,
  timeoutMs = 18_000
): Promise<GeneratedLogisticsItem[]> {
  if (!apiKey) return [];

  const profileLines = [
    profile.citizenships ? `Citizenships: ${profile.citizenships}` : null,
    profile.residencyCountry ? `Resident of: ${profile.residencyCountry}` : null,
    profile.residencyStatus ? `Residency Status: ${profile.residencyStatus}` : null,
    profile.visasAndPrograms ? `Visas / Trusted Traveler: ${profile.visasAndPrograms}` : null,
    profile.frequentFlyerStatuses ? `Frequent Flyer Status: ${profile.frequentFlyerStatuses}` : null,
    profile.mealPreferences ? `Meal Preferences: ${profile.mealPreferences}` : null,
  ].filter(Boolean);

  const prompt = `
You are a concise aviation concierge & travel logistics analyst.
Given ONE upcoming flight segment and optional anonymous traveler attributes, return **0 to 4 high-signal, genuinely actionable pre-flight tasks**.

### Flight Details (No PII):
- Airline / Flight: ${flight.airlineIata} / ${flight.flightNumber}
- Departure Date: ${flight.flightDate} (${Math.max(0, Math.round(flight.daysUntilFlight))} days from today)
- Route: ${flight.depAirportIata} (${[flight.depCity, flight.depCountryCode].filter(Boolean).join(', ') || 'Unknown'}) -> ${flight.arrAirportIata} (${[flight.arrCity, flight.arrCountryCode].filter(Boolean).join(', ') || 'Unknown'})
- Domestic Segment: ${flight.isDomestic ? 'Yes' : 'No (International)'}
- Cabin: ${flight.cabinClass || 'Unknown'}
- Aircraft: ${flight.aircraftType || 'Unknown'}
- Seat Already Assigned: ${flight.hasSeat ? 'Yes' : 'No'}
${flight.fareNotes ? `- Fare / Ticket Hint: ${flight.fareNotes}` : ''}
${flight.connectingLegsSummary ? `- Adjacent Itinerary Context: ${flight.connectingLegsSummary}` : ''}

### Anonymous Traveler Context:
${profileLines.length > 0 ? profileLines.join('\n') : 'None provided (assume standard passport/visa verification needed for international legs; keep border notes general and prompt traveler to check official portals).'}

### Strict Selection Rules:
1. **High-signal only (0 to 4 items max)**: NEVER output generic advice like "pack passport", "arrive 2h early", or "charge phone". If nothing special applies, return [].
2. **Airline Meal / Service Pre-Selection (category="meal", granularity="day")**: Check if this airline + cabin offers advance meal pre-order programs (e.g., Singapore Airlines Book the Cook / In-the-Air menu, SWISS Pre-Select, JAL/ANA advance meal order, Qatar Pre-Select Dining, ANA/EVA/CX special pre-order). Set daysBeforeFlight to when the booking window should be acted on (e.g. 14 or 7, or current daysUntilFlight if already inside window).
3. **Border / Entry / Customs / Visa (category="border", granularity="day")**:
   - Skip for domestic flights unless special territory rules apply.
   - Tailor strictly to Citizenship + Residency + Visas if provided! (e.g., residents/citizens returning to Japan still benefit from Visit Japan Web customs QR if helpful, but do NOT suggest tourist visas; Taiwan/Singapore/Thailand/Malaysia/Indonesia/Korea arrival cards or ESTA/ETA/NZeTA/K-ETA rules).
   - Briefly remind traveler to verify current official requirements.
4. **Online Check-In Window (category="checkin", granularity="exact")**:
   - Check airline's exact online check-in opening time in hoursBeforeDeparture (e.g. 24 for ANA/JAL, 23 for SWISS, 48 for SQ).
   - Only skip Japan domestic JAL/ANA online check-in when "Seat Already Assigned" is "Yes".
   - Whenever "Seat Already Assigned" is "No" (including Japan domestic NH/JL or Light/Basic/Simple fares), DO generate an exact "checkin" reminder noting that online check-in opens for seat selection!
   - If Fare / Ticket Hint indicates Light / Basic Economy / Simple / Saver fare without free advance seat selection (or the airline restricts free seat selection until check-in), set "seatDeferredToCheckin": true on the "checkin" item.
5. **Airline-Specific Timed Seat Window (category="seat", granularity="day")**:
   - Do NOT create a generic "select seat" reminder simply because Seat Already Assigned is "No" (handled separately).
   - ONLY create a "seat" item if this specific airline/fare/status has a notable timed seat window (e.g. paid advance seats become free at T-48h or T-7d).
6. **URLs**: Only include an official airline or government "actionUrl" starting with "https://" if confident; otherwise null.
7. Output a pure JSON array matching:
   [{ "category": "meal|border|checkin|seat|custom", "title": "...", "details": "...", "actionUrl": "https://..." | null, "granularity": "day|exact", "daysBeforeFlight": integer|null, "hoursBeforeDeparture": integer|null, "seatDeferredToCheckin": boolean|null }]
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const strategies: Array<{ name: string; body: Record<string, unknown> }> = [
    {
      name: 'googleSearch+jsonSchema',
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: LOGISTICS_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      },
    },
    {
      name: 'googleSearch+plainText',
      body: {
        contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nRespond ONLY with the raw JSON array.` }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      },
    },
    {
      name: 'jsonSchemaNoTools',
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: LOGISTICS_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      },
    },
  ];

  let lastError: Error | null = null;
  const deadlineMs = Date.now() + Math.max(2_000, timeoutMs);

  for (const strategy of strategies) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs < 1_500) {
      break;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(strategy.body),
        signal: AbortSignal.timeout(remainingMs),
      });

      if (!response.ok) {
        const errBody = await response.text();
        lastError = new Error(`Gemini (${strategy.name}) HTTP ${response.status}: ${errBody.slice(0, 300)}`);
        if (response.status === 400) {
          console.warn(`[Logistics AI] Fallback from ${strategy.name}: HTTP 400`);
          continue;
        }
        if (response.status === 401 || response.status === 403 || response.status === 429) {
          throw lastError;
        }
        console.warn(`[Logistics AI] Fallback from ${strategy.name}: HTTP ${response.status}`);
        continue;
      }

      const data: any = await response.json();
      const text = extractResponseText(data);
      if (!text) return [];
      const rawItems = parseJsonArrayFromText(text);
      return normalizeLogisticsItems(rawItems);
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Logistics AI] Strategy ${strategy.name} failed:`, lastError.message);
      if (/HTTP (401|403|429):/.test(lastError.message)) {
        break;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}
