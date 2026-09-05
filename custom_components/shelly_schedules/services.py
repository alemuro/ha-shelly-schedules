"""Service handlers for Shelly Schedules."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError

from .const import (
    DOMAIN,
    SERVICE_CREATE_SCHEDULE,
    SERVICE_DELETE_SCHEDULE,
    SERVICE_GET_SCHEDULES,
    SERVICE_TOGGLE_SCHEDULE,
    SERVICE_UPDATE_SCHEDULE,
)
from .coordinator import ShellySchedulesCoordinator

_LOGGER = logging.getLogger(__name__)

SCHEMA_GET_SCHEDULES = vol.Schema(
    {
        vol.Optional("device"): str,
    }
)

SCHEMA_CREATE_SCHEDULE = vol.Schema(
    {
        vol.Required("device"): str,
        vol.Required("time"): str,
        vol.Required("action"): vol.In(["on", "off"]),
        vol.Optional("days", default=[0, 1, 2, 3, 4, 5, 6]): [vol.Coerce(int)],
        vol.Optional("channel", default=0): vol.Coerce(int),
        vol.Optional("time_type", default="time"): vol.In(["time", "sunrise", "sunset", "cron"]),
        vol.Optional("enabled", default=True): bool,
    }
)

SCHEMA_UPDATE_SCHEDULE = vol.Schema(
    {
        vol.Required("device"): str,
        vol.Required("schedule_id"): vol.Any(int, str),
        vol.Required("time"): str,
        vol.Required("action"): vol.In(["on", "off"]),
        vol.Optional("days", default=[0, 1, 2, 3, 4, 5, 6]): [vol.Coerce(int)],
        vol.Optional("channel", default=0): vol.Coerce(int),
        vol.Optional("time_type", default="time"): vol.In(["time", "sunrise", "sunset", "cron"]),
        vol.Optional("enabled", default=True): bool,
    }
)

SCHEMA_DELETE_SCHEDULE = vol.Schema(
    {
        vol.Required("device"): str,
        vol.Required("schedule_id"): vol.Any(int, str),
        vol.Optional("channel", default=0): vol.Coerce(int),
    }
)

SCHEMA_TOGGLE_SCHEDULE = vol.Schema(
    {
        vol.Required("device"): str,
        vol.Required("schedule_id"): vol.Any(int, str),
        vol.Required("enabled"): bool,
        vol.Optional("channel", default=0): vol.Coerce(int),
    }
)


def async_setup_services(hass: HomeAssistant, coordinator: ShellySchedulesCoordinator) -> None:
    """Register Shelly Schedules services."""

    def _get_client_or_raise(device_identifier: str):
        client = coordinator.get_client(device_identifier)
        if not client:
            raise HomeAssistantError(f"Shelly device '{device_identifier}' not found.")
        return client

    async def handle_get_schedules(call: ServiceCall) -> dict[str, Any]:
        """Handle fetching schedules."""
        device = call.data.get("device")
        if device:
            client = _get_client_or_raise(device)
            schedules = await client.async_get_schedules()
            return {"device": device, "schedules": [s.to_dict() for s in schedules]}

        # All devices
        await coordinator.async_refresh()
        return {"devices": coordinator.data}

    async def handle_create_schedule(call: ServiceCall) -> dict[str, Any]:
        """Handle creating a schedule."""
        device = call.data["device"]
        client = _get_client_or_raise(device)
        result = await client.async_create_schedule(
            time_str=call.data["time"],
            action=call.data["action"],
            days=call.data["days"],
            channel=call.data["channel"],
            time_type=call.data["time_type"],
            enabled=call.data["enabled"],
        )
        await coordinator.async_request_refresh()
        return {"result": result}

    async def handle_update_schedule(call: ServiceCall) -> dict[str, Any]:
        """Handle updating a schedule."""
        device = call.data["device"]
        client = _get_client_or_raise(device)
        result = await client.async_update_schedule(
            schedule_id=call.data["schedule_id"],
            time_str=call.data["time"],
            action=call.data["action"],
            days=call.data["days"],
            channel=call.data["channel"],
            time_type=call.data["time_type"],
            enabled=call.data["enabled"],
        )
        await coordinator.async_request_refresh()
        return {"result": result}

    async def handle_delete_schedule(call: ServiceCall) -> dict[str, Any]:
        """Handle deleting a schedule."""
        device = call.data["device"]
        client = _get_client_or_raise(device)
        result = await client.async_delete_schedule(
            schedule_id=call.data["schedule_id"],
            channel=call.data["channel"],
        )
        await coordinator.async_request_refresh()
        return {"result": result}

    async def handle_toggle_schedule(call: ServiceCall) -> dict[str, Any]:
        """Handle toggling a schedule."""
        device = call.data["device"]
        client = _get_client_or_raise(device)
        result = await client.async_toggle_schedule(
            schedule_id=call.data["schedule_id"],
            enabled=call.data["enabled"],
            channel=call.data["channel"],
        )
        await coordinator.async_request_refresh()
        return {"result": result}

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_SCHEDULES,
        handle_get_schedules,
        schema=SCHEMA_GET_SCHEDULES,
        supports_response=SupportsResponse.OPTIONAL,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CREATE_SCHEDULE,
        handle_create_schedule,
        schema=SCHEMA_CREATE_SCHEDULE,
        supports_response=SupportsResponse.OPTIONAL,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_UPDATE_SCHEDULE,
        handle_update_schedule,
        schema=SCHEMA_UPDATE_SCHEDULE,
        supports_response=SupportsResponse.OPTIONAL,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_SCHEDULE,
        handle_delete_schedule,
        schema=SCHEMA_DELETE_SCHEDULE,
        supports_response=SupportsResponse.OPTIONAL,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_TOGGLE_SCHEDULE,
        handle_toggle_schedule,
        schema=SCHEMA_TOGGLE_SCHEDULE,
        supports_response=SupportsResponse.OPTIONAL,
    )


def async_unload_services(hass: HomeAssistant) -> None:
    """Unload Shelly Schedules services."""
    for service in (
        SERVICE_GET_SCHEDULES,
        SERVICE_CREATE_SCHEDULE,
        SERVICE_UPDATE_SCHEDULE,
        SERVICE_DELETE_SCHEDULE,
        SERVICE_TOGGLE_SCHEDULE,
    ):
        hass.services.async_remove(DOMAIN, service)
