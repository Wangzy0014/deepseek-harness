"""管线输出测试：全流程产物齐备且结构正确（写入 pytest 临时目录）."""

import csv
import json

import pytest

from conftest import FIXTURES
from study_companion.pipeline import run_pipeline


@pytest.fixture(scope="module")
def paths(tmp_path_factory):
    out = tmp_path_factory.mktemp("pipeline_out")
    return run_pipeline(FIXTURES, out)


def test_pipeline_products(paths):
    for key in ["字段映射", "质量报告", "个人统计", "覆盖表"]:
        assert key in paths
    # 真实样例目标（D01/Q043/Q025/D17）在合成数据下逐项自动跳过
    for key in ["Q025同伴记录", "D17无记录样例", "D01/Q043当前记录"]:
        assert key not in paths


def test_field_mapping_csv(paths):
    with open(paths["字段映射"], encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert rows[0]["中文列名"] == "主题编号"
    assert any(r["中文列名"] == "作答事件编号" for r in rows)


def test_valid_records_csv_keeps_raw_and_flags(paths):
    path = [p for p in paths["当前有效记录"] if str(p).endswith(".csv")][0]
    with open(path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 13
    by_id = {r["记录编号"]: r for r in rows}
    assert by_id["XR0010"]["统计口径"] == "corrected"
    assert by_id["XR0010"]["有效主题"] == "T01"
    assert by_id["XR0010"]["主题编号"] == "T02"       # 原文保留
    assert by_id["XR0004"]["统计口径"] == "excluded"
    assert by_id["XR0006"]["被归并版本"] == "XR0005(v1)"


def test_valid_records_json_structure(paths):
    path = [p for p in paths["当前有效记录"] if str(p).endswith(".json")][0]
    with open(path, encoding="utf-8") as f:
        records = json.load(f)
    assert len(records) == 13
    sample = next(r for r in records if r["记录编号"] == "XR0006")
    assert sample["历史版本"][0]["记录编号"] == "XR0005"
    assert sample["统计口径"] == "normal"


def test_quality_report_json(paths):
    with open(paths["质量报告"], encoding="utf-8") as f:
        report = json.load(f)
    assert report["原始行数"] == 15
    assert report["归并后事件数"] == 13
    assert len(report["异常记录"]) == 5
    assert len(report["版本归并明细"]) == 2


def test_stats_csv_and_json_consistent(paths):
    csv_path, json_path = paths["个人统计"]
    with open(csv_path, encoding="utf-8-sig") as f:
        csv_rows = {r["学生编号"] + "@" + r["节点编号"]: r
                    for r in csv.DictReader(f)}
    with open(json_path, encoding="utf-8") as f:
        json_rows = json.load(f)
    assert len(csv_rows) == len(json_rows) == 10
    for s in json_rows:
        key = s["学生编号"] + "@" + s["节点编号"]
        assert float(csv_rows[key]["得分"] or 0) == s["总体"]["得分"]
        assert float(csv_rows[key]["满分"] or 0) == s["总体"]["满分"]
    assert csv_rows["E05@EN02"]["无记录"] == "8"


def test_stats_flat_rows_expands_themes_dynamically():
    """扁平化 CSV 的主题列按数据动态展开：非 T01—T03 的主题不得丢列."""
    from study_companion.pipeline import stats_flat_rows

    def bucket(score, full):
        return {"已评分_计入统计": 1, "已评分_隔离": 0, "待评分": 0, "未作答": 0,
                "无记录": 0, "得分": score, "满分": full}

    fabricated = [{
        "学生编号": "E01", "班级": "EC01", "节点编号": "EN01",
        "总体": {**bucket(2, 3), "节点可用题数": 5}, "得分率": 2 / 3,
        "按主题": {"T09": {**bucket(2, 3), "得分率": 2 / 3}},
        "按指标": {"T09I1": {**bucket(2, 3), "得分率": 2 / 3}},
    }]
    rows = stats_flat_rows(fabricated)
    assert rows[0]["T09_得分"] == 2
    assert rows[0]["T09_满分"] == 3
    assert rows[0]["T09_得分率"] == 2 / 3
    assert rows[0]["T09I1_得分率"] == 2 / 3
