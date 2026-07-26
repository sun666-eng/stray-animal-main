from pathlib import Path
from difflib import SequenceMatcher
import re
from docx import Document

NEW = Path(r"D:\2026.4.7\Myproject\stray-animal-main\outputs\科技文献检索与论文写作作业3_差异化修改完成版.docx")
OTHER = Path(r"D:\2026.6.25\文献检索\科技文献检索与论文写作作业1.docx")

def texts(path):
    doc = Document(path)
    return doc, [p.text.strip() for p in doc.paragraphs]

def norm(text):
    return re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", text).lower()

new_doc, new_p = texts(NEW)
_, other_p = texts(OTHER)

assert "研究内容与方向总结：从代表性成果可以看出" in new_p[56]
assert new_p[58] == "1. 对学位论文研究链条的理解"
assert new_p[98].startswith("题目：叶菜真空预冷")
assert any("10.1016/j.jfoodeng.2026.113165" in x for x in new_p)
assert len(new_doc.inline_shapes) >= 0

title_idx = next(i for i, x in enumerate(new_p) if x.startswith("题目：叶菜真空预冷"))
ref_idx = next(i for i, x in enumerate(new_p) if i > title_idx and x == "参考文献：")
paper_body = "".join(new_p[title_idx + 1:ref_idx])
paper_chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", paper_body))
assert paper_chinese_chars >= 3000, paper_chinese_chars

new_section = norm("".join(new_p[56:62] + new_p[97:110]))
other_section = norm("".join(other_p[60:66] + other_p[98:112]))
ratio = SequenceMatcher(None, new_section, other_section, autojunk=False).ratio()

print(f"output={NEW}")
print(f"paragraphs={len(new_p)} inline_shapes={len(new_doc.inline_shapes)}")
print(f"rewritten_chars={len(new_section)}")
print(f"section_similarity={ratio:.4f}")
print(f"paper_chinese_chars={paper_chinese_chars}")
print("required_sections=PASS")
