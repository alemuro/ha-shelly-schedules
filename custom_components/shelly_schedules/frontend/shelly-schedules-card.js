/**
 * Shelly Schedules Lovelace Card & Sidebar Panel
 * Professional UI for managing on-device Shelly schedules.
 */

const DAY_LABELS = ["Dg", "Dl", "Dt", "Dc", "Dj", "Dv", "Ds"]; // 0=Sun, 1=Mon...
const DAY_NAMES = [
  "Diumenge",
  "Dilluns",
  "Dimarts",
  "Dimecres",
  "Dijous",
  "Divendres",
  "Dissabte",
];

class ShellySchedulesPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._devices = {};
    this._selectedDevice = "all";
    this._selectedDay = new Date().getDay();
    this._loading = false;
    this._editingSchedule = null;
    this._showModal = false;
    this._timer = null;
  }

  connectedCallback() {
    if (!this._timer) {
      this._timer = setInterval(() => {
        if (this._selectedDay === new Date().getDay()) {
          this._render();
        }
      }, 30000);
    }
  }

  disconnectedCallback() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialFetchDone) {
      this._initialFetchDone = true;
      this._fetchSchedules();
    }
  }

  async _fetchSchedules(forceRefresh = false) {
    if (!this._hass) return;
    this._loading = true;
    this._render();

    try {
      const type = forceRefresh ? "shelly_schedules/refresh" : "shelly_schedules/list";
      const resp = await this._hass.connection.sendMessagePromise({ type });
      if (resp && resp.devices) {
        this._devices = resp.devices;
      }
    } catch (err) {
      console.error("Error fetching Shelly schedules:", err);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _toggleSchedule(device, scheduleId, targetEnabled, channel) {
    if (!this._hass) return;

    // Optimistic update in memory
    const devData = this._devices[device];
    let originalEnabled = !targetEnabled;
    if (devData && devData.schedules) {
      const s = devData.schedules.find((item) => String(item.id) === String(scheduleId));
      if (s) {
        originalEnabled = s.enabled;
        s.enabled = targetEnabled;
        this._render();
      }
    }

    try {
      const resp = await this._hass.connection.sendMessagePromise({
        type: "shelly_schedules/toggle",
        device: device,
        schedule_id: scheduleId,
        enabled: targetEnabled,
        channel: parseInt(channel, 10) || 0,
      });
      if (resp && resp.devices) {
        this._devices = resp.devices;
        this._render();
      } else {
        await this._fetchSchedules();
      }
    } catch (err) {
      // Revert on error
      if (devData && devData.schedules) {
        const s = devData.schedules.find((item) => String(item.id) === String(scheduleId));
        if (s) {
          s.enabled = originalEnabled;
          this._render();
        }
      }
      alert("Error modificant l'estat de l'horari: " + (err.message || err));
    }
  }

  async _deleteSchedule(device, scheduleId, channel) {
    if (!confirm("Vols eliminar definitivament aquest horari del dispositiu Shelly?")) return;
    try {
      await this._hass.connection.sendMessagePromise({
        type: "shelly_schedules/delete",
        device: device,
        schedule_id: scheduleId,
        channel: channel || 0,
      });
      await this._fetchSchedules();
    } catch (err) {
      alert("Error eliminant horari: " + (err.message || err));
    }
  }

  _openCreateModal(deviceKey = "") {
    const defaultDev = deviceKey || Object.keys(this._devices)[0] || "";
    this._editingSchedule = {
      isNew: true,
      device: defaultDev,
      schedule_id: "",
      channel: 0,
      action: "on",
      time_type: "time",
      time: "08:00",
      days: [0, 1, 2, 3, 4, 5, 6],
      enabled: true,
    };
    this._showModal = true;
    this._render();
  }

  _openEditModal(deviceKey, sched) {
    const timeVal = sched.time || sched.time_str || "08:00";
    this._editingSchedule = {
      isNew: false,
      device: deviceKey,
      schedule_id: sched.id,
      channel: sched.channel || 0,
      action: sched.action || "on",
      time_type: sched.time_type || "time",
      time: timeVal,
      time_str: timeVal,
      days: (sched.days && sched.days.length) ? [...sched.days] : [0, 1, 2, 3, 4, 5, 6],
      enabled: sched.enabled !== false,
    };
    this._showModal = true;
    this._render();
  }

  _closeModal() {
    this._showModal = false;
    this._editingSchedule = null;
    this._render();
  }

  async _saveScheduleFromModal(e) {
    e.preventDefault();
    if (!this._editingSchedule) return;

    const root = this.shadowRoot;
    const timeInputVal = root.getElementById("modal-time")?.value?.trim();
    const timeVal = timeInputVal || this._editingSchedule.time || this._editingSchedule.time_str || "08:00";
    const devVal = root.getElementById("modal-device")?.value || this._editingSchedule.device;
    const actVal = root.getElementById("modal-action")?.value || this._editingSchedule.action || "on";
    const chanVal = parseInt(root.getElementById("modal-channel")?.value || this._editingSchedule.channel || 0, 10);
    const timeTypeVal = root.getElementById("modal-time-type")?.value || this._editingSchedule.time_type || "time";

    const s = this._editingSchedule;
    const type = s.isNew ? "shelly_schedules/create" : "shelly_schedules/update";
    const days = (s.days && s.days.length) ? s.days : [0, 1, 2, 3, 4, 5, 6];

    const payload = {
      type,
      device: devVal,
      time: timeVal,
      action: actVal,
      days: days,
      channel: chanVal,
      time_type: timeTypeVal,
      enabled: s.enabled !== false,
    };

    if (!s.isNew) {
      payload.schedule_id = s.schedule_id;
    }

    try {
      await this._hass.connection.sendMessagePromise(payload);
      this._closeModal();
      await this._fetchSchedules();
    } catch (err) {
      alert("Error desant l'horari: " + (err.message || err));
    }
  }

  // --------------------------------------------------------------------------
  // Timeline Calculations
  // --------------------------------------------------------------------------

  _getSunTimes() {
    let sunriseMin = 7 * 60; // 07:00 default
    let sunsetMin = 20 * 60; // 20:00 default
    if (this._hass && this._hass.states && this._hass.states["sun.sun"]) {
      const sun = this._hass.states["sun.sun"];
      if (sun.attributes) {
        if (sun.attributes.next_rising) {
          const d = new Date(sun.attributes.next_rising);
          if (!isNaN(d.getTime())) {
            sunriseMin = d.getHours() * 60 + d.getMinutes();
          }
        }
        if (sun.attributes.next_setting) {
          const d = new Date(sun.attributes.next_setting);
          if (!isNaN(d.getTime())) {
            sunsetMin = d.getHours() * 60 + d.getMinutes();
          }
        }
      }
    }
    return { sunriseMin, sunsetMin };
  }

  _parseTimeToMinutes(timeStr, timeType, sunTimes) {
    if (!timeStr) return 0;
    const str = String(timeStr).trim().toLowerCase();

    if (timeType === "sunrise" || str.includes("sunrise")) {
      let base = sunTimes.sunriseMin;
      const match = str.match(/([+-])\s*(\d+)\s*(m|h|min)?/);
      if (match) {
        const sign = match[1] === "-" ? -1 : 1;
        let val = parseInt(match[2], 10) || 0;
        if (match[3] === "h") val *= 60;
        base += sign * val;
      }
      return Math.max(0, Math.min(1440, base));
    }

    if (timeType === "sunset" || str.includes("sunset")) {
      let base = sunTimes.sunsetMin;
      const match = str.match(/([+-])\s*(\d+)\s*(m|h|min)?/);
      if (match) {
        const sign = match[1] === "-" ? -1 : 1;
        let val = parseInt(match[2], 10) || 0;
        if (match[3] === "h") val *= 60;
        base += sign * val;
      }
      return Math.max(0, Math.min(1440, base));
    }

    const parts = str.split(":");
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      return Math.max(0, Math.min(1440, h * 60 + m));
    }
    if (str.length === 4 && /^\d+$/.test(str)) {
      const h = parseInt(str.substring(0, 2), 10) || 0;
      const m = parseInt(str.substring(2), 10) || 0;
      return Math.max(0, Math.min(1440, h * 60 + m));
    }
    return 0;
  }

  _formatMinutes(m) {
    if (m >= 1440) return "24:00";
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  _formatDuration(dur) {
    const h = Math.floor(dur / 60);
    const m = dur % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  _computeTimelineForChannel(schedules, channel, targetDay) {
    const sunTimes = this._getSunTimes();
    const chanSchedules = (schedules || []).filter(
      (s) => (s.channel || 0) === channel && s.enabled !== false
    );

    if (chanSchedules.length === 0) {
      return {
        intervals: [{ start: 0, end: 1440, state: false, durStr: "24h", startStr: "00:00", endStr: "24:00" }],
        totalOnMinutes: 0,
        totalOnStr: "0m",
        percentOn: 0,
      };
    }

    // Build all events across the whole week [day: 0..6, minutes: 0..1440, action: 'on'|'off'|'toggle']
    const weeklyEvents = [];
    chanSchedules.forEach((s) => {
      const min = this._parseTimeToMinutes(s.time_str, s.time_type, sunTimes);
      const days = s.days && s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
      days.forEach((d) => {
        weeklyEvents.push({
          day: d,
          minutes: min,
          action: s.action || "on",
          timeIndex: d * 1440 + min,
        });
      });
    });

    weeklyEvents.sort((a, b) => a.timeIndex - b.timeIndex);

    // Determine state entering targetDay at 00:00 (look back chronologically across the week)
    let lastEventBefore = null;
    const targetStartIdx = targetDay * 1440;
    for (let i = weeklyEvents.length - 1; i >= 0; i--) {
      if (weeklyEvents[i].timeIndex < targetStartIdx) {
        lastEventBefore = weeklyEvents[i];
        break;
      }
    }
    // If none before in current week, wrap around to the latest event of the week
    if (!lastEventBefore && weeklyEvents.length > 0) {
      lastEventBefore = weeklyEvents[weeklyEvents.length - 1];
    }

    let currentState = lastEventBefore ? lastEventBefore.action === "on" : false;

    // Events happening on targetDay
    const dayEvents = weeklyEvents
      .filter((e) => e.day === targetDay)
      .sort((a, b) => a.minutes - b.minutes);

    const intervals = [];
    let prevMinute = 0;

    dayEvents.forEach((ev) => {
      let nextState;
      if (ev.action === "on") nextState = true;
      else if (ev.action === "off") nextState = false;
      else nextState = !currentState;

      if (ev.minutes > prevMinute) {
        intervals.push({
          start: prevMinute,
          end: ev.minutes,
          state: currentState,
          durStr: this._formatDuration(ev.minutes - prevMinute),
          startStr: this._formatMinutes(prevMinute),
          endStr: this._formatMinutes(ev.minutes),
        });
        prevMinute = ev.minutes;
      }
      currentState = nextState;
    });

    if (prevMinute < 1440) {
      intervals.push({
        start: prevMinute,
        end: 1440,
        state: currentState,
        durStr: this._formatDuration(1440 - prevMinute),
        startStr: this._formatMinutes(prevMinute),
        endStr: "24:00",
      });
    }

    // Merge consecutive intervals having identical state
    const merged = [];
    intervals.forEach((cur) => {
      if (cur.end === cur.start) return;
      if (merged.length > 0 && merged[merged.length - 1].state === cur.state) {
        const last = merged[merged.length - 1];
        last.end = cur.end;
        last.endStr = cur.endStr;
        last.durStr = this._formatDuration(last.end - last.start);
      } else {
        merged.push({ ...cur });
      }
    });

    let totalOnMinutes = 0;
    merged.forEach((item) => {
      if (item.state) {
        totalOnMinutes += item.end - item.start;
      }
    });

    const percentOn = Math.round((totalOnMinutes / 1440) * 100);

    return {
      intervals: merged,
      totalOnMinutes,
      totalOnStr: this._formatDuration(totalOnMinutes),
      percentOn,
    };
  }

  _renderTimeline(devKey, dev, channel, tl, isToday, nowMinutes, nowStr, totalChannels) {
    const isSingleChan = totalChannels <= 1;

    return `
      <div class="timeline-box">
        <div class="timeline-header">
          <div class="timeline-label">
            <ha-icon icon="mdi:chart-timeline-variant"></ha-icon>
            <span>${isSingleChan ? "Previsió 24h" : `Previsió 24h · Canal ${channel}`}</span>
          </div>
          <div class="timeline-stat ${tl.totalOnMinutes > 0 ? "active" : ""}">
            <ha-icon icon="${tl.totalOnMinutes > 0 ? "mdi:power" : "mdi:power-off"}"></ha-icon>
            <span>${tl.totalOnMinutes > 0 ? `${tl.totalOnStr} encès (${tl.percentOn}%)` : "Tot el dia apagat"}</span>
          </div>
        </div>

        <div class="timeline-track-outer">
          <div class="timeline-track">
            <div class="timeline-track-inner">
              ${tl.intervals
                .map((int) => {
                  const leftPct = ((int.start / 1440) * 100).toFixed(2);
                  const widthPct = (((int.end - int.start) / 1440) * 100).toFixed(2);
                  const labelVisible = (int.end - int.start) >= 45; // show duration label if >= 45m

                  if (int.state) {
                    return `
                      <div class="timeline-segment on"
                           style="left: ${leftPct}%; width: ${widthPct}%;"
                           title="${int.startStr} - ${int.endStr} (${int.durStr}) · ENCÈS">
                        ${labelVisible ? `<span class="segment-label">${int.durStr}</span>` : ""}
                      </div>
                    `;
                  }
                  return `
                    <div class="timeline-segment off"
                         style="left: ${leftPct}%; width: ${widthPct}%;"
                         title="${int.startStr} - ${int.endStr} (${int.durStr}) · APAGAT">
                    </div>
                  `;
                })
                .join("")}
            </div>

            ${
              isToday
                ? `
              <div class="timeline-now-cursor" style="left: ${((nowMinutes / 1440) * 100).toFixed(2)}%;" title="Hora actual: ${nowStr}">
                <div class="cursor-line"></div>
                <div class="cursor-badge">Ara ${nowStr}</div>
              </div>
            `
                : ""
            }
          </div>

          <div class="timeline-axis">
            <span>00:00</span>
            <span>04:00</span>
            <span>08:00</span>
            <span>12:00</span>
            <span>16:00</span>
            <span>20:00</span>
            <span>24:00</span>
          </div>
        </div>
      </div>
    `;
  }

  _render() {
    const devices = this._devices || {};
    const devKeys = Object.keys(devices);

    const now = new Date();
    const currentDay = now.getDay();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const nowStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const isToday = this._selectedDay === currentDay;

    // Filter devices to display
    const visibleDevKeys = this._selectedDevice === "all" ? devKeys : [this._selectedDevice].filter((k) => devices[k]);

    // Count total schedules across visible devices
    let totalScheduleCount = 0;
    visibleDevKeys.forEach((k) => {
      totalScheduleCount += (devices[k].schedules || []).length;
    });

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 20px;
          background: var(--primary-background-color, #fafafa);
          color: var(--primary-text-color, #212121);
          font-family: var(--paper-font-body1_-_font-family, Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
          box-sizing: border-box;
          min-height: 100%;
        }
        ha-icon {
          --mdc-icon-size: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          vertical-align: middle;
        }
        .container {
          max-width: 1100px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          flex-wrap: wrap;
          gap: 16px;
        }
        .title-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .title-icon {
          --mdc-icon-size: 30px;
          color: var(--primary-color, #03a9f4);
        }
        .title {
          font-size: 24px;
          font-weight: 600;
          letter-spacing: -0.3px;
          margin: 0;
        }
        .loading-tag {
          font-size: 12px;
          font-weight: 500;
          padding: 3px 10px;
          border-radius: 12px;
          background: var(--secondary-background-color, #e0e0e0);
          color: var(--secondary-text-color, #666);
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          font-size: 13px;
          border: 1px solid transparent;
          transition: all 0.2s ease-in-out;
          font-family: inherit;
          line-height: 1.2;
          user-select: none;
        }
        .btn > * {
          pointer-events: none;
        }
        .btn-primary {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #ffffff);
          border-color: var(--primary-color, #03a9f4);
        }
        .btn-primary:hover {
          filter: brightness(0.92);
          box-shadow: 0 2px 6px rgba(3, 169, 244, 0.3);
        }
        .btn-secondary {
          background: var(--card-background-color, #ffffff);
          color: var(--primary-text-color, #212121);
          border: 1px solid var(--divider-color, #dcdfe6);
        }
        .btn-secondary:hover {
          background: var(--secondary-background-color, #f5f5f5);
          border-color: var(--primary-color, #03a9f4);
        }
        .btn-edit {
          background: transparent;
          color: var(--primary-color, #03a9f4);
          border: 1px solid var(--divider-color, #e0e0e0);
          padding: 6px 12px;
        }
        .btn-edit:hover {
          background: rgba(3, 169, 244, 0.08);
          border-color: var(--primary-color, #03a9f4);
        }
        .btn-delete {
          background: transparent;
          color: var(--error-color, #e53935);
          border: 1px solid var(--divider-color, #e0e0e0);
          padding: 6px 12px;
        }
        .btn-delete:hover {
          background: rgba(229, 57, 53, 0.08);
          border-color: var(--error-color, #e53935);
        }

        /* Device Filters */
        .filters {
          display: flex;
          gap: 8px;
          margin-bottom: 14px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .chip {
          padding: 6px 14px;
          border-radius: 20px;
          background: var(--card-background-color, #ffffff);
          border: 1px solid var(--divider-color, #e0e0e0);
          cursor: pointer;
          font-size: 13px;
          white-space: nowrap;
          user-select: none;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
        }
        .chip ha-icon {
          --mdc-icon-size: 16px;
        }
        .chip.active {
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
          border-color: var(--primary-color, #03a9f4);
        }
        .chip.active ha-icon {
          color: #ffffff;
        }

        /* Day Selector Bar */
        .day-selector-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--card-background-color, #ffffff);
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 12px;
          padding: 8px 16px;
          margin-bottom: 24px;
          gap: 12px;
          flex-wrap: wrap;
          box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,0.03));
        }
        .day-selector-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .day-selector-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--secondary-text-color, #757575);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .day-selector-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .day-chip {
          padding: 5px 12px;
          border-radius: 16px;
          border: 1px solid var(--divider-color, #dcdfe6);
          background: var(--table-row-alternative-background-color, #f5f6f8);
          color: var(--primary-text-color, #333);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: all 0.2s;
          user-select: none;
        }
        .day-chip:hover {
          border-color: var(--primary-color, #03a9f4);
        }
        .day-chip.selected {
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
          border-color: var(--primary-color, #03a9f4);
        }
        .day-chip .today-dot {
          display: inline-block;
          font-size: 14px;
          line-height: 0;
          color: var(--primary-color, #03a9f4);
        }
        .day-chip.selected .today-dot {
          color: #ffffff;
        }
        .day-indicator-text {
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-color, #03a9f4);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* Device Section */
        .device-section {
          background: var(--card-background-color, #ffffff);
          border-radius: 14px;
          border: 1px solid var(--divider-color, #e0e0e0);
          box-shadow: var(--ha-card-box-shadow, 0 1px 4px rgba(0,0,0,0.05));
          margin-bottom: 24px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .device-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--divider-color, #edf0f2);
        }
        .device-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .device-main-icon {
          --mdc-icon-size: 26px;
          color: var(--primary-color, #03a9f4);
          background: rgba(3, 169, 244, 0.1);
          padding: 8px;
          border-radius: 10px;
        }
        .device-title-box h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.2px;
        }
        .device-subtitle {
          margin-top: 2px;
          font-size: 12px;
          color: var(--secondary-text-color, #757575);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .device-tag {
          background: var(--table-row-alternative-background-color, #f0f2f5);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
        }

        /* Timeline Box */
        .timeline-box {
          background: var(--table-row-alternative-background-color, #f8f9fa);
          border: 1px solid var(--divider-color, #e4e7eb);
          border-radius: 10px;
          padding: 14px 16px;
        }
        .timeline-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          font-size: 13px;
        }
        .timeline-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          color: var(--primary-text-color, #333);
        }
        .timeline-label ha-icon {
          --mdc-icon-size: 16px;
          color: var(--primary-color, #03a9f4);
        }
        .timeline-stat {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-weight: 600;
          color: var(--secondary-text-color, #777);
          background: var(--card-background-color, #ffffff);
          padding: 3px 9px;
          border-radius: 12px;
          border: 1px solid var(--divider-color, #e0e0e0);
        }
        .timeline-stat.active {
          color: #2e7d32;
          background: rgba(46, 125, 50, 0.1);
          border-color: rgba(46, 125, 50, 0.25);
        }
        .timeline-stat ha-icon {
          --mdc-icon-size: 14px;
        }

        /* Timeline Track */
        .timeline-track-outer {
          position: relative;
          padding-top: 14px;
        }
        .timeline-track {
          position: relative;
          height: 26px;
          background: var(--card-background-color, #ffffff);
          border-radius: 8px;
          border: 1px solid var(--divider-color, #dcdfe6);
          overflow: visible;
        }
        .timeline-track-inner {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 7px;
          overflow: hidden;
          background: var(--card-background-color, #ffffff);
        }
        .timeline-segment {
          position: absolute;
          top: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          transition: filter 0.15s ease;
        }
        .timeline-segment.on {
          background: linear-gradient(135deg, var(--primary-color, #03a9f4), #0288d1);
          color: #ffffff;
          cursor: pointer;
          z-index: 2;
          border-left: 1px solid rgba(255,255,255,0.4);
          border-right: 1px solid rgba(255,255,255,0.4);
        }
        .timeline-segment.on:hover {
          filter: brightness(1.12);
        }
        .timeline-segment.off {
          background: transparent;
          cursor: pointer;
        }
        .timeline-segment.off:hover {
          background: rgba(0, 0, 0, 0.04);
        }
        .segment-label {
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          user-select: none;
          padding: 0 4px;
          letter-spacing: -0.2px;
        }

        /* Now Cursor */
        .timeline-now-cursor {
          position: absolute;
          top: -2px;
          bottom: -2px;
          width: 2px;
          z-index: 10;
          pointer-events: none;
        }
        .cursor-line {
          width: 100%;
          height: 100%;
          background: var(--error-color, #e53935);
          box-shadow: 0 0 5px rgba(229, 57, 53, 0.8);
        }
        .cursor-badge {
          position: absolute;
          top: -18px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--error-color, #e53935);
          color: #ffffff;
          font-size: 9px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        /* Axis */
        .timeline-axis {
          display: flex;
          justify-content: space-between;
          margin-top: 6px;
          font-size: 11px;
          color: var(--secondary-text-color, #888);
          font-family: var(--code-font-family, monospace);
          padding: 0 2px;
          user-select: none;
        }

        /* Schedules Grid */
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 14px;
          margin-top: 4px;
        }
        .card {
          background: var(--card-background-color, #ffffff);
          border-radius: 10px;
          padding: 14px;
          border: 1px solid var(--divider-color, #e0e0e0);
          box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,0.04));
          display: flex;
          flex-direction: column;
          gap: 12px;
          position: relative;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .card:hover {
          box-shadow: 0 3px 10px rgba(0,0,0,0.07);
        }
        .card.card-disabled {
          opacity: 0.65;
          background: var(--card-background-color, #fbfbfb);
          border: 1px dashed var(--divider-color, #d0d0d0);
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .channel-badge {
          font-size: 11px;
          font-weight: 600;
          color: var(--secondary-text-color, #757575);
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .schedule-title {
          font-size: 17px;
          font-weight: 600;
          margin-top: 3px;
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--primary-text-color, #212121);
        }
        .schedule-title ha-icon {
          --mdc-icon-size: 18px;
          color: var(--primary-color, #03a9f4);
        }
        .action-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .action-tag ha-icon {
          --mdc-icon-size: 13px;
        }
        .action-on {
          background: rgba(46, 125, 50, 0.12);
          color: #2e7d32;
          border: 1px solid rgba(46, 125, 50, 0.25);
        }
        .action-off {
          background: rgba(211, 47, 47, 0.12);
          color: #c62828;
          border: 1px solid rgba(211, 47, 47, 0.25);
        }
        .action-toggle {
          background: rgba(3, 169, 244, 0.12);
          color: var(--primary-color, #03a9f4);
          border: 1px solid rgba(3, 169, 244, 0.25);
        }
        .days-list {
          display: flex;
          gap: 4px;
        }
        .day-badge {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 600;
          background: var(--table-row-alternative-background-color, #f0f2f5);
          color: var(--secondary-text-color, #8a92a0);
          user-select: none;
        }
        .day-badge.active {
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
        }
        .card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid var(--divider-color, #edf0f2);
          padding-top: 10px;
          margin-top: auto;
        }
        .switch-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .switch {
          position: relative;
          display: inline-block;
          width: 36px;
          height: 20px;
        }
        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--switch-unchecked-button-color, #cfd4dc);
          transition: 0.25s ease;
          border-radius: 20px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 14px;
          width: 14px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.25s ease;
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
        }
        input:checked + .slider {
          background-color: var(--primary-color, #03a9f4);
        }
        input:checked + .slider:before {
          transform: translateX(16px);
        }
        .switch-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--primary-text-color, #333);
        }
        .btn-group {
          display: flex;
          gap: 6px;
        }
        .empty-device-schedules {
          text-align: center;
          padding: 24px 16px;
          color: var(--secondary-text-color, #888);
          background: var(--table-row-alternative-background-color, #fafafa);
          border-radius: 8px;
          border: 1px dashed var(--divider-color, #dcdfe6);
          font-size: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .empty-state {
          text-align: center;
          padding: 60px 20px;
          color: var(--secondary-text-color, #757575);
          background: var(--card-background-color, #ffffff);
          border-radius: 12px;
          border: 1px dashed var(--divider-color, #ccc);
        }
        .empty-icon {
          --mdc-icon-size: 48px;
          color: var(--secondary-text-color, #aaa);
          margin-bottom: 12px;
        }

        /* Modal */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(2px);
        }
        .modal {
          background: var(--card-background-color, #ffffff);
          padding: 24px;
          border-radius: 14px;
          width: 92%;
          max-width: 500px;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.2);
          border: 1px solid var(--divider-color, #e0e0e0);
        }
        .modal-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 18px;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--primary-text-color, #111);
        }
        .modal-title ha-icon {
          --mdc-icon-size: 22px;
          color: var(--primary-color, #03a9f4);
        }
        .form-group {
          margin-bottom: 14px;
        }
        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-text-color, #333);
        }
        .form-control, select, input[type="text"], input[type="number"] {
          width: 100%;
          padding: 9px 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ccc);
          box-sizing: border-box;
          font-size: 14px;
          font-family: inherit;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          transition: border-color 0.2s;
        }
        select:focus, input:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
        }
        .day-picker {
          display: flex;
          gap: 6px;
          margin-top: 6px;
        }
        .day-btn {
          flex: 1;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--divider-color, #d0d4dc);
          border-radius: 8px;
          background: var(--table-row-alternative-background-color, #f4f5f7);
          color: var(--primary-text-color, #333);
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          user-select: none;
          transition: all 0.15s;
        }
        .day-btn.selected {
          background: var(--primary-color, #03a9f4);
          color: #ffffff;
          border-color: var(--primary-color, #03a9f4);
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 24px;
          border-top: 1px solid var(--divider-color, #eee);
          padding-top: 16px;
        }
      </style>

      <div class="container">
        <div class="header">
          <div class="title-wrapper">
            <ha-icon icon="mdi:calendar-clock" class="title-icon"></ha-icon>
            <h2 class="title">Horaris Shelly</h2>
            ${this._loading ? '<span class="loading-tag">Actualitzant...</span>' : ""}
          </div>
          <div class="actions">
            <button class="btn btn-secondary" id="btn-refresh" title="Refrescar dades del dispositiu">
              <ha-icon icon="mdi:refresh"></ha-icon>
              <span>Refrescar</span>
            </button>
            <button class="btn btn-primary" id="btn-create">
              <ha-icon icon="mdi:plus"></ha-icon>
              <span>Nou horari</span>
            </button>
          </div>
        </div>

        <!-- Filters by Device -->
        <div class="filters">
          <div class="chip ${this._selectedDevice === "all" ? "active" : ""}" data-dev="all">
            <ha-icon icon="mdi:devices"></ha-icon>
            <span>Tots (${totalScheduleCount})</span>
          </div>
          ${devKeys
            .map(
              (k) => `
            <div class="chip ${this._selectedDevice === k ? "active" : ""}" data-dev="${k}">
              <ha-icon icon="mdi:developer-board"></ha-icon>
              <span>${devices[k].name || devices[k].host} (${(devices[k].schedules || []).length})</span>
            </div>
          `
            )
            .join("")}
        </div>

        <!-- Day of Week Selector -->
        <div class="day-selector-bar">
          <div class="day-selector-left">
            <span class="day-selector-title">
              <ha-icon icon="mdi:calendar-today"></ha-icon>
              <span>Previsió del dia:</span>
            </span>
            <div class="day-selector-chips">
              ${[1, 2, 3, 4, 5, 6, 0]
                .map((d) => {
                  const isCurrent = d === currentDay;
                  const isSelected = d === this._selectedDay;
                  return `
                    <button class="day-chip ${isSelected ? "selected" : ""}" data-day="${d}">
                      <span>${DAY_LABELS[d]}</span>
                      ${isCurrent ? '<span class="today-dot" title="Avui">•</span>' : ""}
                    </button>
                  `;
                })
                .join("")}
            </div>
          </div>
          <div class="day-indicator-text">
            <span>${DAY_NAMES[this._selectedDay]} ${isToday ? "(Avui)" : ""}</span>
          </div>
        </div>

        <!-- Devices List with 24h Timeline & Schedules -->
        ${
          visibleDevKeys.length === 0
            ? `
          <div class="empty-state">
            <ha-icon icon="mdi:calendar-blank-outline" class="empty-icon"></ha-icon>
            <h3>No s'han trobat dispositius Shelly</h3>
            <p>Comprova que la integració oficial Shelly o els dispositius manuals estiguin configurats.</p>
          </div>
        `
            : visibleDevKeys
                .map((k) => {
                  const d = devices[k];
                  const sunTimes = this._getSunTimes();
                  const rawScheds = d.schedules || [];
                  const scheds = [...rawScheds].sort((a, b) => {
                    const minA = this._parseTimeToMinutes(a.time_str, a.time_type, sunTimes);
                    const minB = this._parseTimeToMinutes(b.time_str, b.time_type, sunTimes);
                    if (minA !== minB) return minA - minB;
                    const chanA = a.channel || 0;
                    const chanB = b.channel || 0;
                    if (chanA !== chanB) return chanA - chanB;
                    return String(a.id).localeCompare(String(b.id));
                  });
                  const channels = Array.from(new Set(scheds.map((s) => s.channel || 0))).sort((a, b) => a - b);
                  if (channels.length === 0) channels.push(0);

                  return `
              <div class="device-section">
                <div class="device-section-header">
                  <div class="device-header-left">
                    <ha-icon icon="mdi:developer-board" class="device-main-icon"></ha-icon>
                    <div class="device-title-box">
                      <h3>${d.name || d.host}</h3>
                      <div class="device-subtitle">
                        <span>${d.host}</span>
                        ${d.model ? `<span>·</span><span class="device-tag">${d.model}</span>` : ""}
                        <span>·</span>
                        <span class="device-tag">Gen ${d.generation || 2}</span>
                        <span>·</span>
                        <span>${scheds.length} horari(s)</span>
                      </div>
                    </div>
                  </div>
                  <button class="btn btn-secondary btn-device-create" data-dev="${k}">
                    <ha-icon icon="mdi:plus"></ha-icon>
                    <span>Afegir horari</span>
                  </button>
                </div>

                <!-- 24h Timeline Bars per channel -->
                <div class="device-timelines">
                  ${channels
                    .map((chan) => {
                      const tl = this._computeTimelineForChannel(scheds, chan, this._selectedDay);
                      return this._renderTimeline(k, d, chan, tl, isToday, nowMinutes, nowStr, channels.length);
                    })
                    .join("")}
                </div>

                <!-- Schedule Cards -->
                ${
                  scheds.length === 0
                    ? `
                  <div class="empty-device-schedules">
                    <ha-icon icon="mdi:calendar-blank-outline"></ha-icon>
                    <span>Sense horaris configurats en aquest dispositiu. Fes clic a "Afegir horari" per crear-ne un.</span>
                  </div>
                `
                    : `
                  <div class="grid">
                    ${scheds
                      .map(
                        (s) => `
                      <div class="card ${s.enabled ? "" : "card-disabled"}">
                        <div class="card-header">
                          <div>
                            <div class="channel-badge">Canal ${s.channel || 0}</div>
                            <div class="schedule-title">
                              ${
                                s.time_type === "sunrise"
                                  ? '<ha-icon icon="mdi:weather-sunset-up"></ha-icon><span>Sortida de sol ' +
                                    s.time_str +
                                    "</span>"
                                  : ""
                              }
                              ${
                                s.time_type === "sunset"
                                  ? '<ha-icon icon="mdi:weather-sunset-down"></ha-icon><span>Posta de sol ' +
                                    s.time_str +
                                    "</span>"
                                  : ""
                              }
                              ${
                                s.time_type !== "sunrise" && s.time_type !== "sunset"
                                  ? '<ha-icon icon="mdi:clock-outline"></ha-icon><span>' + s.time_str + "</span>"
                                  : ""
                              }
                            </div>
                          </div>
                          <span class="action-tag ${
                            s.action === "on" ? "action-on" : s.action === "toggle" ? "action-toggle" : "action-off"
                          }">
                            <ha-icon icon="${
                              s.action === "on" ? "mdi:power" : s.action === "toggle" ? "mdi:swap-vertical" : "mdi:power-off"
                            }"></ha-icon>
                            <span>${s.action === "on" ? "ENCÈS" : s.action === "toggle" ? "ALTERNAR" : "APAGAT"}</span>
                          </span>
                        </div>

                        <div class="days-list">
                          ${[1, 2, 3, 4, 5, 6, 0]
                            .map((dDay) => {
                              const activeDays = (s.days && s.days.length) ? s.days : [0, 1, 2, 3, 4, 5, 6];
                              return `
                                <div class="day-badge ${activeDays.includes(dDay) ? "active" : ""}">
                                  ${DAY_LABELS[dDay]}
                                </div>
                              `;
                            })
                            .join("")}
                        </div>

                        <div class="card-footer">
                          <div class="switch-container">
                            <label class="switch" title="Activar o desactivar horari">
                              <input type="checkbox" ${s.enabled ? "checked" : ""} class="toggle-cb" data-dev="${k}" data-id="${s.id}" data-chan="${s.channel || 0}">
                              <span class="slider"></span>
                            </label>
                            <span class="switch-label">Actiu</span>
                          </div>
                          <div class="btn-group">
                            <button class="btn btn-edit" data-dev="${k}" data-id="${s.id}">
                              <ha-icon icon="mdi:pencil-outline"></ha-icon>
                              <span>Editar</span>
                            </button>
                            <button class="btn btn-delete" data-dev="${k}" data-id="${s.id}" data-chan="${s.channel || 0}">
                              <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                              <span>Eliminar</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    `
                      )
                      .join("")}
                  </div>
                `
                }
              </div>
            `;
                })
                .join("")
        }
      </div>

      <!-- Modal Dialog -->
      ${
        this._showModal && this._editingSchedule
          ? `
        <div class="modal-overlay" id="modal-overlay">
          <div class="modal">
            <div class="modal-title">
              <ha-icon icon="${this._editingSchedule.isNew ? "mdi:calendar-plus" : "mdi:calendar-edit"}"></ha-icon>
              <span>${this._editingSchedule.isNew ? "Nou horari Shelly" : "Editar horari"}</span>
            </div>
            <form id="schedule-form">
              <div class="form-group">
                <label>Dispositiu Shelly</label>
                <select id="modal-device" ${!this._editingSchedule.isNew ? "disabled" : ""}>
                  ${devKeys
                    .map(
                      (k) => `
                    <option value="${k}" ${this._editingSchedule.device === k ? "selected" : ""}>
                      ${devices[k].name || devices[k].host}
                    </option>
                  `
                    )
                    .join("")}
                </select>
              </div>

              <div class="form-group">
                <label>Canal / Relay</label>
                <input type="number" id="modal-channel" min="0" max="3" value="${this._editingSchedule.channel || 0}">
              </div>

              <div class="form-group">
                <label>Tipus d'hora</label>
                <select id="modal-time-type">
                  <option value="time" ${this._editingSchedule.time_type === "time" ? "selected" : ""}>Hora exacta (HH:MM)</option>
                  <option value="sunrise" ${this._editingSchedule.time_type === "sunrise" ? "selected" : ""}>Sortida de sol (Sunrise)</option>
                  <option value="sunset" ${this._editingSchedule.time_type === "sunset" ? "selected" : ""}>Posta de sol (Sunset)</option>
                </select>
              </div>

              <div class="form-group">
                <label>Hora o desplaçament (p. ex. 08:30 o @sunset-15m)</label>
                <input type="text" id="modal-time" required value="${this._editingSchedule.time || "08:00"}">
              </div>

              <div class="form-group">
                <label>Acció</label>
                <select id="modal-action">
                  <option value="on" ${this._editingSchedule.action === "on" ? "selected" : ""}>Encendre (ON)</option>
                  <option value="off" ${this._editingSchedule.action === "off" ? "selected" : ""}>Apagar (OFF)</option>
                </select>
              </div>

              <div class="form-group">
                <label>Dies de la setmana</label>
                <div class="day-picker">
                  ${[1, 2, 3, 4, 5, 6, 0]
                    .map(
                      (d) => `
                    <div class="day-btn ${(this._editingSchedule.days || []).includes(d) ? "selected" : ""}" data-day="${d}">
                      ${DAY_LABELS[d]}
                    </div>
                  `
                    )
                    .join("")}
                </div>
              </div>

              <div class="modal-actions">
                <button type="button" class="btn btn-secondary" id="modal-cancel">
                  <ha-icon icon="mdi:close"></ha-icon>
                  <span>Cancel·lar</span>
                </button>
                <button type="submit" class="btn btn-primary" id="modal-save">
                  <ha-icon icon="mdi:content-save-outline"></ha-icon>
                  <span>Desar horari</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      `
          : ""
      }
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const root = this.shadowRoot;

    // Refresh button
    const refreshBtn = root.getElementById("btn-refresh");
    if (refreshBtn) refreshBtn.onclick = () => this._fetchSchedules(true);

    // Global Create button
    const createBtn = root.getElementById("btn-create");
    if (createBtn)
      createBtn.onclick = () =>
        this._openCreateModal(this._selectedDevice !== "all" ? this._selectedDevice : "");

    // Per-device Create button
    root.querySelectorAll(".btn-device-create").forEach((btn) => {
      btn.onclick = () => {
        const dev = btn.getAttribute("data-dev");
        this._openCreateModal(dev);
      };
    });

    // Filter chips
    root.querySelectorAll(".filters .chip").forEach((chip) => {
      chip.onclick = () => {
        this._selectedDevice = chip.getAttribute("data-dev");
        this._render();
      };
    });

    // Day selector chips
    root.querySelectorAll(".day-chip").forEach((chip) => {
      chip.onclick = () => {
        const day = parseInt(chip.getAttribute("data-day"), 10);
        this._selectedDay = day;
        this._render();
      };
    });

    // Toggle switches
    root.querySelectorAll(".toggle-cb").forEach((cb) => {
      cb.onchange = (e) => {
        e.stopPropagation();
        const dev = cb.getAttribute("data-dev");
        const id = cb.getAttribute("data-id");
        const chan = cb.getAttribute("data-chan");
        this._toggleSchedule(dev, id, cb.checked, chan);
      };
    });

    // Delete buttons
    root.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.onclick = () => {
        const dev = btn.getAttribute("data-dev");
        const id = btn.getAttribute("data-id");
        const chan = btn.getAttribute("data-chan");
        this._deleteSchedule(dev, id, chan);
      };
    });

    // Edit buttons
    root.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.onclick = () => {
        const dev = btn.getAttribute("data-dev");
        const id = btn.getAttribute("data-id");
        const deviceData = this._devices[dev];
        if (deviceData && deviceData.schedules) {
          const sched = deviceData.schedules.find((s) => String(s.id) === String(id));
          if (sched) this._openEditModal(dev, sched);
        }
      };
    });

    // Modal events
    if (this._showModal) {
      const cancelBtn = root.getElementById("modal-cancel");
      if (cancelBtn) cancelBtn.onclick = () => this._closeModal();

      const form = root.getElementById("schedule-form");
      if (form) {
        form.onsubmit = (e) => this._saveScheduleFromModal(e);
      }

      const devSelect = root.getElementById("modal-device");
      if (devSelect) {
        devSelect.onchange = () => {
          this._editingSchedule.device = devSelect.value;
        };
      }

      const chanInput = root.getElementById("modal-channel");
      if (chanInput) {
        chanInput.onchange = () => {
          this._editingSchedule.channel = chanInput.value;
        };
      }

      const timeInput = root.getElementById("modal-time");
      if (timeInput) {
        timeInput.oninput = () => {
          this._editingSchedule.time = timeInput.value;
        };
      }

      const timeTypeSelect = root.getElementById("modal-time-type");
      if (timeTypeSelect) {
        timeTypeSelect.onchange = () => {
          this._editingSchedule.time_type = timeTypeSelect.value;
          if (timeTypeSelect.value === "sunrise" && !this._editingSchedule.time.includes("sunrise")) {
            timeInput.value = "@sunrise";
            this._editingSchedule.time = "@sunrise";
          } else if (timeTypeSelect.value === "sunset" && !this._editingSchedule.time.includes("sunset")) {
            timeInput.value = "@sunset";
            this._editingSchedule.time = "@sunset";
          }
        };
      }

      const actSelect = root.getElementById("modal-action");
      if (actSelect) {
        actSelect.onchange = () => {
          this._editingSchedule.action = actSelect.value;
        };
      }

      // Day buttons
      root.querySelectorAll(".day-btn").forEach((dayBtn) => {
        dayBtn.onclick = () => {
          const day = parseInt(dayBtn.getAttribute("data-day"), 10);
          let days = this._editingSchedule.days || [];
          if (days.includes(day)) {
            days = days.filter((d) => d !== day);
          } else {
            days.push(day);
          }
          this._editingSchedule.days = days;
          dayBtn.classList.toggle("selected", days.includes(day));
        };
      });
    }
  }
}

class ShellySchedulesCard extends ShellySchedulesPanel {}

if (!customElements.get("shelly-schedules-panel")) {
  customElements.define("shelly-schedules-panel", ShellySchedulesPanel);
}
if (!customElements.get("shelly-schedules-card")) {
  customElements.define("shelly-schedules-card", ShellySchedulesCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "shelly-schedules-card",
  name: "Shelly Schedules Card",
  preview: true,
  description: "Targeta interactiva per gestionar els horaris dels dispositius Shelly.",
});
