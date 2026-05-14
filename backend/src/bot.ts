import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, asc, sql } from 'drizzle-orm';
import { flights, airports } from './db/schema';

function formatFlightNumber(airlineIata: string, flightNumber: string): string {
  if (flightNumber.startsWith(airlineIata)) {
    return flightNumber;
  }
  return airlineIata + flightNumber;
}

export class FlightBot {
  constructor(
    private botBinding: Fetcher,
    private db: D1Database
  ) { }

  async handleUpdate(payload: any): Promise<any> {
    const isCallback = !!payload.callback_query;
    const message = payload.message || payload.callback_query?.message;
    const chatId = message?.chat?.id;
    const text = (payload.message?.text || payload.callback_query?.data || "").toLowerCase();

    if (!chatId) return null;

    if (text === '/flight' || text === 'flight_menu') {
      return this.sendMenu(chatId);
    } else if (text === '/flight_stats' || text === 'flight_stats') {
      return this.sendStats(chatId);
    } else if (text.startsWith('/flight_next') || text.startsWith('flight_next')) {
      const parts = text.split(':');
      const offset = parts.length > 1 ? parseInt(parts[1], 10) : 0;
      return this.sendNextFlight(chatId, offset);
    } else if (text === '/flight_recent' || text === 'flight_recent') {
      return this.sendRecentFlights(chatId);
    } else if (text.startsWith('/flight_search ')) {
      const query = text.replace('/flight_search ', '').trim();
      return this.searchFlights(chatId, query);
    }

    // Default response if it's explicitly a flight command prefix but not recognized
    if (text.startsWith('/flight')) {
      return this.sendMenu(chatId);
    }

    return null;
  }

  private async sendMenu(chatId: number) {
    return {
      method: 'sendMessage',
      chat_id: chatId,
      text: "✈️ *AeroLog Flight Assistant*\nWelcome to your personal flight records manager. What would you like to check?",
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "📊 Travel Statistics", callback_data: "flight_stats" }],
          [{ text: "🕒 Upcoming Flights", callback_data: "flight_next:0" }],
          [{ text: "📜 Recent Flight History", callback_data: "flight_recent" }]
        ]
      }
    };
  }

  private async sendStats(chatId: number) {
    const db = drizzle(this.db);
    const allFlights = await db.select().from(flights).all();
    const airportList = await db.select().from(airports).all();
    const airportMap = new Map(airportList.map(a => [a.iataCode, a]));

    const uniqueAirports = new Set<string>();
    const uniqueCountries = new Set<string>();
    let totalKm = 0;

    allFlights.forEach(f => {
      uniqueAirports.add(f.depAirportIata);
      uniqueAirports.add(f.arrAirportIata);
      if (f.distanceKm) totalKm += f.distanceKm;

      const dep = airportMap.get(f.depAirportIata);
      const arr = airportMap.get(f.arrAirportIata);
      if (dep) uniqueCountries.add(dep.countryCode);
      if (arr) uniqueCountries.add(arr.countryCode);
    });

    return {
      method: 'sendMessage',
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `📊 *Your Flight Statistics*\n\n• *Total Flights:* ${allFlights.length}\n• *Distance:* ${Math.round(totalKm).toLocaleString()} km\n• *Airports Visited:* ${uniqueAirports.size}\n• *Countries Visited:* ${uniqueCountries.size}`,
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Back to Menu", callback_data: "flight_menu" }]]
      }
    };
  }

  private async sendNextFlight(chatId: number, offset: number) {
    const db = drizzle(this.db);
    const today = new Date().toISOString().split('T')[0];

    const upcomingList = await db.select()
      .from(flights)
      .where(sql`${flights.flightDate} >= ${today}`)
      .orderBy(asc(flights.flightDate))
      .limit(1)
      .offset(offset);
      
    const next = upcomingList[0];

    if (!next) {
      const emptyMsg = offset === 0 ? "No upcoming flights found. Time to book a trip! ✈️" : "No more upcoming flights found.";
      return {
        method: 'sendMessage',
        chat_id: chatId,
        text: emptyMsg,
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Back to Menu", callback_data: "flight_menu" }]]
        }
      };
    }

    const flightRef = formatFlightNumber(next.airlineIata, next.flightNumber);

    return {
      method: 'sendMessage',
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `🕒 *Upcoming Flight*\n\n• *Date:* ${next.flightDate}\n• *Flight:* ${flightRef}\n• *Route:* ${next.depAirportIata} → ${next.arrAirportIata}\n• *Time:* ${next.depTime || 'TBD'} - ${next.arrTime || 'TBD'}`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "⏩ Next Upcoming Flight", callback_data: `flight_next:${offset + 1}` }],
          [{ text: "⬅️ Back to Menu", callback_data: "flight_menu" }]
        ]
      }
    };
  }

  private async sendRecentFlights(chatId: number) {
    const db = drizzle(this.db);
    const today = new Date().toISOString().split('T')[0];
    
    const recent = await db.select()
      .from(flights)
      .where(sql`${flights.flightDate} < ${today}`)
      .orderBy(desc(flights.flightDate))
      .limit(5);

    if (recent.length === 0) {
      return {
        method: 'sendMessage',
        chat_id: chatId,
        text: "You have no past flight history recorded.",
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Back to Menu", callback_data: "flight_menu" }]]
        }
      };
    }

    let text = `📜 *Recent Flights*\n\n`;
    recent.forEach(f => {
      const flightRef = formatFlightNumber(f.airlineIata, f.flightNumber);
      text += `• ${f.flightDate}: ${f.depAirportIata}→${f.arrAirportIata} (${flightRef})\n`;
    });

    return {
      method: 'sendMessage',
      chat_id: chatId,
      parse_mode: 'Markdown',
      text,
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Back to Menu", callback_data: "flight_menu" }]]
      }
    };
  }

  private async searchFlights(chatId: number, query: string) {
    const db = drizzle(this.db);
    const q = `%${query}%`;
    const results = await db.select()
      .from(flights)
      .where(sql`${flights.flightNumber} LIKE ${q} OR ${flights.depAirportIata} LIKE ${q} OR ${flights.arrAirportIata} LIKE ${q}`)
      .orderBy(desc(flights.flightDate))
      .limit(5);

    if (results.length === 0) {
      return {
        method: 'sendMessage',
        chat_id: chatId,
        text: `No flights found matching "${query}"`
      };
    }

    let text = `🔍 *Search Results for "${query}"*\n\n`;
    results.forEach(f => {
      const flightRef = formatFlightNumber(f.airlineIata, f.flightNumber);
      text += `• ${f.flightDate}: ${f.depAirportIata}→${f.arrAirportIata} (${flightRef})\n`;
    });

    return {
      method: 'sendMessage',
      chat_id: chatId,
      parse_mode: 'Markdown',
      text
    };
  }
}
