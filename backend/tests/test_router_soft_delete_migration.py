import asyncio

from core.pagination import PaginationParams
from routers import partner_orgs, project_docs


def _run(awaitable):
    return asyncio.run(awaitable)


def test_partner_org_list_and_detail_use_active_repo(monkeypatch):
    calls = []

    async def fake_paginate(query, pagination):
        calls.append((query, pagination.skip, pagination.limit))
        return ([{"id": "org-1"}], 1)

    async def fake_get_by_id(org_id):
        return None if org_id == "deleted" else {"id": org_id, "name": "Org"}

    monkeypatch.setattr(partner_orgs.partner_orgs_repo, "paginate", fake_paginate)
    monkeypatch.setattr(partner_orgs.partner_orgs_repo, "get_by_id", fake_get_by_id)

    res = _run(partner_orgs.list_partner_orgs(user={"id": "u"}, pagination=PaginationParams(skip=0, limit=10)))
    assert res["total"] == 1
    assert calls[0][0] == {}

    detail = _run(partner_orgs.get_partner_org("org-1", user={"id": "u"}))
    assert detail["id"] == "org-1"


def test_partner_org_delete_restore_transitions(monkeypatch):
    async def fake_delete(org_id, deleted_by=None):
        return org_id == "org-1"

    async def fake_restore(org_id):
        return org_id == "org-1"

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(partner_orgs.partner_orgs_repo, "soft_delete", fake_delete)
    monkeypatch.setattr(partner_orgs.partner_orgs_repo, "restore", fake_restore)
    monkeypatch.setattr(partner_orgs, "log_activity", noop)

    ok = _run(partner_orgs.delete_partner_org("org-1", user={"name": "Admin"}))
    assert ok["message"] == "Partner organization deleted"

    restored = _run(partner_orgs.restore_partner_org("org-1", user={"name": "Admin"}))
    assert restored["message"] == "Partner organization restored"


def test_project_docs_pagination_totals_and_soft_delete(monkeypatch):
    async def fake_paginate(query, pagination, projection=None, sort=None):
        assert query == {"project_id": "p-1"}
        assert sort == [("uploaded_at", -1)]
        return ([{"id": "d1"}, {"id": "d2"}], 3)

    async def fake_find_one_active(query):
        return {"id": query["id"], "project_id": query["project_id"], "filename": "a.pdf", "file_path": "a.pdf"}

    async def fake_soft_delete(doc_id, deleted_by=None):
        return doc_id == "d1"

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(project_docs.documents_repo, "paginate", fake_paginate)
    monkeypatch.setattr(project_docs.documents_repo, "find_one_active", fake_find_one_active)
    monkeypatch.setattr(project_docs.documents_repo, "soft_delete", fake_soft_delete)
    monkeypatch.setattr(project_docs, "log_activity", noop)

    res = _run(project_docs.list_documents("p-1", user={"id": "u"}, pagination=PaginationParams(skip=0, limit=2)))
    assert res["total"] == 3
    assert res["limit"] == 2

    deleted = _run(project_docs.delete_document("p-1", "d1", user={"name": "Scheduler"}))
    assert deleted["message"] == "Document deleted"


def test_project_docs_visibility_patch_is_idempotent(monkeypatch):
    async def fake_find_one_active(query):
        return {
            "id": query["id"],
            "project_id": query["project_id"],
            "visibility": "shared",
        }

    calls = {"update": 0}

    async def fake_update_active(doc_id, fields):
        calls["update"] += 1
        return False

    monkeypatch.setattr(project_docs.documents_repo, "find_one_active", fake_find_one_active)
    monkeypatch.setattr(project_docs.documents_repo, "update_active", fake_update_active)

    updated = _run(
        project_docs.update_visibility(
            "p-1",
            "d1",
            data=type("Visibility", (), {"visibility": "shared"})(),
            user={"name": "Editor"},
        )
    )
    assert updated["visibility"] == "shared"
    assert calls["update"] == 0
