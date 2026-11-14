"""CLI 全命令冒烟测试：每个子命令的成功路径与错误路径（含参数位置）。"""

import json

import pytest

from conftest import FIXTURES
from study_companion import cli


def _run(argv, capsys):
    rc = cli.main(["--data-dir", str(FIXTURES)] + argv)
    out = capsys.readouterr().out
    return rc, out


def test_stats_command(dataset, capsys):
    rc, out = _run(["stats", "--student", "E01", "--node", "EN01"], capsys)
    assert rc == 0 and "E01" in out and "0.5" not in out
    rc, out = _run(["stats", "--student", "E01", "--node", "EN01", "--json"], capsys)
    payload = json.loads(out)
    assert payload[0]["总体"]["得分"] == 4


def test_stats_unknown_student(dataset, capsys):
    rc, out = _run(["stats", "--student", "E99"], capsys)
    assert rc == 2


def test_class_command_honors_node_and_exclude(dataset, capsys):
    rc, out = _run(["class", "--class", "EC01", "--node", "EN01",
                    "--exclude", "E01"], capsys)
    assert rc == 0
    assert "EN01" in out and "EN02" not in out     # --node 生效
    assert "E01" in out                            # 排除名单可见
    rc, _ = _run(["class", "--class", "EC01", "--node", "EN99"], capsys)
    assert rc == 2


def test_evidence_command(dataset, capsys):
    rc, out = _run(["evidence", "--question", "QX02"], capsys)
    assert rc == 0 and "XR0010" in out and "XR0011" in out


def test_evidence_requires_condition(dataset, capsys):
    rc, _ = _run(["evidence"], capsys)
    assert rc == 2


def test_check_command(dataset, capsys):
    rc, out = _run(["check"], capsys)
    assert rc == 0 and "原始行数 15 -> 归并后事件数 13" in out


def test_mapping_command(dataset, capsys, tmp_path):
    target = tmp_path / "mapping.csv"
    rc, out = _run(["mapping", "--out", str(target)], capsys)
    assert rc == 0 and target.exists()


def test_pipeline_command(dataset, capsys, tmp_path):
    rc, out = _run(["pipeline", "--output-dir", str(tmp_path / "out")], capsys)
    assert rc == 0
    assert (tmp_path / "out" / "quality_report.json").exists()
    assert (tmp_path / "out" / "samples" / "answer_process_conflicts.json").exists()


def test_repair_points_flag_after_subcommand(dataset, capsys):
    """--repair-points 放在子命令之后也应可用（父解析器）。"""
    rc, out = _run(["stats", "--student", "E01", "--node", "EN01",
                    "--repair-points"], capsys)
    assert rc == 0


def test_repair_points_flag_before_subcommand(dataset, capsys):
    rc = cli.main(["--data-dir", str(FIXTURES), "--repair-points", "check"])
    out = capsys.readouterr().out
    assert rc == 0 and "原始行数 15" in out
