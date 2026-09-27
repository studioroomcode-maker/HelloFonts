"""샘플의 모든 낱말을 우리 글꼴과 나란히 한 장에 모은다. 사용: python compare_all.py <ref폴더> <제목.otf> <본문.otf> <출력.png>"""
import sys, os
from PIL import Image, ImageColor, ImageDraw, ImageFont
ref, title, body, out = sys.argv[1:5]
ROWS = [
    ('clear', title, '클리어!', '#e8638f', '#fff8ee'), ('setting', title, '설정', '#e8638f', '#fff8ee'),
    ('bgm', body, '배경음악', '#fbf3e6', '#3b3a4a'), ('sfx', body, '효과음', '#fbf3e6', '#3b3a4a'),
    ('voice', body, '목소리', '#fbf3e6', '#3b3a4a'), ('vib', body, '진동', '#fbf3e6', '#3b3a4a'),
    ('korean', body, '한국어', '#e8638f', '#ffffff'), ('opening', body, '오프닝 다시 보기', '#e8638f', '#ffffff'),
    ('next', body, '다음 스테이지', '#5fbf8f', '#ffffff'), ('bonus', body, '보너스 클로버', '#e3f1e3', '#2f6b3a'),
    ('stage', body, '스테이지 1-3', '#fbf3e6', '#4a3a3a'),
]
def ink_height(img, fg):
    # 글자색에 가까운 픽셀의 세로 범위(원본 잉크 높이)
    px = img.load(); fr, fgc, fb = ImageColor.getrgb(fg)
    rows = [y for y in range(img.height) if any(abs(px[x, y][0] - fr) + abs(px[x, y][1] - fgc) + abs(px[x, y][2] - fb) < 120 for x in range(img.width))]
    return (rows[-1] - rows[0] + 1) if rows else img.height * 0.7

tiles = []
for name, font, text, bg, fg in ROWS:
    r = Image.open(os.path.join(ref, name + '.png')).convert('RGB')
    r = r.resize((int(r.width * 110 / r.height), 110), Image.LANCZOS)
    target = ink_height(r, fg)
    probe = ImageFont.truetype(font, 100)
    pb = ImageDraw.Draw(r).textbbox((0, 0), text, font=probe)
    f = ImageFont.truetype(font, max(8, round(100 * target / max(1, pb[3] - pb[1]))))
    d0 = ImageDraw.Draw(r)
    b = d0.textbbox((0, 0), text, font=f)
    o = Image.new('RGB', (b[2] - b[0] + 30, 110), bg)
    ImageDraw.Draw(o).text((15 - b[0], (110 - (b[3] - b[1])) / 2 - b[1]), text, font=f, fill=fg)
    row = Image.new('RGB', (r.width + o.width + 20, 110), 'white')
    row.paste(r, (0, 0)); row.paste(o, (r.width + 20, 0))
    tiles.append(row)
W = max(t.width for t in tiles); H = sum(t.height + 8 for t in tiles)
sheet = Image.new('RGB', (W, H), 'white'); y = 0
for t in tiles:
    sheet.paste(t, (0, y)); y += t.height + 8
sheet.save(out)
