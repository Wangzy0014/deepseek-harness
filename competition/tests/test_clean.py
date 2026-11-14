"""版本归并与异常处置测试（验收书：版本归并 / 异常处理 / 状态区别）."""

from study_companion.clean import (
    ISSUE_NODE_OUT_OF_SCOPE,
    ISSUE_SCORE_EXCEEDS_FULL,
    ISSUE_SEMANTIC_REVIEW,
    ISSUE_THEME_MISMATCH,
    ISSUE_TOTAL_POINTS_MISMATCH,
    normalize_answer,
)
from study_companion.schema import (
    FLAG_CORRECTED,
    FLAG_EXCLUDED,
    FLAG_NORMAL,
    FLAG_REVIEW_KEPT,
)


def test_version_merge_806_style(clean):
    """合成数据 15 行 -> 13 事件，2 个多版本事件各归并 1 条旧版本."""
    assert clean.row_count == 15
    assert clean.event_count == 13
    assert len(clean.merge_log) == 2
    events = {entry.event_id: entry for entry in clean.merge_log}
    e1 = events["E01-EN02-QX03"]
    assert e1.kept_record_id == "XR0006" and e1.kept_revision == 2
    assert e1.superseded == [("XR0005", 1)]
    assert e1.changes["评分状态"] == ["待评分", "已评分"]
    assert e1.changes["得分"] == ["None", "2"]
    e2 = events["E02-EN01-QX05"]
    assert e2.kept_record_id == "XR0008"
    assert e2.changes["得分"] == ["1", "2"]


def test_superseded_versions_kept_as_history(clean, valid_by_record):
    """被归并旧版本保留在 history（保留原文与可查询的历史记录）."""
    vr = valid_by_record["XR0006"]
    assert [h.record_id for h in vr.history] == ["XR0005"]
    assert vr.history[0].scoring_status == "待评分"
    # 旧版本记录编号不在当前有效记录中，但仍可经证据查询命中（见 test_evidence）


def test_score_exceeds_full_excluded(valid_by_record):
    vr = valid_by_record["XR0004"]  # 10/1
    assert ISSUE_SCORE_EXCEEDS_FULL in vr.issues
    assert vr.stats_flag == FLAG_EXCLUDED
    assert vr.effective_score is None


def test_total_points_mismatch_excluded(valid_by_record):
    vr = valid_by_record["XR0009"]  # 总分3 评分点合计2
    assert ISSUE_TOTAL_POINTS_MISMATCH in vr.issues
    assert vr.stats_flag == FLAG_EXCLUDED


def test_theme_mismatch_corrected_to_bank(valid_by_record):
    vr = valid_by_record["XR0010"]  # 记录 T02 / 题库 T01
    assert ISSUE_THEME_MISMATCH in vr.issues
    assert vr.stats_flag == FLAG_CORRECTED
    assert vr.effective_theme == "T01"
    assert vr.record.theme_recorded == "T02"   # 原文保留
    assert vr.effective_score == 1             # 修正主题不隔离得分


def test_semantic_zero_review_kept(valid_by_record):
    vr = valid_by_record["XR0011"]  # 答案=-5ab² 与参考一致但 0 分
    assert ISSUE_SEMANTIC_REVIEW in vr.issues
    assert vr.stats_flag == FLAG_REVIEW_KEPT
    assert vr.effective_score == 0              # 不擅自改分


def test_out_of_scope_keeps_node_but_excludes(valid_by_record):
    vr = valid_by_record["XR0012"]  # QX07(T03) 出现在 EN01
    assert ISSUE_NODE_OUT_OF_SCOPE in vr.issues
    assert vr.stats_flag == FLAG_EXCLUDED
    assert vr.record.node_id == "EN01"          # 不按时间戳改节点
    assert vr.effective_theme == "T03"


def test_normal_records_untouched(valid_by_record):
    for rid in ["XR0001", "XR0002", "XR0008", "XR0014", "XR0015"]:
        vr = valid_by_record[rid]
        assert vr.stats_flag == FLAG_NORMAL
        assert vr.issues == []


def test_pending_and_unanswered_not_excluded(valid_by_record):
    """待评分 / 未作答不是异常：保留原状态，仅不计入得分统计."""
    pending = valid_by_record["XR0013"]
    assert pending.record.scoring_status == "待评分"
    assert pending.stats_flag == FLAG_NORMAL
    unanswered = valid_by_record["XR0003"]
    assert unanswered.record.scoring_status == "未作答"
    assert unanswered.stats_flag == FLAG_NORMAL


def test_anomaly_record_count(clean):
    """合成数据共 5 条异常记录（5 类规则各一条）."""
    flagged = [vr for vr in clean.valid_records if vr.issues]
    assert {vr.record.record_id for vr in flagged} == {
        "XR0004", "XR0009", "XR0010", "XR0011", "XR0012"}


def test_normalize_answer():
    assert normalize_answer(" -5ab² ") == normalize_answer("-5ab²")
    assert normalize_answer("－5ab²") == normalize_answer("-5ab²")  # 全角负号归一
    assert normalize_answer("5ab²") != normalize_answer("-5ab²")
