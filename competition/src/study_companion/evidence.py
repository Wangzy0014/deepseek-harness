"""证据查询：按学生 / 题目 / 记录编号 / 指标查原始记录.

验收书"当前记录：保留原文与可查询的历史记录"。查询永远返回原始行
（含被归并的旧版本），并附归并状态、异常标记与题库信息。
"""

from typing import Dict, List, Optional

from .clean import CleanResult
from .schema import Dataset, ValidRecord


def record_view(vr: ValidRecord, dataset: Dataset) -> Dict:
    row = vr.record
    question = dataset.question(row.material_id)
    return {
        "记录编号": row.record_id,
        "修订版本": row.revision,
        "学生编号": row.student_id,
        "材料编号": row.material_id,
        "记录主题": row.theme_recorded,
        "有效主题": vr.effective_theme,
        "节点编号": row.node_id,
        "作答事件编号": row.event_id,
        "模拟提交时间": row.submitted_at,
        "评分状态": row.scoring_status,
        "得分": row.score,
        "有效得分": vr.effective_score,
        "满分": row.full_score,
        "有效满分": vr.effective_full_score,
        "统计口径": vr.stats_flag,
        "异常类型": vr.issues,
        "学生最终作答": row.final_answer,
        "解答过程": row.solution_steps,
        "评分点得分": row.point_scores,
        "题库参考答案": question.answer if question else None,
        "题库主题": question.theme_id if question else None,
        "指标编号": question.indicator_id if question else None,
        "题库满分": question.full_score if question else None,
        "历史版本": [
            {
                "记录编号": h.record_id,
                "修订版本": h.revision,
                "评分状态": h.scoring_status,
                "得分": h.score,
                "模拟提交时间": h.submitted_at,
                "状态": "已被更高版本归并（保留可查）",
            }
            for h in vr.history
        ],
    }


def query(
    dataset: Dataset,
    clean: CleanResult,
    student: Optional[str] = None,
    question: Optional[str] = None,
    record: Optional[str] = None,
    node: Optional[str] = None,
    indicator: Optional[str] = None,
    include_history_only: bool = True,
) -> Dict:
    """证据查询入口.

    include_history_only=False 时只返回当前有效记录；True 时连只存在于
    历史版本中的记录编号也能查到（返回其所在事件的当前版本 + 历史明细）。
    """
    index: Dict[str, ValidRecord] = {}
    history_index: Dict[str, ValidRecord] = {}
    for vr in clean.valid_records:
        index[vr.record.record_id] = vr
        for h in vr.history:
            history_index[h.record_id] = vr

    matched: List[ValidRecord] = []
    if record:
        vr = index.get(record)
        if vr is None and include_history_only:
            vr = history_index.get(record)
        if vr is not None:
            matched.append(vr)
    else:
        matched = clean.valid_records

    results = []
    for vr in matched:
        row = vr.record
        if student and row.student_id != student:
            continue
        if question and row.material_id != question:
            continue
        if node and row.node_id != node:
            continue
        if indicator:
            q = dataset.question(row.material_id)
            if q is None or q.indicator_id != indicator:
                continue
        results.append(record_view(vr, dataset))

    return {
        "查询条件": {
            "学生": student, "题目": question, "记录": record,
            "节点": node, "指标": indicator,
        },
        "命中条数": len(results),
        "记录": results,
    }


def render_text(query_result: Dict) -> str:
    """人读版证据输出."""
    lines = []
    cond = {k: v for k, v in query_result["查询条件"].items() if v}
    lines.append(f"证据查询 {cond} 命中 {query_result['命中条数']} 条")
    for r in query_result["记录"]:
        lines.append(
            f"- {r['记录编号']}(v{r['修订版本']}) {r['学生编号']}/{r['材料编号']}"
            f"/{r['节点编号']} {r['评分状态']} 得分={r['得分']}/{r['满分']}"
            f" 口径={r['统计口径']}"
            + (f" 异常={','.join(r['异常类型'])}" if r["异常类型"] else "")
        )
        if r["学生最终作答"]:
            lines.append(f"    作答: {r['学生最终作答']} ｜参考: {r['题库参考答案']}")
        for step in r["解答过程"]:
            lines.append(f"    {step}")
        for h in r["历史版本"]:
            lines.append(
                f"    [历史] {h['记录编号']}(v{h['修订版本']}) "
                f"{h['评分状态']} 得分={h['得分']} @ {h['模拟提交时间']}"
            )
    return "\n".join(lines)
