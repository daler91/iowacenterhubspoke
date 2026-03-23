with open("backend/routers/schedules.py", "r") as f:
    text = f.read()
text = text.replace("loc_map = {l[\"_id\"]: l for l in locations}", "loc_map = {loc[\"_id\"]: loc for loc in locations}")
with open("backend/routers/schedules.py", "w") as f:
    f.write(text)
