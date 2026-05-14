/**
 * One-time import script: Reads an Excel/XLS file, transforms data, and outputs SQL.
 * 
 * Usage:
 *   npx tsx scripts/import_historical.ts path/to/your/export.xls > import.sql
 */
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import { AIRPORT_LOOKUP, AIRLINE_LOOKUP } from './airport_lookup';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Error: Please provide the path to your .xls or .xlsx file.');
  console.error('Usage: npx tsx scripts/import_historical.ts <path_to_file>');
  process.exit(1);
}

const XLS_PATH = path.resolve(process.cwd(), inputPath);

if (!fs.existsSync(XLS_PATH)) {
  console.error(`Error: File not found at ${XLS_PATH}`);
  process.exit(1);
}

function parseDate(dateStr: string): string {
  // Support YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  
  // Support "2026年4月29日"
  const match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  throw new Error(`Cannot parse date: "${dateStr}"`);
}

function parseDistance(distStr: string): number | null {
  if (!distStr) return null;
  // Extract number from "2113公里" or just "2113"
  const match = distStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function extractAirlineIata(flightNumber: string, airlineChinese: string): string {
  // Try to extract from flight number first: "JL25" -> "JL"
  const match = flightNumber.match(/^([A-Z0-9]{2})\d+$/);
  if (match) return match[1];

  // Fallback to airline name lookup
  const code = AIRLINE_LOOKUP[airlineChinese];
  if (code) return code;

  throw new Error(`Cannot determine airline IATA for: flight="${flightNumber}", airline="${airlineChinese}"`);
}

function escapeSQL(val: string): string {
  return val.replace(/'/g, "''");
}

function main() {
  const workbook = XLSX.readFile(XLS_PATH);
  const sheetNames = workbook.SheetNames;

  console.log('-- Flight Records Import');
  console.log(`-- Generated at ${new Date().toISOString()}`);
  console.log(`-- Sheets found: ${sheetNames.join(', ')}`);
  console.log('');

  const sheetsToImport = sheetNames.filter(name => !name.includes('无效票'));
  let totalRows = 0;
  let errors: string[] = [];

  for (const sheetName of sheetsToImport) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Skip header row
    const header = rows[0] as string[];
    console.log(`-- Processing sheet: "${sheetName}" (${rows.length - 1} rows)`);
    console.log(`-- Headers: ${header.join(', ')}`);
    console.log('');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as string[];
      if (!row || row.length < 7 || !row[0]) {
        errors.push(`Sheet "${sheetName}" row ${i + 1}: empty or incomplete, skipping`);
        continue;
      }

      const [dateStr, airlineChinese, flightNo, depCity, depTime, arrCity, arrTime, distStr, ticketNo] = row;

      try {
        const flightDate = parseDate(dateStr);
        const airlineIata = extractAirlineIata(flightNo, airlineChinese);

        // Try direct IATA code (3 letters) or lookup
        const depIata = (depCity.length === 3 && /^[A-Z]{3}$/.test(depCity)) 
          ? depCity 
          : AIRPORT_LOOKUP[depCity];
        if (!depIata) throw new Error(`Unknown departure airport: "${depCity}"`);

        const arrIata = (arrCity.length === 3 && /^[A-Z]{3}$/.test(arrCity)) 
          ? arrCity 
          : AIRPORT_LOOKUP[arrCity];
        if (!arrIata) throw new Error(`Unknown arrival airport: "${arrCity}"`);

        const distance = parseDistance(distStr || '');
        const ticket = (ticketNo && ticketNo !== '--') ? escapeSQL(ticketNo) : null;

        const distVal = distance !== null ? distance.toString() : 'NULL';
        const ticketVal = ticket ? `'${ticket}'` : 'NULL';

        console.log(
          `INSERT INTO flights (flight_date, airline_iata, flight_number, dep_airport_iata, arr_airport_iata, dep_time, arr_time, distance_km, ticket_number, source, created_at) ` +
          `VALUES ('${flightDate}', '${airlineIata}', '${escapeSQL(flightNo)}', '${depIata}', '${arrIata}', '${escapeSQL(depTime || '')}', '${escapeSQL(arrTime || '')}', ${distVal}, ${ticketVal}, 'import', unixepoch());`
        );
        totalRows++;
      } catch (err: any) {
        errors.push(`Sheet "${sheetName}" row ${i + 1}: ${err.message}`);
      }
    }
    console.log('');
  }

  console.log(`-- Total rows imported: ${totalRows}`);

  if (errors.length > 0) {
    console.log('');
    console.log('-- ===== ERRORS =====');
    errors.forEach(e => console.log(`-- ERROR: ${e}`));
  }
}

main();
