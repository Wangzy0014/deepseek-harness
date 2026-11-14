"""个人统计：有效题数、各状态数量、主题与指标得分.

口径（对应验收书"统计复算 / 状态区别 / 覆盖与范围"）：
- 得分率分母 = 该范围内参与统计的已评分有效记录的满分之和（不是可用题数）；
- 待评分、未作答单独计数，不进分母；
- 本节点未教学的主题标记 ``未教学``，不产生 0% 假象（零分与尚未教学分别处理）；
- 无记录（学生 × 节点没有任何当前记录）由 coverage 模块输出，绝不折算为 0 分。
"""

from typing import Dict, List, Optional

from .clean import CleanResult
from .schema import (
    Dataset,
    FLAG_NORMAL,
    FLAG_CORRECTED,
    FLAG_REVIEW_KEPT,
    PENDING,
    SCORED,
    UNANSWERED,
    ValidRecord,
)

IN_STATS_FLAGS = {FLAG_NORMAL, FLAG_CORRECTED, FLAG_REVIEW_KEPT}


def _empty_bucket() -> Dict:
    return {
        "已评分_计入统计": 0,
        "已评分_隔离": 0,
        "待评分": 0,
        "未作答": 0,
        "无记录": 0,
        "得分": 0,
        "满分": 0,
    }


def _rate(score: int, full: int) -> Optional[float]:
    if full <= 0:
        return None
    return round(score / full, 4)


def student_node_stats(
    dataset: Dataset,
    clean: CleanResult,
    student_id: str,
    node_id: str,
) -> Optional[Dict]:
    """单个学生在单个节点的统计；学生或节点不存在返回 None."""
    student = dataset.student(student_id)
    node = dataset.node(node_id)
    if student is None or node is None:
        return None

    records = [vr for vr in clean.valid_records
               if vr.record.student_id == student_id and vr.record.node_id == node_id]

    overall = _empty_bucket()
    by_theme: Dict[str, Dict] = {}
    by_indicator: Dict[str, Dict] = {}

    for vr in records:
        row = vr.record
        question = dataset.question(row.material_id)
        indicator = question.indicator_id if question else ""
        theme = vr.effective_theme or (question.theme_id if question else "")
        in_stats = (row.scoring_status == SCORED
                    and vr.stats_flag in IN_STATS_FLAGS
                    and vr.effective_score is not None
                    and row.full_score is not None)

        # 总体
        if row.scoring_status == SCORED and vr.stats_flag in IN_STATS_FLAGS:
            overall["已评分_计入统计"] += 1
            overall["得分"] += vr.effective_score or 0
            overall["满分"] += row.full_score or 0
        elif row.scoring_status == SCORED:
            overall["已评分_隔离"] += 1
        elif row.scoring_status == PENDING:
            overall["待评分"] += 1
        elif row.scoring_status == UNANSWERED:
            overall["未作答"] += 1

        # 主题 / 指标只统计计入统计的已评分记录
        if in_stats and theme:
            tb = by_theme.setdefault(theme, _empty_bucket())
            tb["已评分_计入统计"] += 1
            tb["得分"] += vr.effective_score or 0
            tb["满分"] += row.full_score or 0
            if indicator:
                ib = by_indicator.setdefault(indicator, _empty_bucket())
                ib["已评分_计入统计"] += 1
                ib["得分"] += vr.effective_score or 0
                ib["满分"] += row.full_score or 0

    # 未教学主题显式标注（零分与尚未教学分别处理）
    for theme in dataset.themes():
        if theme not in by_theme:
            if theme in node.themes_taught:
                by_theme[theme] = dict(_empty_bucket())  # 本节点已教但该生无有效记录
            else:
                by_theme[theme] = "未教学（本节点未测量）"

    available = set(node.available_questions)
    covered = {vr.record.material_id for vr in records}
    overall["无记录"] = len(available - covered)
    overall["节点可用题数"] = len(available)

    return {
        "学生编号": student_id,
        "班级": student.class_id,
        "节点编号": node_id,
        "总体": overall,
        "得分率": _rate(overall["得分"], overall["满分"]),
        "按主题": {t: (b if isinstance(b, str) else {**b, "得分率": _rate(b["得分"], b["满分"])})
                  for t, b in sorted(by_theme.items())},
        "按指标": {i: {**b, "得分率": _rate(b["得分"], b["满分"])}
                  for i, b in sorted(by_indicator.items())},
    }


def all_students_stats(dataset: Dataset, clean: CleanResult) -> List[Dict]:
    """全部学生 × 全部节点统计（CSV/JSON 输出用）."""
    results = []
    for student_id in sorted(dataset.students):
        for node_id in sorted(dataset.nodes):
            stats = student_node_stats(dataset, clean, student_id, node_id)
            if stats is not None:
                results.append(stats)
    return results


def class_node_stats(
    dataset: Dataset,
    clean: CleanResult,
    class_id: str,
    node_id: str,
    exclude_students: Optional[List[str]] = None,
) -> Optional[Dict]:
    """班级在某节点的汇总；``exclude_students`` 供同伴比较"排除本人"真实生效."""
    exclude = set(exclude_students or [])
    members = [s for s in sorted(dataset.students.values(), key=lambda x: x.student_id)
               if s.class_id == class_id]
    if not members:
        return None
    bucket = _empty_bucket()
    bucket["学生数"] = 0
    for student in members:
        if student.student_id in exclude:
            continue
        stats = student_node_stats(dataset, clean, student.student_id, node_id)
        if stats is None:
            continue
        o = stats["总体"]
        bucket["学生数"] += 1
        for key in ("已评分_计入统计", "已评分_隔离", "待评分", "未作答", "得分", "满分"):
            bucket[key] += o[key]
    node = dataset.node(node_id)
    bucket["节点可用题数"] = len(node.available_questions) if node else 0
    return {
        "班级编号": class_id,
        "节点编号": node_id,
        "排除学生": sorted(exclude),
        "总体": bucket,
        "得分率": _rate(bucket["得分"], bucket["满分"]),
    }
