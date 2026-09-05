"""Config flow for Shelly Schedules integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    CONF_DISCOVER_CORE_SHELLY,
    DEFAULT_NAME,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


class ShellySchedulesConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Shelly Schedules."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle the initial step."""
        # Only allow a single instance
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(title=DEFAULT_NAME, data=user_input)

        schema = vol.Schema(
            {
                vol.Required(CONF_DISCOVER_CORE_SHELLY, default=True): bool,
            }
        )

        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Get the options flow handler."""
        return ShellySchedulesOptionsFlowHandler(config_entry)


class ShellySchedulesOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle Shelly Schedules options."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            current_options = dict(self.config_entry.options)
            current_options.update(user_input)
            return self.async_create_entry(title="", data=current_options)

        options = self.config_entry.options or self.config_entry.data
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_DISCOVER_CORE_SHELLY,
                    default=options.get(CONF_DISCOVER_CORE_SHELLY, True),
                ): bool,
            }
        )

        return self.async_show_form(step_id="init", data_schema=schema)
