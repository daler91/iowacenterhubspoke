"""Schema-level regression tests for ``ProjectCreate`` / ``ProjectUpdate``.

The ``venue_name`` cap is structurally tied to ``PartnerOrgCreate.name``:
the project dialog copies the partner's name into ``venue_name`` verbatim
via a disabled input, so a lower project cap makes long-named partners
un-bookable with a bare 422.
"""

import pytest
from pydantic import ValidationError

from models.coordination_schemas import (
    PartnerOrgCreate,
    ProjectCreate,
    ProjectUpdate,
)


def _project_payload(**overrides):
    base = {
        "title": "AI for Small Business Workshop",
        "event_format": "workshop",
        "partner_org_id": "org-123",
        "event_date": "2026-05-01",
    }
    base.update(overrides)
    return base


def _max_length(model, field):
    for item in model.model_fields[field].metadata:
        if hasattr(item, "max_length"):
            return item.max_length
    raise AssertionError(f"{model.__name__}.{field} has no max_length constraint")


def test_project_create_accepts_venue_name_at_partner_name_cap():
    # PartnerOrgCreate.name is what the dialog copies in — the two caps
    # must stay aligned so any valid partner name fits in venue_name.
    partner_cap = _max_length(PartnerOrgCreate, "name")
    project_cap = _max_length(ProjectCreate, "venue_name")
    assert project_cap == partner_cap
    venue = "v" * partner_cap
    project = ProjectCreate(**_project_payload(venue_name=venue))
    assert project.venue_name == venue


def test_project_create_rejects_venue_name_above_cap():
    with pytest.raises(ValidationError) as exc:
        ProjectCreate(**_project_payload(venue_name="v" * 301))
    assert "venue_name" in str(exc.value)


def test_project_update_accepts_venue_name_at_partner_name_cap():
    update = ProjectUpdate(venue_name="v" * 300)
    assert update.venue_name == "v" * 300
