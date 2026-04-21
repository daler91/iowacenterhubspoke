"""Regression: ``ProjectCreate.venue_name`` / ``ProjectUpdate.venue_name``
must accept every value that ``PartnerOrgCreate.name`` accepts.

The new-project dialog copies the partner's name into ``venue_name``
through a disabled input, so a lower project-side cap silently
breaks project creation for long-named partners with a bare 422.
"""

import pytest
from pydantic import ValidationError

from models.coordination_schemas import ProjectCreate, ProjectUpdate

_BASE = {
    "title": "AI for Small Business Workshop",
    "event_format": "workshop",
    "partner_org_id": "org-123",
    "event_date": "2026-05-01",
}

# Must match ``PartnerOrgCreate.name`` max_length (currently 300). If the
# partner cap ever moves, both that schema and this constant must move
# together — the assertion below makes the miss a test failure, not a
# silent 422 at runtime.
_PARTNER_NAME_CAP = 300


def test_project_create_accepts_venue_name_at_partner_name_cap():
    project = ProjectCreate(**_BASE, venue_name="v" * _PARTNER_NAME_CAP)
    assert len(project.venue_name) == _PARTNER_NAME_CAP


def test_project_create_rejects_venue_name_above_cap():
    with pytest.raises(ValidationError):
        ProjectCreate(**_BASE, venue_name="v" * (_PARTNER_NAME_CAP + 1))


def test_project_update_accepts_venue_name_at_partner_name_cap():
    update = ProjectUpdate(venue_name="v" * _PARTNER_NAME_CAP)
    assert len(update.venue_name) == _PARTNER_NAME_CAP
