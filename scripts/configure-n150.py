import json
import os
import re
import shlex
import shutil
import urllib.request
from pathlib import Path

HOME = Path.home()
DOMAIN = 'wefood.sherlockguo.com'
DEST = HOME / 'wefood'
DEST.mkdir(mode=0o700, exist_ok=True)


def read_env(path):
    result = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line.startswith('export '):
            line = line[7:]
        if not re.match(r'^[A-Z_0-9]+=', line):
            continue
        key, value = line.split('=', 1)
        parts = shlex.split(value, comments=True)
        result[key] = parts[0] if parts else ''
    return result


travel = read_env(HOME / 'wetravel/.env')
config = {'PORT': '4318', 'HOST': '127.0.0.1', 'DATA_DIR': str(DEST / 'data'), 'TRUSTED_ORIGINS': 'https://' + DOMAIN, 'SECURE_COOKIE': 'true'}
for old, new in [('WETRAVEL_TENCENT_JS_KEY', 'WEFOOD_TENCENT_JS_KEY'), ('WETRAVEL_TENCENT_KEY', 'WEFOOD_TENCENT_KEY'), ('WETRAVEL_TENCENT_SK', 'WEFOOD_TENCENT_SK')]:
    config[new] = travel.get(old, '')
path = DEST / '.env'
if path.exists():
    shutil.copy2(path, DEST / '.env.before-deploy')
    config = {**read_env(path), **config}
path.write_text(''.join(key + '=' + shlex.quote(value) + '\n' for key, value in config.items()))
os.chmod(path, 0o600)
print('wefood_env_configured; maps=' + str(bool(config.get('WEFOOD_TENCENT_KEY'))))

cf = read_env(HOME / 'wemonitor/.env').get('CF_API_TOKEN')
if not cf:
    raise RuntimeError('Cloudflare token missing')
text = Path('/etc/cloudflared/config.yml').read_text()
tunnel = re.search(r'^tunnel:\s*(.+)', text, re.M).group(1).strip()
credentials = re.search(r'^credentials-file:\s*(.+)', text, re.M).group(1).strip().strip('"\'')
account = json.loads(Path(credentials).read_text())['AccountTag']
endpoint = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/cfd_tunnel/' + tunnel + '/configurations'


def cf_request(method, body=None):
    request = urllib.request.Request(endpoint, method=method, headers={'Authorization': 'Bearer ' + cf, 'Content-Type': 'application/json'}, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    if not payload.get('success'):
        raise RuntimeError('Cloudflare configuration request failed')
    return payload['result']


current = cf_request('GET')['config']
rows = current['ingress']
existing = [row for row in rows if row.get('hostname') == DOMAIN]
if existing and any(row.get('service') != 'http://localhost:4318' for row in existing):
    raise RuntimeError('Domain already points to another service; refusing overwrite')
if not existing:
    index = next((i for i, row in enumerate(rows) if not row.get('hostname')), len(rows))
    updated = rows[:index] + [{'hostname': DOMAIN, 'service': 'http://localhost:4318'}] + rows[index:]
    cf_request('PUT', {'config': {**current, 'ingress': updated}})
    verified = cf_request('GET')['config']['ingress']
    assert any(row.get('hostname') == DOMAIN and row.get('service') == 'http://localhost:4318' for row in verified)
    print('cloudflare_dashboard_route_added; previous_routes_preserved=' + str(len(rows)))
else:
    print('cloudflare_dashboard_route_already_configured')
