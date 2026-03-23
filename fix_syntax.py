with open("backend/routers/schedules.py", "r") as f:
    lines = f.readlines()

with open("backend/routers/schedules.py", "w") as f:
    for line in lines:
        if "detail=f\\\"Missing" in line:
            f.write("            detail=f\"Missing required columns. File must have headers: date, start_time, end_time, employee_email, location_name\"\n")
        else:
            f.write(line)
