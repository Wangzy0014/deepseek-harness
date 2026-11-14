# 规则溯源表：验收书条文 → 实现 → 测试 → 产物

答辩/评审核对用。左列为验收书原文（涉及真实编号处以描述代替，
原编号见本机质量报告）。每条规则四段可追溯：代码位置、测试、
产物字段、依据来源。

| # | 验收书条文（意） | 实现 | 测试 | 产物字段 |
| --- | --- | --- | --- | --- |
| 1 | 原始包 806 行先归并 799 事件，7 个 v2 不与 v1 重复计数 | `clean.merge_versions`（事件分组取最高版本，输出按记录编号规范排序） | `test_clean::test_version_merge_*`、`test_acceptance::1` | 质量报告"原始行数/归并后事件数/版本归并明细" |
| 2 | 作答主题与题库主题不一致——修复或隔离必须留依据 | `clean.detect_issues`：以题目与材料表为准修正 `effective_theme`，原文保留 | `test_clean::test_theme_mismatch_*` | valid_records"有效主题/统计口径=corrected"+处置依据 |
| 3 | 得分超出满分——不能直接进入统计 | 差异化处置：评分点合计==满分 → 纠正为评分点合计（老师说明：系统检测并处理/忽略与纠正）；否则隔离 | `test_clean::test_differentiated_*`、`test_score_exceeds_*` | valid_records"有效得分"+质量报告处置条目 |
| 4 | 总分与评分点合计不一致（且无自洽证据） | 隔离（excluded），证据保留 | `test_clean::test_total_points_*` | 质量报告异常记录（处置=隔离+依据） |
| 5 | 节点包含范围外材料——不能仅按时间戳擅自改节点 | 保留原节点、隔离出该节点统计 | `test_clean::test_out_of_scope_*` | 同上 |
| 6 | 答案与参考答案相符但记 0 分——进入语义评分复核 | 归一化逐字符比对（NFKC/空白/大小写），保留原分标记复核 | `test_clean::test_semantic_zero_*` | 口径=review_kept + 异常类型 semantic_review |
| 7 | 待评分、未作答、无记录——零分和尚未教学分别处理 | 状态分开计数；节点未教主题标"未教学（本节点未测量）"；无记录不算 0 分 | `test_stats::test_rate_denominator_*`、`test_coverage` | student_stats 各状态列/按主题"未教学"/coverage"无记录" |
| 8 | 得分、分母和覆盖与独立复算一致，数值由代码产生 | 管线唯一产出路径；独立预言机 `reference_impl` 对拍 | `test_properties`（200 套随机 × 2 模式）、`test_acceptance::4` | 全部数值产物 + `_meta.json` 指纹 |
| 9 | 同节点同题集同权重；排除本人真实生效 | `stats.class_node_stats(exclude_students=)` | `test_stats::test_class_stats_*`、`test_acceptance::5` | CLI `class --exclude` 输出"排除学生" |
| 10 | 记录不足不被推断为掌握/未掌握；不同节点不混比 | coverage"解读提示"；统计按节点隔离 | `test_coverage::test_no_record_*` | coverage 表 + 质量报告"数据观察" |
| 11 | 换学生、打乱行、重复导入、补传旧版后行为正确；同字段新输入可处理 | 无隐藏状态；输出规范排序（打乱行序产物逐字节一致）；结构/契约校验 | `test_properties::invariants`、`test_pipeline::test_determinism_*` | `_meta.json` 数据指纹证明数据版本 |
| 12 | JSON/CSV 共享版本、数值与依据一致 | 同一次计算双写；合计三方核对 | `test_pipeline::test_stats_csv_and_json_consistent`（含列完整性） | 同名 .json/.csv + _meta |
| 13 | 数据缺失/异常说明、记录不足暂不能确定的内容 | 质量报告"数据观察"层（未决待评分/节点×题目无有效作答/指标零覆盖/节点×学生零记录） | `test_quality::test_observations_layer` | 质量报告"数据观察" |

补充：修改规则一处（`clean.detect_issues`），本表与 README 统计口径节须同步更新。
