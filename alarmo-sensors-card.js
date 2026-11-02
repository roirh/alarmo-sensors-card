/**
 * alarmo-sensors-card
 * Custom Lovelace card to visualize the state of the sensors configured in Alarmo.
 *
 * - Read-only: consumes the existing Alarmo WebSocket API (alarmo/sensors, alarmo/areas,
 *   alarmo/entities) without requiring any modification to the integration.
 * - Live sensor state comes from hass.states (already subscribed by Lovelace).
 * - Groups sensors by area and filters by arm mode (away, home, night, vacation, custom).
 * - Defensive design: if the Alarmo WS API changes or is unavailable, the card falls back
 *   to a manual entity list (`entities:` / `include:` in the YAML config) instead of breaking.
 *
 * Install: copy this file to /config/www/ and register it as a JS module resource
 *   /local/alarmo-sensors-card.js — then use `type: custom:alarmo-sensors-card`.
 */

const CARD_VERSION = '0.3.1-rc.4';

/* ------------------------------------------------------------------ */
/* Static metadata (mirrors alarmo's own frontend const.ts / const.py) */
/* ------------------------------------------------------------------ */

// States that alarmo's sensors.py considers "open" (SENSOR_STATES_OPEN) and "closed".
const OPEN_STATES = ['on', 'open', 'unlocked'];
const CLOSED_STATES = ['off', 'closed', 'locked'];

const SENSOR_TYPES = {
  door: { en: 'Door', es: 'Puerta' },
  window: { en: 'Window', es: 'Ventana' },
  motion: { en: 'Motion', es: 'Movimiento' },
  tamper: { en: 'Tamper', es: 'Manipulación' },
  environmental: { en: 'Environmental', es: 'Ambiental' },
  other: { en: 'Other', es: 'Otro' },
};

const SENSOR_ICONS = {
  door: { closed: 'mdi:door-closed', open: 'mdi:door-open' },
  window: { closed: 'mdi:window-closed', open: 'mdi:window-open' },
  motion: { closed: 'mdi:motion-sensor-off', open: 'mdi:motion-sensor' },
  tamper: { closed: 'mdi:crop-portrait', open: 'mdi:vibrate' },
  environmental: { closed: 'mdi:fire', open: 'mdi:fire-alert' },
  other: { closed: 'mdi:check-circle', open: 'mdi:alert-circle' },
};

const MODES = {
  armed_away: { label: { en: 'Away', es: 'Fuera' }, icon: 'mdi:exit-run' },
  armed_home: { label: { en: 'Home', es: 'Casa' }, icon: 'mdi:home' },
  armed_night: { label: { en: 'Night', es: 'Noche' }, icon: 'mdi:weather-night' },
  armed_vacation: { label: { en: 'Vacation', es: 'Vacaciones' }, icon: 'mdi:palm-tree' },
  armed_custom_bypass: { label: { en: 'Custom', es: 'Personalizado' }, icon: 'mdi:wrench' },
};

const DISARMED_ICON = 'mdi:shield-off';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const i18n = (lang, table) => (table && (table[lang] || table.en)) || '';

function isOpen(state) {
  return OPEN_STATES.includes(state);
}
function isClosed(state) {
  return CLOSED_STATES.includes(state);
}

function computeDomain(entityId) {
  return entityId.substr(0, entityId.indexOf('.'));
}

function friendlyName(stateObj) {
  return (stateObj && stateObj.attributes && stateObj.attributes.friendly_name) || '';
}

function normalizeSensorType(rawType, stateObj) {
  if (rawType && SENSOR_TYPES[rawType]) return rawType;
  // Fall back to the HA device_class, the same mapping alarmo's frontend uses
  // when suggesting a type for a new sensor (sensors.ts / sensorClassToType).
  const dc = stateObj && stateObj.attributes && stateObj.attributes.device_class;
  switch (dc) {
    case 'door':
    case 'garage_door':
    case 'lock':
    case 'opening':
      return 'door';
    case 'window':
      return 'window';
    case 'motion':
    case 'moving':
    case 'occupancy':
    case 'presence':
    case 'vibration':
    case 'sound':
      return 'motion';
    case 'tamper':
      return 'tamper';
    case 'carbon_monoxide':
    case 'gas':
    case 'heat':
    case 'moisture':
    case 'smoke':
    case 'safety':
      return 'environmental';
    default:
      return computeDomain(stateObj ? stateObj.entity_id : '') === 'lock' ? 'door' : 'other';
  }
}

/* Device-grouping helpers ------------------------------------------ */

// Common HA sensor suffixes. Entities sharing a stem (e.g. puerta_fondo_contact
// + puerta_fondo_tamper) are treated as the same physical device when the
// entity registry has no device_id for them.
const STEM_SUFFIXES = [
  '_contact', '_tamper', '_occupancy', '_motion_detection', '_motion',
  '_opening', '_vibration', '_sound', '_safety', '_smoke', '_gas',
  '_moisture', '_heat', '_carbon_monoxide',
];

function sensorStem(entityId) {
  const bare = entityId.replace(/^[^.]+\./, '');
  for (const s of STEM_SUFFIXES) {
    if (bare.endsWith(s)) return bare.slice(0, -s.length);
  }
  return null;
}

function prettify(stem) {
  return stem
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// Render order: regular sensors first, tampers last (so a tamper never
// becomes the primary of a device group).
const TYPE_RANK = { door: 0, window: 0, motion: 1, environmental: 2, other: 3, tamper: 4 };

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

class AlarmoSensorsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._alarmo = null;          // normalized data model
    this._loading = false;
    this._loadFailed = false;
    _scheduleRetry.clear(this);
    this._unsubConfig = null;
    this._collapsedAreas = new Set();
    this._activeModeFilters = null; // single selected mode, or null = show all
    this._expandedSensor = null;
  }

  /* ---------- Lovelace integration ---------- */

  setConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid configuration');
    }
    this._config = {
      title: config.title || '',
      group_by: config.group_by || 'area',            // 'area' | 'none'
      group_by_device: config.group_by_device !== false, // default true
      areas: Array.isArray(config.areas) ? config.areas : null,
      modes: Array.isArray(config.modes) ? config.modes : null,
      show_disabled: !!config.show_disabled,
      compact: !!config.compact,
      sort: config.sort || 'name',                    // 'name' | 'open_first'
      entities: Array.isArray(config.entities) ? config.entities : null,
      include: typeof config.include === 'string' ? config.include : null,
      show_more_info: config.show_more_info !== false,
      debug: !!config.debug,
    };
    this._alarmo = null;
    this._activeModeFilters = null;
    if (this._hass) this._loadAlarmoData(this._hass);
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._alarmo && !this._loading) {
      this._loadAlarmoData(hass);
    }
    this._render();
  }

  static getStubConfig() {
    return { type: 'custom:alarmo-sensors-card', title: 'Alarmo · Sensores' };
  }

  getCardSize() {
    return 4;
  }

  static getConfigElement() {
    return document.createElement('alarmo-sensors-card-editor');
  }

  disconnectedCallback() {
    _scheduleRetry.clear(this);
    if (this._unsubConfig) {
      try { this._unsubConfig.then((fn) => fn()); } catch (e) { /* noop */ }
      this._unsubConfig = null;
    }
  }

  /* ---------- Data loading (defensive) ---------- */

  async _loadAlarmoData(hass) {
    if (this._loading) return;
    this._loading = true;
    let wsOk = false;

    try {
      const safe = (p) => p.catch(() => null);
      const [sensors, areas, entities] = await Promise.all([
        safe(hass.callWS({ type: 'alarmo/sensors' })),
        safe(hass.callWS({ type: 'alarmo/areas' })),
        safe(hass.callWS({ type: 'alarmo/entities' })),
      ]);

      if (sensors && areas) {
        wsOk = true;
        this._alarmo = this._buildModelFromWs(sensors || {}, areas || {}, entities || []);
        this._loadFailed = false;
        this._subscribeConfigUpdates(hass);
      }
    } catch (e) {
      // ignore, fall through to fallback
    }

    if (!wsOk) {
      // Fallback: build model from manual config and/or hass.states so the
      // card still works if the WS API shape ever changes.
      this._alarmo = this._buildModelFallback();
      this._loadFailed = true;
      _scheduleRetry.set(this, setTimeout(() => {
        this._loading = false;
        if (this._hass && this._alarmo && this._alarmo.source !== 'ws') {
          this._loadAlarmoData(this._hass);
        }
      }, 60000));
    }

    this._loading = false;
    this._render();
  }

  async _subscribeConfigUpdates(hass) {
    if (this._unsubConfig) return;
    try {
      const conn = hass.connection || hass.conn;
      if (conn && typeof conn.subscribeMessage === 'function') {
        this._unsubConfig = await conn.subscribeMessage(() => {
          // Alarmo config changed -> reload sensor/area definitions.
          this._alarmo = null;
          this._loading = false;
          if (this._hass) this._loadAlarmoData(this._hass);
        }, { type: 'alarmo_config_updated' });
      }
    } catch (e) {
      this._unsubConfig = null; // subscription is optional
    }
  }

  _buildModelFromWs(sensors, areas, alarmEntities) {
    const areaList = Object.values(areas).map((a) => ({
      area_id: String(a.area_id),
      name: a.name || String(a.area_id),
      modes: Object.keys((a.modes || {})).filter((m) => a.modes[m] && a.modes[m].enabled),
    }));

    const entityByArea = {};
    (Array.isArray(alarmEntities) ? alarmEntities : []).forEach((e) => {
      entityByArea[String(e.area_id)] = e.entity_id;
    });

    const sensorList = Object.values(sensors)
      .filter((s) => s && s.entity_id)
      .map((s) => ({
        entity_id: s.entity_id,
        name: friendlyName(this._hass && this._hass.states[s.entity_id]) || s.entity_id,
        type: normalizeSensorType(s.type, this._hass && this._hass.states[s.entity_id]),
        area: s.area != null ? String(s.area) : null,
        modes: Array.isArray(s.modes) ? s.modes : [],
        enabled: s.enabled !== false,
        always_on: !!s.always_on,
        auto_bypass: !!s.auto_bypass,
        group: s.group || null,
      }));

    return {
      source: 'ws',
      areas: areaList,
      sensors: sensorList,
      entityByArea,
    };
  }

  _buildModelFallback() {
    const lang = this._language();
    let entries = [];

    if (this._config.entities) {
      entries = this._config.entities.map((e) => ({
        entity_id: e.entity,
        name: e.name || e.entity,
        type: e.type || 'other',
        area: e.area || null,
        modes: Array.isArray(e.modes) ? e.modes : [],
        enabled: e.enabled !== false,
        always_on: !!e.always_on,
        auto_bypass: false,
        group: null,
      }));
    } else if (this._config.include) {
      let re;
      try { re = new RegExp(this._config.include); } catch (e) { re = null; }
      if (re) {
        entries = Object.values(this._hass ? this._hass.states : {})
          .filter((s) => re.test(s.entity_id) || re.test(friendlyName(s)))
          .map((s) => ({
            entity_id: s.entity_id,
            name: friendlyName(s) || s.entity_id,
            type: normalizeSensorType(null, s),
            area: (s.attributes && (s.attributes.area || s.attributes.room)) || null,
            modes: [],
            enabled: true,
            always_on: false,
            auto_bypass: false,
            group: null,
          }));
      }
    }

    const areasByName = new Map();
    entries.forEach((s) => {
      const key = s.area || i18n(lang, { en: 'Sensors', es: 'Sensores' });
      if (!areasByName.has(key)) {
        areasByName.set(key, { area_id: key, name: key, modes: [] });
      }
    });

    return {
      source: 'manual',
      areas: [...areasByName.values()],
      sensors: entries,
      entityByArea: {},
    };
  }

  /* ---------- Derived view model ---------- */

  _language() {
    const l = this._hass && (this._hass.language || this._hass.locale);
    return l && String(l).toLowerCase().startsWith('es') ? 'es' : 'en';
  }

  _allModes() {
    if (!this._alarmo) return [];
    // Explicit config restricts the offered filter chips; otherwise derive
    // from the alarmo data itself (sensors' modes + enabled area modes).
    if (this._config.modes) return this._config.modes.filter((m) => MODES[m]);
    const set = new Set();
    this._alarmo.sensors.forEach((s) => (s.modes || []).forEach((m) => set.add(m)));
    this._alarmo.areas.forEach((a) => (a.modes || []).forEach((m) => set.add(m)));
    return [...set].filter((m) => MODES[m]);
  }

  _filteredSensors() {
    const mode = this._activeModeFilters;
    return this._alarmo.sensors.filter((s) => {
      if (!this._config.show_disabled && !s.enabled) return false;
      if (mode) {
        // A sensor matches when it is active in the selected mode
        // (always_on sensors apply to every mode).
        const match = s.always_on || (s.modes || []).includes(mode);
        if (!match) return false;
      }
      return true;
    });
  }

  _visibleSensors(areaId) {
    return this._mergeRows(this._filteredSensors().filter((s) => {
      const areaKey = s.area != null ? String(s.area) : (this._alarmo.areas[0] ? this._alarmo.areas[0].area_id : null);
      return areaKey === areaId;
    }));
  }

  _allRows() {
    return this._mergeRows(this._filteredSensors());
  }

  /* HA zone of a row: entity registry area -> device area, primary members
   * first. Returns null when nothing in the row is assigned to a zone. */
  _deviceAreaName(row) {
    const h = this._hass;
    if (!h) return null;
    const members = [row.primary, ...row.companions];
    for (const s of members) {
      const reg = h.entities && h.entities[s.entity_id];
      if (this._config.debug) {
        console.debug('[alarmo-sensors-card]', s.entity_id,
          'reg:', reg ? JSON.stringify({ device_id: reg.device_id, area_id: reg.area_id }) : 'NO está en hass.entities');
      }
      if (reg && reg.area_id && h.areas && h.areas[reg.area_id] && h.areas[reg.area_id].name) {
        return h.areas[reg.area_id].name;
      }
      const devId = this._resolveDeviceId(s.entity_id);
      if (devId && h.devices && h.devices[devId]) {
        const d = h.devices[devId];
        if (this._config.debug) {
          console.debug('[alarmo-sensors-card]', s.entity_id, 'device:', d.name || d.id, 'area_id:', d.area_id || 'SIN ZONA');
        }
        if (d.area_id && h.areas && h.areas[d.area_id] && h.areas[d.area_id].name) {
          return h.areas[d.area_id].name;
        }
      }
    }
    return null;
  }

  _resolveDeviceId(entityId) {
    const h = this._hass;
    const reg = h && h.entities && h.entities[entityId];
    if (reg && reg.device_id) return reg.device_id;
    // Fallback: algún hermano con la misma raíz de nombre sí que expone
    // device_id (registries que separan contact/tamper en entidades sueltas).
    const stem = sensorStem(entityId);
    if (stem && h && h.entities) {
      for (const [eid, entry] of Object.entries(h.entities)) {
        if (entry && entry.device_id && eid !== entityId && eid.includes(stem)) {
          return entry.device_id;
        }
      }
    }
    return null;
  }

  _armChipForArea(areaId, lang, t) {
    const alarmEid = this._alarmo.entityByArea[areaId];
    const alarmState = alarmEid && this._hass && this._hass.states[alarmEid];
    const armMode = alarmState && alarmState.attributes && alarmState.attributes.arm_mode;
    const alarmRaw = alarmState ? String(alarmState.state).toLowerCase() : null;
    if (!alarmRaw) return '';
    const cls = alarmRaw.includes('triggered') ? 'arm-triggered'
      : alarmRaw === 'disarmed' ? 'arm-disarmed'
      : alarmRaw === 'pending' || alarmRaw === 'arming' ? 'arm-pending' : 'arm-armed';
    const label = alarmRaw.includes('triggered') ? i18n(lang, t.armState.triggered)
      : alarmRaw === 'disarmed' ? i18n(lang, t.armState.disarmed)
      : `${i18n(lang, t.armState.armed)}${armMode && MODES[armMode] ? ' · ' + i18n(lang, MODES[armMode].label) : ''}`;
    return `<span class="armchip ${cls}"><ha-icon icon="${armMode && MODES[armMode] ? MODES[armMode].icon : DISARMED_ICON}"></ha-icon>${label}</span>`;
  }

  /* Merge sensors that belong to the same physical device into single rows
   * (e.g. puerta_fondo_contact + puerta_fondo_tamper -> one row).
   * Strategy, in order of reliability:
   *   1. HA entity registry device_id (hass.entities), when available.
   *   2. Shared name stem (puerta_fondo_contact / puerta_fondo_tamper).
   * Groups with a single member render as regular rows, so nothing changes
   * for sensors that have no tamper/companion counterpart.
   */
  _mergeRows(sensors) {
    if (!this._config.group_by_device) {
      return sensors.map((s) => ({ primary: s, companions: [] }));
    }
    // Union-find: sensors are merged when they share a device_id (entity
    // registry) OR a name stem (puerta_fondo_contact / puerta_fondo_tamper).
    // Either signal alone is enough — registries differ between integrations.
    const parent = new Map(sensors.map((s) => [s.entity_id, s.entity_id]));
    const find = (x) => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
    const union = (a, b) => {
      const ra = find(a.entity_id);
      const rb = find(b.entity_id);
      if (ra !== rb) parent.set(ra, rb);
    };
    const byDev = new Map();
    const byStem = new Map();
    sensors.forEach((s) => {
      const dev = this._resolveDeviceId(s.entity_id);
      if (dev) {
        if (byDev.has(dev)) union(byDev.get(dev), s); else byDev.set(dev, s);
      }
      const stem = sensorStem(s.entity_id);
      if (stem) {
        const key = (s.area || '') + '|' + stem;
        if (byStem.has(key)) union(byStem.get(key), s); else byStem.set(key, s);
      }
    });

    const gmap = new Map();
    sensors.forEach((s) => {
      const root = find(s.entity_id);
      if (!gmap.has(root)) gmap.set(root, []);
      gmap.get(root).push(s);
    });

    const rows = [];
    gmap.forEach((members) => {
      if (members.length < 2) {
        rows.push({ primary: members[0], companions: [] });
        return;
      }
      const sorted = members.slice().sort(
        (a, b) => ((TYPE_RANK[a.type] ?? 3) - (TYPE_RANK[b.type] ?? 3)) || a.name.localeCompare(b.name)
      );
      // Prefer an enabled non-tamper sensor as the row's primary.
      const primary =
        sorted.find((s) => s.enabled && s.type !== 'tamper') ||
        sorted.find((s) => s.type !== 'tamper') ||
        sorted[0];
      const companions = sorted.filter((s) => s !== primary);
      rows.push({ primary, companions, grouped: true, name: this._deviceName(members, primary) });
    });

    const rowName = (r) => r.name || r.primary.name;
    const rowOpen = (r) => (this._sensorState(r.primary.entity_id) === 'open' ? 0 : 1);
    if (this._config.sort === 'open_first') {
      rows.sort((a, b) => rowOpen(a) - rowOpen(b) || rowName(a).localeCompare(rowName(b)));
    } else {
      rows.sort((a, b) => rowName(a).localeCompare(rowName(b)));
    }
    return rows;
  }

  _deviceName(members, primary) {
    // Prefer the HA device registry name, fall back to the shared stem.
    const reg = this._hass && this._hass.entities && this._hass.entities[primary.entity_id];
    if (reg && reg.device_id && this._hass.devices) {
      const dev = this._hass.devices[reg.device_id];
      if (dev && (dev.name_by_user || dev.name)) return dev.name_by_user || dev.name;
    }
    const stem = sensorStem(primary.entity_id);
    return stem ? prettify(stem) : primary.name;
  }

  _rowTampers(row) {
    return row.companions.filter((c) => c.type === 'tamper');
  }

  _visibleAreas() {
    if (!this._alarmo) return [];
    let areas = this._alarmo.areas;
    if (this._config.areas) {
      const wanted = this._config.areas.map(String);
      areas = areas.filter((a) => wanted.includes(a.area_id) || wanted.includes(a.name));
    }
    return areas;
  }

  _sensorState(entityId) {
    const stateObj = this._hass && this._hass.states[entityId];
    if (!stateObj) return 'missing';
    const st = String(stateObj.state).toLowerCase();
    if (st === 'unavailable' || st === 'unknown' || st === 'none') return 'unavailable';
    if (isOpen(st)) return 'open';
    if (isClosed(st)) return 'closed';
    return 'other';
  }

  _bypassedSet() {
    // Alarm entity attributes expose bypassed_sensors / open_sensors (read-only info).
    const result = new Set();
    if (!this._hass || !this._alarmo) return result;
    Object.values(this._alarmo.entityByArea).forEach((eid) => {
      const s = this._hass.states[eid];
      const attr = s && s.attributes;
      if (!attr) return;
      (attr.bypassed_sensors || []).forEach((x) => result.add(x));
    });
    return result;
  }

  /* ---------- Rendering ---------- */

  _render() {
    const lang = this._language();
    const t = {
      sensors: { en: 'sensors', es: 'sensores' },
      open: { en: 'Open', es: 'Abierto' },
      closed: { en: 'Closed', es: 'Cerrado' },
      unavailable: { en: 'Unavailable', es: 'No disponible' },
      missing: { en: 'Not found', es: 'No encontrado' },
      disabled: { en: 'Disabled', es: 'Desactivado' },
      alwaysOn: { en: '24/7', es: '24/7' },
      bypass: { en: 'Bypassed', es: 'Bypass' },
      tamper: { en: 'Tamper', es: 'Manip.' },
      noZone: { en: 'No zone', es: 'Sin zona' },
      allModes: { en: 'All', es: 'Todos' },
      noData: { en: 'Waiting for Alarmo data…', es: 'Esperando datos de Alarmo…' },
      wsWarn: {
        en: 'Alarmo API not reachable – showing manual/fallback list.',
        es: 'API de Alarmo no disponible – mostrando lista manual/alternativa.',
      },
      armState: {
        disarmed: { en: 'Disarmed', es: 'Desarmada' },
        armed: { en: 'Armed', es: 'Armada' },
        triggered: { en: 'TRIGGERED', es: 'DISPARADA' },
        pending: { en: 'Arming…', es: 'Armando…' },
      },
    };

    if (!this._alarmo) {
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div class="empty">${i18n(lang, t.noData)}</div>
        </ha-card>
        ${this._styles()}
      `;
      return;
    }

    const groupBy = this._config.group_by;
    const bypassed = this._bypassedSet();
    const allModes = this._allModes();
    const filters = this._activeModeFilters;

    // Filter chips (single-select: only one mode active at a time)
    const chips = allModes.map((m) => {
      const active = filters === m;
      return `
        <button class="chip ${active ? 'chip-active' : ''}" data-mode="${m}" title="${i18n(lang, MODES[m].label)}">
          <ha-icon icon="${MODES[m].icon}"></ha-icon>
          <span>${i18n(lang, MODES[m].label)}</span>
        </button>
      `;
    }).join('');

    const chipAll = `
      <button class="chip ${!filters ? 'chip-active' : ''}" data-mode="__all__">
        <ha-icon icon="mdi:filter-variant-remove"></ha-icon>
        <span>${i18n(lang, t.allModes)}</span>
      </button>
    `;

    // Build section list — either alarmo areas or HA zones (device areas).
    const sectionsList = [];
    if (groupBy === 'device_area') {
      const noZone = i18n(lang, t.noZone);
      const buckets = new Map();
      this._allRows().forEach((r) => {
        const zone = this._deviceAreaName(r) || noZone;
        if (!buckets.has(zone)) buckets.set(zone, []);
        buckets.get(zone).push(r);
      });
      [...buckets.entries()]
        .sort((a, b) => ((a[0] === noZone) - (b[0] === noZone)) || a[0].localeCompare(b[0]))
        .forEach(([zone, rows]) => sectionsList.push({
          key: 'z:' + zone,
          title: zone,
          rows,
          armChip: this._alarmo.areas.length === 1 ? this._armChipForArea(this._alarmo.areas[0].area_id, lang, t) : '',
        }));
    } else if (groupBy === 'area') {
      const areas = this._visibleAreas();
      areas.forEach((area) => {
        const rows = this._visibleSensors(area.area_id);
        if (!this._config.show_disabled && !rows.length && this._alarmo.sensors.length && areas.length > 1) return;
        sectionsList.push({ key: area.area_id, title: area.name, rows, armChip: this._armChipForArea(area.area_id, lang, t) });
      });
    }

    // Area sections
    const sections = sectionsList.map(({ key, title, rows, armChip }) => {
      const collapsed = this._collapsedAreas.has(key);
      const rowHtml = rows.map((s) => this._sensorRow(s, bypassed, lang, t)).join('');
      const summary = this._summaryBadge(rows, lang, t);

      return `
        <section class="area ${collapsed ? 'collapsed' : ''}">
          <header data-area="${key}">
            <ha-icon class="caret" icon="${collapsed ? 'mdi:chevron-right' : 'mdi:chevron-down'}"></ha-icon>
            <span class="area-name">${title}</span>
            ${armChip}
            <span class="count">${summary}</span>
          </header>
          ${collapsed ? '' : `<div class="rows">${rowHtml || `<div class="empty small">${i18n(lang, { en: 'No sensors match the filter', es: 'Ningún sensor coincide con el filtro' })}</div>`}</div>`}
        </section>
      `;
    }).join('');

    const title = this._config.title
      ? `<div class="title">${this._config.title}</div>`
      : '';

    const warn = this._loadFailed
      ? `<div class="warn"><ha-icon icon="mdi:alert-outline"></ha-icon>${i18n(lang, t.wsWarn)}</div>`
      : '';

    this.shadowRoot.innerHTML = `
      <ha-card>
        ${title}
        ${allModes.length ? `<div class="chips">${chipAll}${chips}</div>` : ''}
        ${warn}
        ${groupBy !== 'none' ? sections : this._flatList(lang, t, bypassed)}
      </ha-card>
      ${this._styles()}
    `;

    this._bindEvents();
  }

  _flatList(lang, t, bypassed) {
    const rows = this._mergeRows(
      this._alarmo.sensors.filter((s) => this._config.show_disabled || s.enabled)
    );
    return `<div class="rows">${rows.map((r) => this._sensorRow(r, bypassed, lang, t)).join('')}</div>`;
  }

  _summaryBadge(rows, lang, t) {
    const open = rows.filter((r) => this._sensorState(r.primary.entity_id) === 'open').length;
    return open
      ? `<span class="open-badge">${open} ${i18n(lang, t.open).toLowerCase()}</span>`
      : `<span class="ok-badge">✓</span>`;
  }

  _sensorRow(row, bypassed, lang, t) {
    const sensor = row.primary;
    const st = this._sensorState(sensor.entity_id);
    const open = st === 'open';
    const icon = SENSOR_ICONS[sensor.type] || SENSOR_ICONS.other;
    const typeLabel = i18n(lang, SENSOR_TYPES[sensor.type] || SENSOR_TYPES.other);

    const badges = [];
    if (!sensor.enabled) badges.push(`<span class="badge badge-off">${i18n(lang, t.disabled)}</span>`);
    if (sensor.always_on) badges.push(`<span class="badge badge-aon">${i18n(lang, t.alwaysOn)}</span>`);
    if (bypassed.has(sensor.entity_id)) badges.push(`<span class="badge badge-bypass">${i18n(lang, t.bypass)}</span>`);
    if (sensor.auto_bypass) badges.push(`<span class="badge badge-bypass" title="auto_bypass">auto</span>`);

    // Tamper companions: one compact badge per tamper entity in the device group.
    const tamperBadges = this._rowTampers(row).map((tp) => {
      const tst = this._sensorState(tp.entity_id);
      const active = tst === 'open';
      const cls = active ? 'badge-tamper-active' : tst === 'unavailable' ? 'badge-tamper-unavail' : 'badge-tamper';
      return `<span class="badge ${cls}" data-tamper="${tp.entity_id}" title="${i18n(lang, t.tamper)}: ${tp.name}">
        <ha-icon icon="${active ? 'mdi:shield-alert' : 'mdi:shield-outline'}"></ha-icon>${i18n(lang, t.tamper)}</span>`;
    }).join('');

    const all = [sensor, ...row.companions];
    const modeSet = new Set();
    all.forEach((s) => (s.modes || []).forEach((m) => MODES[m] && modeSet.add(m)));
    const modeIcons = [...modeSet].map((m) => `
      <ha-icon class="mode-ic" icon="${MODES[m].icon}" title="${i18n(lang, MODES[m].label)}"></ha-icon>
    `).join('');

    const stateCls = st === 'open' ? 'st-open' : st === 'closed' ? 'st-closed' : st === 'unavailable' ? 'st-unavail' : 'st-missing';
    const stateLabel = st === 'open' ? i18n(lang, t.open)
      : st === 'closed' ? i18n(lang, t.closed)
      : st === 'unavailable' ? i18n(lang, t.unavailable)
      : i18n(lang, t.missing);

    return `
      <div class="row ${this._config.compact ? 'compact' : ''} ${st === 'open' ? 'row-open' : ''} ${row.grouped ? 'row-grouped' : ''}" data-entity="${sensor.entity_id}">
        <ha-icon class="s-ic ${stateCls}" icon="${open ? icon.open : icon.closed}"></ha-icon>
        <div class="s-main">
          <div class="s-name">${row.name || sensor.name}</div>
          <div class="s-sub">
            <span class="s-type">${typeLabel}</span>
            ${modeIcons}
            ${badges.join('')}
            ${tamperBadges}
          </div>
        </div>
        <span class="s-state ${stateCls}">${stateLabel}</span>
      </div>
    `;
  }

  _bindEvents() {
    const root = this.shadowRoot;

    root.querySelectorAll('.chip').forEach((el) => {
      el.addEventListener('click', () => {
        const mode = el.getAttribute('data-mode');
        if (mode === '__all__') {
          this._activeModeFilters = null;
        } else {
          // Single-select: activate only this mode; tapping the active one
          // again returns to "All".
          this._activeModeFilters = this._activeModeFilters === mode ? null : mode;
        }
        this._render();
      });
    });

    root.querySelectorAll('section.area > header').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-area');
        if (this._collapsedAreas.has(id)) this._collapsedAreas.delete(id);
        else this._collapsedAreas.add(id);
        this._render();
      });
    });

    if (this._config.show_more_info) {
      root.querySelectorAll('.row').forEach((el) => {
        el.addEventListener('click', () => {
          this._openMoreInfo(el.getAttribute('data-entity'));
        });
      });
      // A tamper badge opens the dialog of the tamper entity itself.
      root.querySelectorAll('.badge[data-tamper]').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openMoreInfo(el.getAttribute('data-tamper'));
        });
      });
    }
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    // Standard Lovelace event: opens Home Assistant's more-info dialog,
    // exactly like clicking the entity anywhere else in the frontend.
    // HA >= 2025.x reads detail.entityId; older versions read .entity — set both.
    const ev = new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } });
    Object.defineProperty(ev, 'entity', { value: entityId });
    this.dispatchEvent(ev);
  }

  _styles() {
    return `
      <style>
        :host {
          display: block;
          --asc-open: var(--error-color, #e53935);
          --asc-closed: var(--success-color, #43a047);
          --asc-idle: var(--secondary-text-color, #9e9e9e);
        }
        ha-card { padding: 12px 14px; }
        .title {
          font-size: 1.15em; font-weight: 600;
          padding: 2px 0 8px;
          color: var(--primary-text-color);
        }
        .empty { padding: 18px; color: var(--secondary-text-color); text-align: center; }
        .empty.small { padding: 10px; font-size: 0.9em; }

        .chips { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 10px; }
        .chip {
          display: inline-flex; align-items: center; gap: 4px;
          border: 1px solid var(--divider-color, #444);
          background: transparent; color: var(--primary-text-color);
          border-radius: 16px; padding: 4px 10px; font-size: 0.85em;
          cursor: pointer; opacity: 0.75;
        }
        .chip ha-icon { --mdc-icon-size: 16px; }
        .chip-active {
          opacity: 1; font-weight: 600;
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #fff);
          border-color: transparent;
        }

        .warn {
          color: var(--warning-color, #ff9800); font-size: 0.85em;
          display: flex; align-items: center; gap: 6px; padding-bottom: 8px;
        }
        .warn ha-icon { --mdc-icon-size: 16px; }

        section.area { margin-bottom: 4px; }
        section.area > header {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 2px; cursor: pointer; user-select: none;
        }
        .caret { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
        .area-name { font-weight: 600; color: var(--primary-text-color); }
        .armchip {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 0.75em; padding: 2px 8px; border-radius: 10px;
          background: var(--secondary-background-color, #eee);
          color: var(--secondary-text-color);
        }
        .armchip ha-icon { --mdc-icon-size: 14px; }
        .arm-armed { color: var(--primary-color, #03a9f4); }
        .arm-disarmed { color: var(--secondary-text-color); }
        .arm-pending { color: var(--warning-color, #ff9800); }
        .arm-triggered { color: var(--error-color, #e53935); font-weight: 700; }
        .count { margin-left: auto; font-size: 0.8em; color: var(--secondary-text-color); }
        .open-badge {
          color: var(--error-color, #e53935); font-weight: 600;
          background: color-mix(in srgb, var(--error-color, #e53935) 15%, transparent);
          padding: 1px 8px; border-radius: 10px;
        }
        .ok-badge { color: var(--success-color, #43a047); }

        .rows { display: flex; flex-direction: column; }
        .row {
          display: flex; align-items: center; gap: 10px;
          padding: 7px 6px; border-radius: 8px; cursor: pointer;
        }
        .row.compact { padding: 3px 6px; }
        .row:hover { background: var(--secondary-background-color, rgba(128,128,128,0.12)); }
        .row-open { background: color-mix(in srgb, var(--error-color, #e53935) 8%, transparent); }
        .row-open:hover { background: color-mix(in srgb, var(--error-color, #e53935) 14%, transparent); }

        .s-ic { --mdc-icon-size: 24px; flex-shrink: 0; }
        .row.compact .s-ic { --mdc-icon-size: 20px; }
        .st-open { color: var(--asc-open); }
        .st-closed { color: var(--asc-closed); }
        .st-unavail { color: var(--asc-idle); }
        .st-missing { color: var(--asc-idle); opacity: 0.5; }

        .s-main { flex: 1; min-width: 0; }
        .s-name {
          color: var(--primary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .row.compact .s-name { font-size: 0.92em; }
        .s-sub { display: flex; align-items: center; gap: 6px; }
        .s-type { font-size: 0.75em; color: var(--secondary-text-color); }
        .mode-ic { --mdc-icon-size: 14px; color: var(--secondary-text-color); }

        .badge {
          font-size: 0.68em; padding: 1px 6px; border-radius: 8px;
          background: var(--secondary-background-color, #eee);
          color: var(--secondary-text-color); font-weight: 600;
        }
        .badge-off { color: var(--warning-color, #ff9800); }
        .badge-aon { color: var(--accent-color, #ff9800); }
        .badge-bypass { color: var(--purple-color, #9c27b0); }

        .badge-tamper { color: var(--secondary-text-color); }
        .badge-tamper ha-icon, .badge-tamper-active ha-icon { --mdc-icon-size: 12px; vertical-align: -2px; }
        .badge-tamper-active {
          color: #fff;
          background: var(--asc-open);
        }
        .badge-tamper-unavail { opacity: 0.5; }
        .row-grouped .s-name { letter-spacing: 0.01em; }

        .s-state { font-size: 0.75em; font-weight: 600; white-space: nowrap; }
      </style>
    `;
  }
}

/* Retry helper (avoids stacking timers per instance) */
const _scheduleRetry = {
  set(el, id) { el.__retry = id; },
  clear(el) { if (el.__retry) { clearTimeout(el.__retry); el.__retry = null; } },
};

/* Register with Lovelace so the card picker offers it.
 * Guards: if another copy of this file is loaded (e.g. /local + HACS at once),
 * the first definition wins and we skip re-defining. */
if (!customElements.get('alarmo-sensors-card')) {
  customElements.define('alarmo-sensors-card', AlarmoSensorsCard);
}

/* ------------------------------------------------------------------ */
/* GUI editor (minimal, native elements – no external dependencies)    */
/* ------------------------------------------------------------------ */

class AlarmoSensorsCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    this._config = { ...config };
    if (!this.shadowRoot.childNodes.length) this._render();
    this._fill();
  }

  set hass(hass) { this._hass = hass; }

  _dispatch() {
    const ev = new Event('config-changed', { bubbles: true, composed: true });
    ev.detail = { config: this._config };
    this.dispatchEvent(ev);
  }

  _render() {
    // el shadow root ya existe (creado en el constructor)
    this.shadowRoot.innerHTML = `
      <style>
        .f { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
        label { display: flex; flex-direction: column; font-size: 0.85em; color: var(--secondary-text-color); gap: 4px; }
        input, select {
          padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color, #555);
          background: var(--card-background-color, #222); color: var(--primary-text-color);
        }
        .checks { display: flex; flex-wrap: wrap; gap: 10px; }
        .checks label { flex-direction: row; align-items: center; gap: 6px; }
      </style>
      <div class="f">
        <label>Título <input data-k="title" type="text"></label>
        <label>Agrupar por
          <select data-k="group_by">
            <option value="area">Área de Alarmo</option>
            <option value="device_area">Zona HA del dispositivo</option>
            <option value="none">Sin agrupar</option>
          </select>
        </label>
        <label>Orden
          <select data-k="sort">
            <option value="name">Nombre</option>
            <option value="open_first">Abiertos primero</option>
          </select>
        </label>
        <div class="checks">
          <label><input data-k="group_by_device" type="checkbox"> Agrupar por dispositivo (contact + tamper)</label>
          <label><input data-k="show_disabled" type="checkbox"> Mostrar sensores desactivados</label>
          <label><input data-k="compact" type="checkbox"> Compacto</label>
          <label><input data-k="debug" type="checkbox"> Debug (consola)</label>
        </div>
      </div>
    `;
    this.shadowRoot.querySelectorAll('[data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.getAttribute('data-k');
        if (el.type === 'checkbox') this._config[k] = el.checked;
        else this._config[k] = el.value;
        this._dispatch();
      });
    });
  }

  _fill() {
    this.shadowRoot.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.getAttribute('data-k');
      const v = this._config[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (v != null) el.value = v;
    });
  }
}

if (!customElements.get('alarmo-sensors-card-editor')) {
  customElements.define('alarmo-sensors-card-editor', AlarmoSensorsCardEditor);
}

/* Register with Lovelace so the card picker offers it */
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'alarmo-sensors-card',
  name: 'Alarmo Sensors Card',
  description: 'Muestra el estado de los sensores configurados en Alarmo, agrupados por área y filtrables por modo.',
  preview: false,
});

console.info(`%c ALARMO-SENSORS-CARD %c v${CARD_VERSION} `, 'color:white;background:#e53935;font-weight:bold', 'color:white;background:#555');
