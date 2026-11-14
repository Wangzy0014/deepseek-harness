"""共享测试上下文：加载合成数据并跑统一清洗入口."""

import sys
from pathlib import Path

import pytest

COMPETITION_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(COMPETITION_DIR / "src"))

from study_companion.clean import build_valid_records  # noqa: E402
from study_companion.load import load_all  # noqa: E402

FIXTURES = COMPETITION_DIR / "shared" / "fixtures" / "synthetic" / "模拟学情数据"


@pytest.fixture(scope="session")
def dataset():
    return load_all(FIXTURES)


@pytest.fixture(scope="session")
def clean(dataset):
    return build_valid_records(dataset)


@pytest.fixture(scope="session")
def valid_by_record(clean):
    return {vr.record.record_id: vr for vr in clean.valid_records}
