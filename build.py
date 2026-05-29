# -*- coding: utf-8 -*-
"""
皇帝后宫养成 - 构建脚本
自动读取 Photo 文件夹中的图片，嵌入到 HTML 中生成单文件版本
"""
import base64, os, sys, re

PHOTO_DIR = '/Users/dm-jenna/Desktop/claude code/Photo'
SRC_HTML  = '/Users/dm-jenna/Desktop/claude code/index.html'
DST_HTML  = '/tmp/emperor-web/index.html'
MAX_PNG_SIZE = 400  # Resize max dimension

def find_images(directory):
    """找出妃子肖像图片和背景图（支持 .png/.PNG/.jpeg/.JPEG/.jpg/.JPG）"""
    portraits = []
    bg = None
    valid_ext = ('.png', '.jpeg', '.jpg')
    for f in sorted(os.listdir(directory)):
        if f.lower().endswith(valid_ext):
            path = os.path.join(directory, f)
            if '主界面背景' in f:
                bg = path
            else:
                portraits.append(path)
    return portraits, bg

def resize_image(input_path, max_size):
    """使用 sips 压缩图片"""
    output_path = input_path.rsplit('.', 1)[0] + '_resized' + os.path.splitext(input_path)[1]
    os.system(f'sips -Z {max_size} "{input_path}" --out "{output_path}" 2>/dev/null')
    return output_path if os.path.exists(output_path) else input_path

def to_base64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')

def build():
    print(f"扫描照片文件夹: {PHOTO_DIR}")
    portraits, bg = find_images(PHOTO_DIR)
    
    if not portraits:
        print("错误: 没有找到妃子肖像图片!")
        sys.exit(1)
    
    print(f"找到 {len(portraits)} 张妃子肖像图片")
    if bg:
        print(f"找到背景图: {os.path.basename(bg)}")
    
    # 读取模板 HTML
    with open(SRC_HTML, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 处理肖像图：压缩后转 base64
    portrait_data = []
    for i, path in enumerate(portraits):
        print(f"  处理肖像 {i+1}/{len(portraits)}: {os.path.basename(path)}")
        resized = resize_image(path, MAX_PNG_SIZE)
        data = to_base64(resized)
        mime = 'image/jpeg' if resized.lower().endswith(('.jpeg', '.jpg')) else 'image/png'
        portrait_data.append(f'"data:{mime};base64,{data}"')
        # 清理临时文件
        if resized != path:
            try:
                os.remove(resized)
            except:
                pass

    # 处理公主肖像图：复制 visit 文件夹到输出目录
    VISIT_DIR = '/Users/dm-jenna/Desktop/claude code/visit'
    if os.path.isdir(VISIT_DIR):
        out_visit = os.path.join(os.path.dirname(DST_HTML), 'visit')
        os.makedirs(out_visit, exist_ok=True)
        for f in os.listdir(VISIT_DIR):
            if f.lower().endswith(('.png', '.jpeg', '.jpg')) and not f.startswith('.'):
                import shutil
                shutil.copy(os.path.join(VISIT_DIR, f), out_visit)
        print(f"  已复制 {len(os.listdir(out_visit))} 张公主肖像到 visit/ 目录")

    # 复制下江南背景图到输出目录
    OUT_DIR = '/Users/dm-jenna/Desktop/claude code/out'
    if os.path.isdir(OUT_DIR):
        out_img = os.path.join(OUT_DIR, '皇帝下江南风景图生成.png')
        if os.path.isfile(out_img):
            import shutil
            shutil.copy(out_img, os.path.dirname(DST_HTML))
            print(f"  已复制下江南背景图")

    # 处理背景图
    bg_data = ''
    if bg:
        print(f"  处理背景图: {os.path.basename(bg)}")
        resized_bg = resize_image(bg, 1200)
        bg_data = to_base64(resized_bg)
        if resized_bg != bg:
            try:
                os.remove(resized_bg)
            except:
                pass

    # 处理坤宁宫背景图
    KUNNING_PNG = '/Users/dm-jenna/Desktop/claude code/坤宁宫.png'
    kunning_bg_data = ''
    if os.path.isfile(KUNNING_PNG):
        print(f"  处理坤宁宫背景: 坤宁宫.png")
        resized_kunning = resize_image(KUNNING_PNG, 1200)
        kunning_bg_data = to_base64(resized_kunning)
        if resized_kunning != KUNNING_PNG:
            try:
                os.remove(resized_kunning)
            except:
                pass
    
    # 替换肖像数据数组
    old_pattern = r'const PORTRAIT_DATA = \[[\s\S]*?\];'
    new_data = 'const PORTRAIT_DATA = [\n    ' + ',\n    '.join(portrait_data) + '\n  ];'
    content = re.sub(old_pattern, new_data, content)
    
    # 替换背景图
    if bg_data:
        old_bg_pattern = r'url\("data:image/(png|jpeg);base64,[^"]*"\)'
        new_bg = f'url("data:image/png;base64,{bg_data}")'
        content = re.sub(old_bg_pattern, new_bg, content, count=1)

    # 替换坤宁宫背景图
    if kunning_bg_data:
        old_kunning = r'#page-kunning\.kunning-bg \{[^}]*\}'
        new_kunning = f'#page-kunning.kunning-bg {{ background-image:url("data:image/png;base64,{kunning_bg_data}"); background-size:cover !important; background-position:center !important; }}'
        content = re.sub(old_kunning, new_kunning, content)
    
    # 更新妃子生成中的随机范围
    content = re.sub(
        r'portraitIdx:Math\.floor\(Math\.random\(\)\*\d+\)\+1',
        f'portraitIdx:pickPortrait()' + '}',
        content
    )
    
    # 写入输出
    os.makedirs(os.path.dirname(DST_HTML), exist_ok=True)
    with open(DST_HTML, 'w', encoding='utf-8') as f:
        f.write(content)
    
    size_mb = os.path.getsize(DST_HTML) / 1024 / 1024
    print(f"\n构建完成!")
    print(f"  妃子肖像: {len(portraits)} 张")
    if os.path.isdir(os.path.dirname(DST_HTML)):
        out_visit = os.path.join(os.path.dirname(DST_HTML), 'visit')
        if os.path.isdir(out_visit):
            print(f"  公主肖像: {len([f for f in os.listdir(out_visit) if f.endswith(('.png','.jpg','.jpeg'))])} 张")
    print(f"  输出文件: {DST_HTML}")
    print(f"  文件大小: {size_mb:.1f} MB")
    print(f"\n下一步: 将 /tmp/emperor-web 文件夹拖到 https://app.netlify.com/drop")

if __name__ == '__main__':
    build()
