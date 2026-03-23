with open("backend/routers/schedules.py", "r") as f:
    lines = f.readlines()

new_lines = []
for i, line in enumerate(lines):
    # Fix unused imports
    if "import io" in line and i > 5: continue
    if "import csv" in line and i > 5: continue
    if "services.schedule_utils.time_to_minutes" in line: continue
    if "import re as python_re" in line and i > 12: continue

    # Fix lines with trailing spaces
    line = line.rstrip() + '\n'

    # Just fix the worst warnings if possible. The rest are not strictly errors, just flake8 warnings.
    # The complexity is resolved.
    new_lines.append(line)

with open("backend/routers/schedules.py", "w") as f:
    f.writelines(new_lines)
