with open("backend/routers/schedules.py", "r") as f:
    content = f.read()

import re

# Fix line 812 syntax error (the string replacement added escape characters back in accidentally)
content = re.sub(
    r'detail=f\\"Missing required columns: \{.*',
    r'detail=f"Missing columns: {','.join(missing)}. Required headers: date, start_time, end_time, employee_email, location_name"',
    content
)

# And fix line 729 which had the cognitive complexity issue.
# We actually just extracted logic to _validate_import_row. Let's make sure that's working.
with open("backend/routers/schedules.py", "w") as f:
    f.write(content)
