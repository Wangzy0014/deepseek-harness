"""统计复算测试：数值由代码产生，并与手工独立复算（测试内硬编码）逐项核对.

对应验收书"统计复算：得分、分母和覆盖与独立复算一致"。
手工复算过程记录（合成数据，15 行 / 13 事件 / 5 条异常 / 2 条归并）：

E01@EN01: XR0001(1/1)+XR0002(3/3) 计入；XR0003 未作答 -> 得分4/4，无记录=6-3=3
E01@EN02: XR0006(2/3) 计入；XR0004(10/1) 隔离 -> 得分2/3，无记录=8-2=6
E02@EN01: XR0008(v2,2/3) 计入 -> 得分2/3，无记录=6-1=5
E02@EN02: XR0009 隔离 -> 得分0/0（率 None），T03 已教但无有效记录
E03@EN01: XR0010 修正主题后计入(1/1) -> T01 得分1/1
E03@EN02: XR0015(1/1) 计入；XR0013 待评分 -> 得分1/1
E04@EN01: XR0011(0/1) 复核保留计入；XR0012 隔离 -> 得分0/1（真零分）
E05@EN01: XR0014(0/1) -> 得分0/1；E05@EN02 无任何记录 -> 合法空结果
"""

from study_companion.stats import (
    all_students_stats,
    class_node_stats,
    student_node_stats,
)


def _get(stats_list, student, node):
    return next(s for s in stats_list if s["学生编号"] == student and s["节点编号"] == node)


def test_independent_recalc_overall(dataset, clean):
    stats_list = all_students_stats(dataset, clean)
    expected = {
        ("E01", "EN01"): (4, 4, 2, 0, 0, 1, 3),
        ("E01", "EN02"): (2, 3, 1, 1, 0, 0, 6),
        ("E02", "EN01"): (2, 3, 1, 0, 0, 0, 5),
        ("E02", "EN02"): (0, 0, 0, 1, 0, 0, 7),
        ("E03", "EN01"): (1, 1, 1, 0, 0, 0, 5),
        ("E03", "EN02"): (1, 1, 1, 0, 1, 0, 6),
        ("E04", "EN01"): (0, 1, 1, 1, 0, 0, 5),
        ("E04", "EN02"): (0, 0, 0, 0, 0, 0, 8),
        ("E05", "EN01"): (0, 1, 1, 0, 0, 0, 5),
        ("E05", "EN02"): (0, 0, 0, 0, 0, 0, 8),
    }
    for (student, node), (score, full, counted, isolated, pending, unanswered, missing) in expected.items():
        s = _get(stats_list, student, node)
        o = s["总体"]
        assert (o["得分"], o["满分"]) == (score, full), f"{student}@{node} 得分/满分"
        assert o["已评分_计入统计"] == counted, f"{student}@{node} 计入统计题数"
        assert o["已评分_隔离"] == isolated, f"{student}@{node} 隔离题数"
        assert o["待评分"] == pending, f"{student}@{node} 待评分"
        assert o["未作答"] == unanswered, f"{student}@{node} 未作答"
        assert o["无记录"] == missing, f"{student}@{node} 无记录"
    assert len(stats_list) == 10  # 5 学生 x 2 节点


def test_rate_denominator_and_zero_score(dataset, clean):
    """零分（0/1 -> 0.0）与未教学（无分母 -> 未教学标注）分别处理."""
    e05 = student_node_stats(dataset, clean, "E05", "EN01")
    assert e05["得分率"] == 0.0                       # 真零分，不是 None
    assert e05["按主题"]["T01"]["得分率"] == 0.0

    e02n2 = student_node_stats(dataset, clean, "E02", "EN02")
    assert e02n2["得分率"] is None                    # 全部隔离，无有效分母
    assert e02n2["按主题"]["T03"] != "未教学（本节点未测量）"   # EN02 已教 T03

    any_n1 = student_node_stats(dataset, clean, "E01", "EN01")
    assert any_n1["按主题"]["T03"] == "未教学（本节点未测量）"  # EN01 未教 T03


def test_theme_correction_flows_into_theme_stats(dataset, clean):
    """XR0010 主题修正为题库 T01 后，T02 不再被污染."""
    e03 = student_node_stats(dataset, clean, "E03", "EN01")
    assert e03["按主题"]["T01"]["得分"] == 1
    assert e03["按主题"]["T01"]["满分"] == 1


def test_indicator_stats(dataset, clean):
    e01 = student_node_stats(dataset, clean, "E01", "EN01")
    assert e01["按指标"]["T01I1"]["得分"] == 4   # QX01(1) + QX03(3)
    assert e01["按指标"]["T01I1"]["满分"] == 4


def test_excluded_records_not_in_scores(dataset, clean):
    e04 = student_node_stats(dataset, clean, "E04", "EN01")
    assert e04["总体"]["得分"] == 0 and e04["总体"]["满分"] == 1  # 只剩 XR0011 0/1
    assert e04["总体"]["已评分_隔离"] == 1                       # XR0012 隔离可追溯


def test_class_stats_and_exclude_self(dataset, clean):
    """班级汇总 + 排除本人（供宗博文同伴比较，排除真实生效）."""
    base = class_node_stats(dataset, clean, "EC01", "EN01")
    assert base["总体"]["学生数"] == 3   # E01 E02 E05
    # EC01@EN01 总分 = E01(4) + E02(2) + E05(0) = 6，满分 = 4+3+1 = 8
    assert (base["总体"]["得分"], base["总体"]["满分"]) == (6, 8)

    excluded = class_node_stats(dataset, clean, "EC01", "EN01", exclude_students=["E01"])
    assert excluded["总体"]["学生数"] == 2
    assert (excluded["总体"]["得分"], excluded["总体"]["满分"]) == (2, 4)
    assert excluded["排除学生"] == ["E01"]
