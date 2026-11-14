"""加载与字段映射测试."""

import pytest

from study_companion.load import (
    LoadError,
    field_mapping_rows,
    load_all,
    parse_point_scores,
    parse_scoring_points,
)


def test_load_six_tables(dataset):
    assert len(dataset.requirements) == 4          # 3 主题 4 指标
    assert len(dataset.questions) == 8
    assert len(dataset.students) == 5
    assert len(dataset.nodes) == 2
    assert len(dataset.rows) == 15                 # 合成作答原始行
    assert dataset.themes() == ["T01", "T02", "T03"]


def test_question_bank_fields(dataset):
    q = dataset.question("QX03")
    assert q.material_type == "题目"
    assert q.full_score == 3
    assert [p.point_id for p in q.scoring_points] == ["QX03P1", "QX03P2", "QX03P3"]
    assert all(p.score == 1 for p in q.scoring_points)
    assert q.indicator_id == "T01I1"


def test_node_available_questions(dataset):
    n1 = dataset.node("EN01")
    assert "QX07" not in n1.available_questions   # T03 题不在 EN01
    assert n1.themes_taught == ["T01", "T02"]
    n2 = dataset.node("EN02")
    assert "QX07" in n2.available_questions
    assert n2.themes_taught == ["T01", "T02", "T03"]


def test_parse_point_scores():
    assert parse_point_scores("QX03P1=1；QX03P2=0；QX03P3=0") == {
        "QX03P1": 1, "QX03P2": 0, "QX03P3": 0}
    assert parse_point_scores("") == {}


def test_parse_scoring_points_multiline():
    points = parse_scoring_points("QX05P1 步骤一 1分\nQX05P2 步骤二 1分\nQX05P3 步骤三 1分")
    assert len(points) == 3
    assert points[1].text == "步骤二"


def test_field_mapping_covers_answer_columns():
    rows = field_mapping_rows()
    columns = {r["中文列名"] for r in rows}
    assert {"记录编号", "作答事件编号", "修订版本", "评分状态", "得分", "评分点得分"} <= columns


def test_missing_file_raises(tmp_path):
    with pytest.raises(LoadError):
        load_all(tmp_path)


def test_duplicate_event_revision_raises(tmp_path, dataset):
    """同一事件出现重复修订版本号时必须报错（归并将无法仲裁）。"""
    import shutil
    from conftest import FIXTURES
    for name in ["课程要求.csv", "题目与材料.csv", "模拟学生.csv",
                 "测验节点.csv", "字段说明.csv"]:
        shutil.copy(FIXTURES / name, tmp_path / name)
    # 整行复制 v1 行并换记录编号 -> 同事件同版本重复
    with open(FIXTURES / "作答记录.csv", encoding="utf-8-sig", newline="") as f:
        lines = f.read().splitlines()
    out = []
    for line in lines:
        out.append(line)
        if line.startswith("XR0001,"):
            out.append(line.replace("XR0001,", "XR9999,", 1))
    with open(tmp_path / "作答记录.csv", "w", encoding="utf-8-sig", newline="") as f:
        f.write("\n".join(out) + "\n")
    with pytest.raises(LoadError, match="修订版本 1 重复"):
        load_all(tmp_path)


def test_reference_integrity(tmp_path, dataset):
    # 引用不存在的学生应报错：仅拷贝学生表的一部分
    import shutil
    src = dataset.questions  # noqa: F841  仅确认可访问
    for name in ["课程要求.csv", "题目与材料.csv", "测验节点.csv", "作答记录.csv"]:
        shutil.copy(FIXTURE_DIR_OF(name) / name, tmp_path / name)
    # 学生表只留 E01 -> 其余学生引用失效
    with open(tmp_path / "模拟学生.csv", "w", encoding="utf-8-sig", newline="") as f:
        f.write("学生编号,模拟班级编号,年级\nE01,EC01,7\n")
    with pytest.raises(LoadError):
        load_all(tmp_path)


def FIXTURE_DIR_OF(name):  # pragma: no cover - 辅助
    from conftest import FIXTURES
    return FIXTURES
