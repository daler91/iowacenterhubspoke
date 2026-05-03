import asyncio
from unittest.mock import AsyncMock
from types import SimpleNamespace

from core.pagination import PaginationParams
from routers import partner_orgs, project_docs


def _run(awaitable):
    return asyncio.run(awaitable)


def test_partner_org_list_and_detail_use_active_repo(monkeypatch):
    paginate_mock = AsyncMock(return_value=([{"id": "org-1"}], 1))
    get_by_id_mock = AsyncMock(side_effect=[{"id": "org-1", "name": "Org"}])

    monkeypatch.setattr(partner_orgs.partner_orgs_repo, "paginate", paginate_mock)
    monkeypatch.setattr(partner_orgs.partner_orgs_repo, "get_by_id", get_by_id_mock)

    res = _run(partner_orgs.list_partner_orgs(user={"id": "u"}, pagination=PaginationParams(skip=0, limit=10)))
    assert res["total"] == 1
    paginate_mock.assert_awaited_once()
    assert paginate_mock.await_args.args[0] == {}

    detail = _run(partner_orgs.get_partner_org("org-1", user={"id": "u"}))
    assert detail["id"] == "org-1"


def test_partner_org_delete_restore_transitions(monkeypatch):
    monkeypatch.setattr(
        partner_orgs.partner_orgs_repo,
        "soft_delete",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr(partner_orgs.partner_orgs_repo, "restore", AsyncMock(return_value=True))
    monkeypatch.setattr(partner_orgs, "log_activity", AsyncMock(return_value=None))

    ok = _run(partner_orgs.delete_partner_org("org-1", user={"name": "Admin"}))
    assert ok["message"] == "Partner organization deleted"

    restored = _run(partner_orgs.restore_partner_org("org-1", user={"name": "Admin"}))
    assert restored["message"] == "Partner organization restored"


def test_project_docs_pagination_totals_and_soft_delete(monkeypatch):
    paginate_mock = AsyncMock(return_value=([{"id": "d1"}, {"id": "d2"}], 3))
    find_one_mock = AsyncMock(return_value={"id": "d1", "project_id": "p-1", "filename": "a.pdf", "file_path": "a.pdf"})
    soft_delete_mock = AsyncMock(return_value=True)

    monkeypatch.setattr(project_docs.documents_repo, "paginate", paginate_mock)
    monkeypatch.setattr(project_docs.documents_repo, "find_one_active", find_one_mock)
    monkeypatch.setattr(project_docs.documents_repo, "soft_delete", soft_delete_mock)
    monkeypatch.setattr(project_docs, "log_activity", AsyncMock(return_value=None))

    res = _run(project_docs.list_documents("p-1", user={"id": "u"}, pagination=PaginationParams(skip=0, limit=2)))
    assert res["total"] == 3
    assert res["limit"] == 2
    assert paginate_mock.await_args.args[0] == {"project_id": "p-1"}
    assert paginate_mock.await_args.kwargs["sort"] == [("uploaded_at", -1)]

    deleted = _run(project_docs.delete_document("p-1", "d1", user={"name": "Scheduler"}))
    assert deleted["message"] == "Document deleted"


def test_project_docs_visibility_patch_is_idempotent(monkeypatch):
    find_one_mock = AsyncMock(return_value={"id": "d1", "project_id": "p-1", "visibility": "shared"})
    update_mock = AsyncMock(return_value=False)

    monkeypatch.setattr(project_docs.documents_repo, "find_one_active", find_one_mock)
    monkeypatch.setattr(project_docs.documents_repo, "update_active", update_mock)

    updated = _run(
        project_docs.update_visibility(
            "p-1",
            "d1",
            data=type("Visibility", (), {"visibility": "shared"})(),
            user={"name": "Editor"},
        )
    )
    assert updated["visibility"] == "shared"
    update_mock.assert_not_awaited()


def test_project_docs_visibility_update_scopes_write_to_project(monkeypatch):
    find_one_mock = AsyncMock(side_effect=[
        {"id": "d1", "project_id": "p-1", "visibility": "internal"},
        {"id": "d1", "project_id": "p-1", "visibility": "shared"},
    ])
    update_one_mock = AsyncMock(return_value=SimpleNamespace(matched_count=1))
    fake_repo = SimpleNamespace(
        find_one_active=find_one_mock,
        collection=SimpleNamespace(update_one=update_one_mock),
    )

    monkeypatch.setattr(project_docs, "documents_repo", fake_repo)

    updated = _run(
        project_docs.update_visibility(
            "p-1",
            "d1",
            data=type("Visibility", (), {"visibility": "shared"})(),
            user={"name": "Editor"},
        )
    )

    assert updated["visibility"] == "shared"
    assert update_one_mock.await_args.args[0] == {
        "id": "d1",
        "project_id": "p-1",
        "deleted_at": None,
    }
