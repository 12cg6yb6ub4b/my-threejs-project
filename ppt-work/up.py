# -*- coding: utf-8 -*-
import subprocess, json, os
os.chdir(r'C:\Users\z\Desktop\250207239\250207239\my-threejs-project\ppt-work')
PRES = 'AQw8s2bxHlg9TCdMOZ5crytXnyh'
files = ['docs-v7-orbit-day.png','docs-v2-orbit-day.png','docs-v2-orbit-dusk.png',
         'docs-v2-orbit-night.png','docs-v5-day-zoom.png','docs-v6-night-zoom.png',
         'docs-terrain-preview.png','docs-lowpoly-preview.png','docs-v3-fps-day.png']
out = {}
for f in files:
    r = subprocess.run(['lark-cli', 'slides', '+media-upload', '--file', './' + f,
                        '--presentation', PRES, '--jq', '.data.file_token'],
                       capture_output=True, text=True)
    merged = (r.stdout or '') + (r.stderr or '')
    lines = [ln.strip() for ln in merged.splitlines() if ln.strip()]
    tok = lines[-1] if lines else ''
    out[f] = tok
    print(f, tok[:24], 'ERR' if r.returncode else 'ok')
with open('tokens.json', 'w', encoding='utf-8') as fp:
    json.dump(out, fp, ensure_ascii=False)
print('saved tokens.json')
