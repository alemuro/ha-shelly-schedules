"""WebSocket API handlers for Shelly Schedules."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .coordinator import ShellySchedulesCoordinator

_LOGGER = logging.getLogger(__name__)


def async_register_websocket_api(
    hass: HomeAssistant, coordinator: ShellySchedulesCoordinator
) -> None:
    """Register WebSocket handlers for the frontend UI."""

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "shelly_schedules/list",
        }
    )
    @websocket_api.async_response
    async def ws_get_schedules(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        """Handle listing all Shelly devices and their schedules."""
        if not coordinator.data:
            await coordinator.async_refresh()
        connection.send_result(msg["id"], {"devices": coordinator.data})

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "shelly_schedules/refresh",
        }
    )
    @websocket_api.async_response
    async def ws_refresh(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        """Force refresh schedules from all Shelly devices."""
        await coordinator.async_refresh()
        connection.send_result(msg["id"], {"devices": coordinator.data})

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "shelly_schedules/create",
            vol.Required("device"): str,
            vol.Required("time"): str,
            vol.Required("action"): vol.In(["on", "off"]),
            vol.Optional("days", default=[0, 1, 2, 3, 4, 5, 6]): [vol.Coerce(int)],
            vol.Optional("channel", default=0): vol.Coerce(int),
            vol.Optional("time_type", default="time"): str,
            vol.Optional("enabled", default=True): bool,
        }
    )
    @websocket_api.async_response
    async def ws_create_schedule(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        """Handle schedule creation."""
        device = msg["device"]
        client = coordinator.get_client(device)
        if not client:
            connection.send_error(msg["id"], "device_not_found", f"Device '{device}' not found.")
            return

        try:
            result = await client.async_create_schedule(
                time_str=msg["time"],
                action=msg["action"],
                days=msg["days"],
                channel=msg["channel"],
                time_type=msg["time_type"],
                enabled=msg["enabled"],
            )
            await coordinator.async_request_refresh()
            connection.send_result(msg["id"], {"success": True, "result": result})
        except Exception as err:
            connection.send_error(msg["id"], "creation_failed", str(err))

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "shelly_schedules/update",
            vol.Required("device"): str,
            vol.Required("schedule_id"): vol.Any(int, str),
            vol.Required("time"): str,
            vol.Required("action"): vol.In(["on", "off"]),
            vol.Optional("days", default=[0, 1, 2, 3, 4, 5, 6]): [vol.Coerce(int)],
            vol.Optional("channel", default=0): vol.Coerce(int),
            vol.Optional("time_type", default="time"): str,
            vol.Optional("enabled", default=True): bool,
        }
    )
    @websocket_api.async_response
    async def ws_update_schedule(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        """Handle schedule update."""
        device = msg["device"]
        client = coordinator.get_client(device)
        if not client:
            connection.send_error(msg["id"], "device_not_found", f"Device '{device}' not found.")
            return

        try:
            result = await client.async_update_schedule(
                schedule_id=msg["schedule_id"],
                time_str=msg["time"],
                action=msg["action"],
                days=msg["days"],
                channel=msg["channel"],
                time_type=msg["time_type"],
                enabled=msg["enabled"],
            )
            await coordinator.async_request_refresh()
            connection.send_result(msg["id"], {"success": True, "result": result})
        except Exception as err:
            connection.send_error(msg["id"], "update_failed", str(err))

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "shelly_schedules/delete",
            vol.Required("device"): str,
            vol.Required("schedule_id"): vol.Any(int, str),
            vol.Optional("channel", default=0): vol.Coerce(int),
        }
    )
    @websocket_api.async_response
    async def ws_delete_schedule(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        """Handle schedule deletion."""
        device = msg["device"]
        client = coordinator.get_client(device)
        if not client:
            connection.send_error(msg["id"], "device_not_found", f"Device '{device}' not found.")
            return

        try:
            result = await client.async_delete_schedule(
                schedule_id=msg["schedule_id"], channel=msg["channel"]
            )
            await coordinator.async_request_refresh()
            connection.send_result(msg["id"], {"success": True, "result": result})
        except Exception as err:
            connection.send_error(msg["id"], "delete_failed", str(err))

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "shelly_schedules/toggle",
            vol.Required("device"): str,
            vol.Required("schedule_id"): vol.Any(int, str),
            vol.Required("enabled"): bool,
            vol.Optional("channel", default=0): vol.Coerce(int),
        }
    )
    @websocket_api.async_response
    async def ws_toggle_schedule(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        """Handle schedule toggle."""
        device = msg["device"]
        client = coordinator.get_client(device)
        if not client:
            connection.send_error(msg["id"], "device_not_found", f"Device '{device}' not found.")
            return

        try:
            result = await client.async_toggle_schedule(
                schedule_id=msg["schedule_id"], enabled=msg["enabled"], channel=msg["channel"]
            )
            # Optimistically update in-memory coordinator cache
            dev_data = coordinator.data.get(device) if coordinator.data else None
            if not dev_data and coordinator.data:
                for v in coordinator.data.values():
                    if v.get("host") == device or v.get("name") == device:
                        dev_data = v
                        break
            if dev_data and "schedules" in dev_data:
                for s in dev_data["schedules"]:
                    if str(s.get("id")) == str(msg["schedule_id"]):
                        s["enabled"] = msg["enabled"]

            await coordinator.async_refresh()
            connection.send_result(
                msg["id"], {"success": True, "result": result, "devices": coordinator.data}
            )
        except Exception as err:
            connection.send_error(msg["id"], "toggle_failed", str(err))

    websocket_api.async_register_command(hass, ws_get_schedules)
    websocket_api.async_register_command(hass, ws_refresh)
    websocket_api.async_register_command(hass, ws_create_schedule)
    websocket_api.async_register_command(hass, ws_update_schedule)
    websocket_api.async_register_command(hass, ws_delete_schedule)
    websocket_api.async_register_command(hass, ws_toggle_schedule)
