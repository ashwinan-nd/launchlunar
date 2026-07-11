// toast.js — minimal non-blocking status toasts (data-source failures,
// degradation notices). No dependencies; injects its own styles once.

let container = null;

function ensureContainer() {
  if (container) return container;
  const style = document.createElement('style');
  style.textContent = `
    .toast-container {
      position: absolute;
      top: 60px;
      right: 12px;
      z-index: 50;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 340px;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      background: rgba(12, 14, 20, 0.92);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-left: 3px solid #f5a623;
      border-radius: 8px;
      padding: 10px 14px;
      color: #cdd6e0;
      font-size: 0.75rem;
      line-height: 1.45;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      opacity: 0;
      transform: translateX(12px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    .toast.visible { opacity: 1; transform: translateX(0); }
    .toast.toast-error { border-left-color: #ff4d4d; }
    .toast.toast-info { border-left-color: #1a73e8; }
    .toast-title {
      font-weight: 700;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 2px;
      color: #ffffff;
    }
  `;
  document.head.appendChild(style);

  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/**
 * Show a toast. Returns a dispose function.
 * @param {Object} opts
 * @param {string} opts.title    - short uppercase heading
 * @param {string} opts.message  - body text
 * @param {'warn'|'error'|'info'} [opts.level='warn']
 * @param {number} [opts.durationMs=9000] - auto-dismiss; 0 = sticky
 */
export function showToast({ title, message, level = 'warn', durationMs = 9000 }) {
  const parent = ensureContainer();
  const node = document.createElement('div');
  node.className = `toast${level === 'error' ? ' toast-error' : level === 'info' ? ' toast-info' : ''}`;

  const titleEl = document.createElement('div');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;
  const msgEl = document.createElement('div');
  msgEl.textContent = message;
  node.appendChild(titleEl);
  node.appendChild(msgEl);

  node.addEventListener('click', dismiss);
  parent.appendChild(node);
  requestAnimationFrame(() => node.classList.add('visible'));

  let timer = null;
  if (durationMs > 0) {
    timer = setTimeout(dismiss, durationMs);
  }

  function dismiss() {
    if (timer) clearTimeout(timer);
    node.classList.remove('visible');
    setTimeout(() => node.remove(), 300);
  }

  return dismiss;
}
