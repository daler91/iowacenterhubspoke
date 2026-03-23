from typing import List, Dict, Any
import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(
            f"WebSocket connected. Total connections: {len(self.active_connections)}"  # noqa: E501
        )

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(
                f"WebSocket disconnected. Total connections: {len(self.active_connections)}"  # noqa: E501
            )

    async def broadcast(self, message: Dict[str, Any]):
        """Broadcasts a JSON message to all connected clients."""
        logger.info(
            f"Broadcasting to {len(self.active_connections)} clients: {message}"  # noqa: E501
        )
        disconnected_clients = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to a client, marking for removal: {e}")  # noqa: E501
                disconnected_clients.append(connection)

        # Cleanup failed connections
        for conn in disconnected_clients:
            self.disconnect(conn)


manager = ConnectionManager()
