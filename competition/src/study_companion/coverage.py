"""覆盖与范围：可用题 / 有记录 / 已评分 / 无记录.

验收书"覆盖与范围"：D17 之类无记录情形不得被推断为"全部掌握"，
也不得解释为"未掌握"；不同节点内容不混比。
"""

from typing import Dict, List

from .clean import CleanResult
from .schema import Dataset
from .stats import IN_STATS_FLAGS


def student_node_coverage(
    dataset: Dataset,
    clean: CleanResult,
    student_id: str,
    node_id: str,
    missing_sample_limit: int = 10,
) -> Dict:
    node = dataset.node(node_id)
    if node is None or dataset.student(student_id) is None:
        return {"error": f"学生或节点不存在: {student_id}/{node_id}"}

    records = [vr for vr in clean.valid_records
               if vr.record.student_id == student_id and vr.record.node_id == node_id]
    available = set(node.available_questions)
    covered = {vr.record.material_id for vr in records}
    # 已评分数口径与统计模块一致：被隔离的冲突记录不计入有效已评分
    scored = {vr.record.material_id for vr in records
              if vr.record.scoring_status == "已评分"
              and vr.stats_flag in IN_STATS_FLAGS}
    missing = sorted(available - covered)

    has_any = len(records) > 0
    return {
        "学生编号": student_id,
        "节点编号": node_id,
        "节点可用题数": len(available),
        "有记录题数": len(covered & available),
        "已评分数": len(scored & available),
        "无记录题数": len(missing),
        "无记录示例": missing[:missing_sample_limit],
        "解读提示": (
            "该生在该节点无任何作答记录：属于记录不足，不能推断为未掌握，"
            "也不能推断为全部掌握；建议先补充观察再下结论。"
            if not has_any else
            "无记录题目为该节点应测而未见记录的题目，分析时单独说明。"
        ),
    }


def coverage_table(dataset: Dataset, clean: CleanResult) -> List[Dict]:
    """全部学生 × 节点覆盖表（供"记录不足"案例选取）."""
    rows = []
    for student_id in sorted(dataset.students):
        for node_id in sorted(dataset.nodes):
            entry = student_node_coverage(dataset, clean, student_id, node_id)
            entry.pop("解读提示", None)
            entry.pop("无记录示例", None)
            rows.append(entry)
    return rows
