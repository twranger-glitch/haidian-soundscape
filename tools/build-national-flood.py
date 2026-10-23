#!/usr/bin/env python3
"""
把水利署「歷史淹水資料」(政府資料開放授權) 的 KML 轉成網站用的 national-historical-flood.geojson。

資料來源：https://data.gov.tw/dataset/25770
  index → https://opendata.wra.gov.tw/api/v2/72d7aee9-e29b-49a2-bd0b-54acc8e3b75c?format=JSON
  裡面只有一個 KML：歷年颱風淹水範圍（每個事件一個 Document，底下依地區分 Folder）。
不需要任何 API 金鑰，純公開檔案；前端只讀同層的 GeoJSON。

縣市用多邊形中心點對縣市界判斷（縣市界：g0v twgeojson，2010 行政區，會併成現在的六都名稱）。

用法：
  python3 tools/build-national-flood.py [--kml 檔] [--county 檔] [--out national-historical-flood.geojson]
  不給檔案就直接從網路下載。
"""
import argparse
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

INDEX_URL = 'https://opendata.wra.gov.tw/api/v2/72d7aee9-e29b-49a2-bd0b-54acc8e3b75c?sort=_importdate%20asc&format=JSON'
COUNTY_URL = 'https://raw.githubusercontent.com/g0v/twgeojson/master/json/twCounty2010.geo.json'
KML_NS = '{http://www.opengis.net/kml/2.2}'
SOURCE = '經濟部水利署 歷史淹水資料（政府資料開放授權條款）'

# 2010 的縣市名稱 → 現在的名稱
COUNTY_RENAME = {
    '台北縣': '新北市', '台中縣': '臺中市', '台南縣': '臺南市', '高雄縣': '高雄市', '桃園縣': '桃園市'
}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'haidian-soundscape build'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def load_kml_text(path):
    if path:
        text = open(path, 'rb').read().decode('utf-8')
    else:
        index = json.loads(fetch(INDEX_URL).decode('utf-8'))
        kml_url = next(i['sourceurl'] for i in index if str(i.get('fileex', '')).lower() == 'kml')
        print('下載', kml_url, file=sys.stderr)
        text = fetch(kml_url).decode('utf-8')
    # 原檔用了 xsi:schemaLocation 卻沒宣告 xsi 命名空間，補上去才解析得了
    if 'xmlns:xsi' not in text[:2000]:
        text = text.replace('<kml ', '<kml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ', 1)
    return text


def norm_county(name):
    name = COUNTY_RENAME.get(name, name)
    return name.replace('台', '臺')


def load_counties(path):
    data = json.loads(open(path, 'rb').read() if path else fetch(COUNTY_URL))
    out = []
    for f in data['features']:
        geom = f['geometry']
        polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        name = norm_county(f['properties'].get('name') or f['properties'].get('COUNTYNAME'))
        for poly in polys:
            ring = poly[0]
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            out.append((name, ring, (min(xs), min(ys), max(xs), max(ys))))
    return out


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-18) + xi:
            inside = not inside
        j = i
    return inside


def county_of(x, y, counties):
    for name, ring, (x0, y0, x1, y1) in counties:
        if x0 <= x <= x1 and y0 <= y <= y1 and point_in_ring(x, y, ring):
            return name
    # 落在海上或界外：找最近的邊界框
    best = None
    for name, ring, (x0, y0, x1, y1) in counties:
        dx = max(x0 - x, 0, x - x1)
        dy = max(y0 - y, 0, y - y1)
        d = dx * dx + dy * dy
        if best is None or d < best[0]:
            best = (d, name)
    return best[1] if best and best[0] < 0.05 ** 2 else ''


def parse_coords(text):
    pts = []
    for token in (text or '').split():
        parts = token.split(',')
        if len(parts) >= 2:
            pts.append([round(float(parts[0]), 5), round(float(parts[1]), 5)])
    return pts


def polygon_coords(poly_el):
    rings = []
    outer = poly_el.find('.//' + KML_NS + 'outerBoundaryIs//' + KML_NS + 'coordinates')
    if outer is None:
        return None
    rings.append(parse_coords(outer.text))
    for inner in poly_el.findall('.//' + KML_NS + 'innerBoundaryIs//' + KML_NS + 'coordinates'):
        rings.append(parse_coords(inner.text))
    return rings if rings[0] and len(rings[0]) >= 4 else None


def placemark_geometry(pm):
    polys = [polygon_coords(p) for p in pm.iter(KML_NS + 'Polygon')]
    polys = [p for p in polys if p]
    if polys:
        if len(polys) == 1:
            return {'type': 'Polygon', 'coordinates': polys[0]}
        return {'type': 'MultiPolygon', 'coordinates': polys}
    pt = pm.find('.//' + KML_NS + 'Point//' + KML_NS + 'coordinates')
    if pt is not None:
        c = parse_coords(pt.text)
        if c:
            return {'type': 'Point', 'coordinates': c[0]}
    return None


def centroid(geom):
    ring = geom['coordinates'] if geom['type'] == 'Point' else None
    if ring:
        return ring
    coords = geom['coordinates'][0] if geom['type'] == 'Polygon' else geom['coordinates'][0][0]
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    return [sum(xs) / len(xs), sum(ys) / len(ys)]


def parse_event(name):
    """'105-09-27梅姬颱風' → ('2016-09-27', 2016, '梅姬颱風')；'94-易淹水調查' → ('', 2005, '易淹水調查')"""
    m = re.match(r'^(\d{2,3})(?:-(\d{2})-(\d{2}))?-?(.*)$', name.strip())
    if not m:
        return '', None, name.strip()
    year = int(m.group(1)) + 1911
    date = '%d-%s-%s' % (year, m.group(2), m.group(3)) if m.group(2) else ''
    return date, year, m.group(4).strip() or name.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kml')
    ap.add_argument('--county')
    ap.add_argument('--out', default='national-historical-flood.geojson')
    args = ap.parse_args()

    root = ET.fromstring(load_kml_text(args.kml))
    counties = load_counties(args.county)
    print('縣市多邊形', len(counties), file=sys.stderr)

    features = []
    for doc in root.iter(KML_NS + 'Document'):
        name_el = doc.find(KML_NS + 'name')
        doc_name = (name_el.text if name_el is not None else doc.get('id') or '').strip()
        event_date, year, event_name = parse_event(doc_name)
        for folder in doc.iter(KML_NS + 'Folder'):
            fname_el = folder.find(KML_NS + 'name')
            region = (fname_el.text or '').strip() if fname_el is not None else ''
            for pm in folder.findall(KML_NS + 'Placemark'):
                geom = placemark_geometry(pm)
                if not geom:
                    continue
                cx, cy = centroid(geom)
                pm_name = pm.find(KML_NS + 'name')
                features.append({
                    'type': 'Feature',
                    'properties': {
                        'event_name': event_name,
                        'event_date': event_date,
                        'year': year,
                        'county': county_of(cx, cy, counties),
                        'region': region.replace('台', '臺'),
                        'location': (pm_name.text or '').strip() if pm_name is not None else '',
                        'source': SOURCE
                    },
                    'geometry': geom
                })

    features.sort(key=lambda f: (f['properties']['year'] or 0, f['properties']['event_date'], f['properties']['county']))
    out = {
        'type': 'FeatureCollection',
        'name': '歷年颱風淹水範圍',
        'source': SOURCE,
        'source_url': 'https://data.gov.tw/dataset/25770',
        'features': features
    }
    with open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    counts = {}
    for f in features:
        counts[f['properties']['county'] or '(無)'] = counts.get(f['properties']['county'] or '(無)', 0) + 1
    print('寫出', args.out, len(features), '筆', counts, file=sys.stderr)


if __name__ == '__main__':
    main()
