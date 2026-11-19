import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, asc, sql } from 'drizzle-orm';
import { flights, airports } from './db/schema';
import {
  FLIGHT_DASHBOARD_HTML,
  buildFlightListData,
  buildFlightStatsData,
  buildUpcomingFlightData,
  formatFlightRef,
  type FlightRecord,
} from './widgets';

export class FlightBot {
  private botBinding: Fetcher;
  private db: D1Database;
  private authorizedChatId?: string;

  constructor(botBinding: Fetcher, db: D1Database, authorizedChatId?: string) {
    this.botBinding = botBinding;
    this.db = db;
    this.authorizedChatId = authorizedChatId?.trim() || undefined;
  }

  private async callApi(method: string, payload: Record<string, unknown>): Promise<any> {
    try {
      const res = await this.botBinding.fetch(new Request(`http://bot/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      const data: any = await res.json().catch(() => null);
      if (!res.ok || (data && data.ok === false)) {
        const descText = data?.description || `HTTP ${res.status}`;
        if (!String(descText).includes('message is not modified')) {
          console.error(`Telegram API error (${method}):`, descText);
        }
      }
      return data;
    } catch (err) {
      console.error(`Failed calling Telegram API (${method}):`, err);
      return null;
    }
  }

  private async sendWidget(
    chatId: number | string,
    opts: {
      html: string;
      caption: string;
      chatData?: string;
      publicData?: string;
      allowQueries?: boolean;
      fallbackText: string;
      fallbackMarkup?: Record<string, unknown>;
    }
  ) {
    const widgetRes = await this.callApi('sendWidget', {
      chat_id: chatId,
      html: opts.html,
      caption: opts.caption.slice(0, 1024),
      ...(opts.chatData !== undefined ? { chat_data: opts.chatData } : {}),
      ...(opts.publicData !== undefined ? { public_data: opts.publicData } : {}),
      allow_queries: opts.allowQueries ?? true,
    });

    if (widgetRes?.ok) {
      return widgetRes;
    }

    return this.callApi('sendMessage', {
      chat_id: chatId,
      text: opts.fallbackText,
      parse_mode: 'Markdown',
      ...(opts.fallbackMarkup ? { reply_markup: opts.fallbackMarkup } : {}),
    });
  }

  private async editWidgetData(chatId: number | string, messageId: number, chatData: string) {
    return this.callApi('editMessageWidgetData', {
      chat_id: chatId,
      message_id: messageId,
      chat_data: chatData,
    });
  }

  private async answerWidgetQuery(widgetQueryId: string, data: string) {
    return this.callApi('answerWidgetQuery', {
      widget_query_id: widgetQueryId,
      data,
    });
  }

  async handleUpdate(payload: any): Promise<any> {
    const wq = payload.widget_query || payload.shared_widget_query;
    if (this.authorizedChatId) {
      const chatId =
        wq?.chat?.id ??
        payload.callback_query?.message?.chat?.id ??
        payload.message?.chat?.id;
      const fromId =
        wq?.from?.id ??
        payload.callback_query?.from?.id ??
        payload.message?.from?.id;
      const matchesChat = chatId !== undefined && String(chatId) === this.authorizedChatId;
      const matchesFrom = fromId !== undefined && String(fromId) === this.authorizedChatId;

      if (!matchesChat && !matchesFrom) {
        if (wq?.id) {
          await this.answerWidgetQuery(wq.id, JSON.stringify({ error: 'Unauthorized' }));
        } else if (payload.callback_query?.id) {
          await this.callApi('answerCallbackQuery', {
            callback_query_id: payload.callback_query.id,
            text: '⛔ Unauthorized access.',
            show_alert: true,
          });
        } else if (payload.message?.chat?.id) {
          const lowerText = String(payload.message.text || '').trim().toLowerCase();
          if (lowerText.startsWith('/flight')) {
            await this.callApi('sendMessage', {
              chat_id: payload.message.chat.id,
              text: '⛔ Unauthorized access.',
            });
          }
        }
        return { status: 'unauthorized' };
      }
    }

    if (wq) {
      await this.handleWidgetQuery(wq);
      return { status: 'ok' };
    }

    if (payload.callback_query) {
      await this.handleCallbackQuery(payload.callback_query);
      return { status: 'ok' };
    }

    if (payload.message) {
      await this.handleMessage(payload.message);
      return { status: 'ok' };
    }

    return { status: 'ok' };
  }

  private async handleWidgetQuery(wq: any) {
    const data = String(wq.data || '');
    const chatId = wq.chat?.id ?? wq.from?.id;
    const messageId = wq.message_id;

    if (data === 'flight:tab:next') {
      const { chatData } = await this.buildUpcomingPayload(0);
      if (chatId && messageId) await this.editWidgetData(chatId, messageId, chatData);
      await this.answerWidgetQuery(wq.id, chatData);
      return;
    }

    if (data.startsWith('flight:next:')) {
      const idx = parseInt(data.slice('flight:next:'.length), 10) || 0;
      const { chatData } = await this.buildUpcomingPayload(idx);
      if (chatId && messageId) await this.editWidgetData(chatId, messageId, chatData);
      await this.answerWidgetQuery(wq.id, chatData);
      return;
    }

    if (data === 'flight:tab:stats') {
      const { chatData } = await this.buildStatsPayload();
      if (chatId && messageId) await this.editWidgetData(chatId, messageId, chatData);
      await this.answerWidgetQuery(wq.id, chatData);
      return;
    }

    if (data === 'flight:tab:hist' || data.startsWith('flight:hist:')) {
      const page = data.startsWith('flight:hist:') ? (parseInt(data.slice('flight:hist:'.length), 10) || 0) : 0;
      const { chatData } = await this.buildHistoryPayload(page);
      if (chatId && messageId) await this.editWidgetData(chatId, messageId, chatData);
      await this.answerWidgetQuery(wq.id, chatData);
      return;
    }

    if (data.startsWith('flight:srch:')) {
      const rest = data.slice('flight:srch:'.length);
      const sep = rest.indexOf(':');
      const page = sep >= 0 ? (parseInt(rest.slice(0, sep), 10) || 0) : 0;
      const query = sep >= 0 ? rest.slice(sep + 1) : '';
      const { chatData } = await this.buildSearchPayload(query, page);
      if (chatId && messageId) await this.editWidgetData(chatId, messageId, chatData);
      await this.answerWidgetQuery(wq.id, chatData);
      return;
    }

    if (data === 'flight:ask_search') {
      await this.answerWidgetQuery(wq.id, '{"ok":1}');
      if (chatId) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '🔍 [AeroLog Search] Reply with a flight number, booking ref, or airport IATA code (e.g. HND or JL25):',
          reply_markup: { force_reply: true, input_field_placeholder: 'e.g. HND, JL25...' },
        });
      }
      return;
    }

    if (data.startsWith('flight:del:')) {
      const id = parseInt(data.slice('flight:del:'.length), 10);
      if (!Number.isNaN(id)) {
        const db = drizzle(this.db);
        await db.delete(flights).where(eq(flights.id, id));
      }
      const deletedState = '{"del":1}';
      if (chatId && messageId) await this.editWidgetData(chatId, messageId, deletedState);
      await this.answerWidgetQuery(wq.id, deletedState);
      return;
    }

    if (data.startsWith('airport:keep:')) {
      const keptState = '{"st":"kept"}';
      if (chatId && messageId) await this.editWidgetData(chatId, messageId, keptState);
      await this.answerWidgetQuery(wq.id, keptState);
      return;
    }

    if (data.startsWith('airport:del:')) {
      const iata = data.slice('airport:del:'.length).trim().toUpperCase();
      if (iata) {
        const db = drizzle(this.db);
        await db.delete(airports).where(eq(airports.iataCode, iata));
      }
      const deletedState = '{"st":"deleted"}';
      if (chatId && messageId) await this.editWidgetData(chatId, messageId, deletedState);
      await this.answerWidgetQuery(wq.id, deletedState);
      return;
    }

    await this.answerWidgetQuery(wq.id, JSON.stringify({ error: 'Unknown flight action' }));
  }

  private async handleCallbackQuery(cb: any) {
    const chatId = cb.message?.chat?.id;
    const raw = String(cb.data || '');
    const lower = raw.toLowerCase();

    if (cb.id) {
      await this.callApi('answerCallbackQuery', { callback_query_id: cb.id });
    }
    if (!chatId) return;

    if (lower === 'flight_menu') {
      await this.sendUpcomingDashboard(chatId, 0);
    } else if (lower === 'flight_stats') {
      await this.sendStatsDashboard(chatId);
    } else if (lower.startsWith('flight_next')) {
      const parts = lower.split(':');
      const offset = parts.length > 1 ? (parseInt(parts[1], 10) || 0) : 0;
      await this.sendUpcomingDashboard(chatId, offset);
    } else if (lower === 'flight_recent') {
      await this.sendHistoryDashboard(chatId, 0);
    }
  }

  private async handleMessage(message: any) {
    const chatId = message.chat?.id;
    if (!chatId) return;

    const rawText = String(message.text || '').trim();
    const lower = rawText.toLowerCase();
    const replyText = String(message.reply_to_message?.text || message.reply_to_message?.caption || '');

    if (replyText.includes('[AeroLog') && rawText && !rawText.startsWith('/')) {
      await this.sendSearchDashboard(chatId, rawText, 0);
      return;
    }

    if (lower === '/flight' || lower.startsWith('/flight@') || lower === 'flight_menu') {
      await this.sendUpcomingDashboard(chatId, 0);
    } else if (lower.startsWith('/flight_stats')) {
      await this.sendStatsDashboard(chatId);
    } else if (lower.startsWith('/flight_next')) {
      const parts = lower.split(':');
      const offset = parts.length > 1 ? (parseInt(parts[1], 10) || 0) : 0;
      await this.sendUpcomingDashboard(chatId, offset);
    } else if (lower.startsWith('/flight_recent')) {
      await this.sendHistoryDashboard(chatId, 0);
    } else if (lower.startsWith('/flight_search')) {
      const query = rawText.replace(/^\/flight_search(?:@\S+)?/i, '').trim();
      if (!query) {
        await this.callApi('sendMessage', {
          chat_id: chatId,
          text: '🔍 [AeroLog Search] Reply with a flight number, booking ref, or airport IATA code (e.g. HND or JL25):',
          reply_markup: { force_reply: true, input_field_placeholder: 'e.g. HND, JL25...' },
        });
      } else {
        await this.sendSearchDashboard(chatId, query, 0);
      }
    } else if (lower.startsWith('/flight')) {
      await this.sendUpcomingDashboard(chatId, 0);
    }
  }

  private async sendUpcomingDashboard(chatId: number | string, offset: number) {
    const { chatData, caption, fallbackText } = await this.buildUpcomingPayload(offset);
    await this.sendWidget(chatId, {
      html: FLIGHT_DASHBOARD_HTML,
      caption,
      chatData,
      allowQueries: true,
      fallbackText,
      fallbackMarkup: {
        inline_keyboard: [
          [{ text: '📊 Travel Statistics', callback_data: 'flight_stats' }],
          [{ text: '📜 Recent Flight History', callback_data: 'flight_recent' }],
        ],
      },
    });
  }

  private async sendStatsDashboard(chatId: number | string) {
    const { chatData, caption, fallbackText } = await this.buildStatsPayload();
    await this.sendWidget(chatId, {
      html: FLIGHT_DASHBOARD_HTML,
      caption,
      chatData,
      allowQueries: true,
      fallbackText,
    });
  }

  private async sendHistoryDashboard(chatId: number | string, page: number) {
    const { chatData, caption, fallbackText } = await this.buildHistoryPayload(page);
    await this.sendWidget(chatId, {
      html: FLIGHT_DASHBOARD_HTML,
      caption,
      chatData,
      allowQueries: true,
      fallbackText,
    });
  }

  private async sendSearchDashboard(chatId: number | string, query: string, page: number) {
    const { chatData, caption, fallbackText } = await this.buildSearchPayload(query, page);
    await this.sendWidget(chatId, {
      html: FLIGHT_DASHBOARD_HTML,
      caption,
      chatData,
      allowQueries: true,
      fallbackText,
    });
  }

  private async buildUpcomingPayload(offset: number) {
    const db = drizzle(this.db);
    const today = new Date().toISOString().split('T')[0];

    const upcomingList = await db
      .select()
      .from(flights)
      .where(sql`${flights.flightDate} >= ${today}`)
      .orderBy(asc(flights.flightDate), asc(flights.id))
      .all();

    const airportList = await db.select().from(airports).all();
    const cityMap = new Map(airportList.map((a) => [a.iataCode, a.city]));

    const chatData = buildUpcomingFlightData(upcomingList as FlightRecord[], offset, cityMap, today);
    const idx = Math.max(0, Math.min(offset, Math.max(0, upcomingList.length - 1)));
    const next = upcomingList[idx];

    if (!next) {
      return {
        chatData,
        caption: '✈️ AeroLog Dashboard — No upcoming flights',
        fallbackText: 'No upcoming flights found. Time to book a trip! ✈️',
      };
    }

    const ref = formatFlightRef(next.airlineIata, next.flightNumber);
    let fallbackText =
      `🕒 *Upcoming Flight*\n\n• *Date:* ${next.flightDate}\n• *Flight:* ${ref}${next.aircraftType ? ` (${next.aircraftType})` : ''}\n` +
      `• *Route:* ${next.depAirportIata} → ${next.arrAirportIata}\n• *Time:* ${next.depTime || 'TBD'} - ${next.arrTime || 'TBD'}`;
    if (next.cabinClass || next.seat) {
      fallbackText += `\n• *Cabin/Seat:* ${[next.cabinClass, next.seat].filter(Boolean).join(' / ')}`;
    }
    if (next.bookingRef) {
      fallbackText += `\n• *PNR:* \`${next.bookingRef}\``;
    }
    if (next.ticketNumber) {
      fallbackText += `\n• *Ticket #:* \`${next.ticketNumber}\``;
    }

    return {
      chatData,
      caption: `✈️ Upcoming: ${next.depAirportIata} → ${next.arrAirportIata} (${ref}) on ${next.flightDate}`,
      fallbackText,
    };
  }

  private async buildStatsPayload() {
    const db = drizzle(this.db);
    const allFlights = await db.select().from(flights).all();
    const airportList = await db.select().from(airports).all();
    const airportMap = new Map(airportList.map((a) => [a.iataCode, a]));
    const today = new Date().toISOString().split('T')[0];

    const uniqueAirports = new Set<string>();
    const uniqueCountries = new Set<string>();
    const uniqueAirlines = new Set<string>();
    const monthlyCounts = new Array<number>(12).fill(0);
    const cabinCounts: Record<string, number> = {};
    let totalKm = 0;
    let upcomingFlights = 0;

    for (const f of allFlights) {
      uniqueAirports.add(f.depAirportIata);
      uniqueAirports.add(f.arrAirportIata);
      uniqueAirlines.add(f.airlineIata);
      if (f.distanceKm) totalKm += f.distanceKm;
      if (f.flightDate >= today) upcomingFlights++;

      const dep = airportMap.get(f.depAirportIata);
      const arr = airportMap.get(f.arrAirportIata);
      if (dep) uniqueCountries.add(dep.countryCode);
      if (arr) uniqueCountries.add(arr.countryCode);

      if (f.flightDate && /^\d{4}-\d{2}/.test(f.flightDate)) {
        const mIdx = parseInt(f.flightDate.slice(5, 7), 10) - 1;
        if (mIdx >= 0 && mIdx < 12) monthlyCounts[mIdx]++;
      }
      if (f.cabinClass) {
        cabinCounts[f.cabinClass] = (cabinCounts[f.cabinClass] || 0) + 1;
      }
    }

    const cabinBreakdown = Object.entries(cabinCounts).sort((a, b) => b[1] - a[1]);
    const chatData = buildFlightStatsData({
      totalFlights: allFlights.length,
      totalDistanceKm: totalKm,
      uniqueAirports: uniqueAirports.size,
      countriesVisited: uniqueCountries.size,
      uniqueAirlines: uniqueAirlines.size,
      upcomingFlights,
      monthlyCounts,
      cabinBreakdown,
    });

    const fallbackText =
      `📊 *Your Flight Statistics*\n\n• *Total Flights:* ${allFlights.length}\n` +
      `• *Distance:* ${Math.round(totalKm).toLocaleString()} km\n• *Airports Visited:* ${uniqueAirports.size}\n` +
      `• *Countries Visited:* ${uniqueCountries.size}`;

    return {
      chatData,
      caption: `📊 AeroLog Stats — ${allFlights.length} flights, ${Math.round(totalKm).toLocaleString()} km`,
      fallbackText,
    };
  }

  private async buildHistoryPayload(page: number) {
    const db = drizzle(this.db);
    const today = new Date().toISOString().split('T')[0];
    const recent = await db
      .select()
      .from(flights)
      .where(sql`${flights.flightDate} < ${today}`)
      .orderBy(desc(flights.flightDate), desc(flights.id))
      .all();

    const chatData = buildFlightListData('hist', recent as FlightRecord[], page);

    let fallbackText = 'You have no past flight history recorded.';
    if (recent.length > 0) {
      fallbackText = `📜 *Recent Flights*\n\n`;
      recent.slice(0, 5).forEach((f) => {
        fallbackText += `• ${f.flightDate}: ${f.depAirportIata}→${f.arrAirportIata} (${formatFlightRef(f.airlineIata, f.flightNumber)})\n`;
      });
    }

    return {
      chatData,
      caption: `📜 Flight History (${recent.length} past flights)`,
      fallbackText,
    };
  }

  private async buildSearchPayload(query: string, page: number) {
    const db = drizzle(this.db);
    const q = `%${query}%`;
    const results = await db
      .select()
      .from(flights)
      .where(
        sql`${flights.flightNumber} LIKE ${q} OR ${flights.depAirportIata} LIKE ${q} OR ${flights.arrAirportIata} LIKE ${q} OR COALESCE(${flights.bookingRef}, '') LIKE ${q}`
      )
      .orderBy(desc(flights.flightDate), desc(flights.id))
      .all();

    const chatData = buildFlightListData('srch', results as FlightRecord[], page, query);

    let fallbackText = `No flights found matching "${query}"`;
    if (results.length > 0) {
      fallbackText = `🔍 *Search Results for "${query}"*\n\n`;
      results.slice(0, 5).forEach((f) => {
        fallbackText += `• ${f.flightDate}: ${f.depAirportIata}→${f.arrAirportIata} (${formatFlightRef(f.airlineIata, f.flightNumber)})\n`;
      });
    }

    return {
      chatData,
      caption: `🔍 Flight Search "${query}" — ${results.length} match(es)`,
      fallbackText,
    };
  }
}
