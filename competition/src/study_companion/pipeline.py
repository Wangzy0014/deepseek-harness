"""管线编排：加载 -> 清洗 -> 质量报告 -> 统计 -> 覆盖 -> 写出 JSON/CSV.

输出目录默认 ``competition/outputs/``（git 忽略，因含真实赛题数据衍生结果）。
"""

import csv
import json
from pathlib import Path
from typing import Dict, List, Optional

from . import clean as clean_mod
from . import coverage as coverage_mod
from . import evidence as evidence_mod
from . import stats as stats_mod
from .load import field_mapping_rows, load_all
from .quality import build_quality_report


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _write_csv(path: Path, rows: List[Dict], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _union_fieldnames(rows: List[Dict]) -> List[str]:
    """并集列（保持首现顺序）。列名取第一行会静默丢弃后续行的独有列。"""
    cols: List[str] = []
    for row in rows:
        for key in row:
            if key not in cols:
                cols.append(key)
    return cols


def valid_record_rows(clean_result) -> List[Dict]:
    """当前有效记录平铺（CSV 用）：含清洗口径字段与原始列."""
    rows = []
    for vr in clean_result.valid_records:
        row = dict(vr.record.raw)  # 保留原文
        row["有效主题"] = vr.effective_theme
        row["有效得分"] = "" if vr.effective_score is None else vr.effective_score
        row["统计口径"] = vr.stats_flag
        row["异常类型"] = "、".join(vr.issues)
        row["被归并版本"] = "、".join(
            f"{h.record_id}(v{h.revision})" for h in vr.history)
        rows.append(row)
    return rows


def stats_flat_rows(stats_list: List[Dict]) -> List[Dict]:
    """学生 x 节点统计平铺成一行一条（CSV 用）；主题列按数据动态展开."""
    themes: List[str] = []
    for s in stats_list:
        for theme in s["按主题"]:
            if theme not in themes:
                themes.append(theme)
    flat = []
    for s in stats_list:
        base = {
            "学生编号": s["学生编号"],
            "班级": s["班级"],
            "节点编号": s["节点编号"],
            "得分": s["总体"]["得分"],
            "满分": s["总体"]["满分"],
            "得分率": s["得分率"],
            "已评分_计入统计": s["总体"]["已评分_计入统计"],
            "已评分_隔离": s["总体"]["已评分_隔离"],
            "待评分": s["总体"]["待评分"],
            "未作答": s["总体"]["未作答"],
            "无记录": s["总体"]["无记录"],
            "节点可用题数": s["总体"]["节点可用题数"],
        }
        for theme in themes:
            b = s["按主题"].get(theme)
            if isinstance(b, str):
                base[f"{theme}_口径"] = b
            elif b:
                base[f"{theme}_得分"] = b["得分"]
                base[f"{theme}_满分"] = b["满分"]
                base[f"{theme}_得分率"] = b["得分率"]
        for key, value in s["按指标"].items():
            base[f"{key}_得分率"] = value["得分率"]
        flat.append(base)
    return flat


def _file_fingerprint(path: Path) -> Dict:
    import csv as _csv
    import hashlib
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    # 逻辑行数须按 csv 解析：多行单元格（如解答过程）会让物理行数虚高
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = sum(1 for _ in _csv.reader(f)) - 1
    return {"sha256": digest.hexdigest(), "行数": max(rows, 0)}


def _write_meta(data_dir: Path, out: Path, policy: str,
                clean_result) -> Path:
    """数据指纹与生成上下文：证明产物来自哪份数据与哪种口径.

    验收书"统一数据与代码版本、在干净输出目录重跑"的核对地基：
    记录每个输入文件的 SHA256 与行数、处置策略、代码版本、行/事件数。
    """
    import datetime
    from . import __version__
    from .config import DATA_FILES

    files = {}
    for name in DATA_FILES.values():
        path = Path(data_dir) / name
        if path.exists():
            files[name] = _file_fingerprint(path)
    payload = {
        "生成时间": datetime.datetime.now().isoformat(timespec="seconds"),
        "代码版本": __version__,
        "处置策略": policy,
        "原始行数": clean_result.row_count,
        "归并后事件数": clean_result.event_count,
        "数据文件": files,
    }
    path = out / "_meta.json"
    _write_json(path, payload)
    return path


def run_pipeline(data_dir: Path, output_dir: Path, samples: bool = True,
                 repair_consistent_points: bool = True) -> Dict:
    """全流程运行并写出全部交付文件，返回产物路径表.

    repair_consistent_points：False 时退回保守全隔离（默认差异化处置）。
    """
    dataset = load_all(data_dir)
    clean_result = clean_mod.build_valid_records(
        dataset, repair_consistent_points=repair_consistent_points)
    policy = "repair_consistent_points" if repair_consistent_points \
        else "conservative"
    report = build_quality_report(dataset, clean_result, policy=policy)
    stats_list = stats_mod.all_students_stats(dataset, clean_result)
    coverage_rows = coverage_mod.coverage_table(dataset, clean_result)

    out = Path(output_dir)
    paths = {}

    _write_csv(out / "field_mapping.csv", field_mapping_rows(),
               ["中文列名", "英文字段", "类型", "说明"])
    paths["字段映射"] = out / "field_mapping.csv"

    vr_rows = valid_record_rows(clean_result)
    _write_csv(out / "valid_records.csv", vr_rows, _union_fieldnames(vr_rows))
    _write_json(out / "valid_records.json",
                [evidence_mod.record_view(vr, dataset) for vr in clean_result.valid_records])
    paths["当前有效记录"] = [out / "valid_records.csv", out / "valid_records.json"]

    _write_json(out / "quality_report.json", report.to_dict())
    paths["质量报告"] = out / "quality_report.json"

    flat = stats_flat_rows(stats_list)
    _write_csv(out / "student_stats.csv", flat, _union_fieldnames(flat))
    _write_json(out / "student_stats.json", stats_list)
    paths["个人统计"] = [out / "student_stats.csv", out / "student_stats.json"]

    _write_csv(out / "coverage.csv", coverage_rows, _union_fieldnames(coverage_rows))
    paths["覆盖表"] = out / "coverage.csv"

    if samples:
        _write_samples(dataset, clean_result, out, paths)

    paths["生成元数据"] = _write_meta(data_dir, out, policy, clean_result)
    return paths


def _write_samples(dataset, clean_result, out: Path, paths: Dict) -> None:
    # 步骤诊断线索（"末步结论 vs 最终作答"矛盾，供诊断模块定位）
    from . import leads as leads_mod
    payload = leads_mod.build_leads_payload(
        leads_mod.answer_process_leads(dataset, clean_result))
    _write_json(out / "samples" / "answer_process_conflicts.json", payload)
    paths["步骤诊断线索"] = out / "samples" / "answer_process_conflicts.json"

    # 以下样例目标编号只存在于真实赛题数据；合成数据下逐项自动跳过
    sample_dir = out / "samples"

    # D01/N02 及 Q043 当前记录（步骤诊断与辅导的首条真实链路样例）
    if "D01" in dataset.students:
        d01_n02 = stats_mod.student_node_stats(dataset, clean_result, "D01", "N02")
        d01_n02_records = evidence_mod.query(
            dataset, clean_result, student="D01", node="N02")
        q043_records = evidence_mod.query(
            dataset, clean_result, question="Q043") if "Q043" in dataset.questions else None
        # 说明文字动态生成，不在代码中硬编码任何真实记录编号
        revision_note = ""
        if q043_records:
            for r in q043_records["记录"]:
                if r["学生编号"] == "D01" and r["历史版本"]:
                    revision_note = (
                        f"示例：{r['作答事件编号']} 事件 "
                        + "、".join(
                            f"{h['记录编号']}({h['评分状态']})"
                            for h in r["历史版本"])
                        + f" 已被 {r['记录编号']}({r['评分状态']}"
                          f"{r['得分']}/{r['满分']}) 归并。")
        _write_json(sample_dir / "d01_q043_current_record.json", {
            "说明": "D01 在 N02 的当前记录与统计，及 Q043 全班当前记录（含修订"
                    "归并历史）。这是步骤诊断（纪宏锋）与分步辅导（王振宇）的"
                    "首条真实链路样例。" + revision_note,
            "D01_N02统计": d01_n02,
            "D01_N02当前记录": d01_n02_records,
            "Q043全班记录": q043_records,
        })
        paths["D01/Q043当前记录"] = sample_dir / "d01_q043_current_record.json"

    # D14/N02 较好表现样例（验收书 T+4h 项：验证覆盖限制与差异化建议）
    if "D14" in dataset.students:
        d14_n02 = stats_mod.student_node_stats(dataset, clean_result, "D14", "N02")
        d14_all = stats_mod.student_node_stats(dataset, clean_result, "D14", "N01")
        d14_records = evidence_mod.query(
            dataset, clean_result, student="D14", node="N02")
        _write_json(sample_dir / "d14_good_performance.json", {
            "说明": "D14 较好表现样例（验收书 T+4h 项）：供差异化建议与"
                    "变式/迁移任务设计使用。注意覆盖限制——用得分率时须结合"
                    "覆盖表，不足处不推断为掌握。",
            "D14_N01统计": d14_all,
            "D14_N02统计": d14_n02,
            "D14_N02当前记录": d14_records,
        })
        paths["D14较好表现样例"] = sample_dir / "d14_good_performance.json"

    # Q025 同题记录（同伴比较样例）
    q025_rows = []
    if "Q025" in dataset.questions:
        q025 = evidence_mod.query(dataset, clean_result, question="Q025")
        _write_json(sample_dir / "q025_peer_records.json", q025)
        for r in q025["记录"]:
            q025_rows.append({
                "记录编号": r["记录编号"], "学生编号": r["学生编号"],
                "节点编号": r["节点编号"], "评分状态": r["评分状态"],
                "得分": r["得分"], "满分": r["满分"],
                "学生最终作答": r["学生最终作答"],
                "解答过程": " / ".join(r["解答过程"]),
                "统计口径": r["统计口径"],
                "历史版本": "、".join(
                    f"{h['记录编号']}v{h['修订版本']}得分{h['得分']}" for h in r["历史版本"]),
            })
    if q025_rows:
        _write_csv(sample_dir / "q025_peer_records.csv", q025_rows, _union_fieldnames(q025_rows))
        paths["Q025同伴记录"] = sample_dir / "q025_peer_records.csv"

    # D17 无记录样例（合法空结果）
    if "D17" in dataset.students:
        d17_node_stats = stats_mod.student_node_stats(dataset, clean_result, "D17", "N02")
        d17_cov = coverage_mod.student_node_coverage(dataset, clean_result, "D17", "N02")
        d17_records = evidence_mod.query(dataset, clean_result, student="D17")
        _write_json(sample_dir / "d17_no_record.json", {
            "说明": "D17 在 N02 无任何记录：合法空结果，传递给诊断与建议模块时"
                    "应表达为'记录不足'，而不是 0 分或未掌握。",
            "N02统计": d17_node_stats,
            "N02覆盖": d17_cov,
            "D17全部记录": d17_records,
        })
        paths["D17无记录样例"] = sample_dir / "d17_no_record.json"
