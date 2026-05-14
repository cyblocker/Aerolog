import json
import os

with open('airports_data.json', 'r', encoding='utf-16') as f:
    # Skip potential junk at start (like wrangler info)
    content = f.read()
    start_index = content.find('[')
    if start_index != -1:
        data = json.loads(content[start_index:])
        results = data[0]['results']
        
        sql_lines = []
        for r in results:
            name = r['name'].replace("'", "''")
            city = r['city'].replace("'", "''")
            line = f"INSERT INTO airports (iata_code, name, city, country_code, latitude, longitude) VALUES ('{r['iata_code']}', '{name}', '{city}', '{r['country_code']}', {r['latitude']}, {r['longitude']});"
            sql_lines.append(line)
            
        with open('airports_import.sql', 'w', encoding='utf-8') as sf:
            sf.write('\n'.join(sql_lines))
        print(f"Generated airports_import.sql with {len(sql_lines)} entries.")
    else:
        print("Could not find JSON array in file.")
