"""证据查询测试（验收书：当前记录保留原文与可查询的历史记录）."""

from study_companion.evidence import query, render_text


def test_query_by_student_includes_all_versions(dataset, clean):
    result = query(dataset, clean, student="E01")
    assert result["命中条数"] == 5   # XR0001/XR0002/XR0003 + XR0004 + 事件QX03当前版XR0006
    # 归并事件只出现当前版本，但历史版本挂在该记录下
    xr6 = next(r for r in result["记录"] if r["记录编号"] == "XR0006")
    assert xr6["历史版本"][0]["记录编号"] == "XR0005"
    assert xr6["历史版本"][0]["状态"].startswith("已被更高版本归并")


def test_query_superseded_record_id_still_resolvable(dataset, clean):
    """直接查旧版本编号 XR0005：返回所在事件的当前版本 + 历史明细."""
    result = query(dataset, clean, record="XR0005")
    assert result["命中条数"] == 1
    rec = result["记录"][0]
    assert rec["记录编号"] == "XR0006"
    assert any(h["记录编号"] == "XR0005" for h in rec["历史版本"])


def test_query_by_question(dataset, clean):
    result = query(dataset, clean, question="QX02")
    ids = {r["记录编号"] for r in result["记录"]}
    assert ids == {"XR0010", "XR0011"}
    xr10 = next(r for r in result["记录"] if r["记录编号"] == "XR0010")
    assert xr10["记录主题"] == "T02" and xr10["有效主题"] == "T01"  # 修正可见
    assert xr10["异常类型"] == ["theme_mismatch"]


def test_query_by_indicator(dataset, clean):
    result = query(dataset, clean, indicator="T03I1")
    ids = {r["记录编号"] for r in result["记录"]}
    assert ids == {"XR0009", "XR0012"}


def test_query_no_condition_returns_error(dataset, clean):
    from study_companion.cli import cmd_evidence  # noqa: F401  CLI 层拦截
    result = query(dataset, clean)
    assert result["命中条数"] == len(clean.valid_records)


def test_render_text_readable(dataset, clean):
    result = query(dataset, clean, student="E04", node="EN01")
    text = render_text(result)
    assert "XR0011" in text and "XR0012" in text
    assert "semantic_review" in text
