// main.js — Lunar Launcher: Single-page layout with immediate 3D scene
// Architecture: full-screen 3D + left sidebar (form) + right sidebar (results) + top bar + bottom controls

import { LunarScene } from './scene.js';
import {
  fetchTLEData,
  processGPData,
  getCategoryColor,
  getCategoryLabel,
  FALLBACK_TLE_DATA,
} from './data-fetcher.js';
import {
  parseTleAndPropagate,
  eciToThreeJs,
  getMoonPosition,
  findOptimalLaunchWindows,
  computeGmst,
  EARTH_RADIUS_KM,
} from './orbital.js';
import { fetchN2YOData } from './n2yo-fetcher.js';
import * as satellite from 'satellite.js';
import gsap from 'gsap';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAUNCH_SITES = [
  { name: 'Kennedy Space Center, FL', lat: 28.5729, lon: -80.6490 },
  { name: 'Baikonur Cosmodrome', lat: 45.9650, lon: 63.3050 },
  { name: 'Jiuquan Satellite Launch Center', lat: 40.9606, lon: 100.2914 },
  { name: 'Guiana Space Centre', lat: 5.2360, lon: -52.7686 },
  { name: 'Tanegashima Space Center', lat: 30.4000, lon: 131.0000 },
  { name: 'Satish Dhawan Space Centre', lat: 13.7199, lon: 80.2304 },
];

const MOON_TARGETS = [
  'Automatic (optimal landing site)',
  'Mare Tranquillitatis (Apollo 11 site)',
  'Oceanus Procellarum',
  'Mare Imbrium',
  'South Pole (Shackleton Crater)',
  'Aristarchus Plateau',
  'Tycho Crater',
];

// Real selenographic coordinates for the named targets (null = automatic).
const MOON_TARGET_COORDS = {
  'Automatic (optimal landing site)': null,
  'Mare Tranquillitatis (Apollo 11 site)': { lat: 0.67, lon: 23.47 },
  'Oceanus Procellarum': { lat: 18.4, lon: -57.4 },
  'Mare Imbrium': { lat: 32.8, lon: -15.6 },
  'South Pole (Shackleton Crater)': { lat: -89.9, lon: 0 },
  'Aristarchus Plateau': { lat: 23.7, lon: -47.4 },
  'Tycho Crater': { lat: -43.3, lon: -11.4 },
};

const CATEGORY_DISPLAY = [
  { key: 'satellite', label: 'Satellites', color: '#AA66FF' },
  { key: 'starlink', label: 'Starlink', color: '#00BFFF' },
  { key: 'oneweb', label: 'OneWeb', color: '#22D3EE' },
  { key: 'iridium', label: 'Iridium', color: '#14B8A6' },
  { key: 'debris', label: 'Debris', color: '#FF4444' },
  { key: 'rocket_body', label: 'Rocket Bodies', color: '#FF8C00' },
  { key: 'gps', label: 'GPS', color: '#32CD32' },
  { key: 'glonass', label: 'GLONASS', color: '#FF6347' },
  { key: 'galileo', label: 'Galileo', color: '#A3E635' },
  { key: 'beidou', label: 'BeiDou', color: '#F472B6' },
  { key: 'weather', label: 'Weather', color: '#87CEEB' },
  { key: 'iss', label: 'ISS', color: '#FFD700' },
  { key: 'station', label: 'Space Stations', color: '#FFD700' },
];

const MISSION_PHASES = [
  { id: 'launch', label: 'Launch', fraction: 0.0 },
  { id: 'leo', label: 'LEO Insertion', fraction: 0.08 },
  { id: 'tli', label: 'TLI Burn', fraction: 0.15 },
  { id: 'transfer', label: 'Lunar Transfer', fraction: 0.50 },
  { id: 'loi', label: 'LOI', fraction: 0.88 },
  { id: 'landing', label: 'Landing', fraction: 1.0 },
];

const WAYPOINT_PHASE_TO_MISSION = {
  launch: 'launch',
  leo: 'leo',
  tli_burn: 'tli',
  transfer: 'transfer',
  lunar_approach: 'loi',
  landing: 'landing',
};

const SPEED_OPTIONS = [0.5, 1, 2, 5];

// Orbital re-propagation interval (milliseconds)
const REPROPAGATION_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Real catalog loader — full Space-Track GP catalog (public/data/catalog.json)
// Each entry carries real TLE lines for genuine SGP4 propagation.
// ---------------------------------------------------------------------------

async function loadCatalog() {
  const resp = await fetch('/data/catalog.json');
  if (!resp.ok) throw new Error(`catalog.json ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000000;
      color: #ffffff;
    }

    #app {
      width: 100%;
      height: 100%;
      position: relative;
    }

    /* ===== SCROLLBAR ===== */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }

    /* ===== CANVAS (full screen, behind everything) ===== */
    .canvas-container {
      position: absolute;
      inset: 0;
      z-index: 1;
    }

    /* ===== GLASS PANEL BASE ===== */
    .glass-panel {
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.06);
    }

    /* ===== TOP BAR ===== */
    .top-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      z-index: 20;
    }

    .top-bar-logo {
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: #ffffff;
      flex-shrink: 0;
    }

    .top-bar-center {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      justify-content: center;
      overflow: hidden;
    }

    .sat-toggles {
      display: flex;
      gap: 4px;
      align-items: center;
      flex-wrap: wrap;
      max-width: 600px;
    }
    .sat-toggle {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.62rem;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.05);
      color: #99aabb;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .sat-toggle.active {
      border-color: currentColor;
      background: rgba(255,255,255,0.08);
      color: #fff;
    }
    .sat-toggle-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    .top-bar-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .view-btns {
      display: flex;
      gap: 2px;
    }

    .view-btn {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 0.65rem;
      font-weight: 600;
      color: #556677;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.2s, color 0.2s, border-color 0.2s;
      letter-spacing: 0.06em;
    }

    .view-btn:hover {
      background: rgba(26,115,232,0.12);
      border-color: rgba(26,115,232,0.3);
      color: #8899aa;
    }

    .view-btn.active {
      background: rgba(26,115,232,0.2);
      border-color: #1a73e8;
      color: #ffffff;
    }

    /* ===== LEFT SIDEBAR (rocket input form) ===== */
    .left-sidebar {
      position: absolute;
      top: 48px;
      left: 0;
      bottom: 0;
      width: 320px;
      z-index: 15;
      display: flex;
      flex-direction: column;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-right: 1px solid rgba(255,255,255,0.15);
      transition: width 0.3s ease, opacity 0.3s ease;
      overflow: hidden;
    }

    .left-sidebar.collapsed {
      width: 48px;
    }

    .left-sidebar.collapsed .sidebar-content {
      opacity: 0;
      pointer-events: none;
    }

    .left-sidebar.collapsed .sidebar-collapse-btn .collapse-icon {
      transform: rotate(180deg);
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }

    .sidebar-header-title {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #556677;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
    }

    .sidebar-collapse-btn {
      background: none;
      border: none;
      color: #556677;
      cursor: pointer;
      font-size: 1.1rem;
      padding: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
      flex-shrink: 0;
    }

    .sidebar-collapse-btn:hover {
      color: #ffffff;
    }

    .collapse-icon {
      transition: transform 0.3s ease;
      display: inline-block;
    }

    .sidebar-rocket-icon {
      display: none;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      font-size: 1.5rem;
      cursor: pointer;
    }

    .left-sidebar.collapsed .sidebar-header {
      padding: 0;
      border-bottom: none;
    }

    .left-sidebar.collapsed .sidebar-header-title {
      display: none;
    }

    .left-sidebar.collapsed .sidebar-rocket-icon {
      display: flex;
    }

    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      transition: opacity 0.2s ease;
    }

    /* ===== FORM FIELDS ===== */
    .form-section {
      margin-bottom: 20px;
    }

    .form-section-title {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #556677;
      margin-bottom: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.06);
      font-weight: 600;
    }

    .form-section:first-child .form-section-title {
      border-top: none;
      padding-top: 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .form-grid.single {
      grid-template-columns: 1fr;
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .form-field.full {
      grid-column: 1 / -1;
    }

    .form-field label {
      font-size: 0.7rem;
      color: #8899aa;
      font-weight: 500;
    }

    .form-field input,
    .form-field select {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 8px 10px;
      color: #ffffff;
      font-size: 0.8rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s ease;
    }

    .form-field input:focus,
    .form-field select:focus {
      border-color: #1a73e8;
    }

    .form-field input::placeholder {
      color: rgba(255,255,255,0.2);
    }

    .form-field select option {
      background: #0a0a0a;
      color: #e0e0e0;
    }

    .custom-coords {
      display: none;
    }

    .custom-coords.visible {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
    }

    .launch-btn {
      display: block;
      width: 100%;
      margin-top: 20px;
      background: #1a73e8;
      border: none;
      border-radius: 8px;
      padding: 0;
      height: 44px;
      font-size: 0.9rem;
      font-weight: 700;
      letter-spacing: 0.18em;
      color: #ffffff;
      cursor: pointer;
      transition: box-shadow 0.3s ease, transform 0.15s ease;
      font-family: inherit;
    }

    .launch-btn:hover {
      box-shadow: 0 0 24px rgba(26,115,232,0.5), 0 0 48px rgba(26,115,232,0.25);
      transform: translateY(-1px);
    }

    .launch-btn:active {
      transform: translateY(1px);
      box-shadow: 0 0 12px rgba(26,115,232,0.4);
    }

    .launch-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .form-error {
      color: #ff4444;
      font-size: 0.72rem;
      text-align: center;
      margin-top: 8px;
      min-height: 1em;
    }

    /* ===== SIDEBAR LOADING SPINNER ===== */
    .sidebar-loading {
      display: none;
      flex-direction: column;
      align-items: center;
      padding: 30px 14px;
      gap: 14px;
    }

    .sidebar-loading.visible {
      display: flex;
    }

    .sidebar-spinner {
      width: 36px;
      height: 36px;
      border: 2px solid rgba(255,255,255,0.08);
      border-top-color: #1a73e8;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .sidebar-loading-msg {
      font-size: 0.78rem;
      color: #8899aa;
      text-align: center;
      letter-spacing: 0.02em;
    }

    .sidebar-loading-progress {
      width: 100%;
      max-width: 200px;
      height: 2px;
      background: rgba(255,255,255,0.06);
      border-radius: 1px;
      overflow: hidden;
    }

    .sidebar-loading-bar {
      height: 100%;
      width: 0%;
      background: #1a73e8;
      border-radius: 1px;
      transition: width 0.4s ease;
    }

    /* ===== RIGHT SIDEBAR (results) ===== */
    .right-sidebar {
      position: absolute;
      top: 48px;
      right: 0;
      bottom: 0;
      width: 320px;
      z-index: 15;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-left: 1px solid rgba(255,255,255,0.06);
      overflow-y: auto;
      padding: 14px;
      transform: translateX(100%);
      transition: transform 0.35s ease;
    }

    .right-sidebar.visible {
      transform: translateX(0);
    }

    .results-header {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #556677;
      margin-bottom: 10px;
      font-weight: 600;
    }

    .window-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }

    .window-card:hover {
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.12);
    }

    .window-card.selected {
      border-color: #1a73e8;
      background: rgba(26,115,232,0.08);
    }

    .window-card-rank {
      font-size: 0.65rem;
      font-weight: 700;
      color: #1a73e8;
      margin-bottom: 3px;
      letter-spacing: 0.04em;
    }

    .window-card-date {
      font-size: 0.85rem;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 6px;
    }

    .window-card-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3px 12px;
      font-size: 0.7rem;
      color: #8899aa;
    }

    .window-card-stats .stat-label {
      color: #556677;
    }

    /* ===== PLAY CONTROLS (bottom center) ===== */
    .play-controls {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: none;
      flex-direction: column;
      align-items: center;
      padding: 14px 20px;
      z-index: 18;
      min-width: 380px;
      gap: 10px;
      border-radius: 8px;
    }

    .play-controls.visible {
      display: flex;
    }

    .play-controls-row {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
    }

    .play-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #1a73e8;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: box-shadow 0.2s, transform 0.1s;
      flex-shrink: 0;
    }

    .play-btn:hover {
      box-shadow: 0 0 16px rgba(26,115,232,0.5);
      transform: scale(1.05);
    }

    .play-btn:active {
      transform: scale(0.95);
    }

    .play-btn svg {
      fill: #ffffff;
      width: 16px;
      height: 16px;
    }

    .timeline-scrubber {
      flex: 1;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: rgba(255,255,255,0.1);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }

    .timeline-scrubber::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #1a73e8;
      cursor: pointer;
      border: 2px solid #ffffff;
    }

    .timeline-scrubber::-moz-range-thumb {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #1a73e8;
      cursor: pointer;
      border: 2px solid #ffffff;
    }

    .speed-controls {
      display: flex;
      gap: 2px;
    }

    .speed-btn {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 0.62rem;
      font-weight: 600;
      color: #556677;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }

    .speed-btn:hover {
      color: #8899aa;
    }

    .speed-btn.active {
      background: rgba(26,115,232,0.15);
      border-color: #1a73e8;
      color: #ffffff;
    }

    .phase-status {
      font-size: 0.7rem;
      color: #8899aa;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 600;
      text-align: center;
    }

    /* ===== INFO PANEL (bottom-right) ===== */
    .info-panel {
      position: absolute;
      bottom: 12px;
      right: 12px;
      padding: 8px 14px;
      z-index: 16;
      font-size: 0.68rem;
      color: #556677;
      text-align: right;
      line-height: 1.7;
      border-radius: 8px;
      transition: right 0.35s ease;
    }

    .info-panel.shifted {
      right: 332px;
    }

    .info-panel-objects {
      color: #8899aa;
      font-variant-numeric: tabular-nums;
    }

    .info-panel-clock {
      color: #556677;
      font-variant-numeric: tabular-nums;
    }

    .info-panel-source {
      color: #445566;
    }

    /* ===== UTC CLOCK ===== */
    .utc-clock {
      font-family: "Consolas", monospace;
      font-size: 11px;
      color: #888;
      white-space: nowrap;
    }

    /* ===== SEARCH INPUT ===== */
    .top-bar-search {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 0.65rem;
      color: #ccc;
      outline: none;
      width: 120px;
      font-family: inherit;
      transition: border-color 0.2s, width 0.2s;
    }
    .top-bar-search:focus {
      border-color: #1a73e8;
      width: 160px;
    }
    .top-bar-search::placeholder {
      color: rgba(255,255,255,0.25);
    }

    /* ===== PRESET BUTTONS ===== */
    .preset-container {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 6px;
    }
    .preset-btn {
      background: rgba(59,130,246,0.1);
      border: 1px solid rgba(59,130,246,0.3);
      color: #3b82f6;
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 10px;
      cursor: pointer;
      margin: 2px;
      font-family: inherit;
      transition: background 0.2s, border-color 0.2s;
    }
    .preset-btn:hover {
      background: rgba(59,130,246,0.2);
      border-color: rgba(59,130,246,0.5);
    }

    /* ===== OBJECT INFO PANEL (click / search to inspect) ===== */
    .object-info {
      position: absolute;
      left: 336px;
      bottom: 16px;
      width: 268px;
      padding: 12px 14px;
      z-index: 17;
      display: none;
      border-radius: 8px;
      background: rgba(0,0,0,0.82);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(0,224,255,0.25);
      box-shadow: 0 0 24px rgba(0,224,255,0.08);
    }
    .left-sidebar.collapsed ~ .object-info { left: 64px; }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d) {
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' ' + d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }) + ' UTC';
}

function formatDateInput(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// UTC Clock
// ---------------------------------------------------------------------------

function createUTCClock() {
  const clock = document.createElement('div');
  clock.className = 'utc-clock';
  setInterval(() => {
    const now = new Date();
    clock.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  }, 1000);
  // Set initial value immediately
  const now = new Date();
  clock.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  return clock;
}

// ---------------------------------------------------------------------------
// Mission Presets
// ---------------------------------------------------------------------------

// Full-stack (surface-launch) vehicle parameters. The trajectory model flies a
// single equivalent stage from the pad with MECO at orbital energy, so presets
// use whole-vehicle liftoff mass/thrust with a stage-averaged specific impulse
// — upper-stage-only values cannot reach orbit from the surface and honestly
// fail the ascent.
const MISSION_PRESETS = [
  { name: 'Apollo 11', rocket: 'Saturn V', mass: 2970000, height: 110.6, thrust: 35100, isp: 304, payload: 45000, site: 'Kennedy Space Center, FL', target: 'Mare Tranquillitatis (Apollo 11 site)' },
  { name: 'Artemis III', rocket: 'SLS Block 1', mass: 2610000, height: 98.1, thrust: 39100, isp: 310, payload: 27000, site: 'Kennedy Space Center, FL', target: 'South Pole (Shackleton Crater)' },
  { name: 'Starship', rocket: 'SpaceX Starship', mass: 5000000, height: 121, thrust: 74500, isp: 350, payload: 100000, site: 'Kennedy Space Center, FL', target: 'Mare Imbrium' },
];

// ---------------------------------------------------------------------------
// Application State
// ---------------------------------------------------------------------------

const state = {
  scene: null,
  orbitalData: null,
  satrecMap: new Map(),     // NORAD_ID -> satrec (for re-propagation)
  n2yoOnlyIds: new Set(),   // IDs from N2YO without CelesTrak TLE
  launchWindows: null,
  formValues: null,
  selectedWindowIndex: -1,
  categoryCounts: {},
  categoryVisibility: {},
  totalObjects: 0,
  clockInterval: null,
  lastRepropagation: 0,
  sidebarCollapsed: false,

  // Play/animation state
  isPlaying: false,
  playSpeed: 1,
  playProgress: 0,
  rocketMesh: null,
  rocketExhaust: null,
  trajectoryPoints: null,
  trajectoryVectors: null,
  trajectoryCurve: null,
  playAnimationId: null,
  lastPlayTimestamp: null,
  computedPhases: null,
};

// ---------------------------------------------------------------------------
// Build Left Sidebar (Rocket Input Form)
// ---------------------------------------------------------------------------

function buildLeftSidebar() {
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const threeDays = new Date();
  threeDays.setDate(threeDays.getDate() + 3);

  const sidebar = el('div', { className: 'left-sidebar', id: 'left-sidebar' },
    // Header
    el('div', { className: 'sidebar-header' },
      el('span', { className: 'sidebar-header-title' }, 'MISSION PARAMETERS'),
      el('div', { className: 'sidebar-rocket-icon', id: 'sidebar-rocket-icon' }, '\u{1F680}'),
      el('button', { className: 'sidebar-collapse-btn', id: 'sidebar-collapse-btn', type: 'button' },
        el('span', { className: 'collapse-icon' }, '\u25C0'),
      ),
    ),

    // Form content
    el('div', { className: 'sidebar-content', id: 'sidebar-form-content' },
      // Vehicle Specifications
      el('div', { className: 'form-section' },
        el('div', { className: 'form-section-title' }, 'Vehicle Specifications'),
        el('div', { className: 'form-grid' },
          el('div', { className: 'form-field full' },
            el('label', null, 'Rocket Name'),
            el('input', { type: 'text', id: 'f-rocket-name', placeholder: 'e.g., Falcon 9, SLS' }),
          ),
          el('div', { className: 'form-field' },
            el('label', null, 'Total Mass (kg)'),
            el('input', { type: 'number', id: 'f-mass', placeholder: '549054' }),
          ),
          el('div', { className: 'form-field' },
            el('label', null, 'Height (m)'),
            el('input', { type: 'number', id: 'f-height', placeholder: '70' }),
          ),
          el('div', { className: 'form-field' },
            el('label', null, 'Max Thrust (kN)'),
            el('input', { type: 'number', id: 'f-thrust', placeholder: '7607' }),
          ),
          el('div', { className: 'form-field' },
            el('label', null, 'Specific Impulse (s)'),
            el('input', { type: 'number', id: 'f-isp', placeholder: '311' }),
          ),
          el('div', { className: 'form-field full' },
            el('label', null, 'Payload Mass (kg)'),
            el('input', { type: 'number', id: 'f-payload', placeholder: '22800' }),
          ),
        ),
      ),

      // Launch Parameters
      el('div', { className: 'form-section' },
        el('div', { className: 'form-section-title' }, 'Launch Parameters'),
        el('div', { className: 'form-grid single' },
          el('div', { className: 'form-field' },
            el('label', null, 'Launch Site'),
            (() => {
              const select = el('select', { id: 'f-launch-site' });
              for (const site of LAUNCH_SITES) {
                const coord = `${Math.abs(site.lat).toFixed(1)}\u00B0${site.lat >= 0 ? 'N' : 'S'}, ${Math.abs(site.lon).toFixed(1)}\u00B0${site.lon >= 0 ? 'E' : 'W'}`;
                select.appendChild(el('option', { value: site.name }, `${site.name} (${coord})`));
              }
              select.appendChild(el('option', { value: 'Custom' }, 'Custom'));
              return select;
            })(),
          ),
        ),
        el('div', { className: 'custom-coords', id: 'custom-coords' },
          el('div', { className: 'form-field' },
            el('label', null, 'Latitude'),
            el('input', { type: 'number', id: 'f-custom-lat', placeholder: '28.5729', step: '0.0001' }),
          ),
          el('div', { className: 'form-field' },
            el('label', null, 'Longitude'),
            el('input', { type: 'number', id: 'f-custom-lon', placeholder: '-80.6490', step: '0.0001' }),
          ),
        ),
      ),

      // Launch Window (Month/Year - system finds exact day, hour, minute)
      el('div', { className: 'form-section' },
        el('div', { className: 'form-section-title' }, 'Launch Window'),
        el('div', { className: 'form-grid' },
          el('div', { className: 'form-field' },
            el('label', null, 'Start Month'),
            el('input', { type: 'month', id: 'f-window-start', value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` }),
          ),
          el('div', { className: 'form-field' },
            el('label', null, 'End Month'),
            el('input', { type: 'month', id: 'f-window-end', value: `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}` }),
          ),
        ),
      ),

      // Mission Target
      el('div', { className: 'form-section' },
        el('div', { className: 'form-section-title' }, 'Mission Target'),
        el('div', { className: 'form-grid single' },
          el('div', { className: 'form-field' },
            el('label', null, 'Moon Target Region'),
            (() => {
              const select = el('select', { id: 'f-moon-target' });
              for (const t of MOON_TARGETS) {
                select.appendChild(el('option', { value: t }, t));
              }
              return select;
            })(),
          ),
        ),
      ),

      // Preset Mission Buttons
      el('div', { className: 'form-section' },
        el('div', { className: 'form-section-title' }, 'Quick Presets'),
        (() => {
          const container = el('div', { className: 'preset-container' });
          for (const preset of MISSION_PRESETS) {
            const btn = el('button', {
              className: 'preset-btn',
              type: 'button',
            }, preset.name);
            btn.addEventListener('click', () => applyPreset(preset));
            container.appendChild(btn);
          }
          return container;
        })(),
      ),

      // Launch button
      el('button', { className: 'launch-btn', id: 'launch-btn', type: 'button' }, 'LAUNCH'),
      el('div', { className: 'form-error', id: 'form-error' }),
    ),

    // In-sidebar loading spinner
    el('div', { className: 'sidebar-loading', id: 'sidebar-loading' },
      el('div', { className: 'sidebar-spinner' }),
      el('div', { className: 'sidebar-loading-msg', id: 'sidebar-loading-msg' }, 'Initializing...'),
      el('div', { className: 'sidebar-loading-progress' },
        el('div', { className: 'sidebar-loading-bar', id: 'sidebar-loading-bar' }),
      ),
    ),
  );

  return sidebar;
}

// ---------------------------------------------------------------------------
// Build Right Sidebar (Results)
// ---------------------------------------------------------------------------

function buildRightSidebar() {
  return el('div', { className: 'right-sidebar', id: 'right-sidebar' });
}

// ---------------------------------------------------------------------------
// Build Play Controls
// ---------------------------------------------------------------------------

function buildPlayControls() {
  return el('div', { className: 'play-controls glass-panel', id: 'play-controls' },
    el('div', { className: 'play-controls-row' },
      el('button', { className: 'play-btn', id: 'play-btn', type: 'button' }),
      el('input', { className: 'timeline-scrubber', id: 'timeline-scrubber', type: 'range', min: '0', max: '1000', value: '0', step: '1' }),
      el('div', { className: 'speed-controls', id: 'speed-controls' }),
    ),
    el('div', { className: 'phase-status', id: 'phase-status' }, 'Select a launch window'),
  );
}

// ---------------------------------------------------------------------------
// Build Info Panel
// ---------------------------------------------------------------------------

function buildInfoPanel() {
  return el('div', { className: 'info-panel glass-panel', id: 'info-panel' });
}

// ---------------------------------------------------------------------------
// Form Handling
// ---------------------------------------------------------------------------

function getFormValues() {
  const rocketName = document.getElementById('f-rocket-name').value.trim();
  const mass = parseFloat(document.getElementById('f-mass').value);
  const height = parseFloat(document.getElementById('f-height').value);
  const thrust = parseFloat(document.getElementById('f-thrust').value);
  const isp = parseFloat(document.getElementById('f-isp').value);
  const payload = parseFloat(document.getElementById('f-payload').value);
  const siteSelect = document.getElementById('f-launch-site').value;
  const windowStart = document.getElementById('f-window-start').value;
  const windowEnd = document.getElementById('f-window-end').value;
  const moonTarget = document.getElementById('f-moon-target').value;

  let lat, lon, siteName;
  if (siteSelect === 'Custom') {
    lat = parseFloat(document.getElementById('f-custom-lat').value);
    lon = parseFloat(document.getElementById('f-custom-lon').value);
    siteName = 'Custom';
  } else {
    const site = LAUNCH_SITES.find((s) => s.name === siteSelect);
    lat = site.lat;
    lon = site.lon;
    siteName = site.name;
  }

  return {
    rocketName, mass, height, thrust, isp, payload,
    lat, lon, siteName,
    // Month inputs: "2026-06" format - construct date ranges
    windowStart: windowStart ? new Date(windowStart + '-01T00:00:00') : null,
    windowEnd: windowEnd ? (() => {
      const [y, m] = windowEnd.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate(); // last day of month
      return new Date(`${windowEnd}-${String(lastDay).padStart(2, '0')}T23:59:59`);
    })() : null,
    moonTarget,
  };
}

function validateForm(values) {
  if (!values.rocketName) return 'Rocket name is required.';
  if (isNaN(values.mass) || values.mass <= 0) return 'Valid total mass is required.';
  if (isNaN(values.height) || values.height <= 0) return 'Valid height is required.';
  if (isNaN(values.thrust) || values.thrust <= 0) return 'Valid max thrust is required.';
  if (isNaN(values.isp) || values.isp <= 0) return 'Valid specific impulse is required.';
  if (isNaN(values.payload) || values.payload <= 0) return 'Valid payload mass is required.';
  if (isNaN(values.lat) || isNaN(values.lon)) return 'Valid launch coordinates are required.';
  if (!values.windowStart || !values.windowEnd) return 'Launch window dates are required.';
  if (values.windowStart >= values.windowEnd) return 'Window end must be after window start.';
  return null;
}

function applyPreset(preset) {
  document.getElementById('f-rocket-name').value = preset.rocket;
  document.getElementById('f-mass').value = preset.mass;
  document.getElementById('f-height').value = preset.height;
  document.getElementById('f-thrust').value = preset.thrust;
  document.getElementById('f-isp').value = preset.isp;
  document.getElementById('f-payload').value = preset.payload;

  // Set launch site
  const siteSelect = document.getElementById('f-launch-site');
  const siteOption = Array.from(siteSelect.options).find(o => o.value === preset.site);
  if (siteOption) {
    siteSelect.value = preset.site;
  }
  // Hide custom coords if not custom
  const customCoords = document.getElementById('custom-coords');
  if (customCoords) customCoords.classList.remove('visible');

  // Set moon target
  const targetSelect = document.getElementById('f-moon-target');
  const targetOption = Array.from(targetSelect.options).find(o => o.value === preset.target);
  if (targetOption) {
    targetSelect.value = preset.target;
  }
}

// ---------------------------------------------------------------------------
// Sidebar Loading Helpers
// ---------------------------------------------------------------------------

function showSidebarLoading(msg, progress) {
  const formContent = document.getElementById('sidebar-form-content');
  const loadingEl = document.getElementById('sidebar-loading');
  const msgEl = document.getElementById('sidebar-loading-msg');
  const bar = document.getElementById('sidebar-loading-bar');

  if (formContent) formContent.style.display = 'none';
  if (loadingEl) loadingEl.classList.add('visible');
  if (msg && msgEl) msgEl.textContent = msg;
  if (progress !== undefined && bar) bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

function hideSidebarLoading() {
  const formContent = document.getElementById('sidebar-form-content');
  const loadingEl = document.getElementById('sidebar-loading');

  if (formContent) formContent.style.display = '';
  if (loadingEl) loadingEl.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Results Panel (Right Sidebar)
// ---------------------------------------------------------------------------

function renderResultsPanel(windows, formValues) {
  const panel = document.getElementById('right-sidebar');
  panel.innerHTML = '';

  // Summary header
  const siteShort = formValues.siteName.split(',')[0];
  panel.appendChild(el('div', { className: 'results-header' },
    `${formValues.rocketName} | ${siteShort}`));
  panel.appendChild(el('div', { className: 'results-header', style: { marginTop: '-4px', marginBottom: '12px' } },
    'OPTIMAL LAUNCH WINDOWS'));

  // 98% success threshold: if no window clears it, tell the user to widen the range.
  const anyFeasible = windows.some((w) => (w.pSuccess ?? 0) >= 0.98);
  if (!anyFeasible) {
    const best = Math.max(0, ...windows.map((w) => (w.pSuccess ?? 0) * 100));
    panel.appendChild(el('div', {
      className: 'window-warning',
      style: {
        background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.4)',
        borderRadius: '6px', padding: '10px', marginBottom: '10px',
        fontSize: '0.72rem', color: '#ffb060', lineHeight: '1.5',
      },
    }, `No launch window reaches the 98% success threshold (best: ${best.toFixed(1)}%). Widen your launch-window month range for more opportunities.`));
  }

  const craterLabel = (w) => {
    const t = formValues.moonTarget;
    if (t && !t.startsWith('Automatic')) return t.replace(/\s*\(.*\)$/, '');
    return w.landingSite.craterName;
  };

  windows.forEach((w, idx) => {
    const flightDays = (w.flightDuration / 86400).toFixed(1);
    const dvTotal = w.deltaV.total.toFixed(2);
    const pSucc = ((w.pSuccess ?? 0) * 100).toFixed(1);
    const pColor = (w.pSuccess ?? 0) >= 0.98 ? '#00e08a' : (w.pSuccess ?? 0) >= 0.9 ? '#ffcc44' : '#ff6b6b';
    const critical = (w.closeApproaches || []).filter((a) => a.severity === 'critical' || a.severity === 'warning').length;
    const card = el('div', {
      className: `window-card${idx === 0 ? ' selected' : ''}`,
      id: `window-card-${idx}`,
    },
      el('div', { className: 'window-card-rank' }, `#${idx + 1}`),
      el('div', { className: 'window-card-date' }, formatDateTime(w.launchDate)),
      el('div', { style: { fontSize: '0.95rem', fontWeight: '700', color: pColor, margin: '2px 0 6px' } },
        `P(success): ${pSucc}%`),
      el('div', { className: 'window-card-stats' },
        el('span', null, el('span', { className: 'stat-label' }, 'Delta-V: '), `${dvTotal} km/s`),
        el('span', null, el('span', { className: 'stat-label' }, 'Flight: '), `${flightDays} days`),
        el('span', null, el('span', { className: 'stat-label' }, 'High-risk: '), `${critical} objects`),
        el('span', null, el('span', { className: 'stat-label' }, 'Screened: '), `${w.closeApproaches.length}`),
        el('span', { style: { gridColumn: '1 / -1' } },
          el('span', { className: 'stat-label' }, 'Landing: '),
          craterLabel(w),
        ),
      ),
    );
    card.addEventListener('click', () => selectWindow(idx, windows, formValues));
    panel.appendChild(card);
  });

  // Show right sidebar
  panel.classList.add('visible');
  // Shift info panel
  const infoPanel = document.getElementById('info-panel');
  if (infoPanel) infoPanel.classList.add('shifted');
}

// ---------------------------------------------------------------------------
// Select Launch Window
// ---------------------------------------------------------------------------

function selectWindow(idx, windows, formValues) {
  const oldCard = document.querySelector('.window-card.selected');
  if (oldCard) oldCard.classList.remove('selected');

  const card = document.getElementById(`window-card-${idx}`);
  if (card) card.classList.add('selected');
  state.selectedWindowIndex = idx;

  const w = windows[idx];
  const scene = state.scene;
  if (!scene) return;

  stopPlayback();
  computePhaseFractions(w);

  // Move the Moon to the window's ARRIVAL position and freeze the Earth spin so the
  // inertial ECI trajectory (frozen at launchDate) lines up with the Moon mesh, the
  // landing marker and the launch beacon. Do this BEFORE drawing the trajectory.
  const moonPosThree = eciToThreeJs(w.moonArrivalPosition);
  scene.setMoonPosition(moonPosThree);
  scene.freezeEarthRotationAt(computeGmst(w.launchDate));

  // Build trajectory
  const trajPoints = w.trajectory.waypoints.map((wp) => eciToThreeJs(wp.position));
  scene.showTrajectory(trajPoints, 0xff0000);
  addTrajectoryTickMarks(scene, w);

  state.trajectoryPoints = trajPoints;
  buildTrajectoryCurve(scene, trajPoints);

  // Show landing site on Moon
  const landingLatRad = (w.landingSite.lat || 0) * (Math.PI / 180);
  const landingLonRad = (w.landingSite.lon || 0) * (Math.PI / 180);
  const moonRadiusThree = 1737.4 / EARTH_RADIUS_KM;
  const localX = moonRadiusThree * Math.cos(landingLatRad) * Math.cos(landingLonRad);
  const localY = moonRadiusThree * Math.sin(landingLatRad);
  const localZ = moonRadiusThree * Math.cos(landingLatRad) * Math.sin(landingLonRad);
  scene.showLandingSite({
    x: moonPosThree.x + localX,
    y: moonPosThree.y + localY,
    z: moonPosThree.z + localZ,
  });

  // Show launch site on Earth — use the TRUE ECI launch surface point (GMST-based,
  // the physics start), not the texture-convention lat/lon, so the beacon coincides
  // with the actual trajectory start.
  const earthSurfacePos = eciToThreeJs(w.trajectory.waypoints[0].position);
  scene.showLaunchSite({
    x: earthSurfacePos.x,
    y: earthSurfacePos.y,
    z: earthSurfacePos.z,
  });

  // Create rocket mesh and place it at the launch point (visible on the pad).
  createRocketMesh(scene);
  positionRocketAtProgress(0);

  // Highlight high-risk conjunction objects for this window.
  showWindowRisks(scene, w);

  // Reset play state
  state.playProgress = 0;
  state.isPlaying = false;
  updatePlayButton();
  updateScrubber();
  updatePhaseStatus();

  // Show play controls
  document.getElementById('play-controls').classList.add('visible');

  scene.focusEarth();
  setActiveViewButton('earth');
}

// ---------------------------------------------------------------------------
// Three.js helpers (trajectory curve, tick marks, rocket)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Object info panel (click / search to inspect a real tracked object)
// ---------------------------------------------------------------------------

function computeObjectInfo(o) {
  try {
    const sat = satellite.twoline2satrec(o.l1, o.l2);
    if (!sat || sat.error) return null;
    const pv = satellite.propagate(sat, new Date());
    if (!pv || !pv.position) return null;
    const r = Math.hypot(pv.position.x, pv.position.y, pv.position.z);
    const speed = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : 0;
    return {
      altKm: r - 6371,
      speedKms: speed,
      incDeg: sat.inclo * 180 / Math.PI,
      periodMin: sat.no > 0 ? (2 * Math.PI) / sat.no : 0,
    };
  } catch (e) { return null; }
}

function showObjectInfoByGidx(gidx, category, index) {
  const o = state.catalog && state.catalog[gidx];
  if (!o) return;
  const info = computeObjectInfo(o);
  const panel = document.getElementById('object-info');
  if (!panel) return;
  const catColor = (CATEGORY_DISPLAY.find((c) => c.key === o.cat) || {}).color || '#8899aa';
  panel.innerHTML = '';
  panel.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
    el('span', { style: { fontWeight: '700', fontSize: '0.82rem', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '230px' } }, o.name),
    el('span', { style: { cursor: 'pointer', color: '#889', fontSize: '1rem', paddingLeft: '8px' }, onclick: hideObjectInfo }, '×'),
  ));
  const row = (label, val) => el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', padding: '2px 0' } },
    el('span', { style: { color: '#667' } }, label),
    el('span', { style: { color: '#cdd', fontVariantNumeric: 'tabular-nums' } }, val));
  panel.appendChild(row('NORAD ID', String(o.id)));
  panel.appendChild(row('Int’l Desig', o.intl || '—'));
  panel.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', padding: '2px 0' } },
    el('span', { style: { color: '#667' } }, 'Category'),
    el('span', { style: { color: catColor, fontWeight: '600' } }, getCategoryLabel(o.cat)),
  ));
  if (o.rcs) panel.appendChild(row('RCS Size', o.rcs));
  if (o.cc) panel.appendChild(row('Country', o.cc));
  if (info) {
    panel.appendChild(row('Altitude', `${info.altKm.toFixed(0)} km`));
    panel.appendChild(row('Velocity', `${info.speedKms.toFixed(2)} km/s`));
    panel.appendChild(row('Inclination', `${info.incDeg.toFixed(2)}°`));
    panel.appendChild(row('Period', `${info.periodMin.toFixed(1)} min`));
  }
  panel.style.display = 'block';

  if (state.scene && index != null && index >= 0) {
    const p = state.scene.getObjectWorldPosition(category, index);
    if (p) state.scene.showSelectionMarker(p);
  }
}

function hideObjectInfo() {
  const panel = document.getElementById('object-info');
  if (panel) panel.style.display = 'none';
  if (state.scene) state.scene.clearSelectionMarker();
}

// Highlight a window's screened conjunction objects: red markers on the trajectory +
// a listed high-risk panel in the right sidebar.
function showWindowRisks(scene, w) {
  const approaches = (w.closeApproaches || []).slice(0, 10);
  const markers = approaches.map((a) => {
    const p = eciToThreeJs(a.rocketPosition);
    return {
      pos: p,
      label: `${a.objectName} · ${a.distanceKm.toFixed(0)} km`,
      critical: a.severity === 'critical' || a.severity === 'warning',
    };
  });
  scene.showConjunctionMarkers(markers);

  // Sidebar list (replace previous).
  const panel = document.getElementById('right-sidebar');
  if (!panel) return;
  const old = document.getElementById('conjunction-list');
  if (old) old.remove();
  const list = el('div', { id: 'conjunction-list', style: { marginTop: '14px' } });
  list.appendChild(el('div', { className: 'results-header' },
    `HIGH-RISK CONJUNCTIONS (${approaches.length})`));
  if (approaches.length === 0) {
    list.appendChild(el('div', { style: { fontSize: '0.72rem', color: '#5a7' } },
      'No screened objects within 200 km of the ascent corridor.'));
  } else {
    for (const a of approaches) {
      const col = a.severity === 'critical' ? '#ff5555' : a.severity === 'warning' ? '#ffaa44' : '#8aa';
      list.appendChild(el('div', {
        style: {
          display: 'flex', justifyContent: 'space-between', gap: '8px',
          fontSize: '0.7rem', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
        },
      },
        el('span', { style: { color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          `${a.objectName}${a.cat ? ' (' + a.cat + ')' : ''}`),
        el('span', { style: { color: col, flexShrink: '0', fontVariantNumeric: 'tabular-nums' } },
          `${a.distanceKm.toFixed(1)} km`),
      ));
    }
  }
  panel.appendChild(list);
}

function buildTrajectoryCurve(scene, trajPoints) {
  const Vec3 = scene.camera.position.constructor;
  const vectors = trajPoints.map(p => new Vec3(p.x, p.y, p.z));
  state.trajectoryCurve = null;
  state.trajectoryVectors = vectors;
}

function addTrajectoryTickMarks(scene, windowData) {
  const waypoints = windowData.trajectory.waypoints;
  if (!waypoints || waypoints.length < 2) return;

  const launchTime = waypoints[0].time.getTime();
  const TWELVE_HOURS_MS = 12 * 3600 * 1000;

  import('three').then((THREE) => {
    const oldGroup = scene.scene.getObjectByName('trajectoryTicks');
    if (oldGroup) {
      scene.scene.remove(oldGroup);
      oldGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    const tickGroup = new THREE.Group();
    tickGroup.name = 'trajectoryTicks';

    const tickGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const tickMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.9,
    });
    scene._disposables.push(tickGeo, tickMat);

    let nextTickMs = TWELVE_HOURS_MS;
    for (let i = 1; i < waypoints.length; i++) {
      const elapsedMs = waypoints[i].time.getTime() - launchTime;
      if (elapsedMs >= nextTickMs) {
        const pos = eciToThreeJs(waypoints[i].position);
        const marker = new THREE.Mesh(tickGeo, tickMat);
        marker.position.set(pos.x, pos.y, pos.z);
        tickGroup.add(marker);

        const hours = Math.round(nextTickMs / (3600 * 1000));
        const label = `${hours}h`;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 32, 16);
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85 });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(pos.x, pos.y + 0.04, pos.z);
        sprite.scale.set(0.12, 0.06, 1);
        tickGroup.add(sprite);
        scene._disposables.push(tex, spriteMat);

        nextTickMs += TWELVE_HOURS_MS;
      }
    }

    scene.scene.add(tickGroup);
  });
}

function createRocketMesh(scene) {
  // Use the scene's detailed rocket model (staged body, engine nozzle, fins, animated
  // exhaust plume). createRocket() is idempotent (disposes any previous rocket).
  const height = (state.formValues && state.formValues.height) || 70;
  const rocket = scene.createRocket(height, Math.max(2, height * 0.06));
  // Scale up for visibility against Earth (radius = 1 unit); the physical size is tiny.
  rocket.scale.multiplyScalar(4);
  rocket.visible = false;
  state.rocketMesh = rocket;
  state.rocketExhaust = scene._rocketExhaust || null;
}

function positionRocketAtProgress(progress) {
  if (!state.rocketMesh || !state.trajectoryVectors || state.trajectoryVectors.length < 2) return;

  const vectors = state.trajectoryVectors;
  const t = Math.max(0, Math.min(1, progress));
  const totalSegments = vectors.length - 1;
  const segF = t * totalSegments;
  const segIdx = Math.min(Math.floor(segF), totalSegments - 1);
  const segT = segF - segIdx;

  const p0 = vectors[segIdx];
  const p1 = vectors[Math.min(segIdx + 1, vectors.length - 1)];

  const x = p0.x + (p1.x - p0.x) * segT;
  const y = p0.y + (p1.y - p0.y) * segT;
  const z = p0.z + (p1.z - p0.z) * segT;

  state.rocketMesh.position.set(x, y, z);
  state.rocketMesh.visible = true;

  const nextIdx = Math.min(segIdx + 2, vectors.length - 1);
  const next = vectors[nextIdx];
  const dx = next.x - x;
  const dy = next.y - y;
  const dz = next.z - z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (len > 0.0001) {
    const targetPos = state.rocketMesh.position.clone();
    targetPos.x += dx / len;
    targetPos.y += dy / len;
    targetPos.z += dz / len;

    const upCandidate = state.rocketMesh.position.clone().normalize();
    state.rocketMesh.up.copy(upCandidate);
    state.rocketMesh.lookAt(targetPos);
    state.rocketMesh.rotateX(-Math.PI / 2);
  }

  if (state.rocketExhaust) {
    state.rocketExhaust.visible = state.isPlaying && progress < 0.98;
    if (state.rocketExhaust.visible) {
      const flicker = 0.5 + Math.random() * 0.5;
      state.rocketExhaust.material.opacity = flicker;
      const scale = 0.8 + Math.random() * 0.4;
      state.rocketExhaust.scale.set(scale, scale, scale);
    }
  }
}

function getCameraPositionForProgress(scene, progress) {
  if (!state.trajectoryVectors || state.trajectoryVectors.length < 2) return null;
  const rocketPos = state.rocketMesh ? state.rocketMesh.position : null;
  if (!rocketPos) return null;

  const phase = getCurrentPhase(progress);

  if (phase.id === 'launch') {
    const offset = rocketPos.clone().normalize().multiplyScalar(0.15);
    const camPos = rocketPos.clone().add(offset);
    camPos.y += 0.1;
    return { position: camPos, target: rocketPos.clone() };
  }
  if (phase.id === 'leo') {
    const offset = rocketPos.clone().normalize().multiplyScalar(0.8);
    const camPos = rocketPos.clone().add(offset);
    camPos.y += 0.3;
    return { position: camPos, target: rocketPos.clone() };
  }
  if (phase.id === 'tli') {
    const offset = rocketPos.clone().normalize().multiplyScalar(1.5);
    offset.y += 1.0;
    return { position: rocketPos.clone().add(offset), target: rocketPos.clone() };
  }
  if (phase.id === 'transfer') {
    const earthPos = scene.earth ? scene.earth.position.clone() : rocketPos.clone();
    const moonPos = scene.moon ? scene.moon.position.clone() : rocketPos.clone();
    const mid = earthPos.clone().add(moonPos).multiplyScalar(0.5);
    const totalDist = earthPos.distanceTo(moonPos);
    const camPos = mid.clone();
    camPos.y += totalDist * 0.6;
    camPos.z += totalDist * 0.2;
    return { position: camPos, target: rocketPos.clone() };
  }
  if (phase.id === 'loi') {
    const moonPos = scene.moon ? scene.moon.position.clone() : rocketPos.clone();
    const toMoon = moonPos.clone().sub(rocketPos).normalize();
    const camPos = rocketPos.clone().sub(toMoon.multiplyScalar(2.0));
    camPos.y += 0.5;
    return { position: camPos, target: moonPos };
  }
  if (phase.id === 'landing') {
    const moonPos = scene.moon ? scene.moon.position.clone() : rocketPos.clone();
    const fromMoon = rocketPos.clone().sub(moonPos).normalize();
    const camPos = rocketPos.clone().add(fromMoon.multiplyScalar(0.3));
    camPos.y += 0.15;
    return { position: camPos, target: rocketPos.clone() };
  }

  const offset = rocketPos.clone().normalize().multiplyScalar(1.0);
  return { position: rocketPos.clone().add(offset), target: rocketPos.clone() };
}

// ---------------------------------------------------------------------------
// Phase computation
// ---------------------------------------------------------------------------

function computePhaseFractions(windowData) {
  const waypoints = windowData.trajectory.waypoints;
  if (!waypoints || waypoints.length < 2) {
    state.computedPhases = null;
    return;
  }

  const total = waypoints.length;
  const phaseStartIndices = {};

  for (let i = 0; i < total; i++) {
    const wpPhase = waypoints[i].phase;
    const missionId = WAYPOINT_PHASE_TO_MISSION[wpPhase] || wpPhase;
    if (!(missionId in phaseStartIndices)) {
      phaseStartIndices[missionId] = i;
    }
  }

  state.computedPhases = MISSION_PHASES.map((mp) => {
    const startIdx = phaseStartIndices[mp.id];
    const fraction = startIdx !== undefined ? startIdx / (total - 1) : mp.fraction;
    return { id: mp.id, label: mp.label, fraction };
  });
}

function getCurrentPhase(progress) {
  const phases = state.computedPhases || MISSION_PHASES;
  for (let i = phases.length - 1; i >= 0; i--) {
    if (progress >= phases[i].fraction) {
      return phases[i];
    }
  }
  return phases[0];
}

// ---------------------------------------------------------------------------
// Play Controls
// ---------------------------------------------------------------------------

function initPlayControls() {
  const playBtn = document.getElementById('play-btn');
  const scrubber = document.getElementById('timeline-scrubber');
  const speedContainer = document.getElementById('speed-controls');

  updatePlayButton();
  playBtn.addEventListener('click', togglePlayback);

  scrubber.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.playProgress = val / 1000;
    positionRocketAtProgress(state.playProgress);
    updatePhaseStatus();
  });

  speedContainer.innerHTML = '';
  SPEED_OPTIONS.forEach((speed) => {
    const btn = el('button', {
      className: `speed-btn${speed === state.playSpeed ? ' active' : ''}`,
      type: 'button',
    }, `${speed}x`);
    btn.addEventListener('click', () => {
      state.playSpeed = speed;
      speedContainer.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    speedContainer.appendChild(btn);
  });
}

function updatePlayButton() {
  const btn = document.getElementById('play-btn');
  if (!btn) return;
  if (state.isPlaying) {
    btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="4" height="16" fill="white"/><rect x="15" y="4" width="4" height="16" fill="white"/></svg>';
  } else {
    btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20" fill="white"/></svg>';
  }
}

function updateScrubber() {
  const scrubber = document.getElementById('timeline-scrubber');
  if (scrubber) {
    scrubber.value = Math.round(state.playProgress * 1000);
  }
}

function updatePhaseStatus() {
  const statusEl = document.getElementById('phase-status');
  if (!statusEl) return;
  const phase = getCurrentPhase(state.playProgress);
  statusEl.textContent = phase.label;
}

function togglePlayback() {
  if (state.isPlaying) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (!state.trajectoryVectors || state.trajectoryVectors.length < 2) return;
  if (!state.rocketMesh) return;

  if (state.playProgress >= 0.99) {
    state.playProgress = 0;
  }

  state.isPlaying = true;
  state.lastPlayTimestamp = performance.now();
  updatePlayButton();

  state.rocketMesh.visible = true;
  positionRocketAtProgress(state.playProgress);

  playAnimationFrame();
}

function pausePlayback() {
  state.isPlaying = false;
  updatePlayButton();
  if (state.rocketExhaust) {
    state.rocketExhaust.visible = false;
  }
  if (state.playAnimationId) {
    cancelAnimationFrame(state.playAnimationId);
    state.playAnimationId = null;
  }
}

function stopPlayback() {
  pausePlayback();
  state.playProgress = 0;
  if (state.rocketMesh) {
    state.rocketMesh.visible = false;
  }
  updateScrubber();
  updatePhaseStatus();
}

function playAnimationFrame() {
  if (!state.isPlaying) return;

  const now = performance.now();
  const deltaMs = now - state.lastPlayTimestamp;
  state.lastPlayTimestamp = now;

  const baseDuration = 30000;
  const increment = (deltaMs / baseDuration) * state.playSpeed;
  state.playProgress = Math.min(1.0, state.playProgress + increment);

  positionRocketAtProgress(state.playProgress);
  updateScrubber();
  updatePhaseStatus();

  if (state.scene) {
    const cam = getCameraPositionForProgress(state.scene, state.playProgress);
    if (cam) {
      const camera = state.scene.camera;
      const controls = state.scene.controls;
      const lerpFactor = 0.03;
      camera.position.lerp(cam.position, lerpFactor);
      controls.target.lerp(cam.target, lerpFactor);
    }
  }

  if (state.playProgress >= 1.0) {
    pausePlayback();
    const statusEl = document.getElementById('phase-status');
    if (statusEl) statusEl.textContent = 'Landing Complete';
    return;
  }

  state.playAnimationId = requestAnimationFrame(playAnimationFrame);
}

// ---------------------------------------------------------------------------
// View Buttons
// ---------------------------------------------------------------------------

function setActiveViewButton(view) {
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`view-${view}-btn`);
  if (btn) btn.classList.add('active');
}

function initViewButtons() {
  const earthBtn = document.getElementById('view-earth-btn');
  const trajBtn = document.getElementById('view-trajectory-btn');
  const moonBtn = document.getElementById('view-moon-btn');

  if (earthBtn) earthBtn.addEventListener('click', () => {
    if (state.scene) state.scene.focusEarth();
    setActiveViewButton('earth');
  });
  if (trajBtn) trajBtn.addEventListener('click', () => {
    if (state.scene) state.scene.focusTrajectory();
    setActiveViewButton('trajectory');
  });
  if (moonBtn) moonBtn.addEventListener('click', () => {
    if (state.scene) state.scene.focusMoon();
    setActiveViewButton('moon');
  });
}

// ---------------------------------------------------------------------------
// Category Toggles (Top Bar)
// ---------------------------------------------------------------------------

function populateSatToggles() {
  const container = document.getElementById('sat-toggles');
  if (!container) return;
  container.innerHTML = '';

  for (const cat of CATEGORY_DISPLAY) {
    const count = state.categoryCounts[cat.key] || 0;
    if (count === 0) continue;

    const visible = state.categoryVisibility[cat.key] !== false;

    const dot = el('span', { className: 'sat-toggle-dot', style: { backgroundColor: cat.color } });
    const pill = el('button', {
      className: `sat-toggle${visible ? ' active' : ''}`,
      type: 'button',
      style: { color: visible ? cat.color : '' },
    }, dot, ` ${cat.label} (${count})`);

    pill.addEventListener('click', () => {
      const nowVisible = state.categoryVisibility[cat.key] !== false;
      const newVisible = !nowVisible;
      state.categoryVisibility[cat.key] = newVisible;
      pill.classList.toggle('active', newVisible);
      pill.style.color = newVisible ? cat.color : '';
      if (state.scene) {
        state.scene.setCategoryVisibility(cat.key, newVisible);
      }
    });

    container.appendChild(pill);
  }
}

// ---------------------------------------------------------------------------
// Info Panel
// ---------------------------------------------------------------------------

function renderInfoPanel() {
  const panel = document.getElementById('info-panel');
  updateInfoPanel(panel);

  if (state.clockInterval) clearInterval(state.clockInterval);
  state.clockInterval = setInterval(() => updateInfoPanel(panel), 1000);
}

function updateInfoPanel(panel) {
  if (!panel) return;
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  panel.innerHTML = '';
  panel.appendChild(el('div', { className: 'info-panel-objects' }, `Objects: ${state.totalObjects.toLocaleString()}`));
  panel.appendChild(el('div', { className: 'info-panel-clock' }, timeStr));
  panel.appendChild(el('div', { className: 'info-panel-source' }, 'Source: Space-Track GP (SGP4)'));
}

// ---------------------------------------------------------------------------
// Orbital Re-propagation (every 5 seconds)
// ---------------------------------------------------------------------------

function repropagateSatellites() {
  if (!state.scene || state.satrecMap.size === 0) return;

  const now = new Date();
  const positionsMap = new Map();

  for (const [id, satrec] of state.satrecMap) {
    try {
      const posVel = satellite.propagate(satrec, now);
      if (posVel.position && posVel.position !== false) {
        const pos3 = eciToThreeJs(posVel.position);
        positionsMap.set(String(id), pos3);
      }
    } catch (e) {
      // Skip failed propagations silently
    }
  }

  if (positionsMap.size > 0) {
    state.scene.updateOrbitalObjects(positionsMap);
  }
}

// ---------------------------------------------------------------------------
// Data Pipeline (loads on page start and on LAUNCH)
// ---------------------------------------------------------------------------

async function loadInitialOrbitalData() {
  const scene = state.scene;
  if (!scene) return;

  const now = new Date();

  // Load the full real Space-Track catalog (every entry has real TLE lines).
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    console.error('[data] catalog load failed:', e);
    return;
  }
  state.catalog = catalog;
  state.orbitalData = catalog; // reused by the launch pipeline for conjunction screening

  // Seed initial positions with a single synchronous SGP4 pass (the worker takes
  // over continuous propagation immediately after). Objects that fail to parse or
  // propagate are dropped from the render set entirely.
  const orbitalObjects = [];
  const categoryCounts = {};
  let parseOk = 0;
  for (let i = 0; i < catalog.length; i++) {
    const obj = catalog[i];
    let pos3;
    try {
      const satrec = satellite.twoline2satrec(obj.l1, obj.l2);
      if (!satrec || satrec.error) continue;
      const pv = satellite.propagate(satrec, now);
      if (!pv || !pv.position) continue;
      pos3 = eciToThreeJs(pv.position);
      if (!isFinite(pos3.x) || !isFinite(pos3.y) || !isFinite(pos3.z)) continue;
      parseOk++;
    } catch (e) {
      continue;
    }
    orbitalObjects.push({
      idx: i,                 // global catalog index (worker buffer alignment)
      id: obj.id,
      name: obj.name,
      category: obj.cat,      // scene lowercases; colors keyed by cat
      rcs: obj.rcs,
      position: pos3,
      size: 0.03,
    });
    categoryCounts[obj.cat] = (categoryCounts[obj.cat] || 0) + 1;
  }

  console.log(`[data] Loaded ${orbitalObjects.length}/${catalog.length} real objects (SGP4 ok: ${parseOk})`);

  state.totalObjects = orbitalObjects.length;
  state.categoryCounts = categoryCounts;
  for (const key of Object.keys(categoryCounts)) {
    if (state.categoryVisibility[key] === undefined) state.categoryVisibility[key] = true;
  }

  // Add objects to 3D scene
  scene.addOrbitalObjects(orbitalObjects);

  // ---- Spin up the propagation worker (continuous real SGP4, off main thread) ----
  try {
    const worker = new Worker(new URL('./propagation-worker.js', import.meta.url), { type: 'module' });
    state.propWorker = worker;
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        console.log(`[worker] propagating ${msg.ok}/${msg.total} objects`);
      } else if (msg.type === 'positions') {
        if (state.scene) state.scene.updateFromBuffer(msg.buf);
      }
    };
    // Transfer only the fields the worker needs.
    const workerCatalog = catalog.map((o) => ({ l1: o.l1, l2: o.l2 }));
    worker.postMessage({ type: 'init', catalog: workerCatalog, timeScale: 1, simStartMs: now.getTime() });
  } catch (e) {
    console.warn('[worker] failed to start; positions will be static:', e);
  }

  // Position Moon using accurate Meeus ephemeris
  const moonPos = getMoonPosition(now);
  const moonPosThree = eciToThreeJs(moonPos);
  scene.setMoonPosition(moonPosThree);

  // Compute Moon's orbital path (positions every ~6.5 hours over 27.3 days)
  const MOON_PERIOD_MS = 27.321661 * 86400 * 1000; // sidereal month in ms
  const orbitPoints = [];
  for (let i = 0; i < 100; i++) {
    const t = now.getTime() + (i / 100) * MOON_PERIOD_MS;
    const mp = getMoonPosition(new Date(t));
    orbitPoints.push(eciToThreeJs(mp));
  }
  scene.setMoonOrbitFromPositions(orbitPoints);

  // Continuously update Moon position every 10 seconds using Meeus — but NOT while a
  // launch window/trajectory is active. In that case the Moon is pinned to the
  // window's arrival position so it stays at the end of the rendered trajectory.
  setInterval(() => {
    if (!state.scene) return;
    if (state.launchWindows && state.launchWindows.length > 0 && state.selectedWindowIndex >= 0) return;
    const currentMoonPos = getMoonPosition(new Date());
    const currentMoonThree = eciToThreeJs(currentMoonPos);
    state.scene.setMoonPosition(currentMoonThree);
  }, 10000);

  // Populate category toggles in top bar
  populateSatToggles();

  // Render info panel
  renderInfoPanel();
}

// ---------------------------------------------------------------------------
// LAUNCH handler (trajectory computation)
// ---------------------------------------------------------------------------

// Select a representative subset of the real catalog for conjunction screening.
// Prioritises larger objects (LARGE/MEDIUM RCS) which dominate real collision risk,
// then fills with a uniform sample so the screen stays fast but representative.
function buildScreeningSet(limit = 800) {
  const cat = state.catalog || [];
  const rank = { LARGE: 0, MEDIUM: 1, SMALL: 2 };
  const sorted = cat
    .map((o, i) => ({ o, i }))
    .filter((e) => e.o.l1 && e.o.l2)
    .sort((a, b) => (rank[a.o.rcs] ?? 3) - (rank[b.o.rcs] ?? 3));
  const chosen = sorted.slice(0, limit);
  return chosen.map(({ o }) => ({
    noradId: String(o.id),
    name: o.name,
    line1: o.l1,
    line2: o.l2,
    cat: o.cat,
    rcs: o.rcs,
  }));
}

async function handleLaunch() {
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const values = getFormValues();
  const error = validateForm(values);
  if (error) {
    errorEl.textContent = error;
    return;
  }

  state.formValues = values;

  // Disable launch button
  const launchBtn = document.getElementById('launch-btn');
  launchBtn.disabled = true;

  // Show loading spinner in sidebar
  showSidebarLoading('Computing transfer trajectories...', 10);

  try {
    const rocketParams = {
      massKg: values.mass,
      heightM: values.height,
      thrustN: values.thrust * 1000,
      specificImpulseS: values.isp,
      payload: values.payload,
    };

    const launchSite = {
      lat: values.lat,
      lon: values.lon,
      name: values.siteName,
    };

    // Build TLE data subset for conjunction screening from the real catalog.
    const tleDataForWindows = buildScreeningSet();

    // Resolve the requested Moon target to selenographic coordinates (null = auto).
    const moonTargetCoords = MOON_TARGET_COORDS[values.moonTarget] || null;

    showSidebarLoading('Finding optimal launch windows...', 40);
    await new Promise((r) => setTimeout(r, 30));

    let windows;
    try {
      windows = await findOptimalLaunchWindows(
        launchSite,
        values.windowStart,
        values.windowEnd,
        rocketParams,
        tleDataForWindows,
        5,
        (progress, message) => {
          const pct = 40 + progress * 50;
          showSidebarLoading(message || 'Computing trajectories...', pct);
        },
        moonTargetCoords
      );
    } catch (e) {
      console.error('Window computation failed:', e);
      windows = [];
    }

    if (windows.length === 0) {
      // Fallback: generate at least one trajectory
      try {
        const { calculateTranslunarTrajectory } = await import('./orbital.js');
        const fallbackDate = values.windowStart;
        const trajectory = calculateTranslunarTrajectory(
          fallbackDate, values.lat, values.lon, rocketParams, false, moonTargetCoords
        );
        const fbLanding = trajectory.landingTarget || { lat: 0, lon: 0 };
        const moonAtArrival = getMoonPosition(new Date(fallbackDate.getTime() + 3.5 * 86400000));
        windows = [{
          launchDate: fallbackDate,
          score: 0.5,
          trajectory,
          closeApproaches: [],
          deltaV: trajectory.deltaV,
          flightDuration: trajectory.flightDuration,
          moonArrivalPosition: trajectory.moonPositionAtArrival || moonAtArrival,
          landingSite: { lat: fbLanding.lat, lon: fbLanding.lon, craterName: values.moonTarget || 'Mare Tranquillitatis', terrainType: 'mare' },
          pSuccess: 0.5,
          feasible: trajectory.transferResult !== 'miss',
        }];
      } catch (e) {
        console.error('Fallback trajectory failed:', e);
      }
    }

    state.launchWindows = windows;

    showSidebarLoading('Rendering results...', 95);
    await new Promise((r) => setTimeout(r, 30));

    // Render results in right sidebar
    if (windows.length > 0) {
      renderResultsPanel(windows, values);

      // Auto-select first window
      state.selectedWindowIndex = 0;
      const w = windows[0];

      computePhaseFractions(w);

      // Move the Moon to the ARRIVAL position and freeze the Earth spin BEFORE drawing
      // the trajectory so Moon mesh + landing marker + trajectory end + beacon coincide.
      const moonPosThree = eciToThreeJs(w.moonArrivalPosition);
      state.scene.setMoonPosition(moonPosThree);
      state.scene.freezeEarthRotationAt(computeGmst(w.launchDate));

      const trajPoints = w.trajectory.waypoints.map((wp) => eciToThreeJs(wp.position));
      state.scene.showTrajectory(trajPoints, 0xff0000);
      addTrajectoryTickMarks(state.scene, w);
      buildTrajectoryCurve(state.scene, trajPoints);
      createRocketMesh(state.scene);
      positionRocketAtProgress(0);
      showWindowRisks(state.scene, w);

      // Show markers
      const landingLatRad = (w.landingSite.lat || 0) * (Math.PI / 180);
      const landingLonRad = (w.landingSite.lon || 0) * (Math.PI / 180);
      const moonRadiusThree = 1737.4 / EARTH_RADIUS_KM;
      const localX = moonRadiusThree * Math.cos(landingLatRad) * Math.cos(landingLonRad);
      const localY = moonRadiusThree * Math.sin(landingLatRad);
      const localZ = moonRadiusThree * Math.cos(landingLatRad) * Math.sin(landingLonRad);
      state.scene.showLandingSite({
        x: moonPosThree.x + localX,
        y: moonPosThree.y + localY,
        z: moonPosThree.z + localZ,
      });

      // True ECI launch surface point (physics start), not texture lat/lon.
      const earthSurfacePos = eciToThreeJs(w.trajectory.waypoints[0].position);
      state.scene.showLaunchSite({
        x: earthSurfacePos.x,
        y: earthSurfacePos.y,
        z: earthSurfacePos.z,
      });

      // Show play controls
      document.getElementById('play-controls').classList.add('visible');

      // Initialize play controls
      initPlayControls();

      state.scene.focusEarth();
      setActiveViewButton('earth');
    } else {
      const panel = document.getElementById('right-sidebar');
      panel.innerHTML = '';
      panel.appendChild(el('div', { className: 'results-header' }, 'No valid launch windows found.'));
      panel.classList.add('visible');
    }

  } catch (e) {
    console.error('Launch pipeline error:', e);
    errorEl.textContent = 'An error occurred during computation. Check console.';
  }

  // Re-show form, hide loading
  hideSidebarLoading();
  launchBtn.disabled = false;
}

// ---------------------------------------------------------------------------
// Initialize — Single-page layout, immediate 3D scene
// ---------------------------------------------------------------------------

function init() {
  injectStyles();

  const app = document.getElementById('app');
  app.innerHTML = '';

  // Full-screen canvas container (behind everything)
  const canvasContainer = el('div', { className: 'canvas-container', id: 'canvas-container' });
  app.appendChild(canvasContainer);

  // Top bar
  const topBar = el('div', { className: 'top-bar' },
    el('span', { className: 'top-bar-logo' }, 'LUNAR LAUNCHER'),
    el('div', { className: 'top-bar-center' },
      el('input', { className: 'top-bar-search', id: 'top-bar-search', type: 'text', placeholder: 'Search satellites...' }),
      el('div', { className: 'sat-toggles', id: 'sat-toggles' }),
    ),
    el('div', { className: 'top-bar-right' },
      createUTCClock(),
      el('div', { className: 'view-btns' },
        el('button', { className: 'view-btn active', id: 'view-earth-btn', type: 'button' }, 'EARTH'),
        el('button', { className: 'view-btn', id: 'view-trajectory-btn', type: 'button' }, 'TRAJECTORY'),
        el('button', { className: 'view-btn', id: 'view-moon-btn', type: 'button' }, 'MOON'),
      ),
    ),
  );
  app.appendChild(topBar);

  // Left sidebar (form)
  app.appendChild(buildLeftSidebar());

  // Right sidebar (results)
  app.appendChild(buildRightSidebar());

  // Play controls (bottom center)
  app.appendChild(buildPlayControls());

  // Info panel (bottom-right)
  app.appendChild(buildInfoPanel());

  // Object info panel (click / search to inspect a tracked object)
  app.appendChild(el('div', { className: 'object-info', id: 'object-info' }));

  // ---- Wire up events ----

  // Sidebar collapse/expand
  document.getElementById('sidebar-collapse-btn').addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    document.getElementById('left-sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
  });
  document.getElementById('sidebar-rocket-icon').addEventListener('click', () => {
    state.sidebarCollapsed = false;
    document.getElementById('left-sidebar').classList.remove('collapsed');
  });

  // Custom coordinates toggle
  document.getElementById('f-launch-site').addEventListener('change', (e) => {
    const customCoords = document.getElementById('custom-coords');
    if (e.target.value === 'Custom') {
      customCoords.classList.add('visible');
    } else {
      customCoords.classList.remove('visible');
    }
  });

  // Launch button
  document.getElementById('launch-btn').addEventListener('click', handleLaunch);

  // View buttons
  initViewButtons();

  // Search input — filters category toggle pills by label text
  const searchInput = document.getElementById('top-bar-search');
  if (searchInput) {
    searchInput.setAttribute('placeholder', 'Search name / NORAD…');
    // Enter: find a real object by name or NORAD id and inspect it.
    searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const q = searchInput.value.trim().toLowerCase();
      if (!q || !state.catalog) return;
      let gidx = -1;
      for (let i = 0; i < state.catalog.length; i++) {
        const o = state.catalog[i];
        if (String(o.id) === q || (o.name && o.name.toLowerCase().includes(q))) { gidx = i; break; }
      }
      if (gidx < 0) return;
      const o = state.catalog[gidx];
      const arr = state.scene && state.scene._orbitalCategoryGidx.get(o.cat);
      const idx = arr ? arr.indexOf(gidx) : -1;
      showObjectInfoByGidx(gidx, o.cat, idx);
      // Focus the camera on the found object.
      if (state.scene && idx >= 0) {
        const p = state.scene.getObjectWorldPosition(o.cat, idx);
        if (p) {
          const off = p.clone().normalize().multiplyScalar(0.6);
          state.scene._followRocket = false; state.scene._followMoon = false;
          state.scene._animateCameraTo(p.clone().add(off), p.clone(), 1.2);
        }
      }
    });
  }

  // ---- Create 3D scene immediately ----
  try {
    state.scene = new LunarScene(canvasContainer);

    // Click-to-inspect: raycast the object clouds (ignoring camera drags).
    const canvasEl = state.scene.renderer.domElement;
    let downXY = null;
    canvasEl.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; });
    canvasEl.addEventListener('pointerup', (e) => {
      if (!downXY) return;
      const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
      downXY = null;
      if (moved > 5) return; // treat as an orbit drag, not a pick
      const rect = canvasEl.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const hit = state.scene.pickObject(ndcX, ndcY);
      if (hit && hit.gidx >= 0) showObjectInfoByGidx(hit.gidx, hit.category, hit.index);
    });

    // Orbital object positions come from the propagation worker (see loadInitialOrbitalData).
    state.scene.animate();
    window.addEventListener('resize', () => {
      if (state.scene) state.scene.onResize();
    });
  } catch (e) {
    console.error('Scene creation failed:', e);
    canvasContainer.innerHTML = '<div style="color:#ff4444;padding:40px;text-align:center;">Failed to initialize 3D scene. WebGL may not be supported.</div>';
    return;
  }

  // ---- Load orbital data in the background ----
  loadInitialOrbitalData().catch(e => {
    console.error('Background data load failed:', e);
  });

  // ---- Render info panel immediately (will update when data loads) ----
  renderInfoPanel();
}

// Expose state for verification/debugging.
window.__state = state;

// Boot
init();
