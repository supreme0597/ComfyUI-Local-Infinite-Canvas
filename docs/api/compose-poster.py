"""把两张绿幕生成图合成到海报上，几何与画布卡片完全一致。

用法：
  python compose-poster.py --person cartoon-person.png --robot cartoon-robot.png \
      --poster poster.webp --out final.png

可选：
  --person-anchor 0.38  真人质心所在的横向位置（占宽比）
  --robot-anchor 0.67   机器人质心所在的横向位置
  --body 0.78           身体高度占海报高度比（卡片「画面大小」中=0.78，小=0.62，大=0.9）
  --baseline 0.94       脚底线占海报高度比
  --shadow 0.55         投影不透明度
"""
import argparse
from PIL import Image, ImageFilter


def chroma(im):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            gness = g - max(r, b)
            if gness <= 40:
                continue
            alpha = 0 if gness >= 110 else round(255 * (1 - (gness - 40) / 70))
            px[x, y] = (r, min(g, max(r, b) + 24), b, min(a, alpha))
    return im


def trim(im):
    box = im.getbbox()
    if not box:
        return im
    pad = max(4, round(min(im.size) * 0.02))
    x0, y0, x1, y1 = box
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def shape(im):
    """最大连通块的重心与上下界：气泡、星星单独成块，不能把包围盒撑高、把身高算短。"""
    im = im.convert("RGBA")
    w, h = im.size
    a = im.split()[3].load()
    step = max(1, min(w, h) // 200)
    gw, gh = -(-w // step), -(-h // step)
    mask = [[0] * gw for _ in range(gh)]
    for gy in range(gh):
        for gx in range(gw):
            x = min(w - 1, gx * step + step // 2)
            y = min(h - 1, gy * step + step // 2)
            mask[gy][gx] = 1 if a[x, y] > 16 else 0
    label = [[0] * gw for _ in range(gh)]
    best, best_size, idx = 0, 0, 0
    for sy in range(gh):
        for sx in range(gw):
            if not mask[sy][sx] or label[sy][sx]:
                continue
            idx += 1
            size = 0
            stack = [(sx, sy)]
            label[sy][sx] = idx
            while stack:
                cx, cy = stack.pop()
                size += 1
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < gw and 0 <= ny < gh and mask[ny][nx] and not label[ny][nx]:
                        label[ny][nx] = idx
                        stack.append((nx, ny))
            if size > best_size:
                best_size, best = size, idx
    tot = sx_sum = 0
    top, bottom = h - 1, 0
    for y in range(h):
        gy = min(gh - 1, y // step)
        for x in range(w):
            v = a[x, y]
            if v <= 8 or label[gy][min(gw - 1, x // step)] != best:
                continue
            tot += v
            sx_sum += x * v
            if y < top:
                top = y
            if y > bottom:
                bottom = y
    if not tot:
        return w / 2, 0, h - 1
    return sx_sum / tot, top, bottom


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--person", required=True)
    ap.add_argument("--robot", required=True)
    ap.add_argument("--poster", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--person-anchor", type=float, default=0.36)
    ap.add_argument("--robot-anchor", type=float, default=0.67)
    ap.add_argument("--body", type=float, default=0.78)
    ap.add_argument("--baseline", type=float, default=0.94)
    ap.add_argument("--shadow", type=float, default=0.55)
    args = ap.parse_args()

    poster = Image.open(args.poster).convert("RGB")
    W, H = poster.size
    imgs = [trim(chroma(Image.open(args.person))), trim(chroma(Image.open(args.robot)))]
    shapes = [shape(i) for i in imgs]
    target_body = H * args.body
    baseline = round(H * args.baseline)

    for idx, im in enumerate(imgs):
        cx, top, bottom = shapes[idx]
        body = bottom - top + 1
        scale = min(W * 0.46 / im.width, target_body / body)
        w, h = round(im.width * scale), round(im.height * scale)
        anchor = args.person_anchor if idx == 0 else args.robot_anchor
        x = round(W * anchor - cx * scale)
        y = baseline - round(bottom * scale)
        layer = im.resize((w, h), Image.LANCZOS)
        shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        shadow.paste((15, 23, 42, 140), (0, 0), layer.split()[3])
        shadow = shadow.filter(ImageFilter.GaussianBlur(max(1, round(W * 0.005))))
        alpha = shadow.split()[3].point(lambda v: int(v * args.shadow))
        poster.paste((0, 0, 0), (x + round(W * 0.003), y + round(W * 0.006)), alpha)
        poster.paste(layer, (x, y), layer)
        print(f"[{idx}] x={x} y={y} w={w} h={h} body={round(body * scale)}px")

    poster.save(args.out)
    print(args.out)


if __name__ == "__main__":
    main()
