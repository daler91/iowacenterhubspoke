import pytest
from pydantic import ValidationError

from models.schemas import RecurrenceRule


def test_recurrence_rule_rejects_unbounded_occurrences():
    with pytest.raises(ValidationError):
        RecurrenceRule(
            interval=1,
            frequency="month",
            end_mode="after_occurrences",
            occurrences=90000,
        )


def test_recurrence_rule_requires_end_date_for_on_date_mode():
    with pytest.raises(ValidationError):
        RecurrenceRule(
            interval=1,
            frequency="month",
            end_mode="on_date",
            end_date=None,
        )
