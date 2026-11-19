# AeroLog: Personal Flight Records Manager

A modern, high-performance web application to track, visualize, and analyze your personal flight history. Built with **React**, **Deck.gl**, and **Cloudflare Workers**.

**[Live Demo: flights.cyblocker.com](https://flights.cyblocker.com)**

### Quick Deploy (Backend API)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cyblocker/flight-records-manager&root=backend)

> [!NOTE]
> The **Frontend** should be deployed via **Cloudflare Pages** by connecting it directly to your GitHub repository for the best experience.

## Features

- **Interactive 3D Globe & Map**: Visualize your flight routes using Deck.gl and MapLibre GL.
- **Detailed Analytics**: Automatic calculation of total distance, countries visited, and airline statistics.
- **Flight Log**: Searchable and filterable table of all your historical flights.
- **Admin Panel & Owner Mode**: Unified management, upcoming trips vault (countdowns, seat, 1-tap copy PNR/ticket), and per-flight privacy controls on `/admin`.
- **Privacy-First Public Showcase**: Server-side Option B filtering hides upcoming flights, PNRs, ticket numbers, seats, notes, local departure/arrival times, unvisited airports, and private-flagged flights — plus a uniform randomized **3–7 day delay (20% per day)** before completed flights appear publicly.
- **Fancy Itinerary Image Generator**: Select 1 or more flights in Owner Mode to render a Retina boarding-pass PNG with an embedded curved route map and customizable privacy toggles for easy sharing with family and friends.
- **Installable Offline PWA**: Install `/admin` to your iOS/Android Home Screen with offline caching for in-flight / airport access.
- **Email-to-Log**: Forward your itinerary emails to a dedicated worker for automatic parsing via Gemini AI.
- **Cloudflare Native**: Optimized for Cloudflare Pages (Frontend), Workers (Backend), and D1 (Database).

## Project Structure

- `/frontend`: React + Vite application (Deck.gl, Framer Motion, Lucide icons).
- `/backend`: Cloudflare Worker API using Drizzle ORM.
- `/scripts`: Utility scripts for data migration and airport seeding.

---

## 🛠 Setup & Deployment

Since this project leverages several Cloudflare services, some manual setup is required in the Cloudflare Dashboard.

### 1. Database Setup (Cloudflare D1)
1.  Go to **Workers & Pages > D1** in your Cloudflare dashboard.
2.  Create a new database named `flight-records-db`.
3.  Copy the `database_id` and paste it into `backend/wrangler.toml`.
4.  Initialize the schema:
    ```bash
    cd backend
    npx wrangler d1 migrations apply flight-records-db --local
    npx wrangler d1 migrations apply flight-records-db --remote
    ```
5.  Seed airport data:
    ```bash
    wrangler d1 execute flight-records-db --remote --file=../seed_airports.sql
    ```

### 2. Secrets Configuration
You need to set two critical secrets for the backend worker. You can do this in the **Cloudflare Dashboard** (Settings > Variables > Secrets) or via the CLI:
```bash
wrangler secret put GEMINI_API_KEY      # Your Google AI Studio API Key
wrangler secret put AUTHORIZED_SENDER   # The email address authorized to forward itineraries
```
*Note: Secrets set in the dashboard persist across all future deployments.*

### 3. Service Bindings
To allow the frontend to communicate securely with the backend:
1.  Deploy the backend first: `cd backend && npm run deploy`.
2.  In the Cloudflare Dashboard, go to your **Frontend Pages project > Settings > Functions > Service Bindings**.
3.  Add a binding named `BACKEND` pointing to your `flight-records-backend` worker.

### 4. Local Development
1.  Copy `backend/.dev.vars.example` to `backend/.dev.vars` and add your keys.
2.  Start the backend: `cd backend && npm run dev`.
3.  Start the frontend: `cd frontend && npm run dev`.

---

## 🔒 Privacy, Cloudflare Zero Trust Passkey & PWA Setup

### 1. How Public Privacy Filtering Works
- **Server-Side Redaction**: Public endpoints (`/api/flights`, `/api/airports`, `/api/stats`) never return upcoming flights, `bookingRef` (PNR), `ticketNumber`, `seat`, `notes`, `depTime`/`arrTime`, `isPrivate` flights, or airports from unflown future bookings.
- **Randomized 3–7 Day Delay (20% / Day)**: When a flight is created or imported via email, the backend assigns a uniform random `publishDelayDays` in `{3, 4, 5, 6, 7}` using `crypto.getRandomValues`. A completed flight appears publicly only once `flightDate + publishDelayDays <= today` (and `isPrivate = false`).
- **Database Migration**: After pulling, apply `0002_add_flight_privacy.sql` to D1:
  ```bash
  cd backend
  npx wrangler d1 migrations apply flight-records-db --local
  npx wrangler d1 migrations apply flight-records-db --remote
  ```

### 2. Cloudflare Zero Trust + Passkeys
1. In Cloudflare **Zero Trust → Integrations → Identity providers**, add **Passkeys** (and enable *Automatically prompt on the login page*). Keep **One-time PIN** enabled as a device-enrollment fallback.
2. Under **Access → Applications**, protect `/admin*` and `/admin/api/*` on `flights.cyblocker.com` (leaving `/`, `/api/flights`, `/api/airports`, `/api/stats` public).
3. *(Recommended Defense-in-Depth)* Add your Access team domain, application AUD tag, and Telegram chat ID as Worker secrets so the backend cryptographically verifies Cloudflare Access JWTs and locks down the Telegram bot:
   ```bash
   cd backend
   npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # e.g. myteam.cloudflareaccess.com
   npx wrangler secret put CF_ACCESS_AUD           # Application Audience (AUD) Tag from Zero Trust
   npx wrangler secret put AUTHORIZED_CHAT_ID      # Optional: your numeric Telegram chat ID
   ```

### 3. Installing Owner PWA & Sharing Itinerary Cards
- **Install on Phone**: Open `https://flights.cyblocker.com/admin`, sign in with your Passkey, and tap **Add to Home Screen** (iOS Safari) / **Install App** (Android Chrome). Your flights are cached locally for offline viewing in Airplane Mode.
- **Share Fancy Cards**: Use the **Share Trip** button in Owner Mode (or select legs in *Upcoming* / *Flight Log*) to generate a high-DPI boarding-pass PNG with a custom route map. PNR and Ticket Number remain **OFF by default**.

---

## 🛫 Data Import

To import your existing records from an Excel or CSV file:

1.  **Check the format**: Refer to `data/sample_flights.csv` (International/English) or `data/sample_flights-cn.csv` (Chinese) for the required column structure.
2.  **Generate SQL**: Run the import script against your file:
    ```bash
    # For Excel or CSV
    npx tsx scripts/import_historical.ts path/to/your/data.csv > import.sql
    ```
3.  **Execute in D1**:
    ```bash
    # Local test
    npx wrangler d1 execute flight-records-db --local --file=import.sql
    # Remote deployment
    npx wrangler d1 execute flight-records-db --remote --file=import.sql
    ```

## License

MIT License. Feel free to use and modify for your personal use!
