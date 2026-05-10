#!/usr/bin/env python3
"""Worker entrypoint: drop privileges, then exec arq worker."""

from __future__ import annotations

import os
import sys

APP_UID = 1001
APP_GID = 1001


def main() -> None:
    if os.geteuid() == 0:
        # Clear any inherited supplementary groups (including root's)
        # before switching the primary gid/uid.
        os.setgroups([])
        os.setgid(APP_GID)
        os.setuid(APP_UID)
        if os.geteuid() == 0:
            print(
                "entrypoint: fatal: failed to drop privileges "
                f"(still euid=0 after setuid({APP_UID}))",
                file=sys.stderr,
            )
            sys.exit(1)

    os.execvp("arq", ["arq", "worker.WorkerSettings"])


if __name__ == "__main__":
    main()
