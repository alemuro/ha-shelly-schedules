"""Unit tests for Shelly API parsing and scheduling logic."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.shelly_schedules.api import (
    ShellyDeviceClient,
)
from custom_components.shelly_schedules.const import SHELLY_GEN_1, SHELLY_GEN_2


@pytest.mark.asyncio
async def test_gen2_schedule_parsing():
    """Test parsing Gen 2 RPC schedules."""
    session = MagicMock()
    client = ShellyDeviceClient(session=session, host="192.168.1.50", name="Test Shelly Plus")
    client.generation = SHELLY_GEN_2

    sample_rpc_jobs = {
        "jobs": [
            {
                "id": 1,
                "enable": True,
                "timespec": "0 30 8 * * MON,WED,FRI",
                "calls": [
                    {
                        "method": "Switch.Set",
                        "params": {"id": 0, "on": True},
                    }
                ],
            },
            {
                "id": 2,
                "enable": False,
                "timespec": "@sunset-15m",
                "calls": [
                    {
                        "method": "Switch.Set",
                        "params": {"id": 1, "on": False},
                    }
                ],
            },
        ]
    }

    with patch.object(client, "_async_rpc_call", new=AsyncMock(return_value=sample_rpc_jobs)):
        schedules = await client.async_get_schedules()
        assert len(schedules) == 2

        s1 = schedules[0]
        assert s1.id == 1
        assert s1.enabled is True
        assert s1.time_str == "08:30"
        assert s1.action == "on"
        assert s1.channel == 0
        assert 1 in s1.days  # Monday
        assert 3 in s1.days  # Wednesday
        assert 5 in s1.days  # Friday

        s2 = schedules[1]
        assert s2.id == 2
        assert s2.enabled is False
        assert s2.time_type == "sunset"
        assert s2.time_str == "@sunset-15m"
        assert s2.action == "off"
        assert s2.channel == 1


@pytest.mark.asyncio
async def test_gen1_schedule_parsing():
    """Test parsing Gen 1 REST rules."""
    session = MagicMock()
    client = ShellyDeviceClient(session=session, host="192.168.1.60", name="Test Shelly 1")
    client.generation = SHELLY_GEN_1

    sample_relay_settings = {
        "schedule": True,
        "schedule_rules": [
            "0830-0123456-on",
            "sunset+20-12345-off",
        ],
    }

    async def mock_get_relay(channel):
        if channel == 0:
            return sample_relay_settings
        return None

    with patch.object(client, "_async_gen1_get_relay_settings", side_effect=mock_get_relay):
        schedules = await client.async_get_schedules()
        assert len(schedules) == 2

        s1 = schedules[0]
        assert s1.id == "0_0"
        assert s1.channel == 0
        assert s1.enabled is True
        assert s1.time_str == "08:30"
        assert s1.action == "on"
        assert s1.days == [0, 1, 2, 3, 4, 5, 6]

        s2 = schedules[1]
        assert s2.id == "0_1"
        assert s2.time_type == "sunset"
        assert s2.action == "off"
        assert s2.days == [1, 2, 3, 4, 5]


@pytest.mark.asyncio
async def test_gen2_create_schedule():
    """Test schedule creation for Gen 2."""
    session = MagicMock()
    client = ShellyDeviceClient(session=session, host="192.168.1.50")
    client.generation = SHELLY_GEN_2

    rpc_mock = AsyncMock(return_value={"id": 3, "rev": 1})
    with patch.object(client, "_async_rpc_call", new=rpc_mock):
        result = await client.async_create_schedule(
            time_str="07:15",
            action="on",
            days=[1, 2, 3, 4, 5],
            channel=0,
            time_type="time",
            enabled=True,
        )

        assert result["id"] == 3
        rpc_mock.assert_called_once()
        args = rpc_mock.call_args[0]
        assert args[0] == "Schedule.Create"
        params = args[1]
        assert params["enable"] is True
        assert params["timespec"] == "0 15 7 * * MON,TUE,WED,THU,FRI"
        assert params["calls"][0]["method"] == "Switch.Set"
        assert params["calls"][0]["params"] == {"id": 0, "on": True}
