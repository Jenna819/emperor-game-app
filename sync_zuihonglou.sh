#!/bin/bash
# 同步醉红楼图片：压缩PNG->JPG，更新JS中的ZH_PORTRAIT_DATA数组
set -e

SRC_DIR="zuihonglou"

echo "=== 同步醉红楼图片 ==="

# 1. 压缩所有PNG到JPG（同目录下）
for f in "$SRC_DIR"/*.PNG; do
  [ -f "$f" ] || continue
  base=$(basename "$f" .PNG)
  sips -s format jpeg --resampleWidth 400 "$f" -o "$SRC_DIR/${base}.jpg" 2>/dev/null
done

# 2. 删除不再存在的PNG对应的JPG
for jpg in "$SRC_DIR"/*.jpg; do
  [ -f "$jpg" ] || continue
  base=$(basename "$jpg" .jpg)
  if [ ! -f "$SRC_DIR/${base}.PNG" ]; then
    rm "$jpg"
    echo "已删除: $base.jpg"
  fi
done

# 3. 用Python生成JS数组并更新app.js和emperor.html
python3 << 'PYEOF'
import os, re

DEST_DIR = "zuihonglou"
files = sorted([f for f in os.listdir(DEST_DIR) if f.lower().endswith('.jpg')])
zh_entries = ',\n'.join(f'    "zuihonglou/{name}"' for name in files)

# 更新 app.js
with open('app.js', 'r', encoding='utf-8') as f:
    content = f.read()
zh_array_js = f'const ZH_PORTRAIT_DATA = [\n{zh_entries}\n];'
content = re.sub(r'const ZH_PORTRAIT_DATA = \[.*?\];', zh_array_js, content, flags=re.DOTALL)
with open('app.js', 'w', encoding='utf-8') as f:
    f.write(content)

# 更新 emperor.html
with open('emperor.html', 'r', encoding='utf-8') as f:
    content = f.read()
zh_array_html = f'  const ZH_PORTRAIT_DATA = [\n{zh_entries}\n  ];'
content = re.sub(r'const ZH_PORTRAIT_DATA = \[.*?\];', zh_array_html, content, flags=re.DOTALL)
with open('emperor.html', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'已更新 ZH_PORTRAIT_DATA ({len(files)} 张图片)')
PYEOF

echo "=== 同步完成 ==="
