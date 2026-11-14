"""出处核验（验收项"课程材料：无虚构题号、页码或内容"的机器验证）.

三层核验：
1. 引用存在性：题目与材料表"来源或资料文件"指向的文件真实存在；
2. 内容互证（章节级）：教材条目声称覆盖的章节，其章名核心词必须
   出现在对应切片 PDF 的抽取文本中（纯标准库 CID/ToUnicode 解码）；
3. 结构页数：课标 PDF 的页对象计数 ≥ 引用的最大 PDF 页码。
   （课标为扫描件无文本层——内容级核验如实标注为"需人工"，
   不伪造机验结论。）
"""

import re
from pathlib import Path
from typing import Dict, List, Optional

from .pdf_text import extract_text
from .schema import Dataset

CHAPTER_RE = re.compile(r"第[一二三四五六七八九十\d]+章[^\d第]{2,12}")
NOISE_RE = re.compile(r"[\s；;，,。．、]+")


def verify_sources(dataset: Dataset, materials_root: Path) -> Dict:
    """对资料包做出处核验，返回可 JSON 化的报告（含真实编号——产物只写本地）."""
    root = Path(materials_root)
    textbook_rows = [q for q in dataset.questions.values()
                     if q.material_type == "教材"]

    # 1) 引用存在性
    missing_files = []
    for q in textbook_rows:
        if q.source_file and not (root / q.source_file).exists():
            missing_files.append({"材料编号": q.material_id, "来源": q.source_file})

    # 2) 章节级内容互证
    text_cache: Dict[str, str] = {}
    chapter_results = []
    for q in textbook_rows:
        if not q.source_file or (root / q.source_file).exists() is False:
            continue
        rel = q.source_file
        if rel not in text_cache:
            text_cache[rel] = extract_text(root / rel)
        pdf_text = text_cache[rel]
        chapters = CHAPTER_RE.findall(q.content)
        missing = []
        for ch in chapters:
            name = NOISE_RE.sub("", re.sub(r"^第[一二三四五六七八九十\d]+章", "", ch))
            core = name[:4]
            if core and core not in pdf_text:
                missing.append(ch)
        chapter_results.append({
            "材料编号": q.material_id, "来源": rel,
            "声称章节": chapters, "未命中章节": missing,
            "切片文本量": len(text_cache[rel]),
            "通过": not missing,
        })

    # 3) 课标页数结构核验
    curriculum = root / "5_课程标准及相关教学资源" / "课程标准_2022.pdf"
    page_check = {"文件": str(curriculum), "存在": curriculum.exists()}
    if curriculum.exists():
        data = curriculum.read_bytes()
        import zlib
        pages = 0
        for blob in [data]:
            pages += len(re.findall(rb"/Type\s*/Page(?![s/w])", blob))
            for m in re.finditer(rb"stream\r?\n", blob):
                s_ = m.end(); e_ = blob.find(b"endstream", s_)
                if e_ < 0:
                    continue
                try:
                    out = zlib.decompress(blob[s_:e_])
                except Exception:
                    continue
                pages += len(re.findall(rb"/Type\s*/Page(?![s/w])", out))
        referenced = [int(r.standard_loc.split("／")[0])
                      for r in dataset.requirements
                      if r.standard_loc and r.standard_loc.split("／")[0].isdigit()]
        page_check.update({
            "PDF页对象数": pages,
            "课标引用的最大PDF页": max(referenced) if referenced else None,
            "通过": pages >= (max(referenced) if referenced else 0),
            "说明": "课标为扫描件无文本层：页码仅结构核验，内容一致性需人工抽查",
        })

    passed = (not missing_files
              and all(c["通过"] for c in chapter_results)
              and page_check.get("通过", False))
    return {
        "结论": "通过" if passed else "存在未命中项，需人工核对",
        "引用文件缺失": missing_files,
        "教材条目章节互证": chapter_results,
        "课标页数核验": page_check,
        "口径说明": "章节级互证=教材条目声称章节的章名核心词出现于切片抽取文本；"
                    "题目正文级互证需题目与切片页码映射，属材料索引（诊断模块）职责。",
    }
