import re
with open("backend/routers/schedules.py", "r") as f:
    text = f.read()

# Revert my bad replace
text = text.replace("await manager.broadcast({\"event\": \"SCHEDULE_CREATED\", \"schedule_id\": doc[\"id\"]})\n    await log_activity(", "await log_activity(")
text = text.replace("await manager.broadcast({\"event\": \"SCHEDULE_CREATED\", \"schedule_id\": doc[\"id\"]})\n        await log_activity(", "        await log_activity(")

# Now put it back ONLY where it belongs!
# Specifically inside _handle_single_schedule, right before log_activity
# I'll find `class_label = f" for {class_doc['name']}" if class_doc else ""` and insert after.

def replace_first(text, search, replace):
    return text.replace(search, replace, 1)

with open("backend/routers/schedules.py", "w") as f:
    f.write(text)
