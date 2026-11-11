#!/usr/bin/env bash
# 一键出最终效果图：三张输入图（真人照片、机器人照片、背景图）→ 成品 PNG。
#
# 用法：
#   bash docs/api/make-poster.sh 真人.jpg 机器人.png 背景图.png [气泡文字] [输出目录]
#
# 例：
#   bash docs/api/make-poster.sh ./me.jpg ./robot.png ./bg.png 点赞！ ./out
#
# 可选环境变量：
#   GATEWAY=http://127.0.0.1:8190   本地网关
#   PY=/path/to/python              带 Pillow 的 Python（默认自动探测）
#   KEEP=1                          保留中间产物（两张绿幕图与 pose.json）
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "用法: make-poster.sh 真人.jpg 机器人.png 背景图.png [气泡文字] [输出目录]" >&2
  exit 1
fi

PERSON=$1
ROBOT=$2
BACKGROUND=$3
BUBBLE=${4:-}
OUT=${5:-./out}
GATEWAY=${GATEWAY:-http://127.0.0.1:8190}

for f in "$PERSON" "$ROBOT" "$BACKGROUND"; do
  [ -f "$f" ] || { echo "文件不存在: $f" >&2; exit 1; }
done

if [ -z "${PY:-}" ]; then
  for cand in python3 python "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe" "C:/Users/${USERNAME:-oee}/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe"; do
    if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import PIL" >/dev/null 2>&1; then PY=$cand; break; fi
  done
fi
if [ -z "${PY:-}" ]; then
  echo "找不到带 Pillow 的 Python，请设置 PY=/path/to/python" >&2
  exit 1
fi
echo "== Python: $PY"

mkdir -p "$OUT"

echo "== 1/2 生成两张绿幕图（真人 + 机器人）"
GATEWAY=$GATEWAY bun docs/api/generate-pose-image.ts \
  --person "$PERSON" --robot "$ROBOT" --out "$OUT" ${BUBBLE:+--bubble "$BUBBLE"}

echo "== 2/2 合成到背景图"
"$PY" docs/api/compose-poster.py \
  --person "$OUT/cartoon-person.png" \
  --robot  "$OUT/cartoon-robot.png" \
  --poster "$BACKGROUND" \
  --out    "$OUT/final-poster.png"

if [ "${KEEP:-0}" != "1" ]; then
  rm -f "$OUT/cartoon-person.png" "$OUT/cartoon-robot.png" "$OUT/pose.json"
fi

echo "完成：$OUT/final-poster.png"
