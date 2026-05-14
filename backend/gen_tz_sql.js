const fs = require('fs');
const lookup = require('tz-lookup');

const content = fs.readFileSync('airports_data.json', 'utf16le');
// Strip BOM if present
const cleanContent = content.trim().replace(/^\uFEFF/, '');

try {
    const data = JSON.parse(cleanContent);
    const results = data[0].results;

    const sqlLines = results.map(r => {
        const tz = lookup(r.latitude, r.longitude);
        return `UPDATE airports SET timezone = '${tz}' WHERE iata_code = '${r.iata_code}';`;
    });

    fs.writeFileSync('airports_tz_update.sql', sqlLines.join('\n'));
    console.log(`Generated airports_tz_update.sql with ${sqlLines.length} updates.`);
} catch (e) {
    console.error("Error parsing JSON:", e.message);
    console.log("First 100 chars:", cleanContent.substring(0, 100));
}
