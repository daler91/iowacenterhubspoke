"""Regression: ``ProjectCreate.venue_name`` / ``ProjectUpdate.venue_name``
must accept every value that ``PartnerOrgCreate.name`` accepts.

The new-project dialog copies the partner's name into ``venue_name``
through a disabled input, so a lower project-side cap silently
breaks project creation for long-named partners with a bare 422.
"""

import pytest
from pydantic import ValidationError

from models.coordination_schemas import (
    PartnerOrgCreate,
    ProjectCreate,
    ProjectUpdate,
)


def _max_length(model, field: str) -> int:
    for item in model.model_fields[field].metadata:
        cap = getattr(item, "max_length", None)
        if cap is not None:
            return cap
    raise AssertionError(f"{model.__name__}.{field} has no max_length")


_PARTNER_NAME_CAP = _max_length(PartnerOrgCreate, "name")
_BASE = {
    "title": "AI for Small Business Workshop",
    "event_format": "workshop",
    "partner_org_id": "org-123",
    "event_date": "2026-05-01",
}


def test_project_venue_name_caps_track_partner_name_cap():
    # The whole point of this file: a schema drift here becomes a 422 at
    # runtime, so pin both project-side caps to the partner-side cap.
    assert _max_length(ProjectCreate, "venue_name") == _PARTNER_NAME_CAP
    assert _max_length(ProjectUpdate, "venue_name") == _PARTNER_NAME_CAP


def test_project_create_accepts_venue_name_at_partner_name_cap():
    project = ProjectCreate(**_BASE, venue_name="v" * _PARTNER_NAME_CAP)
    assert len(project.venue_name) == _PARTNER_NAME_CAP


def test_project_create_rejects_venue_name_above_cap():
    with pytest.raises(ValidationError):
        ProjectCreate(**_BASE, venue_name="v" * (_PARTNER_NAME_CAP + 1))
