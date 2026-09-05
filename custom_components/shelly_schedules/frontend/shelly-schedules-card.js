/**
 * Shelly Schedules Lovelace Card & Sidebar Panel
 * Professional UI for managing on-device Shelly schedules.
 */

const DAY_LABELS = ["Dg", "Dl", "Dt", "Dc", "Dj", "Dv", "Ds"]; // 0=Sun, 1=Mon...

class ShellySchedulesPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._devices = {};
    this._selectedDevice = "all";
    this._loading = false;
    this._editingSchedule = null;
    this._showModal = false;
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
    this._editingSchedule = {
      isNew: false,
      device: deviceKey,
      schedule_id: sched.id,
      channel: sched.channel || 0,
      action: sched.action || "on",
      time_type: sched.time_type || "time",
      time: sched.time_str || "08:00",
      days: sched.days || [0, 1, 2, 3, 4, 5, 6],
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

    const s = this._editingSchedule;
    const type = s.isNew ? "shelly_schedules/create" : "shelly_schedules/update";

    const payload = {
      type,
      device: s.device,
      time: s.time,
      action: s.action,
      days: s.days,
      channel: parseInt(s.channel, 10) || 0,
      time_type: s.time_type,
      enabled: s.enabled,
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

  _render() {
    const devices = this._devices || {};
    const devKeys = Object.keys(devices);

    let filteredSchedules = [];
    if (this._selectedDevice === "all") {
      devKeys.forEach((k) => {
        const d = devices[k];
        (d.schedules || []).forEach((s) => {
          filteredSchedules.push({ ...s, deviceKey: k, devName: d.name || d.host });
        });
      });
    } else if (devices[this._selectedDevice]) {
      const d = devices[this._selectedDevice];
      (d.schedules || []).forEach((s) => {
        filteredSchedules.push({ ...s, deviceKey: this._selectedDevice, devName: d.name || d.host });
      });
    }

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
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 16px;
        }
        .title-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .title-icon {
          --mdc-icon-size: 28px;
          color: var(--primary-color, #03a9f4);
        }
        .title {
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.2px;
          margin: 0;
        }
        .loading-tag {
          font-size: 12px;
          font-weight: 500;
          padding: 2px 8px;
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
        .filters {
          display: flex;
          gap: 8px;
          margin-bottom: 20px;
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
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
          gap: 16px;
        }
        .card {
          background: var(--card-background-color, #ffffff);
          border-radius: 12px;
          padding: 16px;
          border: 1px solid var(--divider-color, #e0e0e0);
          box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,0.05));
          display: flex;
          flex-direction: column;
          gap: 14px;
          position: relative;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .card.card-disabled {
          opacity: 0.68;
          background: var(--card-background-color, #fbfbfb);
          border: 1px dashed var(--divider-color, #d0d0d0);
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .device-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 500;
          color: var(--secondary-text-color, #757575);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .device-badge ha-icon {
          --mdc-icon-size: 14px;
        }
        .schedule-title {
          font-size: 18px;
          font-weight: 600;
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--primary-text-color, #212121);
        }
        .schedule-title ha-icon {
          --mdc-icon-size: 20px;
          color: var(--primary-color, #03a9f4);
        }
        .action-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 14px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .action-tag ha-icon {
          --mdc-icon-size: 14px;
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
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
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
          padding-top: 12px;
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
          width: 38px;
          height: 22px;
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
          border-radius: 22px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
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
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-text-color, #333);
        }
        .btn-group {
          display: flex;
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
            ${this._loading ? '<span class="loading-tag">Actualitzant...</span>' : ''}
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

        <!-- Filters -->
        <div class="filters">
          <div class="chip ${this._selectedDevice === 'all' ? 'active' : ''}" data-dev="all">
            <ha-icon icon="mdi:devices"></ha-icon>
            <span>Tots (${filteredSchedules.length})</span>
          </div>
          ${devKeys.map((k) => `
            <div class="chip ${this._selectedDevice === k ? 'active' : ''}" data-dev="${k}">
              <ha-icon icon="mdi:developer-board"></ha-icon>
              <span>${devices[k].name || devices[k].host} (${(devices[k].schedules || []).length})</span>
            </div>
          `).join('')}
        </div>

        <!-- Schedule list -->
        ${filteredSchedules.length === 0 ? `
          <div class="empty-state">
            <ha-icon icon="mdi:calendar-blank-outline" class="empty-icon"></ha-icon>
            <h3>No hi ha horaris configurats</h3>
            <p>Fes clic a "Nou horari" per crear una programació a un dispositiu Shelly.</p>
          </div>
        ` : `
          <div class="grid">
            ${filteredSchedules.map((s) => `
              <div class="card ${s.enabled ? '' : 'card-disabled'}">
                <div class="card-header">
                  <div>
                    <div class="device-badge">
                      <ha-icon icon="mdi:developer-board"></ha-icon>
                      <span>${s.devName} · Canal ${s.channel || 0}</span>
                    </div>
                    <div class="schedule-title">
                      ${s.time_type === 'sunrise' ? '<ha-icon icon="mdi:weather-sunset-up"></ha-icon><span>Sortida de sol ' + s.time_str + '</span>' : ''}
                      ${s.time_type === 'sunset' ? '<ha-icon icon="mdi:weather-sunset-down"></ha-icon><span>Posta de sol ' + s.time_str + '</span>' : ''}
                      ${s.time_type !== 'sunrise' && s.time_type !== 'sunset' ? '<ha-icon icon="mdi:clock-outline"></ha-icon><span>' + s.time_str + '</span>' : ''}
                    </div>
                  </div>
                  <span class="action-tag ${s.action === 'on' ? 'action-on' : s.action === 'toggle' ? 'action-toggle' : 'action-off'}">
                    <ha-icon icon="${s.action === 'on' ? 'mdi:power' : s.action === 'toggle' ? 'mdi:swap-vertical' : 'mdi:power-off'}"></ha-icon>
                    <span>${s.action === 'on' ? 'ENCÈS' : s.action === 'toggle' ? 'ALTERNAR' : 'APAGAT'}</span>
                  </span>
                </div>

                <div class="days-list">
                  ${[1, 2, 3, 4, 5, 6, 0].map((d) => `
                    <div class="day-badge ${(s.days || []).includes(d) ? 'active' : ''}">
                      ${DAY_LABELS[d]}
                    </div>
                  `).join('')}
                </div>

                <div class="card-footer">
                  <div class="switch-container">
                    <label class="switch" title="Activar o desactivar horari">
                      <input type="checkbox" ${s.enabled ? 'checked' : ''} class="toggle-cb" data-dev="${s.deviceKey}" data-id="${s.id}" data-chan="${s.channel || 0}">
                      <span class="slider"></span>
                    </label>
                    <span class="switch-label">Actiu</span>
                  </div>
                  <div class="btn-group">
                    <button class="btn btn-edit" data-dev="${s.deviceKey}" data-id="${s.id}">
                      <ha-icon icon="mdi:pencil-outline"></ha-icon>
                      <span>Editar</span>
                    </button>
                    <button class="btn btn-delete" data-dev="${s.deviceKey}" data-id="${s.id}" data-chan="${s.channel || 0}">
                      <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                      <span>Eliminar</span>
                    </button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Modal Dialog -->
      ${this._showModal && this._editingSchedule ? `
        <div class="modal-overlay" id="modal-overlay">
          <div class="modal">
            <div class="modal-title">
              <ha-icon icon="${this._editingSchedule.isNew ? 'mdi:calendar-plus' : 'mdi:calendar-edit'}"></ha-icon>
              <span>${this._editingSchedule.isNew ? 'Nou horari Shelly' : 'Editar horari'}</span>
            </div>
            <form id="schedule-form">
              <div class="form-group">
                <label>Dispositiu Shelly</label>
                <select id="modal-device" ${!this._editingSchedule.isNew ? 'disabled' : ''}>
                  ${devKeys.map((k) => `
                    <option value="${k}" ${this._editingSchedule.device === k ? 'selected' : ''}>
                      ${devices[k].name || devices[k].host}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group">
                <label>Canal / Relay</label>
                <input type="number" id="modal-channel" min="0" max="3" value="${this._editingSchedule.channel || 0}">
              </div>

              <div class="form-group">
                <label>Tipus d'hora</label>
                <select id="modal-time-type">
                  <option value="time" ${this._editingSchedule.time_type === 'time' ? 'selected' : ''}>Hora exacta (HH:MM)</option>
                  <option value="sunrise" ${this._editingSchedule.time_type === 'sunrise' ? 'selected' : ''}>Sortida de sol (Sunrise)</option>
                  <option value="sunset" ${this._editingSchedule.time_type === 'sunset' ? 'selected' : ''}>Posta de sol (Sunset)</option>
                </select>
              </div>

              <div class="form-group">
                <label>Hora o desplaçament (p. ex. 08:30 o @sunset-15m)</label>
                <input type="text" id="modal-time" required value="${this._editingSchedule.time || '08:00'}">
              </div>

              <div class="form-group">
                <label>Acció</label>
                <select id="modal-action">
                  <option value="on" ${this._editingSchedule.action === 'on' ? 'selected' : ''}>Encendre (ON)</option>
                  <option value="off" ${this._editingSchedule.action === 'off' ? 'selected' : ''}>Apagar (OFF)</option>
                </select>
              </div>

              <div class="form-group">
                <label>Dies de la setmana</label>
                <div class="day-picker">
                  ${[1, 2, 3, 4, 5, 6, 0].map((d) => `
                    <div class="day-btn ${(this._editingSchedule.days || []).includes(d) ? 'selected' : ''}" data-day="${d}">
                      ${DAY_LABELS[d]}
                    </div>
                  `).join('')}
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
      ` : ''}
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const root = this.shadowRoot;

    // Refresh button
    const refreshBtn = root.getElementById("btn-refresh");
    if (refreshBtn) refreshBtn.onclick = () => this._fetchSchedules(true);

    // Create button
    const createBtn = root.getElementById("btn-create");
    if (createBtn) createBtn.onclick = () => this._openCreateModal(this._selectedDevice !== "all" ? this._selectedDevice : "");

    // Filter chips
    root.querySelectorAll(".chip").forEach((chip) => {
      chip.onclick = () => {
        this._selectedDevice = chip.getAttribute("data-dev");
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
