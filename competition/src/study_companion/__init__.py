"""智慧学伴 · 学情数据处理与个人统计模块（负责人：魏文宇）.

职责（见 competition/README.md）：
- 六表加载与字段映射（load）
- 统一清洗入口：版本归并、异常识别与处置（clean）
- 质量报告（quality）
- 个人统计：有效题数 / 各状态数量 / 主题与指标得分（stats）
- 覆盖与范围：无记录 ≠ 未掌握（coverage）
- 证据查询：保留原文与历史版本（evidence）

队友（宗博文 / 纪宏锋 / 王振宇）一律通过 ``study_companion.pipeline`` 或
``clean.build_valid_records`` 获取"当前有效记录"，不得各自重复清洗。
"""

__version__ = "0.1.0"

# 便捷导出：队友最常用的入口（详细 API 见各模块）
from .config import resolve_data_dir  # noqa: F401
from .load import load_all  # noqa: F401
from .clean import build_valid_records  # noqa: F401
from .stats import student_node_stats, class_node_stats  # noqa: F401
from .coverage import student_node_coverage  # noqa: F401
from .evidence import query as evidence_query  # noqa: F401
from .leads import answer_process_leads  # noqa: F401
