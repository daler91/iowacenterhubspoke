with open("backend/routers/schedules.py", "r") as f:
    text = f.read()
text = text.replace('f"Missing required columns. File must have headers: date, start_time, end_time, employee_email, location_name"',
                    '"Missing required columns. File must have headers: date, start_time, end_time, employee_email, location_name"')
with open("backend/routers/schedules.py", "w") as f:
    f.write(text)
