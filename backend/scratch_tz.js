const { drizzle } = require('drizzle-orm/d1');
const lookup = require('tz-lookup');

async function updateTimezones(db) {
  const airportsData = await db.prepare('SELECT iata_code, latitude, longitude FROM airports').all();
  console.log(`Processing ${airportsData.results.length} airports...`);
  
  for (const airport of airportsData.results) {
    const tz = lookup(airport.latitude, airport.longitude);
    await db.prepare('UPDATE airports SET timezone = ? WHERE iata_code = ?')
      .bind(tz, airport.iata_code)
      .run();
  }
}

// Since I can't easily run a D1 script from node with the local state,
// I'll just generate a SQL file with the updates.
