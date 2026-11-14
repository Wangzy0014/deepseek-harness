"""命令行入口：``python -m study_companion <命令>``（在 competition/ 目录下运行）.

命令：
    pipeline   全流程：清洗 + 质量报告 + 统计 + 覆盖 + 团队样例 -> outputs/
    check      数据自检：行数、归并数、异常数（验收口径）
    stats      个人统计：--student D01 [--node N01] [--json]
    class      班级汇总：--class DC01 --node N01 [--exclude D01,D02]
    evidence   证据查询：--student/--question/--record/--node/--indicator 任选
    mapping    导出字段映射 CSV
"""

import argparse
import json
import sys
from pathlib import Path

from . import clean as clean_mod
from . import coverage as coverage_mod
from . import evidence as evidence_mod
from . import stats as stats_mod
from .config import resolve_data_dir, resolve_output_dir
from .load import field_mapping_rows, load_all
from .pipeline import run_pipeline
from .quality import build_quality_report


def _ctx(args):
    data_dir = resolve_data_dir(getattr(args, "data_dir", None))
    dataset = load_all(data_dir)
    clean_result = clean_mod.build_valid_records(
        dataset,
        repair_consistent_points=getattr(args, "repair_points", False))
    return dataset, clean_result


def cmd_pipeline(args) -> int:
    output_dir = resolve_output_dir(args.output_dir)
    paths = run_pipeline(resolve_data_dir(args.data_dir), output_dir,
                         repair_consistent_points=args.repair_points)
    print(f"完成，产物写入 {output_dir}:")
    for name, p in paths.items():
        if isinstance(p, list):
            for one in p:
                print(f"  {name}: {one}")
        else:
            print(f"  {name}: {p}")
    return 0


def cmd_check(args) -> int:
    dataset, clean_result = _ctx(args)
    report = build_quality_report(dataset, clean_result)
    print("\n".join(report.summary_lines()))
    print("\n版本归并明细（{} 条事件有多版本）:".format(len(report.merge_entries)))
    for entry in report.merge_entries:
        superseded = "、".join(
            f"{m['记录编号']}(v{m['版本']})" for m in entry["被归并记录"])
        changes = "; ".join(
            f"{k}: {v[0]}->{v[1]}" for k, v in entry["字段变化"].items())
        print(f"  {entry['作答事件编号']}: 保留 {entry['保留记录']}(v{entry['保留版本']})"
              f"，归并 {superseded} ｜ {changes}")
    return 0


def cmd_stats(args) -> int:
    dataset, clean_result = _ctx(args)
    if args.node:
        node_ids = [args.node]
    else:
        node_ids = sorted(dataset.nodes)
    payloads = []
    for node_id in node_ids:
        stats = stats_mod.student_node_stats(dataset, clean_result, args.student, node_id)
        if stats is None:
            print(f"学生或节点不存在: {args.student}/{node_id}", file=sys.stderr)
            return 2
        payloads.append(stats)
    if args.json:
        print(json.dumps(payloads, ensure_ascii=False, indent=2))
    else:
        for s in payloads:
            o = s["总体"]
            print(f"{s['学生编号']}({s['班级']}) @ {s['节点编号']}: "
                  f"得分 {o['得分']}/{o['满分']}（率 {s['得分率']}）"
                  f"｜计入统计 {o['已评分_计入统计']}｜隔离 {o['已评分_隔离']}"
                  f"｜待评分 {o['待评分']}｜未作答 {o['未作答']}｜无记录 {o['无记录']}")
            for theme, b in s["按主题"].items():
                if isinstance(b, str):
                    print(f"    {theme}: {b}")
                else:
                    print(f"    {theme}: {b['得分']}/{b['满分']}（率 {b['得分率']}）")
            for ind, b in s["按指标"].items():
                print(f"    {ind}: {b['得分']}/{b['满分']}（率 {b['得分率']}）")
    return 0


def cmd_class(args) -> int:
    dataset, clean_result = _ctx(args)
    exclude = [s.strip() for s in (args.exclude or "").split(",") if s.strip()]
    for node_id in sorted(dataset.nodes):
        result = stats_mod.class_node_stats(
            dataset, clean_result, args.class_id, node_id, exclude_students=exclude)
        if result is None:
            continue
        o = result["总体"]
        print(f"{result['班级编号']} @ {node_id}（排除 {result['排除学生'] or '无'}，"
              f"学生数 {o['学生数']}）: 得分 {o['得分']}/{o['满分']}（率 {result['得分率']}）"
              f"｜隔离 {o['已评分_隔离']}｜待评分 {o['待评分']}｜未作答 {o['未作答']}")
    return 0


def cmd_evidence(args) -> int:
    dataset, clean_result = _ctx(args)
    if not any([args.student, args.question, args.record, args.node, args.indicator]):
        print("请至少提供一个查询条件（--student/--question/--record/--node/--indicator）",
              file=sys.stderr)
        return 2
    result = evidence_mod.query(
        dataset, clean_result, student=args.student, question=args.question,
        record=args.record, node=args.node, indicator=args.indicator)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(evidence_mod.render_text(result))
    return 0


def cmd_mapping(args) -> int:
    rows = field_mapping_rows()
    out = Path(args.out or "field_mapping.csv")
    import csv as _csv
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        writer = _csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"字段映射已写入 {out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="study_companion",
        description="智慧学伴 · 数据处理与个人统计（负责人：魏文宇）")
    parser.add_argument("--data-dir", help="赛题数据目录（默认 competition/data/raw）")
    parser.add_argument("--repair-points", action="store_true",
                        help="处置策略B：得分超满分但评分点合计==满分时按评分点合计修正"
                             "（默认策略A：隔离。切换前需全队拍板）")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("pipeline", help="全流程运行并写出 outputs/")
    p.add_argument("--output-dir", help="输出目录（默认 competition/outputs）")
    p.set_defaults(func=cmd_pipeline)

    p = sub.add_parser("check", help="数据自检：归并与异常")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("stats", help="个人统计")
    p.add_argument("--student", required=True)
    p.add_argument("--node")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("class", help="班级汇总（支持排除本人）")
    p.add_argument("--class", dest="class_id", required=True)
    p.add_argument("--node")
    p.add_argument("--exclude", help="逗号分隔的排除学生编号")
    p.set_defaults(func=cmd_class)

    p = sub.add_parser("evidence", help="证据查询")
    p.add_argument("--student")
    p.add_argument("--question")
    p.add_argument("--record")
    p.add_argument("--node")
    p.add_argument("--indicator")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_evidence)

    p = sub.add_parser("mapping", help="导出字段映射 CSV")
    p.add_argument("--out")
    p.set_defaults(func=cmd_mapping)
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
