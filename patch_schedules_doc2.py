with open("backend/routers/schedules.py", "r") as f:
    content = f.read()

# Fix the specific F821 undefined name 'doc'
content = content.replace(
    'await manager.broadcast({"event": "SCHEDULE_CREATED", "schedule_id": doc["id"]})',
    'await manager.broadcast({"event": "SCHEDULE_CREATED", "schedule_id": doc["id"]})'
)
# Wait, F821 undefined name 'doc' on line 339, 573, 599, 635, 694, 944, 968, 997, 1035? Wait, let me check where they are!

import sys
lines = content.splitlines()
for i, line in enumerate(lines):
    if "doc" in line and "manager.broadcast" in line:
        print(f"Line {i+1}: {line}")
