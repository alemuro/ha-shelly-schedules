"""DataUpdateCoordinator for Shelly Schedules."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .api import ShellyDeviceClient
from .const import (
    CONF_DISCOVER_CORE_SHELLY,
    CONF_HOST,
    CONF_MANUAL_DEVICES,
    CONF_NAME,
    CONF_PASSWORD,
    CONF_PORT,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


class ShellySchedulesCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator to manage polling and schedule synchronization."""

    def __init__(self, hass: HomeAssistant, entry: Any) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )
        self.entry = entry
        self.devices: dict[str, ShellyDeviceClient] = {}
        self.session = async_get_clientsession(hass)

    async def _async_discover_devices(self) -> None:
        """Discover Shelly devices from core Shelly integration and manual config."""
        options = self.entry.options or self.entry.data

        # 1. Discover from official 'shelly' integration
        if options.get(CONF_DISCOVER_CORE_SHELLY, True):
            core_entries = self.hass.config_entries.async_entries("shelly")
            for core_entry in core_entries:
                host = core_entry.data.get("host")
                if not host:
                    continue
                dev_id = core_entry.unique_id or host
                if dev_id not in self.devices:
                    password = core_entry.data.get("password")
                    name = core_entry.title or host
                    client = ShellyDeviceClient(
                        session=self.session,
                        host=host,
                        name=name,
                        password=password,
                    )
                    await client.async_detect_device()
                    self.devices[dev_id] = client

        # 2. Manual devices configured in options
        manual_devices = options.get(CONF_MANUAL_DEVICES, [])
        for dev in manual_devices:
            host = dev.get(CONF_HOST)
            if not host:
                continue
            dev_id = f"manual_{host}"
            if dev_id not in self.devices:
                client = ShellyDeviceClient(
                    session=self.session,
                    host=host,
                    name=dev.get(CONF_NAME, host),
                    password=dev.get(CONF_PASSWORD),
                    port=dev.get(CONF_PORT, 80),
                )
                await client.async_detect_device()
                self.devices[dev_id] = client

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch schedules from all connected Shelly devices."""
        await self._async_discover_devices()

        if not self.devices:
            _LOGGER.debug("No Shelly devices discovered or configured yet")
            return {}

        results: dict[str, Any] = {}

        async def _fetch_device(dev_id: str, client: ShellyDeviceClient):
            try:
                schedules = await client.async_get_schedules()
                results[dev_id] = {
                    "id": dev_id,
                    "name": client.name,
                    "host": client.host,
                    "generation": client.generation,
                    "model": client.model,
                    "schedules": [s.to_dict() for s in schedules],
                }
            except Exception as err:
                _LOGGER.warning("Error fetching schedules from Shelly at %s: %s", client.host, err)
                results[dev_id] = {
                    "id": dev_id,
                    "name": client.name,
                    "host": client.host,
                    "generation": client.generation,
                    "model": client.model,
                    "schedules": [],
                    "error": str(err),
                }

        tasks = [_fetch_device(d_id, client) for d_id, client in self.devices.items()]
        await asyncio.gather(*tasks)

        return results

    def get_client(self, identifier: str) -> ShellyDeviceClient | None:
        """Find device client by id, host, or name."""
        if identifier in self.devices:
            return self.devices[identifier]
        for _dev_id, client in self.devices.items():
            if client.host == identifier or client.name == identifier:
                return client
        return None
