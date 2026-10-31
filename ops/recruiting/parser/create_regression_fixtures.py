"""Create only synthetic parser fixtures inside the parser container's writable temporary directory."""
from pathlib import Path
from zipfile import ZipFile
from xml.sax.saxutils import escape
import subprocess
from PIL import Image, ImageDraw, ImageFont

root = Path('/tmp/recruiting-regression-v2')
root.mkdir(exist_ok=True)
font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 34)
heading = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 52)
pages = []
for number in range(2):
    image = Image.new('RGB', (1800, 2400), 'white')
    draw = ImageDraw.Draw(image)
    draw.text((90, 80), '合成候选人 · 中文扫描回归', font=heading, fill='black')
    left = ['求职意向：后端工程师', '雇佣类型：全职', '期望工作方式：远程', '教育：计算机科学本科', '工作经历：2024年至2026年', '负责企业API和异步任务队列', '使用TypeScript开发后端服务', '使用PostgreSQL优化索引和事务']
    right = ['核心技能', 'TypeScript / Node.js', 'PostgreSQL / Redis', '消息队列与自动化测试', '项目成果：接口延迟降低30%', '负责数据迁移与错误恢复', f'第 {number+1} 页，共 2 页']
    for index, line in enumerate(left):
        draw.text((90, 240 + index * 95), line, font=font, fill='black')
    for index, line in enumerate(right):
        draw.text((970, 240 + index * 95), line, font=font, fill='black')
    if number == 1:
        draw.text((90, 2100), '尾页标识 ARCHIVE_END', font=heading, fill='black')
    pages.append(image)
pages[0].save(root / 'scan-chinese.png')
pages[0].save(root / 'scan-chinese.pdf', save_all=True, append_images=pages[1:], resolution=150, quality=100)

paragraphs = ['合成候选人，后端工程师。求职意向：全职远程。'] + [f'项目记录 {index}：使用TypeScript、PostgreSQL和消息队列完成API开发、测试及交付。' for index in range(200)]
(root / 'long-resume.md').write_text('# 合成简历\n\n' + '\n\n'.join(paragraphs) + '\n\nMARKDOWN_LAST_SECTION\n', encoding='utf8')
(root / 'long-resume.html').write_text('<!doctype html><html lang="zh"><meta charset="utf-8"><title>合成材料</title><body>' + ''.join('<p>' + escape(line) + '</p>' for line in paragraphs) + '<p>HTML_LAST_SECTION</p></body></html>', encoding='utf8')
(root / 'external-resource.html').write_text('<meta charset="utf-8"><p>合成候选人，TypeScript后端工程师。</p><img src="http://127.0.0.1:1/must-not-load"><script>document.body.innerHTML="UNSAFE_EXECUTED"</script>', encoding='utf8')
(root / 'corrupt.pdf').write_bytes(b'%PDF-1.7\nnot-a-valid-pdf')
(root / 'corrupt.docx').write_bytes(b'PK invalid archive')
document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ''.join('<w:p><w:r><w:t>' + escape(line) + '</w:t></w:r></w:p>' for line in paragraphs[:10]) + '<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>WORD_LAST_SECTION TypeScript PostgreSQL</w:t></w:r></w:p></w:body></w:document>'
with ZipFile(root / 'resume-two-pages.docx', 'w') as archive:
    archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    archive.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    archive.writestr('word/document.xml', document)
subprocess.run([
    'libreoffice', '-env:UserInstallation=file:///tmp/recruiting-fixture-doc-profile',
    '--headless', '--convert-to', 'doc:MS Word 97', '--outdir', str(root),
    str(root / 'resume-two-pages.docx'),
], check=True, capture_output=True, timeout=60)
assert (root / 'resume-two-pages.doc').read_bytes().startswith(bytes.fromhex('d0cf11e0a1b11ae1'))
print({'directory': str(root), 'syntheticFiles': len(list(root.iterdir()))})
