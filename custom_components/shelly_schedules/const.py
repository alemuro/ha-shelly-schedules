"""Constants for the Shelly Schedules integration."""

DOMAIN = "shelly_schedules"

DEFAULT_NAME = "Shelly Schedules"
DEFAULT_SCAN_INTERVAL = 60  # seconds

CONF_DISCOVER_CORE_SHELLY = "discover_core_shelly"
CONF_MANUAL_DEVICES = "manual_devices"
CONF_HOST = "host"
CONF_PASSWORD = "password"
CONF_NAME = "name"
CONF_PORT = "port"

SHELLY_GEN_1 = 1
SHELLY_GEN_2 = 2  # Gen 2, 3, Plus, Pro (RPC based)

SERVICE_GET_SCHEDULES = "get_schedules"
SERVICE_CREATE_SCHEDULE = "create_schedule"
SERVICE_UPDATE_SCHEDULE = "update_schedule"
SERVICE_DELETE_SCHEDULE = "delete_schedule"
SERVICE_TOGGLE_SCHEDULE = "toggle_schedule"

URL_FRONTEND = "/shelly_schedules_ui"
FRONTEND_URL_PATH = "shelly-schedules"
