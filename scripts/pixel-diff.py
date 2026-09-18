# 前后截图像素差异分析（同一默认视角）
from PIL import Image
import os

base = r"C:\Users\z\Desktop\250207239\250207239\my-threejs-project"
before = Image.open(os.path.join(base, "docs-before-fix.png")).convert("RGB")
after = Image.open(os.path.join(base, "docs-after-fix.png")).convert("RGB")
print("before:", before.size, "after:", after.size)
assert before.size == after.size, "尺寸不一致"

w, h = before.size
pb = before.load()
pa = after.load()
changed = 0
total = w * h
max_d = 0
for y in range(h):
    for x in range(w):
        r1, g1, b1 = pb[x, y]
        r2, g2, b2 = pa[x, y]
        d = abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)
        if d > 30:
            changed += 1
        if d > max_d:
            max_d = d
print(f"像素变化(>30): {changed} / {total} = {changed/total*100:.1f}%")
print(f"最大通道差和: {max_d}")

# 差异图
diff = Image.new("RGB", (w, h))
pd = diff.load()
for y in range(h):
    for x in range(w):
        r1, g1, b1 = pb[x, y]
        r2, g2, b2 = pa[x, y]
        d = abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)
        if d > 30:
            pd[x, y] = (255, 0, 0)
        else:
            pd[x, y] = (r1, g1, b1)
diff.save(os.path.join(base, "docs-diff-default.png"))
print("差异图已保存")
