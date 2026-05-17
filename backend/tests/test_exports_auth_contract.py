import os
import sys
from typing import get_args
from unittest.mock import MagicMock

sys.path.append(os.path.abspath("backend"))

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

from core.auth import SchedulerRequired  # noqa: E402
from routers import exports  # noqa: E402


def _dependency_callable(annotation):
    metadata = get_args(annotation)[1:]
    depends = metadata[0]
    return depends.dependency


def test_exports_require_scheduler_or_admin_role():
    for handler in (
        exports.export_projects,
        exports.export_tasks,
        exports.export_partners,
        exports.export_outcomes,
    ):
        assert _dependency_callable(handler.__annotations__["user"]) is _dependency_callable(SchedulerRequired)
