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

from .config import resolve_data_dir  # noqa: F401
