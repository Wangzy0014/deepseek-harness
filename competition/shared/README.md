# shared/ —— 共同资产（T+2h 冻结）

按验收书：`shared/contracts 与 fixtures` 由四人共同维护，**T+2h 冻结**；
此后字段变更必须先同步所有消费者（在群里通知并更新本目录），不得单方面改契约。

## contracts/ —— 模块间输入输出契约样例

全部由合成数据生成（`tests/make_fixtures.py` 的数据），真实数据产物结构完全相同。

| 文件 | 契约 | 生产者 | 消费者 |
| --- | --- | --- | --- |
| `valid_record.example.json` | 当前有效记录（ValidRecord JSON） | 魏文宇 clean | 宗博文 / 纪宏锋 / 王振宇 |
| `quality_report.example.json` | 质量报告（归并摘要 + 异常清单） | 魏文宇 quality | 全队 / 评审材料 |
| `student_stats.example.json` | 个人统计（学生 x 节点） | 魏文宇 stats | 宗博文（比较）/ 王振宇（建议） |
| `evidence_query.example.json` | 证据查询返回 | 魏文宇 evidence | 纪宏锋（诊断引用）/ 答辩展示 |

关键字段口径见 `../README.md`"统计口径"一节。

## fixtures/synthetic/ —— 合成联调数据

编号一律 E/X/EC/EN 前缀，与真实赛题数据（D/Q/DC/N）完全隔离，**可入库**。
覆盖全部清洗规则（版本归并、超满分、评分点矛盾、主题不一致、语义复核、
节点范围外、待评分、未作答、无记录）。重新生成：

```sh
python3 tests/make_fixtures.py
```

真实赛题数据放 `data/raw/`（gitignore），样例传递走队内渠道，不走仓库。
