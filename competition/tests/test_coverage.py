"""覆盖与范围测试（验收书：D17 类无记录不得推断为掌握/未掌握；节点不混比）."""

from study_companion.coverage import coverage_table, student_node_coverage


def test_no_record_case_is_explicit(dataset, clean):
    """E05@EN02 无任何记录：输出'记录不足'提示而不是 0 分."""
    cov = student_node_coverage(dataset, clean, "E05", "EN02")
    assert cov["节点可用题数"] == 8
    assert cov["有记录题数"] == 0
    assert cov["无记录题数"] == 8
    assert "不能推断为未掌握" in cov["解读提示"]
    assert "不能推断为全部掌握" in cov["解读提示"]


def test_partial_coverage(dataset, clean):
    cov = student_node_coverage(dataset, clean, "E01", "EN01")
    assert cov["节点可用题数"] == 6
    assert cov["有记录题数"] == 3
    assert cov["已评分数"] == 2      # 未作答 XR0003 不算已评分
    assert cov["无记录题数"] == 3
    assert set(cov["无记录示例"]) == {"QX02", "QX04", "QX05"}


def test_coverage_table_shape(dataset, clean):
    table = coverage_table(dataset, clean)
    assert len(table) == 10          # 5 学生 x 2 节点
    e05n2 = next(r for r in table if r["学生编号"] == "E05" and r["节点编号"] == "EN02")
    assert e05n2["有记录题数"] == 0


def test_nodes_not_mixed(dataset, clean):
    """同一学生在两个节点的统计互不混比（E01 的 EN02 隔离不影响 EN01）."""
    cov1 = student_node_coverage(dataset, clean, "E01", "EN01")
    cov2 = student_node_coverage(dataset, clean, "E01", "EN02")
    assert cov1["已评分数"] == 2
    assert cov2["已评分数"] == 1
