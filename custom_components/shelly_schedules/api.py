"""Shelly API Client supporting Gen 1 (REST) and Gen 2/3/Plus/Pro (RPC)."""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import asdict, dataclass
from typing import Any

import aiohttp

from .const import SHELLY_GEN_1, SHELLY_GEN_2

_LOGGER = logging.getLogger(__name__)

DAY_NAMES_GEN2 = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
DAY_MAP_GEN2_TO_INT = {name: i for i, name in enumerate(DAY_NAMES_GEN2)}

DAY_NAME_MAP = {
    "SUN": 0, "SU": 0, "0": 0, "7": 0,
    "MON": 1, "MO": 1, "1": 1,
    "TUE": 2, "TU": 2, "2": 2,
    "WED": 3, "WE": 3, "3": 3,
    "THU": 4, "TH": 4, "4": 4,
    "FRI": 5, "FR": 5, "5": 5,
    "SAT": 6, "SA": 6, "6": 6,
}


def parse_cron_dow(dow_str: str) -> list[int]:
    """Parse cron day-of-week field into a list of day ints (0=Sun..6=Sat)."""
    if not dow_str or dow_str.strip() in ("*", "?", ""):
        return [0, 1, 2, 3, 4, 5, 6]

    result: set[int] = set()
    for part in dow_str.split(","):
        part = part.strip().upper()
        if not part:
            continue
        if part in ("*", "?"):
            return [0, 1, 2, 3, 4, 5, 6]
        if "-" in part:
            range_parts = part.split("-", 1)
            start_key = range_parts[0].strip()
            end_key = range_parts[1].strip()
            if start_key in DAY_NAME_MAP and end_key in DAY_NAME_MAP:
                start_val = DAY_NAME_MAP[start_key]
                end_val = DAY_NAME_MAP[end_key]
                if start_val <= end_val:
                    for d in range(start_val, end_val + 1):
                        result.add(d % 7)
                else:
                    d = start_val
                    while True:
                        result.add(d % 7)
                        if d % 7 == end_val % 7:
                            break
                        d = (d + 1) % 7
        elif part in DAY_NAME_MAP:
            result.add(DAY_NAME_MAP[part])
        elif part.isdigit():
            result.add(int(part) % 7)

    if not result:
        return [0, 1, 2, 3, 4, 5, 6]

    return sorted(list(result))


@dataclass
class ShellySchedule:
    """Unified representation of a Shelly schedule."""

    id: str | int
    device_id: str
    device_name: str
    host: str
    generation: int
    channel: int
    enabled: bool
    time_type: str  # "time", "sunrise", "sunset", "cron"
    time_str: str  # "08:30", "sunrise+15", or cron timespec
    days: list[int]  # 0=Sun, 1=Mon, ..., 6=Sat
    action: str  # "on", "off"
    raw: Any = None

    def to_dict(self) -> dict[str, Any]:
        """Convert schedule to dictionary."""
        return asdict(self)


class ShellyDeviceClient:
    """Client to communicate with a single Shelly device."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        host: str,
        name: str = "",
        password: str | None = None,
        port: int = 80,
    ) -> None:
        """Initialize client."""
        self.session = session
        self.host = host
        self.name = name or host
        self.password = password
        self.port = port
        self.base_url = f"http://{host}:{port}"
        self.generation: int = SHELLY_GEN_2
        self.device_id: str = host
        self.auth_ha1: str | None = None
        self.nc: int = 0
        self.model: str = ""

    async def async_detect_device(self) -> bool:
        """Detect Shelly generation and basic device information."""
        # Try Gen 2 RPC first
        try:
            url = f"{self.base_url}/rpc/Shelly.GetDeviceInfo"
            async with self.session.get(url, timeout=aiohttp.ClientTimeout(total=4)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.generation = SHELLY_GEN_2
                    self.device_id = data.get("id", self.host)
                    self.name = self.name or data.get("name") or data.get("id", self.host)
                    self.model = data.get("model", "")
                    return True
                elif resp.status == 401:
                    # Gen 2 with authentication required
                    self.generation = SHELLY_GEN_2
                    return True
        except Exception:
            pass

        # Try Gen 1 REST API
        try:
            url = f"{self.base_url}/shelly"
            async with self.session.get(url, timeout=aiohttp.ClientTimeout(total=4)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.generation = SHELLY_GEN_1
                    self.device_id = data.get("mac", self.host)
                    self.name = self.name or data.get("name") or self.device_id
                    self.model = data.get("type", "")
                    return True
                elif resp.status == 401:
                    self.generation = SHELLY_GEN_1
                    return True
        except Exception as err:
            _LOGGER.debug("Failed detecting device at %s: %s", self.host, err)

        return False

    # ------------------------------------------------------------------
    # Gen 2 RPC Handling
    # ------------------------------------------------------------------

    async def _async_rpc_call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Perform an RPC call to a Gen 2/3 device."""
        url = f"{self.base_url}/rpc"
        payload = {"id": 1, "method": method, "params": params or {}}

        auth = None
        if self.password:
            auth = aiohttp.BasicAuth("admin", self.password)

        async with self.session.post(
            url, json=payload, auth=auth, timeout=aiohttp.ClientTimeout(total=8)
        ) as resp:
            if resp.status == 401 and self.password:
                # Handle digest auth for Gen 2 RPC
                auth_header = resp.headers.get("Www-Authenticate", "")
                auth_dict = self._parse_auth_header(auth_header)
                if auth_dict:
                    nc_val = 1
                    cnonce = 12345678
                    uri = "/rpc"
                    ha1 = hashlib.sha256(
                        f"admin:{auth_dict.get('realm', '')}:{self.password}".encode()
                    ).hexdigest()
                    ha2 = hashlib.sha256(f"POST:{uri}".encode()).hexdigest()
                    nonce = auth_dict.get("nonce", "")
                    response_hash = hashlib.sha256(
                        f"{ha1}:{nonce}:{nc_val}:{cnonce}:auth:{ha2}".encode()
                    ).hexdigest()

                    digest_params = {
                        "username": "admin",
                        "realm": auth_dict.get("realm", ""),
                        "nonce": nonce,
                        "uri": uri,
                        "cnonce": cnonce,
                        "response": response_hash,
                        "nc": nc_val,
                    }
                    payload["auth"] = digest_params
                    async with self.session.post(
                        url, json=payload, timeout=aiohttp.ClientTimeout(total=8)
                    ) as resp2:
                        data2 = await resp2.json()
                        if "error" in data2:
                            raise RuntimeError(data2["error"].get("message", "RPC Error"))
                        return data2.get("result")

            data = await resp.json()
            if "error" in data:
                raise RuntimeError(data["error"].get("message", "RPC Error"))
            return data.get("result")

    def _parse_auth_header(self, header: str) -> dict[str, str]:
        """Parse HTTP digest authentication header."""
        out = {}
        for match in re.finditer(r'(\w+)="?([^",]+)"?', header):
            out[match.group(1)] = match.group(2)
        return out

    # ------------------------------------------------------------------
    # Gen 1 REST Handling
    # ------------------------------------------------------------------

    async def _async_gen1_get_relay_settings(self, channel: int = 0) -> dict[str, Any]:
        """Fetch relay settings for a Gen 1 device."""
        url = f"{self.base_url}/settings/relay/{channel}"
        auth = aiohttp.BasicAuth("admin", self.password) if self.password else None
        async with self.session.get(url, auth=auth, timeout=aiohttp.ClientTimeout(total=8)) as resp:
            return await resp.json()

    async def _async_gen1_post_relay_settings(
        self, channel: int, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Update relay settings for a Gen 1 device."""
        url = f"{self.base_url}/settings/relay/{channel}"
        auth = aiohttp.BasicAuth("admin", self.password) if self.password else None
        async with self.session.post(
            url, data=data, auth=auth, timeout=aiohttp.ClientTimeout(total=8)
        ) as resp:
            return await resp.json()

    # ------------------------------------------------------------------
    # Schedule Operations (Unified)
    # ------------------------------------------------------------------

    async def async_get_schedules(self) -> list[ShellySchedule]:
        """Fetch all schedules from the device."""
        if self.generation == SHELLY_GEN_2:
            return await self._async_get_schedules_gen2()
        return await self._async_get_schedules_gen1()

    async def _async_get_schedules_gen2(self) -> list[ShellySchedule]:
        """Fetch Gen 2 RPC schedules."""
        result = await self._async_rpc_call("Schedule.List")
        if not result or "jobs" not in result:
            return []

        schedules: list[ShellySchedule] = []
        for job in result.get("jobs", []):
            job_id = job.get("id")
            enabled = job.get("enable", True)
            timespec = job.get("timespec", "")
            calls = job.get("calls", [])

            # Extract target channel and action
            channel = 0
            action = "toggle"
            for call in calls:
                method = call.get("method", "").lower()
                params = call.get("params", {})
                if any(k in method for k in ("switch", "relay", "light", "output")):
                    channel = params.get("id", 0)
                    on_val = params.get("on")
                    turn_val = str(params.get("turn", "")).lower()
                    if (
                        on_val is True
                        or on_val == 1
                        or str(on_val).lower() == "true"
                        or turn_val == "on"
                    ):
                        action = "on"
                    elif (
                        on_val is False
                        or on_val == 0
                        or str(on_val).lower() == "false"
                        or turn_val == "off"
                    ):
                        action = "off"
                    elif "toggle" in method:
                        action = "toggle"
                elif "toggle" in method:
                    action = "toggle"

            # Parse timespec
            time_type = "time"
            time_str = timespec
            days = [0, 1, 2, 3, 4, 5, 6]

            if timespec.startswith("@sunrise") or timespec.startswith("@sunset"):
                parts = timespec.split()
                time_type = "sunrise" if "sunrise" in parts[0] else "sunset"
                time_str = parts[0]
                if len(parts) >= 2:
                    days = parse_cron_dow(parts[-1])
            else:
                parts = timespec.split()
                if len(parts) >= 6:
                    sec, minute, hour, dom, mon, dow = parts[:6]
                    time_str = f"{int(hour):02d}:{int(minute):02d}"
                    days = parse_cron_dow(dow)
                elif len(parts) == 5:
                    minute, hour, dom, mon, dow = parts[:5]
                    time_str = f"{int(hour):02d}:{int(minute):02d}"
                    days = parse_cron_dow(dow)

            schedules.append(
                ShellySchedule(
                    id=job_id,
                    device_id=self.device_id,
                    device_name=self.name,
                    host=self.host,
                    generation=SHELLY_GEN_2,
                    channel=channel,
                    enabled=enabled,
                    time_type=time_type,
                    time_str=time_str,
                    days=days,
                    action=action,
                    raw=job,
                )
            )
        return schedules

    async def _async_get_schedules_gen1(self) -> list[ShellySchedule]:
        """Fetch Gen 1 schedules across relays."""
        schedules: list[ShellySchedule] = []
        for channel in range(4):  # Check relays 0..3
            try:
                data = await self._async_gen1_get_relay_settings(channel)
                if not data or not isinstance(data, dict):
                    break
                rules = data.get("schedule_rules", [])
                is_schedule_active = data.get("schedule", False)

                for idx, rule in enumerate(rules):
                    # Rule format: HHMM-0123456-on or sunrise+offset-0123456-off
                    parts = rule.split("-")
                    if len(parts) != 3:
                        continue
                    t_str, days_str, act_str = parts

                    days = [int(d) % 7 for d in days_str if d.isdigit()]
                    if not days or days_str == "*" or days_str.lower() == "all":
                        days = [0, 1, 2, 3, 4, 5, 6]
                    time_type = "time"
                    if "sunrise" in t_str.lower():
                        time_type = "sunrise"
                    elif "sunset" in t_str.lower():
                        time_type = "sunset"
                    elif len(t_str) == 4 and t_str.isdigit():
                        t_str = f"{t_str[:2]}:{t_str[2:]}"

                    schedules.append(
                        ShellySchedule(
                            id=f"{channel}_{idx}",
                            device_id=self.device_id,
                            device_name=self.name,
                            host=self.host,
                            generation=SHELLY_GEN_1,
                            channel=channel,
                            enabled=is_schedule_active,
                            time_type=time_type,
                            time_str=t_str,
                            days=days,
                            action="on"
                            if "on" in act_str.lower()
                            else "off"
                            if "off" in act_str.lower()
                            else act_str.lower(),
                            raw=rule,
                        )
                    )
            except Exception:
                break
        return schedules

    async def async_create_schedule(
        self,
        time_str: str,
        action: str,
        days: list[int],
        channel: int = 0,
        time_type: str = "time",
        enabled: bool = True,
    ) -> Any:
        """Create a new schedule on the device."""
        if self.generation == SHELLY_GEN_2:
            return await self._async_create_schedule_gen2(
                time_str, action, days, channel, time_type, enabled
            )
        return await self._async_create_schedule_gen1(time_str, action, days, channel)

    async def _async_create_schedule_gen2(
        self,
        time_str: str,
        action: str,
        days: list[int],
        channel: int,
        time_type: str,
        enabled: bool,
    ) -> Any:
        # Always output explicit day names so Shelly web interface displays all checkboxes correctly
        if not days or len(days) >= 7:
            dow = "SUN,MON,TUE,WED,THU,FRI,SAT"
        else:
            dow = ",".join(DAY_NAMES_GEN2[d % 7] for d in sorted(set(days)))

        if time_type in ("sunrise", "sunset"):
            base_tag = time_str if time_str.startswith("@") else f"@{time_str}"
            timespec = f"{base_tag} * * {dow}"
        else:
            # Parse HH:MM
            hh, mm = (0, 0)
            if ":" in time_str:
                parts = time_str.split(":")
                hh = int(parts[0])
                mm = int(parts[1])
            timespec = f"0 {mm} {hh} * * {dow}"

        call_action = action.lower() == "on"
        calls = [
            {
                "method": "Switch.Set",
                "params": {"id": channel, "on": call_action},
            }
        ]

        params = {
            "enable": enabled,
            "timespec": timespec,
            "calls": calls,
        }
        return await self._async_rpc_call("Schedule.Create", params)

    async def _async_create_schedule_gen1(
        self,
        time_str: str,
        action: str,
        days: list[int],
        channel: int,
    ) -> Any:
        """Create schedule in Gen 1 REST."""
        settings = await self._async_gen1_get_relay_settings(channel)
        rules = list(settings.get("schedule_rules", []))

        # Format rule: HHMM-0123456-on
        formatted_time = time_str.replace(":", "")
        days_str = "".join(str(d) for d in sorted(days)) if days else "0123456"
        new_rule = f"{formatted_time}-{days_str}-{action.lower()}"
        rules.append(new_rule)

        payload = {
            "schedule": "true",
            "schedule_rules": ",".join(rules),
        }
        return await self._async_gen1_post_relay_settings(channel, payload)

    async def async_delete_schedule(self, schedule_id: str | int, channel: int = 0) -> Any:
        """Delete a schedule from the device."""
        if self.generation == SHELLY_GEN_2:
            return await self._async_rpc_call("Schedule.Delete", {"id": int(schedule_id)})

        # Gen 1
        # ID is format "{channel}_{index}"
        if isinstance(schedule_id, str) and "_" in schedule_id:
            channel_str, idx_str = schedule_id.split("_", 1)
            channel = int(channel_str)
            idx = int(idx_str)
        else:
            idx = int(schedule_id)

        settings = await self._async_gen1_get_relay_settings(channel)
        rules = list(settings.get("schedule_rules", []))
        if 0 <= idx < len(rules):
            rules.pop(idx)

        payload = {
            "schedule": "true" if rules else "false",
            "schedule_rules": ",".join(rules),
        }
        return await self._async_gen1_post_relay_settings(channel, payload)

    async def async_update_schedule(
        self,
        schedule_id: str | int,
        time_str: str,
        action: str,
        days: list[int],
        channel: int = 0,
        time_type: str = "time",
        enabled: bool = True,
    ) -> Any:
        """Update an existing schedule."""
        if self.generation == SHELLY_GEN_2:
            # Always output explicit day names so Shelly web interface displays all checkboxes correctly
            if not days or len(days) >= 7:
                dow = "SUN,MON,TUE,WED,THU,FRI,SAT"
            else:
                dow = ",".join(DAY_NAMES_GEN2[d % 7] for d in sorted(set(days)))

            if time_type in ("sunrise", "sunset"):
                base_tag = time_str if time_str.startswith("@") else f"@{time_str}"
                timespec = f"{base_tag} * * {dow}"
            else:
                hh, mm = (0, 0)
                if ":" in time_str:
                    parts = time_str.split(":")
                    hh = int(parts[0])
                    mm = int(parts[1])
                timespec = f"0 {mm} {hh} * * {dow}"

            call_action = action.lower() == "on"
            calls = [
                {
                    "method": "Switch.Set",
                    "params": {"id": channel, "on": call_action},
                }
            ]
            params = {
                "id": int(schedule_id),
                "enable": enabled,
                "timespec": timespec,
                "calls": calls,
            }
            return await self._async_rpc_call("Schedule.Update", params)

        # Gen 1 update: replace rule at index
        if isinstance(schedule_id, str) and "_" in schedule_id:
            channel_str, idx_str = schedule_id.split("_", 1)
            channel = int(channel_str)
            idx = int(idx_str)
        else:
            idx = int(schedule_id)

        settings = await self._async_gen1_get_relay_settings(channel)
        rules = list(settings.get("schedule_rules", []))
        formatted_time = time_str.replace(":", "")
        days_str = "".join(str(d) for d in sorted(days)) if days else "0123456"
        new_rule = f"{formatted_time}-{days_str}-{action.lower()}"

        if 0 <= idx < len(rules):
            rules[idx] = new_rule
        else:
            rules.append(new_rule)

        payload = {
            "schedule": "true",
            "schedule_rules": ",".join(rules),
        }
        return await self._async_gen1_post_relay_settings(channel, payload)

    async def async_toggle_schedule(
        self, schedule_id: str | int, enabled: bool, channel: int = 0
    ) -> Any:
        """Enable or disable a schedule without changing its settings."""
        if self.generation == SHELLY_GEN_2:
            try:
                jobs_res = await self._async_rpc_call("Schedule.List")
                if jobs_res and "jobs" in jobs_res:
                    for job in jobs_res["jobs"]:
                        if str(job.get("id")) == str(schedule_id):
                            params = {
                                "id": int(schedule_id),
                                "enable": enabled,
                                "timespec": job.get("timespec"),
                                "calls": job.get("calls", []),
                            }
                            return await self._async_rpc_call("Schedule.Update", params)
            except Exception as err:
                _LOGGER.debug(
                    "Failed to fetch job details before toggle, using direct update: %s", err
                )

            return await self._async_rpc_call(
                "Schedule.Update", {"id": int(schedule_id), "enable": enabled}
            )

        # Gen 1: update master schedule toggle while preserving existing rules
        settings = await self._async_gen1_get_relay_settings(channel)
        rules = settings.get("schedule_rules", []) if settings else []
        payload = {
            "schedule": "true" if enabled else "false",
            "schedule_rules": ",".join(rules) if isinstance(rules, list) else str(rules),
        }
        return await self._async_gen1_post_relay_settings(channel, payload)
