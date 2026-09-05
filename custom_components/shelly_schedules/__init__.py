"""Shelly Schedules Custom Component for Home Assistant."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import ShellySchedulesCoordinator
from .panel import async_register_panel, async_unregister_panel
from .services import async_setup_services, async_unload_services
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Shelly Schedules from a config entry."""
    coordinator = ShellySchedulesCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # Register services
    async_setup_services(hass, coordinator)

    # Register websocket API commands
    async_register_websocket_api(hass, coordinator)

    # Register sidebar panel and static frontend assets
    await async_register_panel(hass)

    entry.async_on_unload(entry.add_update_listener(update_listener))

    _LOGGER.info("Shelly Schedules integration loaded successfully")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    hass.data[DOMAIN].pop(entry.entry_id, None)

    # Unregister services if no other entries exist
    if not hass.data[DOMAIN]:
        async_unload_services(hass)
        async_unregister_panel(hass)
        hass.data.pop(DOMAIN, None)

    return True


async def update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle options update."""
    await hass.config_entries.async_reload(entry.entry_id)
