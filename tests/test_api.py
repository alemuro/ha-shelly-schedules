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


@pytest.mark.asyncio
async def test_gen2_toggle_schedule():
    """Test toggling a schedule preserves job parameters in Gen 2."""
    session = MagicMock()
    client = ShellyDeviceClient(session=session, host="192.168.1.50")
    client.generation = SHELLY_GEN_2

    jobs_response = {
        "jobs": [
            {
                "id": 5,
                "enable": True,
                "timespec": "0 0 9 * * SUN",
                "calls": [{"method": "Switch.Set", "params": {"id": 0, "on": True}}],
            }
        ]
    }

    async def rpc_mock(method, params=None):
        if method == "Schedule.List":
            return jobs_response
        if method == "Schedule.Update":
            return {"rev": 2}
        return {}

    with patch.object(client, "_async_rpc_call", side_effect=rpc_mock) as mock_rpc:
        result = await client.async_toggle_schedule(schedule_id=5, enabled=False, channel=0)
        assert result == {"rev": 2}
        # Verify Schedule.Update was called with preserved timespec and calls
        update_calls = [c for c in mock_rpc.call_args_list if c[0][0] == "Schedule.Update"]
        assert len(update_calls) == 1
        update_params = update_calls[0][0][1]
        assert update_params["id"] == 5
        assert update_params["enable"] is False
        assert update_params["timespec"] == "0 0 9 * * SUN"
        assert update_params["calls"] == jobs_response["jobs"][0]["calls"]


@pytest.mark.asyncio
async def test_gen1_toggle_schedule():
    """Test toggling a schedule in Gen 1 preserves rules and updates master flag."""
    session = MagicMock()
    client = ShellyDeviceClient(session=session, host="192.168.1.60")
    client.generation = SHELLY_GEN_1

    current_settings = {
        "schedule": True,
        "schedule_rules": ["0800-0123456-on"],
    }

    post_mock = AsyncMock(return_value={"schedule": False})
    with (
        patch.object(
            client, "_async_gen1_get_relay_settings", new=AsyncMock(return_value=current_settings)
        ),
        patch.object(client, "_async_gen1_post_relay_settings", new=post_mock),
    ):
        await client.async_toggle_schedule(schedule_id="0_0", enabled=False, channel=0)
        post_mock.assert_called_once_with(
            0,
            {
                "schedule": "false",
                "schedule_rules": "0800-0123456-on",
            },
        )


@pytest.mark.asyncio
async def test_shelly_pro_lowercase_method_parsing():
    """Test parsing real Shelly Pro RPC schedules with lowercase switch.set."""
    session = MagicMock()
    client = ShellyDeviceClient(session=session, host="192.168.10.50", name="Shelly Pro 1PM")
    client.generation = SHELLY_GEN_2

    real_shelly_jobs = {
        "jobs": [
            {
                "id": 1,
                "enable": True,
                "timespec": "0 0 16 * * 0,1,2,3,4,5,6",
                "calls": [{"method": "switch.set", "params": {"on": True, "id": 0}}],
            },
            {
                "id": 2,
                "enable": True,
                "timespec": "0 0 19 * * 0,1,2,3,4,5,6",
                "calls": [{"method": "switch.set", "params": {"on": False, "id": 0}}],
            },
        ]
    }

    with patch.object(client, "_async_rpc_call", new=AsyncMock(return_value=real_shelly_jobs)):
        schedules = await client.async_get_schedules()
        assert len(schedules) == 2
        assert schedules[0].action == "on"
        assert schedules[0].time_str == "16:00"
        assert schedules[0].days == [0, 1, 2, 3, 4, 5, 6]
        assert schedules[1].action == "off"
        assert schedules[1].time_str == "19:00"
        assert schedules[1].days == [0, 1, 2, 3, 4, 5, 6]


def test_parse_cron_dow():
    """Test parse_cron_dow helper handles all cron representations."""
    from custom_components.shelly_schedules.api import parse_cron_dow

    # Wildcards and empty
    assert parse_cron_dow("*") == [0, 1, 2, 3, 4, 5, 6]
    assert parse_cron_dow("") == [0, 1, 2, 3, 4, 5, 6]

    # Explicit day names
    assert parse_cron_dow("SUN,MON,TUE,WED,THU,FRI,SAT") == [0, 1, 2, 3, 4, 5, 6]
    assert parse_cron_dow("MON,WED,FRI") == [1, 3, 5]

    # Ranges
    assert parse_cron_dow("0-6") == [0, 1, 2, 3, 4, 5, 6]
    assert parse_cron_dow("SUN-SAT") == [0, 1, 2, 3, 4, 5, 6]
    assert parse_cron_dow("MON-FRI") == [1, 2, 3, 4, 5]
    assert parse_cron_dow("1-5") == [1, 2, 3, 4, 5]

    # Numeric with 7 as Sunday
    assert parse_cron_dow("7") == [0]
    assert parse_cron_dow("0,1,2,3,4,5,6") == [0, 1, 2, 3, 4, 5, 6]


@pytest.mark.asyncio
async def test_gen2_all_days_create_and_parse():
    """Test that all days creates explicit day names and parses them correctly."""
    session = MagicMock()
    client = ShellyDeviceClient(session=session, host="192.168.1.50")
    client.generation = SHELLY_GEN_2

    rpc_mock = AsyncMock(return_value={"id": 10, "rev": 1})
    with patch.object(client, "_async_rpc_call", new=rpc_mock):
        # Create schedule with all 7 days
        await client.async_create_schedule(
            time_str="08:00",
            action="on",
            days=[0, 1, 2, 3, 4, 5, 6],
            channel=0,
            time_type="time",
            enabled=True,
        )
        rpc_mock.assert_called_once()
        params = rpc_mock.call_args[0][1]
        # Must send explicit day names so Shelly UI shows all days checked!
        assert params["timespec"] == "0 0 8 * * SUN,MON,TUE,WED,THU,FRI,SAT"

    # Now verify reading back schedules with various all-days formats
    jobs_sample = {
        "jobs": [
            {
                "id": 11,
                "enable": True,
                "timespec": "0 0 8 * * *",  # Asterisk format
                "calls": [{"method": "Switch.Set", "params": {"id": 0, "on": True}}],
            },
            {
                "id": 12,
                "enable": True,
                "timespec": "0 0 9 * * 0-6",  # Range format
                "calls": [{"method": "Switch.Set", "params": {"id": 0, "on": False}}],
            },
            {
                "id": 13,
                "enable": True,
                "timespec": "@sunrise * * SUN,MON,TUE,WED,THU,FRI,SAT",  # Sunrise with days
                "calls": [{"method": "Switch.Set", "params": {"id": 0, "on": True}}],
            },
        ]
    }
    with patch.object(client, "_async_rpc_call", new=AsyncMock(return_value=jobs_sample)):
        scheds = await client.async_get_schedules()
        assert len(scheds) == 3
        assert scheds[0].days == [0, 1, 2, 3, 4, 5, 6]
        assert scheds[1].days == [0, 1, 2, 3, 4, 5, 6]
        assert scheds[2].days == [0, 1, 2, 3, 4, 5, 6]

