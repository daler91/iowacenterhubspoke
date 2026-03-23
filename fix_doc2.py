with open("backend/routers/schedules.py", "r") as f:
    text = f.read()

# I need to insert `await manager.broadcast({"event": "SCHEDULE_CREATED", "schedule_id": doc["id"]})`
# inside `_handle_single_schedule`.
# Let's locate:
target = """
    class_label = f" for {class_doc['name']}" if class_doc else ""
    await log_activity(
        action="schedule_created",
"""
replacement = """
    class_label = f" for {class_doc['name']}" if class_doc else ""
    await manager.broadcast({"event": "SCHEDULE_CREATED", "schedule_id": doc["id"]})
    await log_activity(
        action="schedule_created",
"""
text = text.replace(target, replacement, 1)

with open("backend/routers/schedules.py", "w") as f:
    f.write(text)
