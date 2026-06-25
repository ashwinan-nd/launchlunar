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
  generateSmoothTrajectory,
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

const CATEGORY_DISPLAY = [
  { key: 'satellite', label: 'Satellites', color: '#AA66FF' },
  { key: 'debris', label: 'Debris', color: '#FF4444' },
  { key: 'rocket_body', label: 'Rocket Bodies', color: '#FF8C00' },
  { key: 'starlink', label: 'Starlink', color: '#00BFFF' },
  { key: 'gps', label: 'GPS', color: '#32CD32' },
  { key: 'iss', label: 'ISS', color: '#FFD700' },
  { key: 'weather', label: 'Weather', color: '#87CEEB' },
  { key: 'station', label: 'Space Stations', color: '#FFD700' },
  { key: 'glonass', label: 'GLONASS', color: '#FF6347' },
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
// SATCAT Data Loader — loads 34k+ orbital objects from public/data/satcat.json
// ---------------------------------------------------------------------------

async function loadSATCATData() {
  try {
    const resp = await fetch('/data/satcat.json');
    const objects = await resp.json();
    const results = [];
    for (const obj of objects) {
      const apogee = obj.APOGEE || 0;
      const perigee = obj.PERIGEE || 0;
      const period = obj.PERIOD || 0;
      if (apogee <= 0 || perigee <= 0 || period <= 0) continue; // skip invalid
      
      const altKm = (apogee + perigee) / 2;
      if (altKm < 100 || altKm > 100000) continue; // skip unrealistic altitudes
      
      const radius = (6371 + altKm) / 6371;
      const inclRad = (obj.INCLINATION || 0) * Math.PI / 180;
      const raan = Math.random() * Math.PI * 2;
      const trueAnomaly = Math.random() * Math.PI * 2;
      
      const cosI = Math.cos(inclRad), sinI = Math.sin(inclRad);
      const cosR = Math.cos(raan), sinR = Math.sin(raan);
      const cosV = Math.cos(trueAnomaly), sinV = Math.sin(trueAnomaly);
      
      const x = radius * (cosR * cosV - sinR * sinV * cosI);
      const y = radius * sinV * sinI;
      const z = radius * (sinR * cosV + cosR * sinV * cosI);
      
      if (isNaN(x) || isNaN(y) || isNaN(z)) continue; // skip NaN positions
      
      const name = (obj.OBJECT_NAME || '').toUpperCase();
      let category = 'satellite';
      if (name.includes('DEB')) category = 'debris';
      else if (name.includes('R/B')) category = 'rocket_body';
      else if (name.includes('STARLINK')) category = 'starlink';
      else if (name.includes('GPS') || name.includes('NAVSTAR')) category = 'gps';
      else if (name.includes('GLONASS') || name.includes('COSMOS 2')) category = 'glonass';
      else if (name.includes('ONEWEB')) category = 'oneweb';
      else if (name.includes('IRIDIUM')) category = 'iridium';
      else if (name.includes('NOAA') || name.includes('GOES') || name.includes('METEOSAT')) category = 'weather';
      else if (name.includes('TIANGONG') || name.includes('STATION')) category = 'station';
      
      results.push({
        id: String(obj.NORAD_CAT_ID),
        name: obj.OBJECT_NAME,
        category,
        position: { x, y, z },
        size: 0.02,
        keplerian: {
          semiMajorAxis: 6371 + altKm,
          inclination: inclRad,
          raan,
          trueAnomaly,
          period: period * 60,
          meanMotion: 2 * Math.PI / (period * 60),
          epoch: Date.now() / 1000
        }
      });
    }
    return results;
  } catch (e) {
    console.warn('SATCAT load failed:', e);
    return [];
  }
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

const MISSION_PRESETS = [
  { name: 'Apollo 11', rocket: 'Saturn V S-IVB', mass: 50000, height: 17.8, thrust: 1000, isp: 421, payload: 28800, site: 'Kennedy Space Center, FL', target: 'Mare Tranquillitatis (Apollo 11 site)' },
  { name: 'Artemis III', rocket: 'SLS Block 1', mass: 130000, height: 64.6, thrust: 8800, isp: 421, payload: 27000, site: 'Kennedy Space Center, FL', target: 'South Pole (Shackleton Crater)' },
  { name: 'Starship', rocket: 'SpaceX Starship', mass: 1300000, height: 120, thrust: 74500, isp: 380, payload: 100000, site: 'Kennedy Space Center, FL', target: 'Mare Imbrium' },
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

  windows.forEach((w, idx) => {
    const flightDays = (w.flightDuration / 86400).toFixed(1);
    const dvTotal = w.deltaV.total.toFixed(2);
    const card = el('div', {
      className: `window-card${idx === 0 ? ' selected' : ''}`,
      id: `window-card-${idx}`,
    },
      el('div', { className: 'window-card-rank' }, `#${idx + 1}`),
      el('div', { className: 'window-card-date' }, formatDateTime(w.launchDate)),
      el('div', { className: 'window-card-stats' },
        el('span', null, el('span', { className: 'stat-label' }, 'Delta-V: '), `${dvTotal} km/s`),
        el('span', null, el('span', { className: 'stat-label' }, 'Flight: '), `${flightDays} days`),
        el('span', null, el('span', { className: 'stat-label' }, 'Close: '), `${w.closeApproaches.length} objects`),
        el('span', null, el('span', { className: 'stat-label' }, 'Score: '), `${(w.score * 100).toFixed(1)}`),
        el('span', { style: { gridColumn: '1 / -1' } },
          el('span', { className: 'stat-label' }, 'Landing: '),
          w.landingSite.craterName,
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

  // Build trajectory
  const trajPoints = w.trajectory.waypoints.map((wp) => eciToThreeJs(wp.position));
  scene.showTrajectory(trajPoints, 0xff0000);
  addTrajectoryTickMarks(scene, w);

  state.trajectoryPoints = trajPoints;
  buildTrajectoryCurve(scene, trajPoints);

  // Show landing site on Moon
  const moonPosThree = eciToThreeJs(w.moonArrivalPosition);
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

  // Show launch site on Earth
  const earthSurfacePos = scene.latLonToVector3(formValues.lat, formValues.lon);
  scene.showLaunchSite({
    x: earthSurfacePos.x,
    y: earthSurfacePos.y,
    z: earthSurfacePos.z,
  });

  // Create rocket mesh
  createRocketMesh(scene);

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
  if (state.rocketMesh) {
    scene.scene.remove(state.rocketMesh);
    state.rocketMesh = null;
  }
  if (state.rocketExhaust) {
    scene.scene.remove(state.rocketExhaust);
    state.rocketExhaust = null;
  }

  import('three').then((THREE) => {
    if (state.rocketMesh) {
      scene.scene.remove(state.rocketMesh);
    }

    const group = new THREE.Group();
    group.name = 'rocketShip';

    const bodyGeo = new THREE.CylinderGeometry(0.012, 0.015, 0.08, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xdddddd, roughness: 0.4, metalness: 0.6,
      emissive: 0x444444, emissiveIntensity: 0.3,
    });
    group.add(new THREE.Mesh(bodyGeo, bodyMat));

    const noseGeo = new THREE.ConeGeometry(0.012, 0.03, 8);
    const noseMat = new THREE.MeshStandardMaterial({
      color: 0xff4444, roughness: 0.3, metalness: 0.5,
      emissive: 0xff2222, emissiveIntensity: 0.4,
    });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.y = 0.055;
    group.add(nose);

    const engineGeo = new THREE.CylinderGeometry(0.018, 0.01, 0.02, 8);
    const engineMat = new THREE.MeshStandardMaterial({
      color: 0x888888, roughness: 0.5, metalness: 0.7,
    });
    const engine = new THREE.Mesh(engineGeo, engineMat);
    engine.position.y = -0.05;
    group.add(engine);

    const exhaustGeo = new THREE.ConeGeometry(0.015, 0.06, 8);
    const exhaustMat = new THREE.MeshBasicMaterial({
      color: 0x1a73e8, transparent: true, opacity: 0.7,
    });
    const exhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    exhaust.position.y = -0.08;
    exhaust.rotation.x = Math.PI;
    exhaust.visible = false;
    group.add(exhaust);

    const rocketLight = new THREE.PointLight(0x1a73e8, 0.5, 0.5);
    rocketLight.position.y = -0.06;
    group.add(rocketLight);

    group.visible = false;
    scene.scene.add(group);

    state.rocketMesh = group;
    state.rocketExhaust = exhaust;

    scene._disposables.push(bodyGeo, bodyMat, noseGeo, noseMat, engineGeo, engineMat, exhaustGeo, exhaustMat);
  });
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
  panel.appendChild(el('div', { className: 'info-panel-source' }, 'Sources: CelesTrak + N2YO + SATCAT'));
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

  // Fetch CelesTrak TLE data + N2YO data + SATCAT data in parallel
  const [celestrakResult, n2yoResult, satcatResult] = await Promise.allSettled([
    fetchTLEData({
      onProgress: ({ completed, total }) => {
        // Silent background loading
      },
      timeoutMs: 20000,
    }),
    fetchN2YOData(15000),
    loadSATCATData(),
  ]);

  let processedData = (celestrakResult.status === 'fulfilled') ? celestrakResult.value : [];
  const n2yoData = (n2yoResult.status === 'fulfilled') ? n2yoResult.value : [];
  const satcatData = (satcatResult.status === 'fulfilled') ? satcatResult.value : [];

  // Ensure fallback data if CelesTrak fails
  if (!processedData || processedData.length < 20) {
    console.warn('Insufficient CelesTrak data, merging fallback TLE data');
    const fallbackProcessed = processGPData(
      FALLBACK_TLE_DATA.map((gp) => ({ gp, sourceGroup: gp._sourceGroup || 'fallback' }))
    );
    const existingIds = new Set((processedData || []).map(o => o.id));
    for (const fb of fallbackProcessed) {
      if (!existingIds.has(fb.id)) {
        processedData.push(fb);
      }
    }
  }

  state.orbitalData = processedData;

  // Build set of CelesTrak NORAD IDs for deduplication against N2YO
  const celestrakIds = new Set(processedData.map(o => o.id));

  // Propagate CelesTrak objects and build satrec map
  const orbitalObjects = [];
  const categoryCounts = {};

  for (const obj of processedData) {
    if (!obj.tle.line1 || !obj.tle.line2) continue;

    try {
      const result = parseTleAndPropagate(obj.tle.line1, obj.tle.line2, now);
      if (!result.position) continue;

      // Store satrec for re-propagation
      if (result.satrec) {
        state.satrecMap.set(obj.id, result.satrec);
      }

      const pos3 = eciToThreeJs(result.position);
      let sceneCategory = obj.category;
      if (sceneCategory === 'rocket_body') sceneCategory = 'rocket body';

      orbitalObjects.push({
        id: String(obj.id),
        name: obj.name,
        category: sceneCategory,
        position: pos3,
        size: 0.03,
      });

      categoryCounts[obj.category] = (categoryCounts[obj.category] || 0) + 1;
    } catch (e) {
      // Skip failed propagations
    }
  }

  // Add N2YO objects that aren't in CelesTrak
  for (const n2yoObj of n2yoData) {
    if (celestrakIds.has(n2yoObj.id)) continue;

    state.n2yoOnlyIds.add(n2yoObj.id);

    let sceneCategory = n2yoObj.category;
    if (sceneCategory === 'rocket_body') sceneCategory = 'rocket body';

    orbitalObjects.push({
      id: String(n2yoObj.id),
      name: n2yoObj.name,
      category: sceneCategory,
      position: n2yoObj.position,
      size: 0.03,
    });

    categoryCounts[n2yoObj.category] = (categoryCounts[n2yoObj.category] || 0) + 1;
  }

  // Merge SATCAT objects (NORAD_CAT_ID dedup — CelesTrak/N2YO take priority)
  const allExistingIds = new Set(orbitalObjects.map(o => o.id));
  let satcatAdded = 0;
  for (const satcatObj of satcatData) {
    if (allExistingIds.has(satcatObj.id)) continue;
    allExistingIds.add(satcatObj.id);

    let sceneCategory = satcatObj.category;
    if (sceneCategory === 'rocket_body') sceneCategory = 'rocket body';

    orbitalObjects.push({
      id: satcatObj.id,
      name: satcatObj.name,
      category: sceneCategory,
      position: satcatObj.position,
      size: satcatObj.size,
      keplerian: satcatObj.keplerian,
    });

    categoryCounts[satcatObj.category] = (categoryCounts[satcatObj.category] || 0) + 1;
    satcatAdded++;
  }

  console.log(`[data] Loaded ${orbitalObjects.length} orbital objects (CelesTrak: ${processedData.length}, N2YO unique: ${state.n2yoOnlyIds.size}, SATCAT unique: ${satcatAdded})`);

  state.totalObjects = orbitalObjects.length;
  state.categoryCounts = categoryCounts;
  for (const key of Object.keys(categoryCounts)) {
    state.categoryVisibility[key] = true;
  }

  // Add objects to 3D scene
  scene.addOrbitalObjects(orbitalObjects);

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

  // Continuously update Moon position every 10 seconds using Meeus
  setInterval(() => {
    if (!state.scene) return;
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

    // Build TLE data subset for collision checking
    const tleDataForWindows = [];
    if (state.orbitalData) {
      for (const obj of state.orbitalData.slice(0, 200)) {
        if (obj.tle.line1 && obj.tle.line2) {
          tleDataForWindows.push({
            noradId: String(obj.id),
            name: obj.name,
            line1: obj.tle.line1,
            line2: obj.tle.line2,
          });
        }
      }
    }

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
        }
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
          fallbackDate, values.lat, values.lon, rocketParams, false
        );
        const moonAtArrival = getMoonPosition(new Date(fallbackDate.getTime() + 3.5 * 86400000));
        windows = [{
          launchDate: fallbackDate,
          score: 0.5,
          trajectory,
          closeApproaches: [],
          deltaV: trajectory.deltaV,
          flightDuration: trajectory.flightDuration,
          moonArrivalPosition: moonAtArrival,
          landingSite: { lat: 0, lon: 0, craterName: 'Mare Tranquillitatis', terrainType: 'mare' },
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

      const trajPoints = w.trajectory.waypoints.map((wp) => eciToThreeJs(wp.position));
      state.scene.showTrajectory(trajPoints, 0xff0000);
      addTrajectoryTickMarks(state.scene, w);
      buildTrajectoryCurve(state.scene, trajPoints);
      createRocketMesh(state.scene);

      // Show markers
      const moonPosThree = eciToThreeJs(w.moonArrivalPosition);
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

      const earthSurfacePos = state.scene.latLonToVector3(values.lat, values.lon);
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
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim().toLowerCase();
      const toggles = document.querySelectorAll('.sat-toggle');
      for (const toggle of toggles) {
        if (!query) {
          toggle.style.display = '';
        } else {
          const text = toggle.textContent.toLowerCase();
          toggle.style.display = text.includes(query) ? '' : 'none';
        }
      }
    });
  }

  // ---- Create 3D scene immediately ----
  try {
    state.scene = new LunarScene(canvasContainer);

    // Register per-frame SGP4 propagation callback for smooth orbital motion
    let lastSGP4Frame = 0;
    state.scene.setOnBeforeRender((elapsed, delta) => {
      // Propagate SGP4 objects every frame (satellite.js is fast enough for ~3000 objects)
      if (state.satrecMap.size === 0) return;

      // Throttle slightly to every 2nd frame if needed, but generally fine per-frame
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
        state.scene.updateOrbitalPositions(positionsMap);
      }
    });

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

// Boot
init();
