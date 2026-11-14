"""质量报告：版本归并摘要 + 异常清单（含处置与依据）+ 状态分布."""

from dataclasses import dataclass
from typing import Dict, List, Optional

from .clean import (
    CleanResult,
    DISPOSITIONS,
    ISSUE_SEMANTIC_REVIEW,
)
from .schema import (
    Dataset,
    FLAG_CORRECTED,
    FLAG_EXCLUDED,
    FLAG_NORMAL,
    FLAG_REVIEW_KEPT,
    PENDING,
    SCORED,
    UNANSWERED,
)

ISSUE_LABELS = {
    "theme_mismatch": "作答主题与题库主题不一致",
    "score_exceeds_full": "得分超出满分",
    "total_points_mismatch": "总分与评分点合计不一致",
    "node_out_of_scope": "材料超出节点可用范围",
    "semantic_review": "答案与参考答案一致但记0分（语义复核）",
    "full_score_mismatch_bank": "记录满分与题库不一致",
    "score_repaired_from_points": "得分按评分点合计修正（策略B）",
}


@dataclass
class QualityReport:
    row_count: int
    event_count: int
    superseded_count: int
    status_counts: Dict[str, int]
    flag_counts: Dict[str, int]
    anomaly_records: List[Dict]
    merge_entries: List[Dict]
    policy: str = "conservative"

    def to_dict(self) -> Dict:
        return {
            "原始行数": self.row_count,
            "归并后事件数": self.event_count,
            "被归并版本数": self.superseded_count,
            "处置策略": self.policy,
            "评分状态分布": self.status_counts,
            "统计口径分布": self.flag_counts,
            "异常记录": self.anomaly_records,
            "版本归并明细": self.merge_entries,
        }

    def summary_lines(self) -> List[str]:
        lines = [
            f"原始行数 {self.row_count} -> 归并后事件数 {self.event_count}"
            f"（被归并旧版本 {self.superseded_count} 条，不重复计数）",
            "评分状态分布: " + ", ".join(f"{k}={v}" for k, v in sorted(self.status_counts.items())),
            "统计口径分布: " + ", ".join(f"{k}={v}" for k, v in sorted(self.flag_counts.items())),
            f"异常记录共 {len(self.anomaly_records)} 条：",
        ]
        for a in self.anomaly_records:
            issues = "、".join(ISSUE_LABELS.get(i, i) for i in a["异常类型"])
            lines.append(
                f"  {a['记录编号']} {a['学生编号']}/{a['材料编号']}/{a['节点编号']}"
                f"｜{issues}｜口径={a['统计口径']}"
            )
        return lines


def build_quality_report(dataset: Dataset, clean: CleanResult,
                         policy: str = "conservative") -> QualityReport:
    status_counts = {SCORED: 0, PENDING: 0, UNANSWERED: 0}
    flag_counts = {FLAG_NORMAL: 0, FLAG_CORRECTED: 0,
                   FLAG_REVIEW_KEPT: 0, FLAG_EXCLUDED: 0}
    anomalies: List[Dict] = []
    for vr in clean.valid_records:
        status_counts[vr.record.scoring_status] += 1
        flag_counts[vr.stats_flag] += 1
        if vr.issues:
            anomalies.append({
                "记录编号": vr.record.record_id,
                "学生编号": vr.record.student_id,
                "材料编号": vr.record.material_id,
                "节点编号": vr.record.node_id,
                "评分状态": vr.record.scoring_status,
                "得分": vr.record.score,
                "满分": vr.record.full_score,
                "学生最终作答": vr.record.final_answer,
                "异常类型": list(vr.issues),
                "统计口径": vr.stats_flag,
                "处置与依据": [
                    {
                        "类型": issue,
                        "说明": ISSUE_LABELS.get(issue, issue),
                        "处置": DISPOSITIONS[issue]["处置"],
                        "依据": DISPOSITIONS[issue]["依据"],
                    }
                    for issue in vr.issues
                ],
            })
    return QualityReport(
        row_count=clean.row_count,
        event_count=clean.event_count,
        superseded_count=clean.row_count - clean.event_count,
        status_counts=status_counts,
        flag_counts=flag_counts,
        anomaly_records=anomalies,
        merge_entries=[entry.to_dict() for entry in clean.merge_log],
        policy=policy,
    )
