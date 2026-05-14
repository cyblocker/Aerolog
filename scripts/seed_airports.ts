/**
 * Seed script: Outputs SQL INSERT statements for the airports table.
 * Includes all 100 airports from the historical data with verified coordinates.
 *
 * Usage:
 *   npx tsx scripts/seed_airports.ts > seed_airports.sql
 *   wrangler d1 execute flight-records-db --local --file=seed_airports.sql
 *   wrangler d1 execute flight-records-db --remote --file=seed_airports.sql
 */

interface AirportData {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

// All airports appearing in the historical flight data + commonly connected airports
const AIRPORTS: AirportData[] = [
  // === Japan ===
  { iata: 'HND', name: 'Tokyo Haneda', city: 'Tokyo', country: 'JP', lat: 35.5494, lon: 139.7798 },
  { iata: 'NRT', name: 'Tokyo Narita', city: 'Tokyo', country: 'JP', lat: 35.7647, lon: 140.3864 },
  { iata: 'KIX', name: 'Osaka Kansai', city: 'Osaka', country: 'JP', lat: 34.4347, lon: 135.2440 },
  { iata: 'ITM', name: 'Osaka Itami', city: 'Osaka', country: 'JP', lat: 34.7855, lon: 135.4380 },
  { iata: 'CTS', name: 'New Chitose', city: 'Sapporo', country: 'JP', lat: 42.7752, lon: 141.6924 },
  { iata: 'FUK', name: 'Fukuoka', city: 'Fukuoka', country: 'JP', lat: 33.5859, lon: 130.4510 },
  { iata: 'OKA', name: 'Naha', city: 'Okinawa', country: 'JP', lat: 26.1958, lon: 127.6459 },
  { iata: 'HIJ', name: 'Hiroshima', city: 'Hiroshima', country: 'JP', lat: 34.4361, lon: 132.9194 },
  { iata: 'NGS', name: 'Nagasaki', city: 'Nagasaki', country: 'JP', lat: 32.9169, lon: 129.9136 },
  { iata: 'HKD', name: 'Hakodate', city: 'Hakodate', country: 'JP', lat: 41.7700, lon: 140.8220 },
  { iata: 'OBO', name: 'Tokachi-Obihiro', city: 'Obihiro', country: 'JP', lat: 42.7333, lon: 143.2173 },
  { iata: 'MMB', name: 'Memanbetsu', city: 'Memanbetsu', country: 'JP', lat: 43.8806, lon: 144.1642 },
  { iata: 'AOJ', name: 'Aomori', city: 'Aomori', country: 'JP', lat: 40.7347, lon: 140.6907 },
  { iata: 'TAK', name: 'Takamatsu', city: 'Takamatsu', country: 'JP', lat: 34.2142, lon: 134.0156 },
  { iata: 'KCZ', name: 'Kochi Ryoma', city: 'Kochi', country: 'JP', lat: 33.5461, lon: 133.6694 },
  { iata: 'OKJ', name: 'Okayama', city: 'Okayama', country: 'JP', lat: 34.7569, lon: 133.8553 },
  { iata: 'OIT', name: 'Oita', city: 'Oita', country: 'JP', lat: 33.4794, lon: 131.7372 },
  { iata: 'MYJ', name: 'Matsuyama', city: 'Matsuyama', country: 'JP', lat: 33.8272, lon: 132.6997 },
  { iata: 'TOY', name: 'Toyama', city: 'Toyama', country: 'JP', lat: 36.6483, lon: 137.1876 },
  { iata: 'TJH', name: 'Tajima', city: 'Toyooka', country: 'JP', lat: 35.5128, lon: 134.7872 },
  { iata: 'SHM', name: 'Nanki-Shirahama', city: 'Shirahama', country: 'JP', lat: 33.6622, lon: 135.3640 },
  { iata: 'NGO', name: 'Chubu Centrair', city: 'Nagoya', country: 'JP', lat: 34.8584, lon: 136.8125 },
  { iata: 'KMJ', name: 'Kumamoto', city: 'Kumamoto', country: 'JP', lat: 32.8373, lon: 130.8551 },
  { iata: 'KOJ', name: 'Kagoshima', city: 'Kagoshima', country: 'JP', lat: 31.8034, lon: 130.7194 },

  // === China ===
  { iata: 'PEK', name: 'Beijing Capital', city: 'Beijing', country: 'CN', lat: 40.0799, lon: 116.6031 },
  { iata: 'PKX', name: 'Beijing Daxing', city: 'Beijing', country: 'CN', lat: 39.5098, lon: 116.4105 },
  { iata: 'PVG', name: 'Shanghai Pudong', city: 'Shanghai', country: 'CN', lat: 31.1443, lon: 121.8083 },
  { iata: 'SHA', name: 'Shanghai Hongqiao', city: 'Shanghai', country: 'CN', lat: 31.1979, lon: 121.3363 },
  { iata: 'CAN', name: 'Guangzhou Baiyun', city: 'Guangzhou', country: 'CN', lat: 23.3924, lon: 113.2988 },
  { iata: 'SZX', name: 'Shenzhen Bao\'an', city: 'Shenzhen', country: 'CN', lat: 22.6393, lon: 113.8107 },
  { iata: 'CTU', name: 'Chengdu Shuangliu', city: 'Chengdu', country: 'CN', lat: 30.5785, lon: 103.9471 },
  { iata: 'TFU', name: 'Chengdu Tianfu', city: 'Chengdu', country: 'CN', lat: 30.3197, lon: 104.4413 },
  { iata: 'CKG', name: 'Chongqing Jiangbei', city: 'Chongqing', country: 'CN', lat: 29.7192, lon: 106.6417 },
  { iata: 'KMG', name: 'Kunming Changshui', city: 'Kunming', country: 'CN', lat: 25.1019, lon: 102.9292 },
  { iata: 'XMN', name: 'Xiamen Gaoqi', city: 'Xiamen', country: 'CN', lat: 24.5440, lon: 118.1277 },
  { iata: 'TSN', name: 'Tianjin Binhai', city: 'Tianjin', country: 'CN', lat: 39.1244, lon: 117.3462 },
  { iata: 'DLC', name: 'Dalian Zhoushuizi', city: 'Dalian', country: 'CN', lat: 38.9657, lon: 121.5386 },
  { iata: 'CSX', name: 'Changsha Huanghua', city: 'Changsha', country: 'CN', lat: 28.1892, lon: 113.2200 },
  { iata: 'CGO', name: 'Zhengzhou Xinzheng', city: 'Zhengzhou', country: 'CN', lat: 34.5197, lon: 113.8407 },
  { iata: 'TNA', name: 'Jinan Yaoqiang', city: 'Jinan', country: 'CN', lat: 36.8572, lon: 117.2156 },
  { iata: 'SYX', name: 'Sanya Phoenix', city: 'Sanya', country: 'CN', lat: 18.3029, lon: 109.4122 },
  { iata: 'LJG', name: 'Lijiang Sanyi', city: 'Lijiang', country: 'CN', lat: 26.6822, lon: 100.2461 },
  { iata: 'KWL', name: 'Guilin Liangjiang', city: 'Guilin', country: 'CN', lat: 25.2181, lon: 110.0390 },

  // === Hong Kong / Macau / Taiwan ===
  { iata: 'HKG', name: 'Hong Kong', city: 'Hong Kong', country: 'HK', lat: 22.3080, lon: 113.9185 },
  { iata: 'MFM', name: 'Macau', city: 'Macau', country: 'MO', lat: 22.1496, lon: 113.5920 },
  { iata: 'TSA', name: 'Taipei Songshan', city: 'Taipei', country: 'TW', lat: 25.0694, lon: 121.5525 },
  { iata: 'TPE', name: 'Taiwan Taoyuan', city: 'Taipei', country: 'TW', lat: 25.0777, lon: 121.2325 },
  { iata: 'KHH', name: 'Kaohsiung', city: 'Kaohsiung', country: 'TW', lat: 22.5771, lon: 120.3500 },

  // === South Korea ===
  { iata: 'ICN', name: 'Incheon', city: 'Seoul', country: 'KR', lat: 37.4602, lon: 126.4407 },
  { iata: 'GMP', name: 'Gimpo', city: 'Seoul', country: 'KR', lat: 37.5583, lon: 126.7906 },
  { iata: 'PUS', name: 'Gimhae', city: 'Busan', country: 'KR', lat: 35.1796, lon: 128.9382 },
  { iata: 'CJU', name: 'Jeju', city: 'Jeju', country: 'KR', lat: 33.5113, lon: 126.4929 },

  // === Southeast Asia ===
  { iata: 'SIN', name: 'Singapore Changi', city: 'Singapore', country: 'SG', lat: 1.3502, lon: 103.9944 },
  { iata: 'BKK', name: 'Suvarnabhumi', city: 'Bangkok', country: 'TH', lat: 13.6900, lon: 100.7501 },
  { iata: 'HKT', name: 'Phuket', city: 'Phuket', country: 'TH', lat: 8.1132, lon: 98.3169 },
  { iata: 'CNX', name: 'Chiang Mai', city: 'Chiang Mai', country: 'TH', lat: 18.7668, lon: 98.9625 },
  { iata: 'USM', name: 'Ko Samui', city: 'Ko Samui', country: 'TH', lat: 9.5478, lon: 100.0622 },
  { iata: 'KUL', name: 'Kuala Lumpur', city: 'Kuala Lumpur', country: 'MY', lat: 2.7456, lon: 101.7099 },
  { iata: 'KCH', name: 'Kuching', city: 'Kuching', country: 'MY', lat: 1.4847, lon: 110.3468 },
  { iata: 'SGN', name: 'Tan Son Nhat', city: 'Ho Chi Minh City', country: 'VN', lat: 10.8188, lon: 106.6519 },
  { iata: 'HAN', name: 'Noi Bai', city: 'Hanoi', country: 'VN', lat: 21.2212, lon: 105.8072 },
  { iata: 'DLI', name: 'Lien Khuong', city: 'Da Lat', country: 'VN', lat: 11.7500, lon: 108.3673 },
  { iata: 'CXR', name: 'Cam Ranh', city: 'Nha Trang', country: 'VN', lat: 11.9982, lon: 109.2194 },
  { iata: 'MNL', name: 'Ninoy Aquino', city: 'Manila', country: 'PH', lat: 14.5086, lon: 121.0194 },
  { iata: 'CEB', name: 'Mactan-Cebu', city: 'Cebu', country: 'PH', lat: 10.3075, lon: 123.9794 },
  { iata: 'CGK', name: 'Soekarno-Hatta', city: 'Jakarta', country: 'ID', lat: -6.1256, lon: 106.6559 },

  // === Middle East ===
  { iata: 'DXB', name: 'Dubai', city: 'Dubai', country: 'AE', lat: 25.2528, lon: 55.3644 },
  { iata: 'DOH', name: 'Hamad', city: 'Doha', country: 'QA', lat: 25.2731, lon: 51.6081 },
  { iata: 'AUH', name: 'Abu Dhabi Zayed', city: 'Abu Dhabi', country: 'AE', lat: 24.4330, lon: 54.6511 },

  // === Europe ===
  { iata: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', country: 'FR', lat: 49.0097, lon: 2.5479 },
  { iata: 'FRA', name: 'Frankfurt', city: 'Frankfurt', country: 'DE', lat: 50.0379, lon: 8.5622 },
  { iata: 'MUC', name: 'Munich', city: 'Munich', country: 'DE', lat: 48.3537, lon: 11.7863 },
  { iata: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'NL', lat: 52.3105, lon: 4.7683 },
  { iata: 'FCO', name: 'Rome Fiumicino', city: 'Rome', country: 'IT', lat: 41.8003, lon: 12.2389 },
  { iata: 'MXP', name: 'Milan Malpensa', city: 'Milan', country: 'IT', lat: 45.6306, lon: 8.7281 },
  { iata: 'LIN', name: 'Milan Linate', city: 'Milan', country: 'IT', lat: 45.4454, lon: 9.2778 },
  { iata: 'VCE', name: 'Venice Marco Polo', city: 'Venice', country: 'IT', lat: 45.5053, lon: 12.3519 },
  { iata: 'BCN', name: 'Barcelona El Prat', city: 'Barcelona', country: 'ES', lat: 41.2971, lon: 2.0785 },
  { iata: 'MAD', name: 'Madrid Barajas', city: 'Madrid', country: 'ES', lat: 40.4983, lon: -3.5676 },
  { iata: 'BIO', name: 'Bilbao', city: 'Bilbao', country: 'ES', lat: 43.3011, lon: -2.9106 },
  { iata: 'VIE', name: 'Vienna', city: 'Vienna', country: 'AT', lat: 48.1103, lon: 16.5697 },
  { iata: 'BER', name: 'Berlin Brandenburg', city: 'Berlin', country: 'DE', lat: 52.3667, lon: 13.5033 },
  { iata: 'EDI', name: 'Edinburgh', city: 'Edinburgh', country: 'GB', lat: 55.9508, lon: -3.3726 },
  { iata: 'NCE', name: 'Nice Cote d\'Azur', city: 'Nice', country: 'FR', lat: 43.6584, lon: 7.2159 },
  { iata: 'SXB', name: 'Strasbourg', city: 'Strasbourg', country: 'FR', lat: 48.5383, lon: 7.6282 },
  { iata: 'BSL', name: 'EuroAirport Basel', city: 'Basel', country: 'CH', lat: 47.5990, lon: 7.5299 },
  { iata: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB', lat: 51.4700, lon: -0.4543 },
  { iata: 'ZRH', name: 'Zurich', city: 'Zurich', country: 'CH', lat: 47.4647, lon: 8.5492 },
  { iata: 'IST', name: 'Istanbul', city: 'Istanbul', country: 'TR', lat: 41.2753, lon: 28.7519 },
  { iata: 'HEL', name: 'Helsinki-Vantaa', city: 'Helsinki', country: 'FI', lat: 60.3172, lon: 24.9633 },

  // === North America ===
  { iata: 'SFO', name: 'San Francisco', city: 'San Francisco', country: 'US', lat: 37.6213, lon: -122.3790 },
  { iata: 'LAX', name: 'Los Angeles', city: 'Los Angeles', country: 'US', lat: 33.9425, lon: -118.4081 },
  { iata: 'JFK', name: 'John F. Kennedy', city: 'New York', country: 'US', lat: 40.6413, lon: -73.7781 },
  { iata: 'EWR', name: 'Newark Liberty', city: 'Newark', country: 'US', lat: 40.6895, lon: -74.1745 },
  { iata: 'ORD', name: 'O\'Hare', city: 'Chicago', country: 'US', lat: 41.9742, lon: -87.9073 },
  { iata: 'SEA', name: 'Seattle-Tacoma', city: 'Seattle', country: 'US', lat: 47.4502, lon: -122.3088 },
  { iata: 'DFW', name: 'Dallas/Fort Worth', city: 'Dallas', country: 'US', lat: 32.8998, lon: -97.0403 },
  { iata: 'PHX', name: 'Phoenix Sky Harbor', city: 'Phoenix', country: 'US', lat: 33.4373, lon: -112.0078 },
  { iata: 'SLC', name: 'Salt Lake City', city: 'Salt Lake City', country: 'US', lat: 40.7884, lon: -111.9778 },
  { iata: 'SAN', name: 'San Diego', city: 'San Diego', country: 'US', lat: 32.7336, lon: -117.1897 },
  { iata: 'MCO', name: 'Orlando', city: 'Orlando', country: 'US', lat: 28.4312, lon: -81.3081 },
  { iata: 'FLL', name: 'Fort Lauderdale', city: 'Fort Lauderdale', country: 'US', lat: 26.0742, lon: -80.1506 },
  { iata: 'DCA', name: 'Reagan National', city: 'Washington', country: 'US', lat: 38.8512, lon: -77.0402 },
  { iata: 'SJC', name: 'San Jose', city: 'San Jose', country: 'US', lat: 37.3626, lon: -121.9290 },
  { iata: 'YYZ', name: 'Toronto Pearson', city: 'Toronto', country: 'CA', lat: 43.6777, lon: -79.6248 },
  { iata: 'YUL', name: 'Montreal Trudeau', city: 'Montreal', country: 'CA', lat: 45.4706, lon: -73.7408 },

  // === Oceania ===
  { iata: 'SYD', name: 'Sydney Kingsford Smith', city: 'Sydney', country: 'AU', lat: -33.9461, lon: 151.1772 },
  { iata: 'MEL', name: 'Melbourne Tullamarine', city: 'Melbourne', country: 'AU', lat: -37.6690, lon: 144.8410 },
];

function escapeSQL(val: string): string {
  return val.replace(/'/g, "''");
}

function main() {
  console.log('-- Airport Seed Data');
  console.log(`-- Generated at ${new Date().toISOString()}`);
  console.log(`-- Total airports: ${AIRPORTS.length}`);
  console.log('');

  for (const ap of AIRPORTS) {
    console.log(
      `INSERT OR IGNORE INTO airports (iata_code, name, city, country_code, latitude, longitude) ` +
      `VALUES ('${ap.iata}', '${escapeSQL(ap.name)}', '${escapeSQL(ap.city)}', '${ap.country}', ${ap.lat}, ${ap.lon});`
    );
  }
}

main();
