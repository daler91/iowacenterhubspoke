import pytest
from core.websocket import ConnectionManager
from fastapi import WebSocket

class MockWebSocket:
    def __init__(self):
        self.accepted = False
        self.closed = False
        self.sent_messages = []

    async def accept(self):
        self.accepted = True

    async def close(self, code=1000, reason=""):
        self.closed = True

    async def send_json(self, data):
        self.sent_messages.append(data)


@pytest.mark.asyncio
async def test_connection_manager():
    manager = ConnectionManager()
    ws1 = MockWebSocket()
    ws2 = MockWebSocket()

    await manager.connect(ws1)
    await manager.connect(ws2)

    assert len(manager.active_connections) == 2
    assert ws1.accepted
    assert ws2.accepted

    await manager.broadcast({"event": "TEST"})

    assert len(ws1.sent_messages) == 1
    assert ws1.sent_messages[0] == {"event": "TEST"}
    assert len(ws2.sent_messages) == 1
    assert ws2.sent_messages[0] == {"event": "TEST"}

    manager.disconnect(ws1)
    assert len(manager.active_connections) == 1
    assert ws1 not in manager.active_connections
