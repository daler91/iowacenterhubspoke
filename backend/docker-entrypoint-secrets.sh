#!/bin/sh
# Read Docker secret files and export them as the plain env var the app
# actually reads. Called from docker-compose.prod.yml so production can
# mount secrets without invasive per-reader changes in the app.
#
# For every FOO_FILE env var that points to a readable file, export
# FOO=<contents> (unless FOO is already set). Then exec the command
# passed as arguments.
#
# usage (from Dockerfile ENTRYPOINT or compose command):
#     /app/docker-entrypoint-secrets.sh uvicorn server:app --host 0.0.0.0

set -eu

for file_var in $(env | awk -F= '/_FILE=/{print $1}'); do
    plain_var=${file_var%_FILE}
    file_path=$(printenv "$file_var")
    # Skip if the plain var is already set (explicit env wins) or the
    # file doesn't exist (optional secret).
    if [ -z "$(printenv "$plain_var" 2>/dev/null || true)" ] && [ -r "$file_path" ]; then
        export "$plain_var=$(cat "$file_path")"
    fi
done

exec "$@"
