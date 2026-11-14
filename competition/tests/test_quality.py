"""质量报告测试：归并摘要、异常清单含处置与依据、状态分布."""

from study_companion.quality import build_quality_report


def test_report_counts(dataset, clean):
    report = build_quality_report(dataset, clean)
    assert report.row_count == 15
    assert report.event_count == 13
    assert report.superseded_count == 2
    assert report.status_counts == {"已评分": 11, "待评分": 1, "未作答": 1}
    # 归并后当前记录状态：XR0005(待评分)->XR0006(已评分)，XR0013 仍待评分
    assert report.flag_counts == {
        "normal": 8, "corrected": 1, "review_kept": 1, "excluded": 3,
    }


def test_anomalies_have_disposition_and_basis(dataset, clean):
    report = build_quality_report(dataset, clean)
    assert len(report.anomaly_records) == 5
    for a in report.anomaly_records:
        for d in a["处置与依据"]:
            assert d["处置"] and d["依据"]        # 处理依据可追溯
    ids = {a["记录编号"] for a in report.anomaly_records}
    assert ids == {"XR0004", "XR0009", "XR0010", "XR0011", "XR0012"}


def test_merge_entries_carry_field_changes(dataset, clean):
    report = build_quality_report(dataset, clean)
    entries = {e["作答事件编号"]: e for e in report.merge_entries}
    assert entries["E02-EN01-QX05"]["字段变化"]["得分"] == ["1", "2"]
    assert entries["E01-EN02-QX03"]["字段变化"]["评分状态"] == ["待评分", "已评分"]


def test_summary_lines(dataset, clean):
    report = build_quality_report(dataset, clean)
    lines = "\n".join(report.summary_lines())
    assert "原始行数 15 -> 归并后事件数 13" in lines
    assert "异常记录共 5 条" in lines
