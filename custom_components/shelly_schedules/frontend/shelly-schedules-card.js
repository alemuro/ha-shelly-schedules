/**
 * Shelly Schedules Lovelace Card & Sidebar Panel
 * Displays, modifies, deletes and creates on-device schedules for Shelly Gen 1 & Gen 2/3/Plus/Pro.
 */

const DAY_LABELS = ["Dg", "Dl", "Dt", "Dc", "Dj", "Dv", "Ds"]; // 0=Sun, 1=Mon...
const DAY_LABELS_FULL = ["Diumenge", "Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres", "Dissabte"];

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

  async _toggleSchedule(device, scheduleId, currentStatus, channel) {
    if (!this._hass) return;
    try {
      await this._hass.connection.sendMessagePromise({
        type: "shelly_schedules/toggle",
        device: device,
        schedule_id: scheduleId,
        enabled: !currentStatus,
        channel: channel || 0,
      });
      await this._fetchSchedules();
    } catch (err) {
      alert("Error canviant estat: " + (err.message || err));
    }
  }

  async _deleteSchedule(device, scheduleId, channel) {
    if (!confirm("Segur que vols eliminar aquest horari del dispositiu Shelly?")) return;
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
          padding: 16px;
          background: var(--primary-background-color, #fafafa);
          color: var(--primary-text-color, #212121);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          box-sizing: border-box;
          min-height: 100%;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          flex-wrap: wrap;
          gap: 12px;
        }
        .title {
          font-size: 24px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        button, .btn {
          background: var(--primary-color, #03a9f4);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
          font-size: 14px;
          transition: filter 0.2s;
        }
        button:hover, .btn:hover {
          filter: brightness(0.9);
        }
        .btn-outline {
          background: transparent;
          color: var(--primary-color, #03a9f4);
          border: 1px solid var(--primary-color, #03a9f4);
        }
        .btn-danger {
          background: #e53935;
          color: white;
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
        }
        .chip.active {
          background: var(--primary-color, #03a9f4);
          color: white;
          border-color: var(--primary-color, #03a9f4);
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 16px;
        }
        .card {
          background: var(--card-background-color, #ffffff);
          border-radius: 12px;
          padding: 16px;
          box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,0.08));
          display: flex;
          flex-direction: column;
          gap: 12px;
          position: relative;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .device-badge {
          font-size: 12px;
          color: var(--secondary-text-color, #757575);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .schedule-title {
          font-size: 18px;
          font-weight: bold;
          margin-top: 2px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .action-tag {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
        }
        .action-on {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .action-off {
          background: #ffebee;
          color: #c62828;
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
          font-size: 11px;
          font-weight: 500;
          background: var(--table-row-alternative-background-color, #f0f0f0);
          color: var(--secondary-text-color, #9e9e9e);
        }
        .day-badge.active {
          background: var(--primary-color, #03a9f4);
          color: white;
        }
        .card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid var(--divider-color, #eee);
          padding-top: 10px;
          margin-top: 4px;
        }
        .switch-container {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
        }
        .btn-group {
          display: flex;
          gap: 6px;
        }
        .empty-state {
          text-align: center;
          padding: 48px 16px;
          color: var(--secondary-text-color, #757575);
        }
        /* Modal */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal {
          background: var(--card-background-color, #ffffff);
          padding: 24px;
          border-radius: 12px;
          width: 90%;
          max-width: 480px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        }
        .modal-title {
          font-size: 20px;
          font-weight: bold;
          margin-bottom: 16px;
        }
        .form-group {
          margin-bottom: 14px;
        }
        .form-group label {
          display: block;
          margin-bottom: 4px;
          font-size: 13px;
          font-weight: 500;
        }
        .form-control, select, input {
          width: 100%;
          padding: 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          box-sizing: border-box;
          font-size: 14px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
        }
        .day-picker {
          display: flex;
          gap: 6px;
          margin-top: 4px;
        }
        .day-btn {
          flex: 1;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #ccc;
          border-radius: 6px;
          background: #f5f5f5;
          color: #333;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
          user-select: none;
        }
        .day-btn.selected {
          background: var(--primary-color, #03a9f4);
          color: white;
          border-color: var(--primary-color, #03a9f4);
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 20px;
        }
      </style>

      <div class="container">
        <div class="header">
          <div class="title">
            <span>⏰ Horaris Shelly</span>
            ${this._loading ? '<span style="font-size: 14px; opacity: 0.7;">(Actualitzant...)</span>' : ''}
          </div>
          <div class="actions">
            <button class="btn-outline" id="btn-refresh">🔄 Refrescar</button>
            <button id="btn-create">➕ Nou Horari</button>
          </div>
        </div>

        <!-- Filters -->
        <div class="filters">
          <div class="chip ${this._selectedDevice === 'all' ? 'active' : ''}" data-dev="all">
            Tots (${filteredSchedules.length})
          </div>
          ${devKeys.map((k) => `
            <div class="chip ${this._selectedDevice === k ? 'active' : ''}" data-dev="${k}">
              ${devices[k].name || devices[k].host} (${(devices[k].schedules || []).length})
            </div>
          `).join('')}
        </div>

        <!-- Schedule list -->
        ${filteredSchedules.length === 0 ? `
          <div class="empty-state">
            <h3>No s'han trobat horaris configurats</h3>
            <p>Fes clic a "➕ Nou Horari" per programar una acció a un Shelly.</p>
          </div>
        ` : `
          <div class="grid">
            ${filteredSchedules.map((s) => `
              <div class="card">
                <div class="card-header">
                  <div>
                    <div class="device-badge">${s.devName} (Relay ${s.channel || 0})</div>
                    <div class="schedule-title">
                      ${s.time_type === 'sunrise' ? '🌅 Sortida de sol ' + s.time_str : ''}
                      ${s.time_type === 'sunset' ? '🌇 Posta de sol ' + s.time_str : ''}
                      ${s.time_type !== 'sunrise' && s.time_type !== 'sunset' ? '🕒 ' + s.time_str : ''}
                    </div>
                  </div>
                  <span class="action-tag ${s.action === 'on' ? 'action-on' : 'action-off'}">
                    ${s.action === 'on' ? 'ENCÈS (ON)' : 'APAGAT (OFF)'}
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
                    <input type="checkbox" ${s.enabled ? 'checked' : ''} class="toggle-cb" data-dev="${s.deviceKey}" data-id="${s.id}" data-chan="${s.channel || 0}">
                    <span>${s.enabled ? 'Actiu' : 'Desactivat'}</span>
                  </div>
                  <div class="btn-group">
                    <button class="btn-outline btn-edit" data-dev="${s.deviceKey}" data-id="${s.id}">✏️</button>
                    <button class="btn-danger btn-delete" data-dev="${s.deviceKey}" data-id="${s.id}" data-chan="${s.channel || 0}">🗑️</button>
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
            <div class="modal-title">${this._editingSchedule.isNew ? 'Nou Horari Shelly' : 'Modificar Horari'}</div>
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
                <label>Tipus d'Hora</label>
                <select id="modal-time-type">
                  <option value="time" ${this._editingSchedule.time_type === 'time' ? 'selected' : ''}>Hora Exacta (HH:MM)</option>
                  <option value="sunrise" ${this._editingSchedule.time_type === 'sunrise' ? 'selected' : ''}>Sortida de Sol (Sunrise)</option>
                  <option value="sunset" ${this._editingSchedule.time_type === 'sunset' ? 'selected' : ''}>Posta de Sol (Sunset)</option>
                </select>
              </div>

              <div class="form-group">
                <label>Hora o Desplaçament (p. ex. 08:30 o sunrise+15)</label>
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
                <button type="button" class="btn-outline" id="modal-cancel">Cancel·lar</button>
                <button type="submit" id="modal-save">Desar Horari</button>
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
      cb.onchange = () => {
        const dev = cb.getAttribute("data-dev");
        const id = cb.getAttribute("data-id");
        const chan = cb.getAttribute("data-chan");
        this._toggleSchedule(dev, id, !cb.checked, chan);
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

customElements.define("shelly-schedules-panel", ShellySchedulesPanel);
customElements.define("shelly-schedules-card", ShellySchedulesPanel);

// Provide visual card editor info for Lovelace
window.customCards = window.customCards || [];
window.customCards.push({
  type: "shelly-schedules-card",
  name: "Shelly Schedules Card",
  preview: true,
  description: "Targeta interactiva per gestionar els horaris interns dels dispositius Shelly.",
});
