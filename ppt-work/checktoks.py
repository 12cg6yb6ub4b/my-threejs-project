# -*- coding: utf-8 -*-
import re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
s = open(r'C:\Users\z\Desktop\250207239\250207239\my-threejs-project\ppt-work\readback.xml', encoding='utf-8').read()
toks = re.findall(r'<img[^>]*src="([^"]+)"', s)
from collections import Counter
c = Counter(toks)
for t, n in c.items():
    print(t, 'x', n)
print('distinct:', len(c), 'total:', sum(c.values()))
