import lookup from 'tz-lookup';

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
Your task is to parse flight confirmation emails, electronic tickets, or itinerary texts and extract specific flight details into a structured JSON format.

### Extraction Rules:
1. **Dates**: Always use YYYY-MM-DD format.
2. **IATA Codes**: Extract 3-letter IATA codes for airports (e.g., LHR, JFK, PEK) and 2-letter IATA codes for airlines (e.g., BA, AA, JL). If only the city name is provided, infer the most likely IATA code (e.g., "Beijing Capital" -> PEK).
3. **Flight Numbers**: Include the airline code (e.g., JL22, NH860).
4. **Distance**: Estimate the great-circle distance in KM if not explicitly mentioned.
5. **Multiple Flights**: If the email contains multiple segments (connecting flights or multi-trip itineraries), return an array of objects.
6. **Unknown Fields**: If a field cannot be found, use null or omit it.
7. **Language**: The input may be in English, Chinese (Simplified/Traditional), or Japanese. Always output IATA codes in English.

### JSON Schema:
Return a JSON array of objects with these keys:
"flight_date", "airline_iata", "flight_number", "dep_airport_iata", "arr_airport_iata", "dep_time", "arr_time", "distance_km", "ticket_number", "booking_ref", "cabin_class", "seat", "aircraft_type", "notes".

Only output the JSON array. No conversational text.
`;

export async function extractFlightsFromEmail(
  content: string,
  apiKey: string
): Promise<ExtractedFlight[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${SYSTEM_PROMPT}\n\nINPUT TEXT:\n${content}` }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
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
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error('Failed to parse Gemini JSON:', jsonText);
    throw new Error('Gemini output was not valid JSON');
  }
}

export async function getAirportDetails(
  iata: string,
  apiKey: string,
  hintContext?: string
): Promise<AirportDetails> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

  const prompt = `
    Find the official metadata for the commercial airport with 3-letter IATA code: "${iata}".
    ${hintContext ? `Context hint from booking/itinerary:\n"""\n${hintContext.slice(0, 1000)}\n"""` : ''}

    ### Verification Guidelines:
    1. Verify the exact 3-letter IATA code against official international aviation registries (IATA/ICAO).
    2. Do NOT confuse IATA codes with FAA location identifiers, US state abbreviations (e.g., AK = Alaska), or phonetic similarities.
       - Example: AXT = Akita Airport (Akita, Japan).
    3. Ensure latitude and longitude match the primary commercial airport for this IATA code.
    4. If the code is obscure or ambiguous, set "confidence" to "low" and explain in "reasoning".

    ### Output Schema:
    Return a JSON object with these keys: 
    "iataCode" (string, "${iata}"), 
    "name" (string, official airport name), 
    "city" (string), 
    "countryCode" (string, 2-letter ISO country code), 
    "latitude" (number), 
    "longitude" (number),
    "confidence" (string, "high" or "low"),
    "reasoning" (string, explain if confidence is low or if ambiguity was resolved).

    Only return valid JSON. Do not include any markdown or extra text outside JSON.
  `;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`);

  const data: any = await response.json();
  const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) throw new Error('Gemini returned an empty response for airport lookup');

  const airport: AirportDetails = JSON.parse(jsonText);

  console.log(`[Gemini Airport Lookup] ${iata} -> ${airport.name} (${airport.city}, ${airport.countryCode}) | Confidence: ${airport.confidence}${airport.reasoning ? ` | Reasoning: ${airport.reasoning}` : ''}`);

  // High-fidelity timezone lookup from coordinates
  if (airport.latitude && airport.longitude) {
    airport.timezone = lookup(airport.latitude, airport.longitude);
  }

  return airport;
}
