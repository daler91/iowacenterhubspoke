with open("backend/routers/schedules.py", "r") as f:
    text = f.read()
text = text.replace("except Exception as e:", "except Exception:")
with open("backend/routers/schedules.py", "w") as f:
    f.write(text)
