"""步骤诊断线索：解答过程末步结论与学生最终作答的矛盾筛查.

用途：供诊断模块（步骤诊断负责人）定位"答案与过程矛盾"类问题。
定位是**线索**而不是口径结论：过滤后仍可能含表述差异（约两三成），
需人工/智能体甄别；本模块不影响统计口径——统计口径的异常以
验收书 6 条已知冲突为准（见 clean/quality）。

筛查口径：
- 仅扫描"已评分且计入统计口径（normal/corrected/review_kept）"的当前记录；
- 末步以"检验/验算"开头时不作为结论行（检验行不含新结论）；
- 归一化：剥离步骤序号、空白、句读与括号、常见单位词后逐字符比较；
  任一方包含另一方即视为一致；
- 两侧归一化后均非空才参与比较。
"""

import re
import unicodedata
from typing import Dict, List, Optional

from .clean import CleanResult
from .schema import Dataset, FLAG_CORRECTED, FLAG_NORMAL, FLAG_REVIEW_KEPT

LEAD_STAT_FLAGS = {FLAG_NORMAL, FLAG_CORRECTED, FLAG_REVIEW_KEPT}

UNITS = [
    "平方厘米", "平方分米", "平方米", "立方厘米", "立方分米", "立方米",
    "千克", "公里", "千米", "厘米", "毫米", "分米",
    "小时", "分钟", "秒钟",
    "元", "人", "个", "米", "只", "棵", "次", "天", "页", "本", "张", "份",
]

_PUNCT = "。，、,；;：:！!？?（）()「」『』\"'"


def normalize_conclusion(text: str) -> Optional[str]:
    """归一化结论文本；检验/验算行返回 None（不作为结论）。"""
    if not text:
        return None
    s = unicodedata.normalize("NFKC", text)
    s = re.sub(r"^[0-9]+\.\s*", "", s.strip())
    s = s.replace(" ", "").replace("　", "")
    if s.startswith("检验") or s.startswith("验算"):
        return None
    for ch in _PUNCT:
        s = s.replace(ch, "")
    if not s:
        return None
    changed = True
    while changed and s:
        changed = False
        for unit in UNITS:
            if s.endswith(unit) and len(s) > len(unit):
                s = s[: -len(unit)]
                changed = True
                break
    return s.lower() or None


def answer_process_leads(dataset: Dataset, clean: CleanResult) -> List[Dict]:
    """生成"末步结论 vs 最终作答"矛盾线索清单."""
    leads: List[Dict] = []
    for vr in clean.valid_records:
        row = vr.record
        if not (row.solution_steps and row.final_answer
                and row.scoring_status == "已评分"
                and vr.stats_flag in LEAD_STAT_FLAGS):
            continue
        last = normalize_conclusion(row.solution_steps[-1])
        answer = normalize_conclusion(row.final_answer)
        if not last or not answer:
            continue
        if last == answer or answer in last or last in answer:
            continue
        question = dataset.question(row.material_id)
        leads.append({
            "记录编号": row.record_id,
            "学生编号": row.student_id,
            "材料编号": row.material_id,
            "节点编号": row.node_id,
            "得分": row.score,
            "满分": vr.effective_full_score,
            "过程末步": row.solution_steps[-1],
            "学生最终作答": row.final_answer,
            "参考答案": question.answer if question else "",
        })
    return leads


def build_leads_payload(lead_list: List[Dict]) -> Dict:
    """组装线索输出（说明 + 数量 + 线索清单）。"""
    return {
        "说明": "步骤诊断线索（数据处理模块产出，供步骤诊断定位"
                "「答案与过程矛盾」用）。过滤口径：已评分且计入统计口径的"
                "记录，末步结论与最终作答在剥离序号/空白/句读/括号/单位词/"
                "检验行后仍不一致。仍可能含表述差异，需人工/智能体甄别；"
                "仅作线索，不影响统计口径（口径异常以验收书 6 条为准）。",
        "数量": len(lead_list),
        "线索": lead_list,
    }
