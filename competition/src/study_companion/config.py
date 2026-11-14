"""数据目录解析.

赛题数据（六个 CSV）不进版本库（仓库为公开仓库，赛题数据仅限本次大赛使用，
不得外传）。每人把 ``赛题资料包/4_赛题数据/模拟学情数据`` 下的 CSV 放到
``competition/data/raw/``，或用环境变量 ``STUDY_COMPANION_DATA_DIR`` 指向任意目录。
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPETITION_DIR = REPO_ROOT / "competition"
DEFAULT_DATA_DIR = COMPETITION_DIR / "data" / "raw"
OUTPUT_DIR = COMPETITION_DIR / "outputs"

DATA_FILES = {
    "requirements": "课程要求.csv",
    "materials": "题目与材料.csv",
    "students": "模拟学生.csv",
    "nodes": "测验节点.csv",
    "records": "作答记录.csv",
    "field_doc": "字段说明.csv",
}


def resolve_data_dir(explicit: str = None) -> Path:
    """返回赛题数据目录，优先级：参数 > 环境变量 > 默认目录."""
    if explicit:
        path = Path(explicit)
    elif os.environ.get("STUDY_COMPANION_DATA_DIR"):
        path = Path(os.environ["STUDY_COMPANION_DATA_DIR"])
    else:
        path = DEFAULT_DATA_DIR
    return path


def resolve_output_dir(explicit: str = None) -> Path:
    if explicit:
        return Path(explicit)
    return OUTPUT_DIR
