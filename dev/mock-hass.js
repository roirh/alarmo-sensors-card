/**
 * Mock of the Home Assistant `hass` object + a tiny <ha-icon> stub,
 * so the card can be developed and tested outside Home Assistant.
 * Sample data mirrors the real shapes returned by Alarmo's WS API
 * (see custom_components/alarmo/websockets.py and store.py).
 */

/* ---- <ha-icon> stub: renders MDI icons via CDN ---- */
customElements.define('ha-icon', class extends HTMLElement {
  static get observedAttributes() { return ['icon']; }
  connectedCallback() { this._render(); }
  attributeChangedCallback() { this._render(); }
  _render() {
    const icon = this.getAttribute('icon') || '';
    if (!icon.startsWith('mdi:')) { this.innerHTML = ''; return; }
    const name = icon.slice(4);
    this.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/${name}.svg"
      style="height:1em;width:1em;vertical-align:-0.125em;display:inline-block;
      filter:var(--mdi-filter,none);" alt="">`;
  }
});

/* ---- Sample Alarmo data (same shape as the WS API returns) ---- */
const MOCK_AREAS = {
  '1700000001': {
    area_id: '1700000001',
    name: 'Planta baja',
    modes: {
      armed_away: { enabled: true, exit_time: 60, entry_time: 30, trigger_time: 1800 },
      armed_home: { enabled: true, exit_time: null, entry_time: 30, trigger_time: 1800 },
      armed_night: { enabled: true, exit_time: null, entry_time: 30, trigger_time: 900 },
      armed_vacation: { enabled: false, exit_time: 60, entry_time: 30, trigger_time: 1800 },
      armed_custom_bypass: { enabled: false, exit_time: null, entry_time: null, trigger_time: 1800 },
    },
  },
  '1700000002': {
    area_id: '1700000002',
    name: 'Garaje',
    modes: {
      armed_away: { enabled: true, exit_time: 30, entry_time: 0, trigger_time: 300 },
      armed_home: { enabled: true, exit_time: null, entry_time: null, trigger_time: 300 },
      armed_night: { enabled: false, exit_time: null, entry_time: null, trigger_time: 300 },
      armed_vacation: { enabled: false, exit_time: null, entry_time: null, trigger_time: 300 },
      armed_custom_bypass: { enabled: false, exit_time: null, entry_time: null, trigger_time: 300 },
    },
  },
};

const MOCK_SENSORS = {
  'binary_sensor.puerta_principal': {
    entity_id: 'binary_sensor.puerta_principal',
    type: 'door', modes: ['armed_away', 'armed_home'],
    use_exit_delay: true, use_entry_delay: true, always_on: false, arm_on_close: false,
    allow_open: false, trigger_unavailable: false, auto_bypass: false, auto_bypass_modes: [],
    area: '1700000001', enabled: true, entry_delay: null, delay_on: null,
  },
  'binary_sensor.puerta_principal_tamper': {
    entity_id: 'binary_sensor.puerta_principal_tamper',
    type: 'tamper', modes: ['armed_away', 'armed_home'],
    use_exit_delay: false, use_entry_delay: false, always_on: false, arm_on_close: false,
    allow_open: false, trigger_unavailable: false, auto_bypass: false, auto_bypass_modes: [],
    area: '1700000001', enabled: true, entry_delay: null, delay_on: null,
  },
  'binary_sensor.ventana_salon': {
    entity_id: 'binary_sensor.ventana_salon',
    type: 'window', modes: ['armed_away', 'armed_home', 'armed_night'],
    use_exit_delay: false, use_entry_delay: false, always_on: false, arm_on_close: false,
    allow_open: false, trigger_unavailable: false, auto_bypass: false, auto_bypass_modes: [],
    area: '1700000001', enabled: true, entry_delay: null, delay_on: null,
  },
  'binary_sensor.ventana_salon_tamper': {
    entity_id: 'binary_sensor.ventana_salon_tamper',
    type: 'tamper', modes: ['armed_away', 'armed_home', 'armed_night'],
    use_exit_delay: false, use_entry_delay: false, always_on: false, arm_on_close: false,
    allow_open: false, trigger_unavailable: false, auto_bypass: false, auto_bypass_modes: [],
    area: '1700000001', enabled: true, entry_delay: null, delay_on: null,
  },
  'binary_sensor.movimiento_pasillo': {
    entity_id: 'binary_sensor.movimiento_pasillo',
    type: 'motion', modes: ['armed_away'],
    use_exit_delay: true, use_entry_delay: true, always_on: false, arm_on_close: false,
    allow_open: false, trigger_unavailable: false, auto_bypass: true, auto_bypass_modes: ['armed_home'],
    area: '1700000001', enabled: true, entry_delay: null, delay_on: null,
  },
  'binary_sensor.sensor_humo_cocina': {
    entity_id: 'binary_sensor.sensor_humo_cocina',
    type: 'environmental', modes: [],
    use_exit_delay: false, use_entry_delay: false, always_on: true, arm_on_close: false,
    allow_open: false, trigger_unavailable: false, auto_bypass: false, auto_bypass_modes: [],
    area: '1700000001', enabled: true, entry_delay: null, delay_on: null,
  },
  'binary_sensor.sensor_movimiento_garaje': {
    entity_id: 'binary_sensor.sensor_movimiento_garaje',
    type: 'motion', modes: ['armed_away'],
    use_exit_delay: false, use_entry_delay: false, always_on: false, arm_on_close: false,
    allow_open: false, trigger_unavailable: false, auto_bypass: false, auto_bypass_modes: [],
    area: '1700000002', enabled: true, entry_delay: null, delay_on: null,
  },
  'binary_sensor.puerta_garaje': {
    entity_id: 'binary_sensor.puerta_garaje',
    type: 'door', modes: ['armed_away', 'armed_home'],
    use_exit_delay: false, use_entry_delay: false, always_on: false, arm_on_close: true,
    allow_open: false, trigger_unavailable: false, auto_bypass: false, auto_bypass_modes: [],
    area: '1700000002', enabled: false, entry_delay: null, delay_on: null, // disabled on purpose
  },
  'lock.cerradura_entrada': {
    entity_id: 'lock.cerradura_entrada',
    type: 'door', modes: ['armed_away', 'armed_night'],
    use_exit_delay: false, use_entry_delay: true, always_on: false, arm_on_close: false,
    allow_open: true, trigger_unavailable: false, auto_bypass: false, auto_bypass_modes: [],
    area: '1700000001', enabled: true, entry_delay: null, delay_on: null,
  },
};

/* HA entity & device registries (as exposed via hass.entities / hass.devices).
 * Contact+Tamper pairs share device_id -> the card's primary grouping strategy. */
const MOCK_ENTITIES = {
  'binary_sensor.puerta_principal': { entity_id: 'binary_sensor.puerta_principal', device_id: 'dev_puerta_principal', area_id: 'cocina' },
  'binary_sensor.puerta_principal_tamper': { entity_id: 'binary_sensor.puerta_principal_tamper', device_id: 'dev_puerta_principal', area_id: 'cocina' },
  'binary_sensor.ventana_salon': { entity_id: 'binary_sensor.ventana_salon', device_id: 'dev_ventana_salon', area_id: 'salon' },
  'binary_sensor.ventana_salon_tamper': { entity_id: 'binary_sensor.ventana_salon_tamper', device_id: 'dev_ventana_salon', area_id: 'salon' },
  'binary_sensor.movimiento_pasillo': { entity_id: 'binary_sensor.movimiento_pasillo', device_id: 'dev_pir_pasillo', area_id: 'pasillo' },
  'binary_sensor.sensor_humo_cocina': { entity_id: 'binary_sensor.sensor_humo_cocina', device_id: 'dev_humo_cocina', area_id: 'cocina' },
  'binary_sensor.sensor_movimiento_garaje': { entity_id: 'binary_sensor.sensor_movimiento_garaje', device_id: 'dev_pir_garaje', area_id: 'garaje' },
  'binary_sensor.puerta_garaje': { entity_id: 'binary_sensor.puerta_garaje', device_id: 'dev_puerta_garaje', area_id: 'garaje' },
  'lock.cerradura_entrada': { entity_id: 'lock.cerradura_entrada', device_id: 'dev_cerradura', area_id: 'entrada' },
};

const MOCK_DEVICES = {
  dev_puerta_principal: { id: 'dev_puerta_principal', name: 'Puerta principal', area_id: 'entrada' },
  dev_ventana_salon: { id: 'dev_ventana_salon', name: 'Ventana salón', area_id: 'salon' },
  dev_pir_pasillo: { id: 'dev_pir_pasillo', name: 'PIR pasillo', area_id: 'pasillo' },
  dev_humo_cocina: { id: 'dev_humo_cocina', name: 'Detector humo cocina', area_id: 'cocina' },
  dev_pir_garaje: { id: 'dev_pir_garaje', name: 'PIR garaje', area_id: 'garaje' },
  dev_puerta_garaje: { id: 'dev_puerta_garaje', name: 'Puerta garaje', area_id: 'garaje' },
  dev_cerradura: { id: 'dev_cerradura', name: 'Cerradura entrada', area_id: 'entrada' },
};

const MOCK_ALARM_ENTITIES = [
  { entity_id: 'alarm_control_panel.planta_baja', area_id: '1700000001' },
  { entity_id: 'alarm_control_panel.garaje', area_id: '1700000002' },
];

/* ---- Live entity states ---- */
const STATES = {
  'alarm_control_panel.planta_baja': {
    entity_id: 'alarm_control_panel.planta_baja', state: 'armed_away',
    attributes: {
      friendly_name: 'Planta baja',
      arm_mode: 'armed_away', next_state: null,
      open_sensors: {}, bypassed_sensors: [], delay: 0, last_triggered: null,
    },
  },
  'alarm_control_panel.garaje': {
    entity_id: 'alarm_control_panel.garaje', state: 'disarmed',
    attributes: {
      friendly_name: 'Garaje',
      arm_mode: null, next_state: null,
      open_sensors: {}, bypassed_sensors: [], delay: 0, last_triggered: null,
    },
  },
  'binary_sensor.puerta_principal': { entity_id: 'binary_sensor.puerta_principal', state: 'off', attributes: { friendly_name: 'Puerta principal', device_class: 'door' } },
  'binary_sensor.puerta_principal_tamper': { entity_id: 'binary_sensor.puerta_principal_tamper', state: 'off', attributes: { friendly_name: 'Puerta principal tamper', device_class: 'tamper' } },
  'binary_sensor.ventana_salon': { entity_id: 'binary_sensor.ventana_salon', state: 'off', attributes: { friendly_name: 'Ventana salón', device_class: 'window' } },
  'binary_sensor.ventana_salon_tamper': { entity_id: 'binary_sensor.ventana_salon_tamper', state: 'off', attributes: { friendly_name: 'Ventana salón tamper', device_class: 'tamper' } },
  'binary_sensor.movimiento_pasillo': { entity_id: 'binary_sensor.movimiento_pasillo', state: 'off', attributes: { friendly_name: 'Movimiento pasillo', device_class: 'motion' } },
  'binary_sensor.sensor_humo_cocina': { entity_id: 'binary_sensor.sensor_humo_cocina', state: 'off', attributes: { friendly_name: 'Humo cocina', device_class: 'smoke' } },
  'binary_sensor.sensor_movimiento_garaje': { entity_id: 'binary_sensor.sensor_movimiento_garaje', state: 'off', attributes: { friendly_name: 'Movimiento garaje', device_class: 'motion' } },
  'binary_sensor.puerta_garaje': { entity_id: 'binary_sensor.puerta_garaje', state: 'off', attributes: { friendly_name: 'Puerta garaje', device_class: 'garage_door' } },
  'lock.cerradura_entrada': { entity_id: 'lock.cerradura_entrada', state: 'locked', attributes: { friendly_name: 'Cerradura entrada' } },
};

/* ---- The mock hass object ---- */
class MockHass {
  constructor() {
    this.language = 'es';
    this.states = STATES;
    this.entities = MOCK_ENTITIES;
    this.devices = MOCK_DEVICES;
    this.connection = {
      subscribeMessage: async (cb, msg) => {
        MockHass._subs[msg.type] = MockHass._subs[msg.type] || [];
        MockHass._subs[msg.type].push(cb);
        return () => {
          MockHass._subs[msg.type] = (MockHass._subs[msg.type] || []).filter((f) => f !== cb);
        };
      },
    };
    this.callWS = async (msg) => {
      switch (msg.type) {
        case 'alarmo/sensors': return JSON.parse(JSON.stringify(MOCK_SENSORS));
        case 'alarmo/areas': return JSON.parse(JSON.stringify(MOCK_AREAS));
        case 'alarmo/entities': return JSON.parse(JSON.stringify(MOCK_ALARM_ENTITIES));
        case 'alarmo_config_updated': return null; // subscription result
        default: throw new Error(`Unknown WS type: ${msg.type}`);
      }
    };
  }

  // Simulate a config change notification from Alarmo.
  fireConfigUpdated() {
    (MockHass._subs['alarmo_config_updated'] || []).forEach((cb) => cb({}));
  }
}
MockHass._subs = {};

/* ---- Simulation helpers used by the test page ---- */
function setState(entityId, state, extraAttrs = {}) {
  STATES[entityId] = {
    ...STATES[entityId],
    state,
    attributes: { ...STATES[entityId].attributes, ...extraAttrs },
  };
  window.mockHass.states = STATES;
  window.renderCards();
}

function toggleSensor(entityId) {
  const cur = STATES[entityId].state;
  const isOpenNow = ['on', 'open', 'unlocked'].includes(cur);
  const closed = STATES[entityId].attributes.__closedState || (cur === 'locked' ? 'locked' : 'off');
  setState(entityId, isOpenNow ? closed : (cur === 'locked' ? 'unlocked' : 'on'));
}

function armArea(entityId, mode) {
  const haState = mode || 'disarmed';
  setState(entityId, haState, { arm_mode: mode || null });
}

/* Simulate an alarmo config change: e.g. re-enable the garage door sensor */
function toggleGarageDoorEnabled() {
  MOCK_SENSORS['binary_sensor.puerta_garaje'].enabled =
    !MOCK_SENSORS['binary_sensor.puerta_garaje'].enabled;
  window.mockHass.fireConfigUpdated();
}

/* Simulate a tamper detection (device grouping test) */
function toggleTamper(entityId) {
  setState(entityId, STATES[entityId].state === 'on' ? 'off' : 'on');
}
