"""Constants and small helpers shared across the portal sub-routers."""

import os
import re

from database import ROOT_DIR

# Storage location for attachments / documents. Defaults to ``<repo>/uploads``
# for local dev, but the ``UPLOAD_DIR`` env var lets container deploys point
# at a writable mounted volume — ``/app`` is owned by root on the image, so
# the non-root runtime user cannot create the default path without an env
# override and a matching volume mount.
UPLOAD_DIR = os.environ.get("UPLOAD_DIR") or os.path.join(ROOT_DIR, "uploads")

PROJECT_NOT_FOUND = "Project not found"
TASK_NOT_FOUND = "Task not found"
INVALID_TOKEN = "Invalid or expired portal link"

_SAFE_EXT_RE = re.compile(r"^\.[a-zA-Z0-9]{1,10}$")


def safe_stored_name(doc_id: str, original_filename: str | None) -> str:
    """Return a filesystem-safe name for an uploaded file.

    Keeps the original extension if it matches the allow-list (letters,
    digits, 1-10 chars); otherwise drops it. The bare ``doc_id`` is
    always usable as a path component because it is a UUID.
    """
    ext = os.path.splitext(original_filename or "")[1]
    if not ext or not _SAFE_EXT_RE.match(ext):
        ext = ""
    return f"{doc_id}{ext}"
