import asyncio
import websockets
import json
import logging

logging.basicConfig(level=logging.INFO)

async def test():
    # Connect with a fake token. Note that the authentication backend test will fail if mongo is down,
    # but let's see what happens.
    pass

# We already ran the unit tests for websocket manager
