with open("backend/routers/schedules.py", "r") as f:
    text = f.read()
text = text.replace("time_to_minutes,", "")
with open("backend/routers/schedules.py", "w") as f:
    f.write(text)

with open("backend/core/websocket.py", "r") as f:
    text = f.read()
text = text.replace("from fastapi import WebSocket, WebSocketDisconnect", "from fastapi import WebSocket")
with open("backend/core/websocket.py", "w") as f:
    f.write(text)

with open("backend/server.py", "r") as f:
    text = f.read()
text = text.replace("import logging\n", "")
with open("backend/server.py", "w") as f:
    f.write(text)
