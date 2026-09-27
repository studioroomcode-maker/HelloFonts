"""참조 이미지의 낱말과 우리 글꼴로 그린 같은 낱말을 나란히 놓는다.
   사용: python compare.py <참조.png> <글꼴.otf> <문장> <출력.png> [배경색] [글자색]
"""
import sys
from PIL import Image, ImageDraw, ImageFont
ref = Image.open(sys.argv[1]).convert('RGB')
font_path, text, out = sys.argv[2], sys.argv[3], sys.argv[4]
bg = sys.argv[5] if len(sys.argv) > 5 else '#f6f0e6'
fg = sys.argv[6] if len(sys.argv) > 6 else '#2a2233'
H = ref.height
size = int(H * 0.62)
f = ImageFont.truetype(font_path, size)
b = ImageDraw.Draw(ref).textbbox((0, 0), text, font=f)
w = b[2] - b[0] + 40
ours = Image.new('RGB', (max(w, 10), H), bg)
d = ImageDraw.Draw(ours)
d.text((20 - b[0], (H - (b[3] - b[1])) / 2 - b[1]), text, font=f, fill=fg)
canvas = Image.new('RGB', (max(ref.width, ours.width), H * 2 + 10), 'white')
canvas.paste(ref, (0, 0)); canvas.paste(ours, (0, H + 10))
canvas.save(out)
