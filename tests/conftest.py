import sys
from unittest.mock import MagicMock

# Mock homeassistant modules if not installed
for mod in [
    "homeassistant",
    "homeassistant.core",
    "homeassistant.config_entries",
    "homeassistant.components",
    "homeassistant.components.http",
    "homeassistant.components.frontend",
    "homeassistant.components.websocket_api",
    "homeassistant.helpers",
    "homeassistant.helpers.aiohttp_client",
    "homeassistant.helpers.update_coordinator",
    "homeassistant.exceptions",
    "voluptuous",
]:
    if mod not in sys.modules:
        sys.modules[mod] = MagicMock()
