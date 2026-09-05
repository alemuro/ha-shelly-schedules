"""Panel and static view registration for Shelly Schedules."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import FRONTEND_URL_PATH, URL_FRONTEND

_LOGGER = logging.getLogger(__name__)


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the custom sidebar panel and static files."""
    frontend_path = Path(__file__).parent / "frontend"

    # Register static path for frontend JS
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                URL_FRONTEND,
                str(frontend_path),
                cache_headers=False,
            )
        ]
    )

    # Register custom sidebar panel
    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="Shelly Schedules",
        sidebar_icon="mdi:calendar-clock",
        frontend_url_path=FRONTEND_URL_PATH,
        config={
            "_panel_custom": {
                "name": "shelly-schedules-panel",
                "module_url": f"{URL_FRONTEND}/shelly-schedules-card.js",
                "embed_iframe": False,
                "trust_external": False,
            }
        },
        require_admin=False,
    )


def async_unregister_panel(hass: HomeAssistant) -> None:
    """Unregister the custom sidebar panel."""
    frontend.async_remove_panel(hass, FRONTEND_URL_PATH)
