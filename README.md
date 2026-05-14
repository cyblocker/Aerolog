# AeroLog: Personal Flight Records Manager

A modern, high-performance web application to track, visualize, and analyze your personal flight history. Built with **React**, **Deck.gl**, and **Cloudflare Workers**.

**[Live Demo: flights.cyblocker.com](https://flights.cyblocker.com)**

![AeroLog Preview](https://github.com/cyblocker/flight-records-manager/raw/main/preview.png) *(Placeholder for your preview image)*

## Features

- **Interactive 3D Globe & Map**: Visualize your flight routes using Deck.gl and MapLibre GL.
- **Detailed Analytics**: Automatic calculation of total distance, countries visited, and airline statistics.
- **Flight Log**: Searchable and filterable table of all your historical flights.
- **Admin Panel**: Easy management interface to add or edit flight records.
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
