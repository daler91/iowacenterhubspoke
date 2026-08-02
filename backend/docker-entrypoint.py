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


def _forwarded_allow_ips(environ: dict) -> str:
    """Which peer IPs uvicorn should trust ``X-Forwarded-For`` from.

    Rate limiting and brute-force lockouts key on ``request.client.host``.
    uvicorn only rewrites that from ``X-Forwarded-For`` when the immediate TCP
    peer is trusted; its default (``127.0.0.1``) trusts nobody behind a proxy,
    so every request would share the proxy's single IP — collapsing all
    per-IP limits into one global bucket and letting one client's failed
    logins lock out the whole app.

    Precedence:
      * an explicit ``FORWARDED_ALLOW_IPS`` always wins (operator override);
      * on Railway the container is reachable only through Railway's edge
        proxy, so the immediate peer is always that proxy — trust it (``*``);
      * otherwise (direct-publish compose, local dev) keep the safe default
        that refuses spoofable forwarded headers from arbitrary clients.
    """
    explicit = environ.get("FORWARDED_ALLOW_IPS")
    if explicit:
        return explicit
    on_railway = bool(
        environ.get("RAILWAY_ENVIRONMENT") or environ.get("RAILWAY_DEPLOYMENT_ID")
    )
    return "*" if on_railway else "127.0.0.1"


def _uvicorn_argv(environ: dict) -> list[str]:
    """Build the uvicorn argv, including proxy-header trust configuration."""
    port = environ.get("PORT", "8080")
    # ``--timeout-graceful-shutdown 15`` gives uvicorn 15s to drain in-flight
    # requests when SIGTERM arrives (Railway/Heroku send SIGTERM then SIGKILL
    # ~30s later). Without it, bulk-import or project-create requests can be
    # killed mid-write. ``--proxy-headers`` + ``--forwarded-allow-ips`` make
    # per-IP rate limiting see the real client behind Railway's proxy.
    return [
        "uvicorn", "server:app",
        "--host", "0.0.0.0",
        "--port", port,
        "--timeout-graceful-shutdown", "15",
        "--proxy-headers",
        "--forwarded-allow-ips", _forwarded_allow_ips(environ),
    ]


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
        # Clear inherited supplementary groups (e.g. root group 0)
        # before dropping primary gid/uid.
        os.setgroups([])
        os.setgid(APP_GID)
        os.setuid(APP_UID)
        # Belt-and-braces: if setuid silently failed (no error raised but
        # we're still root), refuse to exec uvicorn rather than serving
        # the API as root. setuid(0→nonzero) cannot be undone, so a true
        # success leaves us with effective uid != 0.
        if os.geteuid() == 0:
            print(
                "entrypoint: fatal: failed to drop privileges "
                f"(still euid=0 after setuid({APP_UID}))",
                file=sys.stderr,
            )
            sys.exit(1)

    os.execvp("uvicorn", _uvicorn_argv(os.environ))


if __name__ == "__main__":
    main()
