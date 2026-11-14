"""数据安全回归测试：合成资产中不得出现真实赛题数据的 ID 或内容片段.

范围：README、shared/（fixtures 与 contracts）、data/raw/README.md。
src/ 与 tests/ 允许出现"样例目标编号"常量（如 pipeline.py 里选真实样例的
D01/Q025 等编号——只有编号、不含任何作答内容），不在本测试管辖内。
真实内容片段清单由本测试维护，发现新泄漏直接加进 ``FORBIDDEN_CONTENT``。
"""

import re
from pathlib import Path

COMPETITION_DIR = Path(__file__).resolve().parents[1]

# 真实数据专属 ID 模式（学生 D01—D40 / 材料 Q001—Q054、L、B / 班级 DC / 节点 N）
REAL_ID_PATTERNS = [
    re.compile(r"\bD(0[1-9]|[1-3]\d|40)\b"),
    re.compile(r"\bQ0(0[1-9]|[1-4]\d|5[0-4])\b"),
    re.compile(r"\bDC0[12]\b"),
    re.compile(r"\bN0[12]\b"),
    re.compile(r"\bDR\d{4}\b"),
]
# 已知真实题/作答内容片段（发现新的就加）
FORBIDDEN_CONTENT = ["-3x²y", "x>-4", "两边同乘", "5x-1=24", "解不等式", "代入求值"]

GUARDED_DIRS = [
    COMPETITION_DIR / "shared",
    COMPETITION_DIR / "docs",
    COMPETITION_DIR / "deliverables",
]
GUARDED_FILES = [
    COMPETITION_DIR / "README.md",
    COMPETITION_DIR / "shared" / "README.md",
    COMPETITION_DIR / "data" / "raw" / "README.md",
    COMPETITION_DIR / "docs" / "design_doc_data_section.md",
    COMPETITION_DIR / "deliverables" / "README.md",
]


def _guarded_files():
    files = [p for p in GUARDED_FILES if p.exists()]
    for directory in GUARDED_DIRS:
        files.extend(p for p in directory.rglob("*") if p.is_file())
    return files


def test_no_real_ids_in_synthetic_assets():
    violations = []
    for path in _guarded_files():
        text = path.read_text(encoding="utf-8-sig", errors="ignore")
        rel = path.relative_to(COMPETITION_DIR)
        for pattern in REAL_ID_PATTERNS:
            for m in pattern.finditer(text):
                violations.append(f"{rel}: 真实ID {m.group()}")
    assert not violations, "发现真实赛题数据 ID 泄漏:\n" + "\n".join(violations)


def test_no_real_content_fragments():
    violations = []
    for path in _guarded_files():
        text = path.read_text(encoding="utf-8-sig", errors="ignore")
        rel = path.relative_to(COMPETITION_DIR)
        for fragment in FORBIDDEN_CONTENT:
            if fragment in text:
                violations.append(f"{rel}: 内容片段 {fragment!r}")
    assert not violations, "发现真实赛题内容片段泄漏:\n" + "\n".join(violations)


def test_fixture_ids_are_synthetic():
    """合成数据自身必须只用 E/X/EC/EN 前缀。"""
    fixture_dir = COMPETITION_DIR / "shared" / "fixtures" / "synthetic"
    answer = fixture_dir / "模拟学情数据" / "作答记录.csv"
    text = answer.read_text(encoding="utf-8-sig")
    assert re.search(r"\bE\d{2}\b", text)
    assert re.search(r"\bXR\d{4}\b", text)
    assert "EN01" in text and "QX0" in text
