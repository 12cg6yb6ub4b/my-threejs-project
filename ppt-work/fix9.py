# -*- coding: utf-8 -*-
import re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
src = open(r'C:\Users\z\Desktop\250207239\250207239\my-threejs-project\ppt-work\readback.xml', encoding='utf-8').read()
slides = re.findall(r'<slide\b.*?</slide>', src, flags=re.S)
print('slides found:', len(slides))
p9 = slides[8]
p9_new = p9.replace('WL7cb0a1Ood9xXxvLHUcTzZHnWh', 'DylFbPdhhoI11RxhJWpc9Jefnrh')
open(r'C:\Users\z\Desktop\250207239\250207239\my-threejs-project\ppt-work\slide-09-fix.xml', 'w', encoding='utf-8').write(p9_new)
print('slide-09-fix.xml written, old token present:', 'WL7cb0a1Ood9xXxvLHUcTzZHnWh' in p9_new)
