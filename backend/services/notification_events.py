"""Per-event notification helpers — **the single place** to wire new
user-facing notifications.

Architecture summary
--------------------
This module sits between the CRUD routers and the generic dispatcher::

    router handler  →  notify_<event>(...)  →  dispatch(principal, event)

Every user-facing event has exactly one ``notify_<event>`` function here.
Each helper:

1. Resolves the recipient principals (via ``services.notification_prefs``
   helpers: ``find_principal_by_email``, ``load_principal``,
   ``list_admin_principals``, ``principal_for_employee``,
   ``principals_for_project``).
2. Builds the ``NotificationEvent`` via :func:`make_event` (keeps all the
   boilerplate — type_key, HTML rendering, dedup key, entity ref — in one
   place).
3. Fans out via :func:`_fan_out`, which logs + swallows per-recipient errors
   so a notification failure never breaks the CRUD write.

Adding a new notification (cheat sheet)
---------------------------------------
Three steps; no other files need to understand your new event.

1. **Declare** the event in ``core/notification_types.py``::

       "project.retroactive_update": {
           "key": "project.retroactive_update",
           "category": "projects",
           "label": "Project updated retroactively",
           "description": "A past-dated update was recorded on a project.",
           "default_channels": {"in_app": "instant", "email": "daily"},
           "allowed_channels": {"in_app", "email"},
           "audience": {"internal", "partner"},
           "required_roles": None,
           "transactional": False,
           "implemented": True,
       }

2. **Add a helper** here following the template::

       async def notify_project_retroactive_update(project, actor):
           recipients = await principals_for_project(
               project["id"], exclude_ids={actor.get("id", "")},
           )
           if not recipients:
               return
           event = make_event(
               type_key="project.retroactive_update",
               title=f"{project['title']}: retroactive change",
               body=f"{_actor_name(actor)} recorded a past-dated change.",
               link=_app_link(f"/coordination/projects/{project['id']}"),
               entity_type="project",
               entity_id=project["id"],
               dedup_key=f"{project['id']}:retroactive",
           )
           await _fan_out(recipients, event, log_key="project.retroactive_update")

3. **Call** the helper from the router that triggers the event::

       await notify_project_retroactive_update(project, user)

That's it. The dispatcher handles preferences, channels, dedup, digests,
and inbox persistence automatically from the registry entry.

Conventions
-----------
- **Plaintext ``body``** lands in the in-app inbox. Keep it one or two
  sentences with the actor + action + entity name.
- **``dedup_key``** must be unique per event instance — typically ``f"{id}:{action}"``.
  Re-dispatching with the same key is a no-op (idempotent).
- **Severity** — ``"warning"`` for cancellations / overdue states, else
  ``"info"``.
- **Links** go to SPA paths. Use :func:`_app_link` — it handles the base URL.
- **Custom HTML** — pass ``email_body_html=`` to :func:`make_event` when you
  want bold/italic formatting; otherwise :func:`make_event` auto-wraps
  ``body`` in a paragraph and appends an "Open" CTA.
"""

from __future__ import annotations

from html import escape
from typing import Optional

from core.logger import get_logger
from database import db
from services.email import resolve_app_url
from services.notification_prefs import (
    PREFS_FIELD,
    Principal,
    find_principal_by_email,
    list_admin_principals,
    load_principal,
    principal_for_employee,
    principals_for_project,
)
from services.notifications import NotificationEvent, dispatch


logger = get_logger(__name__)


# ── Shared constants ─────────────────────────────────────────────────

# Defaults used when an entity doc is missing its display field. Extracting
# constants keeps copy consistent across every notify_* helper and silences
# the "repeated literal" Sonar rule.
DEFAULT_TASK_LABEL = "a task"
DEFAULT_PROJECT_LABEL = "a project"

# SPA deep-link targets that multiple events share.
CALENDAR_PATH = "/calendar"


# ── Shared utilities (used by every notify_* helper) ──────────────────

def _app_link(path: str) -> str:
    """Build an absolute SPA link.

    Centralised so every helper produces consistent deep links and so the
    base URL is resolved once per call.
    """
    return f"{resolve_app_url().rstrip('/')}{path}"


def _actor_name(user: dict) -> str:
    """Return a display name for the user that triggered the event."""
    return user.get("name") or user.get("email") or "Someone"


def _default_html(body: str, link: Optional[str], cta: str) -> str:
    """Default email HTML: escaped paragraph + optional CTA link."""
    html = f"<p>{escape(body)}</p>"
    if link:
        html += f'<p><a href="{escape(link)}">{escape(cta)}</a></p>'
    return html


def make_event(
    *,
    type_key: str,
    title: str,
    body: str,
    link: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    dedup_key: Optional[str] = None,
    severity: str = "info",
    email_body_html: Optional[str] = None,
    cta: str = "Open",
    context: Optional[dict] = None,
) -> NotificationEvent:
    """Construct a :class:`NotificationEvent` with sensible defaults.

    Reduces the per-helper boilerplate to just the event-specific bits
    (``title``, ``body``, ``dedup_key``, optionally ``email_body_html``).

    If ``email_body_html`` is omitted, renders ``body`` as a plain paragraph
    plus an "Open" CTA link — good enough for most events. Pass in a custom
    string when you need bold / italic / inline formatting.
    """
    return NotificationEvent(
        type_key=type_key,
        title=title,
        body=body,
        email_body_html=email_body_html or _default_html(body, link, cta),
        link=link,
        entity_type=entity_type,
        entity_id=entity_id,
        severity=severity,
        dedup_key=dedup_key,
        context=context or {},
    )


async def _fan_out(
    principals: list[Principal],
    event: NotificationEvent,
    *,
    log_key: str,
) -> int:
    """Dispatch ``event`` to each principal; return the delivery count.

    Each per-principal failure is logged and swallowed — notification
    errors must never break the CRUD write that triggered this call.
    """
    sent = 0
    for p in principals:
        try:
            result = await dispatch(p, event)
            if (result.in_app == "sent"
                    or result.email == "sent"
                    or result.email == "queued"):
                sent += 1
        except Exception as e:
            logger.warning(
                "notify[%s]: dispatch failed for %s/%s: %s",
                log_key, p.kind, p.id, e,
            )
    return sent


async def _resolve_task_assignee(
    task: dict, project: Optional[dict] = None,
) -> Optional[Principal]:
    """Resolve the ``Principal`` assigned to ``task``.

    The task schema has several shapes in the wild:

    1. ``assignee_email`` set — the canonical explicit path (used by task
       reminders).
    2. ``assigned_to`` is an email (legacy — some rows store the email
       directly).
    3. ``assigned_to`` is a **name** like ``"Jane Smith"`` — the current
       UI default. We look that up by name against the project's
       partner-org contacts first, then fall back to any partner contact
       or internal user with that exact name.

    Returns ``None`` when we can't resolve anybody — callers no-op silently
    rather than erroring, so a misspelled name never blocks the CRUD.
    """
    # 1 + 2: email paths.
    direct = task.get("assignee_email")
    if direct:
        return await find_principal_by_email(direct)
    assigned = task.get("assigned_to")
    if not isinstance(assigned, str) or not assigned.strip():
        return None
    if "@" in assigned:
        return await find_principal_by_email(assigned)

    # 3: name-based lookup. Prefer the project's partner org (narrow) then
    # widen to any partner contact / internal user with that exact name.
    name = assigned.strip()
    partner_org_id = (project or {}).get("partner_org_id")
    if partner_org_id:
        contact = await db.partner_contacts.find_one(
            {"partner_org_id": partner_org_id, "name": name, "deleted_at": None},
            {"_id": 0},
        )
        if contact:
            return _principal_from_contact(contact)

    contact = await db.partner_contacts.find_one(
        {"name": name, "deleted_at": None}, {"_id": 0},
    )
    if contact:
        return _principal_from_contact(contact)

    user = await db.users.find_one(
        {"name": name}, {"_id": 0, "password_hash": 0},
    )
    if user:
        return _principal_from_user(user)
    return None


def _principal_from_contact(doc: dict) -> Principal:
    """Build a partner Principal from a ``partner_contacts`` row."""
    return Principal(
        kind="partner",
        id=doc.get("id") or "",
        email=doc.get("email"),
        name=doc.get("name"),
        role=None,
        prefs=doc.get(PREFS_FIELD) or {},
    )


def _principal_from_user(doc: dict) -> Principal:
    """Build an internal Principal from a ``users`` row."""
    return Principal(
        kind="internal",
        id=doc.get("id") or "",
        email=doc.get("email"),
        name=doc.get("name"),
        role=doc.get("role"),
        prefs=doc.get(PREFS_FIELD) or {},
    )


# ── Task events ───────────────────────────────────────────────────────

async def notify_task_assigned(task: dict, project: dict, actor: dict) -> None:
    """Fire ``task.assigned_to_you`` for the newly-assigned principal."""
    principal = await _resolve_task_assignee(task, project)
    if principal is None:
        return

    title = task.get("title", DEFAULT_TASK_LABEL)
    project_title = project.get("title", DEFAULT_PROJECT_LABEL)
    actor_name = _actor_name(actor)
    link = _app_link(f"/coordination/projects/{project.get('id', '')}")

    event = make_event(
        type_key="task.assigned_to_you",
        title=f'{actor_name} assigned you: "{title}"',
        body=(
            f'{actor_name} assigned you the task "{title}" on project '
            f'"{project_title}".'
        ),
        email_body_html=(
            f"{escape(actor_name)} assigned you the task "
            f"<strong>{escape(title)}</strong> on project "
            f"<strong>{escape(project_title)}</strong>. "
            f'<a href="{escape(link)}">Open project</a>'
        ),
        link=link,
        entity_type="task",
        entity_id=task.get("id"),
        dedup_key=f"{task.get('id', '')}:assigned:{principal.id}",
    )
    await _fan_out([principal], event, log_key="task.assigned_to_you")


async def notify_task_deleted(task: dict, project: dict, actor: dict) -> None:
    """Fire ``task.deleted`` for assignee + project stakeholders.

    The task no longer exists in the database by the time the notification
    fires, so the link points at the parent project page.
    """
    actor_id = actor.get("id") or actor.get("user_id") or ""
    recipients: list[Principal] = []
    seen_ids: set[str] = {actor_id}

    # Assignee — skip silently if we can't resolve
    assignee = await _resolve_task_assignee(task, project)
    if assignee is not None and assignee.id not in seen_ids:
        recipients.append(assignee)
        seen_ids.add(assignee.id)

    # Add project stakeholders (deduped against the assignee)
    project_folks = await principals_for_project(
        project_id=project.get("id", ""),
        exclude_ids=seen_ids,
    )
    recipients.extend(project_folks)

    if not recipients:
        return

    title = task.get("title", DEFAULT_TASK_LABEL)
    project_title = project.get("title", DEFAULT_PROJECT_LABEL)
    actor_name = _actor_name(actor)
    link = _app_link(f"/coordination/projects/{project.get('id', '')}")

    event = make_event(
        type_key="task.deleted",
        title=f'{actor_name} deleted: "{title}"',
        body=f'{actor_name} deleted the task "{title}" from project "{project_title}".',
        email_body_html=(
            f"{escape(actor_name)} deleted the task <strong>{escape(title)}</strong> "
            f"from project <strong>{escape(project_title)}</strong>. "
            f'<a href="{escape(link)}">Open project</a>'
        ),
        link=link,
        entity_type="task",
        entity_id=task.get("id"),
        severity="warning",
        dedup_key=f"{task.get('id', '')}:deleted",
    )
    await _fan_out(recipients, event, log_key="task.deleted")


async def notify_task_completed(task: dict, project: dict, actor: dict) -> None:
    """Fire ``task.completed`` for project stakeholders (minus the actor)."""
    recipients = await principals_for_project(
        project_id=project.get("id", ""),
        exclude_ids={actor.get("id") or actor.get("user_id") or ""},
    )
    if not recipients:
        return

    title = task.get("title", DEFAULT_TASK_LABEL)
    project_title = project.get("title", DEFAULT_PROJECT_LABEL)
    actor_name = _actor_name(actor)
    link = _app_link(f"/coordination/projects/{project.get('id', '')}")

    event = make_event(
        type_key="task.completed",
        title=f'{actor_name} completed: "{title}"',
        body=f'{actor_name} marked "{title}" complete on project "{project_title}".',
        email_body_html=(
            f"{escape(actor_name)} marked <strong>{escape(title)}</strong> complete on "
            f"project <strong>{escape(project_title)}</strong>. "
            f'<a href="{escape(link)}">Open project</a>'
        ),
        link=link,
        entity_type="task",
        entity_id=task.get("id"),
        dedup_key=f"{task.get('id', '')}:completed",
    )
    await _fan_out(recipients, event, log_key="task.completed")


async def _gather_prior_commenters(
    task_id: str, exclude_ids: set[str],
) -> list[Principal]:
    """Return distinct prior commenters on ``task_id`` as Principals.

    Batches the lookup: one query per principal kind instead of N
    per-sender ``load_principal`` calls. Callers pass the set of already-seen
    IDs (actor + assignee) to skip.
    """
    prior = await db.task_comments.find(
        {"task_id": task_id, "sender_id": {"$nin": list(exclude_ids)}},
        {"_id": 0, "sender_id": 1, "sender_type": 1},
    ).to_list(200)

    ids_by_kind: dict[str, set[str]] = {"internal": set(), "partner": set()}
    for c in prior:
        sender_id = c.get("sender_id") or ""
        if not sender_id or sender_id in exclude_ids:
            continue
        kind = c.get("sender_type") or "internal"
        if kind in ids_by_kind:
            ids_by_kind[kind].add(sender_id)

    out: list[Principal] = []
    for kind, id_set in ids_by_kind.items():
        out.extend(await _load_commenter_principals(kind, id_set, exclude_ids))
    return out


async def _load_commenter_principals(
    kind: str, id_set: set[str], seen_ids: set[str],
) -> list[Principal]:
    """Batch-load Principals for a set of commenter IDs of one kind.

    Mutates ``seen_ids`` so repeat calls across kinds stay deduped.
    """
    if not id_set:
        return []
    coll = db.users if kind == "internal" else db.partner_contacts
    proj = {"_id": 0, "password_hash": 0} if kind == "internal" else {"_id": 0}
    query: dict = {"id": {"$in": list(id_set)}}
    if kind == "partner":
        query["deleted_at"] = None
    docs = await coll.find(query, proj).to_list(len(id_set))
    out: list[Principal] = []
    for d in docs:
        pid = d.get("id") or ""
        if pid in seen_ids:
            continue
        out.append(Principal(
            kind=kind,  # type: ignore[arg-type]
            id=pid,
            email=d.get("email"),
            name=d.get("name"),
            role=d.get("role") if kind == "internal" else None,
            prefs=d.get(PREFS_FIELD) or {},
        ))
        seen_ids.add(pid)
    return out


async def notify_task_comment(
    comment: dict, task: dict, project: dict, actor: dict,
) -> None:
    """Fire ``task.comment_added`` for task assignee + prior commenters."""
    actor_id = actor.get("id") or actor.get("user_id") or ""
    recipients: list[Principal] = []
    seen_ids: set[str] = {actor_id}

    # Task assignee — skip silently if we can't resolve.
    assignee = await _resolve_task_assignee(task, project)
    if assignee is not None and assignee.id not in seen_ids:
        recipients.append(assignee)
        seen_ids.add(assignee.id)

    # Prior commenters — distinct, excluding actor + assignee.
    recipients.extend(await _gather_prior_commenters(task.get("id", ""), seen_ids))

    if not recipients:
        return

    title = task.get("title", DEFAULT_TASK_LABEL)
    project_title = project.get("title", DEFAULT_PROJECT_LABEL)
    actor_name = _actor_name(actor)
    body_text = comment.get("body", "")
    preview = body_text if len(body_text) <= 200 else body_text[:200] + "…"
    link = _app_link(f"/coordination/projects/{project.get('id', '')}")

    event = make_event(
        type_key="task.comment_added",
        title=f'{actor_name} commented on "{title}"',
        body=f'{actor_name} ({project_title}): {preview}',
        email_body_html=(
            f"{escape(actor_name)} commented on <strong>{escape(title)}</strong> "
            f"({escape(project_title)}):<br/><em>{escape(preview)}</em><br/>"
            f'<a href="{escape(link)}">Open project</a>'
        ),
        link=link,
        entity_type="task",
        entity_id=task.get("id"),
        dedup_key=f"{comment.get('id', '')}",
    )
    await _fan_out(recipients, event, log_key="task.comment_added")


# ── Project events ────────────────────────────────────────────────────

async def notify_project_phase_advanced(
    project: dict, old_phase: str, new_phase: str, actor: dict,
) -> None:
    """Fire ``project.phase_advanced`` for all project stakeholders."""
    recipients = await principals_for_project(
        project_id=project.get("id", ""),
        exclude_ids={actor.get("id") or actor.get("user_id") or ""},
    )
    if not recipients:
        return

    project_title = project.get("title", DEFAULT_PROJECT_LABEL)
    actor_name = _actor_name(actor)
    link = _app_link(f"/coordination/projects/{project.get('id', '')}")

    event = make_event(
        type_key="project.phase_advanced",
        title=f"{project_title}: advanced to {new_phase}",
        body=f'{actor_name} advanced "{project_title}" from {old_phase} to {new_phase}.',
        email_body_html=(
            f"{escape(actor_name)} advanced <strong>{escape(project_title)}</strong> "
            f"from <em>{escape(old_phase)}</em> to <strong>{escape(new_phase)}</strong>. "
            f'<a href="{escape(link)}">Open project</a>'
        ),
        link=link,
        entity_type="project",
        entity_id=project.get("id"),
        dedup_key=f"{project.get('id', '')}:phase:{new_phase}",
    )
    await _fan_out(recipients, event, log_key="project.phase_advanced")


async def notify_project_deleted(project: dict, actor: dict) -> None:
    """Fire ``project.deleted`` for all project stakeholders.

    The caller passes the pre-delete project snapshot. We pass
    ``partner_org_id`` through to :func:`principals_for_project` so the
    recipient lookup bypasses the ``deleted_at: None`` filter — by the time
    this runs, the soft-delete has already marked the project deleted.
    """
    recipients = await principals_for_project(
        project_id=project.get("id", ""),
        exclude_ids={actor.get("id") or actor.get("user_id") or ""},
        partner_org_id=project.get("partner_org_id"),
    )
    if not recipients:
        return

    project_title = project.get("title", DEFAULT_PROJECT_LABEL)
    actor_name = _actor_name(actor)
    link = _app_link("/coordination")

    event = make_event(
        type_key="project.deleted",
        title=f"{project_title}: deleted",
        body=f'{actor_name} deleted the project "{project_title}".',
        email_body_html=(
            f"{escape(actor_name)} deleted the project "
            f"<strong>{escape(project_title)}</strong>. "
            f'<a href="{escape(link)}">Open coordination</a>'
        ),
        link=link,
        entity_type="project",
        entity_id=project.get("id"),
        severity="warning",
        dedup_key=f"{project.get('id', '')}:deleted",
    )
    await _fan_out(recipients, event, log_key="project.deleted")


async def notify_project_message(
    message: dict, project: dict, actor: dict,
) -> None:
    """Fire ``project.message_posted`` for stakeholders.

    Respects ``visibility``: ``internal`` messages skip partner contacts.
    """
    actor_id = actor.get("id") or actor.get("user_id") or ""
    recipients = await principals_for_project(
        project_id=project.get("id", ""),
        exclude_ids={actor_id},
    )
    if message.get("visibility") == "internal":
        recipients = [p for p in recipients if p.kind == "internal"]
    if not recipients:
        return

    project_title = project.get("title", DEFAULT_PROJECT_LABEL)
    actor_name = _actor_name(actor)
    body_text = message.get("body", "")
    preview = body_text if len(body_text) <= 200 else body_text[:200] + "…"
    channel = message.get("channel", "")
    link = _app_link(f"/coordination/projects/{project.get('id', '')}")

    event = make_event(
        type_key="project.message_posted",
        title=f"{actor_name} in #{channel}: {project_title}",
        body=f"{actor_name}: {preview}",
        email_body_html=(
            f"<strong>{escape(actor_name)}</strong> posted in "
            f"<em>#{escape(channel)}</em> on <strong>{escape(project_title)}</strong>:"
            f"<br/><em>{escape(preview)}</em><br/>"
            f'<a href="{escape(link)}">Open project</a>'
        ),
        link=link,
        entity_type="project_message",
        entity_id=message.get("id"),
        dedup_key=f"{message.get('id', '')}",
    )
    await _fan_out(recipients, event, log_key="project.message_posted")


async def notify_project_document_shared(
    doc: dict, project: dict, actor: dict,
) -> None:
    """Fire ``project.document_shared`` — only when visibility='shared'."""
    if doc.get("visibility") != "shared":
        return
    recipients = await principals_for_project(
        project_id=project.get("id", ""),
        exclude_ids={actor.get("id") or actor.get("user_id") or ""},
    )
    if not recipients:
        return

    project_title = project.get("title", DEFAULT_PROJECT_LABEL)
    filename = doc.get("filename", "a document")
    actor_name = _actor_name(actor)
    link = _app_link(f"/coordination/projects/{project.get('id', '')}")

    event = make_event(
        type_key="project.document_shared",
        title=f'{actor_name} shared "{filename}"',
        body=f'{actor_name} shared "{filename}" on project "{project_title}".',
        email_body_html=(
            f"{escape(actor_name)} shared <strong>{escape(filename)}</strong> on "
            f"project <strong>{escape(project_title)}</strong>. "
            f'<a href="{escape(link)}">Open project</a>'
        ),
        link=link,
        entity_type="document",
        entity_id=doc.get("id"),
        dedup_key=f"{doc.get('id', '')}",
    )
    await _fan_out(recipients, event, log_key="project.document_shared")


# ── Schedule events ───────────────────────────────────────────────────

async def notify_schedule_assigned(
    schedule: dict, employee_ids: list[str], actor: dict,
) -> None:
    """Fire ``schedule.assigned_to_you`` once per newly-assigned employee."""
    if not employee_ids:
        return
    actor_name = _actor_name(actor)
    location = schedule.get("location_name") or "location TBD"
    date = schedule.get("date", "")
    start = schedule.get("start_time", "")
    link = _app_link(CALENDAR_PATH)

    for emp_id in employee_ids:
        principal = await principal_for_employee(emp_id)
        if principal is None:
            continue
        event = make_event(
            type_key="schedule.assigned_to_you",
            title=f"New class: {location} on {date}",
            body=(
                f'{actor_name} assigned you to a class at {location} on {date} '
                f'starting {start}.'
            ),
            email_body_html=(
                f"{escape(actor_name)} assigned you to a class at "
                f"<strong>{escape(location)}</strong> on "
                f"<strong>{escape(date)}</strong> starting {escape(start)}. "
                f'<a href="{escape(link)}">Open calendar</a>'
            ),
            link=link,
            entity_type="schedule",
            entity_id=schedule.get("id"),
            dedup_key=f"{schedule.get('id', '')}:assigned:{emp_id}",
        )
        await _fan_out([principal], event, log_key="schedule.assigned_to_you")


SCHEDULE_CHANGE_VERBS = {
    "cancelled": ("cancelled", "Cancelled"),
    "relocated": ("moved", "Moved"),
    "rescheduled": ("rescheduled", "Rescheduled"),
}


async def notify_schedule_changed(
    schedule: dict, change_type: str, actor: dict,
    *, extra: Optional[dict] = None,
) -> None:
    """Fire ``schedule.changed`` for every assigned employee.

    ``change_type`` ∈ :data:`SCHEDULE_CHANGE_VERBS` — used in the dedup key
    and the body text. Unknown types fall back to a generic "changed" verb.
    """
    employee_ids = schedule.get("employee_ids") or []
    if not employee_ids:
        return
    actor_name = _actor_name(actor)
    location = schedule.get("location_name") or "a class"
    date = (extra or {}).get("new_date") or schedule.get("date", "")
    link = _app_link(CALENDAR_PATH)
    verb_past, verb_title = SCHEDULE_CHANGE_VERBS.get(
        change_type, ("changed", "Changed"),
    )

    for emp_id in employee_ids:
        principal = await principal_for_employee(emp_id)
        if principal is None:
            continue
        event = make_event(
            type_key="schedule.changed",
            title=f"{verb_title}: {location} on {date}",
            body=f'{actor_name} {verb_past} your class at {location} on {date}.',
            email_body_html=(
                f"{escape(actor_name)} {escape(verb_past)} your class at "
                f"<strong>{escape(location)}</strong> on "
                f"<strong>{escape(date)}</strong>. "
                f'<a href="{escape(link)}">Open calendar</a>'
            ),
            link=link,
            entity_type="schedule",
            entity_id=schedule.get("id"),
            severity="warning",
            dedup_key=f"{schedule.get('id', '')}:{change_type}",
        )
        await _fan_out([principal], event, log_key="schedule.changed")


async def notify_schedule_bulk_status_changed(
    schedule: dict, new_status: str, actor: dict,
) -> None:
    """Fire ``schedule.bulk_status_changed`` for each assigned employee."""
    employee_ids = schedule.get("employee_ids") or []
    if not employee_ids:
        return
    actor_name = _actor_name(actor)
    location = schedule.get("location_name") or "a class"
    date = schedule.get("date", "")
    link = _app_link(CALENDAR_PATH)
    label = new_status.replace("_", " ")

    for emp_id in employee_ids:
        principal = await principal_for_employee(emp_id)
        if principal is None:
            continue
        event = make_event(
            type_key="schedule.bulk_status_changed",
            title=f"{location} on {date}: {label}",
            body=(
                f'{actor_name} marked your class at {location} on {date} '
                f'as "{label}".'
            ),
            email_body_html=(
                f"{escape(actor_name)} marked your class at "
                f"<strong>{escape(location)}</strong> on "
                f"<strong>{escape(date)}</strong> as "
                f"<em>{escape(label)}</em>. "
                f'<a href="{escape(link)}">Open calendar</a>'
            ),
            link=link,
            entity_type="schedule",
            entity_id=schedule.get("id"),
            dedup_key=f"{schedule.get('id', '')}:status:{new_status}",
        )
        await _fan_out([principal], event, log_key="schedule.bulk_status_changed")


async def notify_schedule_bulk_location_changed(
    schedule: dict, new_location_name: str, actor: dict,
) -> None:
    """Fire ``schedule.bulk_location_changed`` for each assigned employee."""
    employee_ids = schedule.get("employee_ids") or []
    if not employee_ids:
        return
    actor_name = _actor_name(actor)
    date = schedule.get("date", "")
    link = _app_link(CALENDAR_PATH)

    for emp_id in employee_ids:
        principal = await principal_for_employee(emp_id)
        if principal is None:
            continue
        event = make_event(
            type_key="schedule.bulk_location_changed",
            title=f"Moved to {new_location_name} on {date}",
            body=(
                f'{actor_name} moved your class on {date} to '
                f'{new_location_name}.'
            ),
            email_body_html=(
                f"{escape(actor_name)} moved your class on "
                f"<strong>{escape(date)}</strong> to "
                f"<strong>{escape(new_location_name)}</strong>. "
                f'<a href="{escape(link)}">Open calendar</a>'
            ),
            link=link,
            entity_type="schedule",
            entity_id=schedule.get("id"),
            severity="warning",
            dedup_key=f"{schedule.get('id', '')}:location:{new_location_name}",
        )
        await _fan_out([principal], event, log_key="schedule.bulk_location_changed")


# ── Account / Admin events ────────────────────────────────────────────

async def notify_role_changed(
    user_id: str, old_role: str, new_role: str, actor: dict,
) -> None:
    """Fire ``account.role_changed`` for the user whose role changed."""
    if old_role == new_role:
        return
    principal = await load_principal("internal", user_id)
    if principal is None:
        return
    actor_name = _actor_name(actor)
    link = _app_link("/settings")

    event = make_event(
        type_key="account.role_changed",
        title=f"Your role is now {new_role}",
        body=f'{actor_name} changed your role from {old_role} to {new_role}.',
        email_body_html=(
            f"{escape(actor_name)} changed your role from "
            f"<em>{escape(old_role)}</em> to <strong>{escape(new_role)}</strong>. "
            f'<a href="{escape(link)}">Open settings</a>'
        ),
        link=link,
        entity_type="user",
        entity_id=user_id,
        dedup_key=f"{user_id}:role:{new_role}",
    )
    await _fan_out([principal], event, log_key="account.role_changed")


async def notify_new_user_pending(pending_user: dict) -> None:
    """Fire ``admin.new_user_pending`` for every admin."""
    admins = await list_admin_principals()
    if not admins:
        return
    name = pending_user.get("name") or pending_user.get("email") or "A new user"
    email = pending_user.get("email", "")
    user_id = pending_user.get("id", "")
    link = _app_link("/users")

    event = make_event(
        type_key="admin.new_user_pending",
        title=f"New user awaiting approval: {name}",
        body=f'{name} ({email}) registered and is pending review.',
        email_body_html=(
            f"<strong>{escape(name)}</strong> ({escape(email)}) registered "
            f"and is pending review. "
            f'<a href="{escape(link)}">Review pending users</a>'
        ),
        link=link,
        entity_type="user",
        entity_id=user_id,
        dedup_key=f"{user_id}:new_user",
    )
    await _fan_out(admins, event, log_key="admin.new_user_pending")


# ── Public surface ────────────────────────────────────────────────────

__all__ = [
    # Event helpers (one per registry key)
    "notify_task_assigned",
    "notify_task_completed",
    "notify_task_deleted",
    "notify_task_comment",
    "notify_project_phase_advanced",
    "notify_project_deleted",
    "notify_project_message",
    "notify_project_document_shared",
    "notify_schedule_assigned",
    "notify_schedule_changed",
    "notify_schedule_bulk_status_changed",
    "notify_schedule_bulk_location_changed",
    "notify_role_changed",
    "notify_new_user_pending",
    # Extension-point utilities (use these when adding a new notify_* helper)
    "make_event",
    "SCHEDULE_CHANGE_VERBS",
]
