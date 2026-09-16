#!/usr/bin/env python3
"""Fetch OSM building footprints for a bbox and save a ShadeMap-ready GeoJSON.
Usage:
  python tools/prebuild-osm-buildings.py --bbox 22.98,120.17,23.04,120.25 --out data/buildings.geojson
"""
import argparse, json, math, urllib.parse, urllib.request

def parse_height(tags, default_storey=3.1, default_height=3.1):
    def num(v):
        if v is None: return None
        s = str(v).lower().replace('meters','').replace('meter','').replace('metres','').replace('metre','').replace('m','').replace(',','.')
        try: return float(s.strip())
        except: return None
    h = num(tags.get('height'))
    if h and h > 0: return h, 'OSM height'
    levels = num(tags.get('building:levels'))
    if levels and levels > 0: return levels * default_storey, f'OSM building:levels × {default_storey} m'
    return default_height, '預設估計值'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', required=True, help='south,west,north,east')
    ap.add_argument('--out', required=True)
    ap.add_argument('--endpoint', default='https://overpass-api.de/api/interpreter')
    ap.add_argument('--timeout', type=int, default=60)
    args = ap.parse_args()
    south, west, north, east = map(float, args.bbox.split(','))
    q = f'[out:json][timeout:45];way["building"]({south},{west},{north},{east});out tags geom;'
    url = args.endpoint + '?data=' + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={'User-Agent':'Haidian-Soundscape-prebuild/1.0'})
    with urllib.request.urlopen(req, timeout=args.timeout) as r:
        data = json.load(r)
    features=[]
    for e in data.get('elements', []):
        geom=e.get('geometry') or []
        if len(geom) < 3: continue
        ring=[[p['lon'],p['lat']] for p in geom]
        if ring[0] != ring[-1]: ring.append(ring[0][:])
        tags=e.get('tags') or {}
        h, source=parse_height(tags)
        features.append({
            'type':'Feature',
            'geometry':{'type':'Polygon','coordinates':[ring]},
            'properties':{
                'height':h,'render_height':h,'height_source':source,
                'osm_id':e.get('id'),'name':tags.get('name:zh') or tags.get('name') or 'OSM building'
            }
        })
    out={'type':'FeatureCollection','features':features,'metadata':{'bbox':[south,west,north,east],'source':'OpenStreetMap via Overpass','count':len(features)}}
    with open(args.out,'w',encoding='utf-8') as f: json.dump(out,f,ensure_ascii=False,separators=(',',':'))
    print(f'wrote {len(features)} buildings -> {args.out}')
if __name__=='__main__': main()
