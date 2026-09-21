#!/usr/bin/env bash
# Publish Mapdash to https://mapdashgame.web.app
#
# Uses your existing gcloud login — no Firebase CLI, no stored secrets.
# Pushing to GitHub updates the github.io mirror on its own; this updates the
# main URL. Run it from the repo root:  ./deploy.sh
set -euo pipefail

PROJECT="mapdash-75488"
SITE="mapdashgame"

TOKEN="$(gcloud auth print-access-token)"
[ -n "$TOKEN" ] || { echo "gcloud is not logged in — run: gcloud auth login"; exit 1; }

PROJECT="$PROJECT" SITE="$SITE" TOKEN="$TOKEN" python3 - <<'PY'
import gzip, hashlib, json, os, sys, urllib.error, urllib.request

pid, site, tok = os.environ['PROJECT'], os.environ['SITE'], os.environ['TOKEN']
API = 'https://firebasehosting.googleapis.com/v1beta1'
H = {'Authorization': 'Bearer ' + tok, 'X-Goog-User-Project': pid,
     'Content-Type': 'application/json'}

# Everything the site needs. Anything not listed here simply is not published.
SHIP = ['index.html', 'config.js', 'sw.js', 'manifest.webmanifest',
        'icon-192.png', 'icon-512.png', 'og-mapdash.png',
        'js/mapdash.js', 'js/warmer.js', 'data/world-data.js']

def call(url, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, headers=H, method=method)
    try:
        with urllib.request.urlopen(r) as f:
            return json.loads(f.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        sys.exit('%s failed (%s): %s' % (url.rsplit('/', 1)[-1], e.code,
                                         e.read().decode()[:300]))

missing = [p for p in SHIP if not os.path.exists(p)]
if missing:
    sys.exit('missing files: ' + ', '.join(missing))

# sw.js must never be cached, or browsers keep serving the old shell.
version = call(API + '/sites/%s/versions' % site,
    {'config': {'headers': [{'glob': '/sw.js',
                             'headers': {'Cache-Control': 'no-cache'}}]}})['name']

blobs = {}
for path in SHIP:
    gz = gzip.compress(open(path, 'rb').read(), 9, mtime=0)
    blobs['/' + path] = (hashlib.sha256(gz).hexdigest(), gz)

pop = call(API + '/%s:populateFiles' % version,
           {'files': {k: v[0] for k, v in blobs.items()}})

by_hash = {h: gz for h, gz in blobs.values()}
needed = pop.get('uploadRequiredHashes') or []
for h in needed:
    r = urllib.request.Request(pop['uploadUrl'] + '/' + h, data=by_hash[h],
        headers={'Authorization': 'Bearer ' + tok,
                 'Content-Type': 'application/octet-stream'}, method='POST')
    with urllib.request.urlopen(r):
        pass

call(API + '/%s?update_mask=status' % version, {'status': 'FINALIZED'}, 'PATCH')
call(API + '/sites/%s/releases?versionName=%s' % (site, version), {})
print('published %d files (%d changed) -> https://%s.web.app'
      % (len(blobs), len(needed), site))
PY
