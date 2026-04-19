#!/usr/bin/env python3
"""Container entrypoint: prepare the uploads volume, drop privileges, exec uvicorn.

Runs as root so we can ``chown`` the Railway-mounted volume — Railway mounts
every volume as root regardless of the Dockerfile ``USER`` directive, which
means the non-root ``appuser`` can't write attachments into it without help.
After fixing ownership we drop to ``appuser`` (uid/gid 1001) and
``execvp`` uvicorn so PID 1 ends up being the server, not this wrapper.

Safe no-op when already running as a non-root user (local dev): we skip the
chown and just exec uvicorn directly.
"""

from __future__ import annotations

import os
import sys

APP_UID = 1001
APP_GID = 1001


def _chown_tree(path: str, uid: int, gid: int) -> None:
    """Best-effort recursive chown — log and continue on per-entry errors."""
    for root, dirs, files in os.walk(path):
        try:
            os.chown(root, uid, gid)
        except OSError as e:
            print(f"entrypoint: warn: chown({root}) failed: {e}", file=sys.stderr)
        for name in (*dirs, *files):
            try:
                os.chown(os.path.join(root, name), uid, gid)
            except OSError as e:
                print(f"entrypoint: warn: chown({name}) failed: {e}", file=sys.stderr)


def main() -> None:
    upload_dir = os.environ.get("UPLOAD_DIR") or "/app/uploads"
    try:
        os.makedirs(upload_dir, exist_ok=True)
    except OSError as e:
        # Don't crash the container just because we couldn't create the
        # path as root — the app will surface its own error on first upload.
        print(f"entrypoint: warn: mkdir({upload_dir}) failed: {e}", file=sys.stderr)

    if os.geteuid() == 0:
        _chown_tree(upload_dir, APP_UID, APP_GID)
        os.setgid(APP_GID)
        os.setuid(APP_UID)

    port = os.environ.get("PORT", "8080")
    os.execvp(
        "uvicorn",
        ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", port],
    )


if __name__ == "__main__":
    main()
