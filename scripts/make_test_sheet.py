"""합성 손글씨 원고지 사진 만들기 (인식 테스트용)
   원고지 칸에 시스템 글꼴로 글자를 '써 넣고', 원근·회전·잡음을 준 사진처럼 만든다.
   사용: python make_test_sheet.py <출력.pgm> <미리보기.png> [hangul|latin]
"""
import sys, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SHEET = dict(w=210, h=297, cols=8, left=20, top=32, pitchX=21.25, pitchY=24.4, box=18, label=4.4)
MARKERS = [(12, 12), (198, 12), (12, 285), (198, 285)]
S = 9  # px/mm

def compose(cho, jung, jong=''):
    CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
    JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
    JONG = ['', *'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']
    return chr(0xAC00 + CHO.index(cho) * 588 + JUNG.index(jung) * 28 + JONG.index(jong))

C = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'
V = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ'
HANGUL = [compose(c, 'ㅏ') for c in C] + [compose(c, 'ㅗ') for c in C] + [compose('ㅇ', v) for v in V] + [compose('ㅇ', 'ㅏ', c) for c in C]
LATIN = list('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-()\'":/')

out_pgm, out_png = sys.argv[1], sys.argv[2]
page = sys.argv[3] if len(sys.argv) > 3 else 'hangul'
cells = HANGUL if page == 'hangul' else LATIN
W, H = SHEET['w'] * S, SHEET['h'] * S
im = Image.new('RGB', (W, H), 'white')
d = ImageDraw.Draw(im)
for (mx, my) in MARKERS:
    d.rectangle([(mx - 4) * S, (my - 4) * S, (mx + 4) * S, (my + 4) * S], fill='black')
font = ImageFont.truetype('C:/Windows/Fonts/malgun.ttf', int(15 * S))
fontL = ImageFont.truetype('C:/Windows/Fonts/segoepr.ttf', int(11 * S)) if page == 'latin' else font
label = ImageFont.truetype('C:/Windows/Fonts/malgun.ttf', int(3 * S))
random.seed(3)
for i, ch in enumerate(cells):
    col, row = i % SHEET['cols'], i // SHEET['cols']
    x = SHEET['left'] + col * SHEET['pitchX'] + (SHEET['pitchX'] - SHEET['box']) / 2
    y = SHEET['top'] + row * SHEET['pitchY'] + SHEET['label']
    d.text((x * S, (y - 4.2) * S), ch, font=label, fill=(150, 150, 150))
    d.rectangle([x * S, y * S, (x + SHEET['box']) * S, (y + SHEET['box']) * S], outline=(244, 182, 194), width=3)
    # 손글씨 흉내: 조금씩 다른 위치와 크기
    jx, jy = random.uniform(-0.6, 0.6), random.uniform(-0.6, 0.6)
    f = fontL
    bbox = d.textbbox((0, 0), ch, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    cx, cy = (x + SHEET['box'] / 2 + jx) * S, (y + SHEET['box'] / 2 + jy) * S
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), ch, font=f, fill=(25, 25, 40))
# 사진처럼: 원근 왜곡 + 흐림 + 잡음 + 그림자
coeffs = None
src = [(0, 0), (W, 0), (W, H), (0, H)]
dst = [(W * 0.03, H * 0.02), (W * 0.95, H * 0.035), (W * 0.99, H * 0.97), (W * 0.01, H * 0.985)]
import numpy as np
def find_coeffs(pa, pb):
    matrix = []
    for p1, p2 in zip(pa, pb):
        matrix.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        matrix.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    A = np.array(matrix, dtype=float); B = np.array(pb, dtype=float).reshape(8)
    return np.linalg.solve(A, B).tolist()
big = Image.new('RGB', (int(W * 1.05), int(H * 1.03)), (205, 200, 190))
warped = im.transform(big.size, Image.PERSPECTIVE, find_coeffs(dst, src), Image.BICUBIC, fillcolor=(205, 200, 190))
warped = warped.filter(ImageFilter.GaussianBlur(1.2))
g = warped.convert('L')
arr = np.array(g, dtype=float)
yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]]
arr = arr * (0.82 + 0.18 * (xx / arr.shape[1])) + np.random.normal(0, 6, arr.shape)
arr = np.clip(arr, 0, 255).astype(np.uint8)
g = Image.fromarray(arr)
g = g.resize((g.width // 2, g.height // 2), Image.LANCZOS)  # 휴대폰 사진 해상도 정도로
g.save(out_png)
with open(out_pgm, 'wb') as fp:
    fp.write(f'P5 {g.width} {g.height} 255\n'.encode())
    fp.write(g.tobytes())
print('ok', g.width, g.height)
