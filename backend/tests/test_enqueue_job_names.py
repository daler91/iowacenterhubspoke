"""Guard: every arq job name we enqueue must actually be registered.

arq resolves jobs by function ``__name__`` at *dequeue* time and does not
validate the name when ``enqueue_job`` is called. A typo therefore looks
completely successful from the API's side — the job is written to Redis, the
handler returns 200, and the worker then fails to resolve it. That is how
``fire_webhook_event`` shipped enqueuing ``"deliver_webhook"`` against a
registry that only contained ``deliver_webhook_job``, silently disabling every
event-driven webhook.

This test closes the loop that ``test_worker_job_extractions`` leaves open: it
asserts the *producer* side (the string literals at each call site) against the
*consumer* side (``WorkerSettings.functions``), rather than checking only that
the registry contains the expected names.
"""

import re
from pathlib import Path

from worker import WorkerSettings


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"

# Matches ``pool.enqueue_job("name"`` and ``safe_enqueue_job("name"``, including
# the multi-line form where the literal sits on the following line. Calls that
# pass a variable (``safe_enqueue_job(job_name, ...)`` inside core/queue.py)
# don't match, which is what we want — only literals are checkable here.
ENQUEUE_LITERAL_PATTERN = re.compile(r"""(?:safe_)?enqueue_job\(\s*["']([\w.]+)["']""")


def _iter_production_sources():
    for path in sorted(BACKEND_ROOT.rglob("*.py")):
        if "tests" in path.parts or "__pycache__" in path.parts:
            continue
        yield path


def test_every_enqueued_job_name_is_registered():
    registered = {fn.__name__ for fn in WorkerSettings.functions}
    registered |= {cron.name for cron in WorkerSettings.cron_jobs}

    offenders = []
    for path in _iter_production_sources():
        text = path.read_text(encoding="utf-8")
        for match in ENQUEUE_LITERAL_PATTERN.finditer(text):
            name = match.group(1)
            if name in registered:
                continue
            line = text.count("\n", 0, match.start()) + 1
            rel = path.relative_to(REPO_ROOT)
            offenders.append(f"{rel}:{line} enqueues unregistered job {name!r}")

    assert offenders == [], (
        "Enqueued job names must appear in worker.WorkerSettings; "
        "arq fails silently otherwise:\n  " + "\n  ".join(offenders)
    )


def test_pattern_actually_finds_call_sites():
    """Cheap self-check so a broken regex can't make the guard vacuous."""
    found = [
        match.group(1)
        for path in _iter_production_sources()
        for match in ENQUEUE_LITERAL_PATTERN.finditer(path.read_text(encoding="utf-8"))
    ]
    assert "deliver_webhook_job" in found
    assert "sync_schedules_denormalized" in found
