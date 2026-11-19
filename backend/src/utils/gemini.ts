import lookup from 'tz-lookup';

const GEMINI_MODEL = 'gemini-3.8-flash';
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

### JSON Schema:
Return a JSON array of objects with these keys:
"flight_date", "airline_iata", "flight_number", "dep_airport_iata", "arr_airport_iata", "dep_time", "arr_time", "distance_km", "ticket_number", "booking_ref", "cabin_class", "seat", "aircraft_type", "notes".

Only output the JSON array. No conversational text.
`;

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
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const data: any = await response.json();
  const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;

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
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`);

  const data: any = await response.json();
  const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
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
