"""Build js/towns.js: Icelandic settlements used to say where a search result is.

Source: IS 50V place names (category "Þéttbýli") from Náttúrufræðistofnun's WFS.

    python tools/build_towns.py
"""
import json
import os
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
EXTRA = {'Þingeyri', 'Hvanneyri', 'Fellabær', 'Laugar', 'Grímsey'}
params = {
    'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature',
    'typeNames': 'IS_50V:v_ornefni_allt', 'outputFormat': 'application/json',
    'count': '500', 'srsName': 'EPSG:4326', 'cql_filter': "ornefnaflokkur='Þéttbýli'",
}
url = 'https://gis.natt.is/geoserver/IS_50V/ows?' + urllib.parse.urlencode(params)
data = json.load(urllib.request.urlopen(url, timeout=60))
towns = []
for f in data['features']:
    p = f['properties']
    b = f.get('bbox')
    if not b or not p.get('ornefni'):
        continue
    if (p.get('birtingarkvardi') or 0) < 250 and p['ornefni'] not in EXTRA:
        continue
    towns.append((p['ornefni'], round((b[0] + b[2]) / 2, 3), round((b[1] + b[3]) / 2, 3)))
towns.sort()
lines = ',\n'.join(f"  [{json.dumps(n, ensure_ascii=False)}, {lon}, {lat}]" for n, lon, lat in towns)
js = f"""// Settlements in Iceland: [name, longitude, latitude].
// From IS 50V place names (Náttúrufræðistofnun), category "Þéttbýli".
export const TOWNS = [
{lines},
];
"""
open(os.path.join(HERE, '..', 'js', 'towns.js'), 'w', encoding='utf-8').write(js)
print(len(towns), 'towns')
