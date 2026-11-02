/**
 * BioSim Lab · ui.js
 * Reusable UI primitives: icons, toasts, modals, tooltips, ripples and sound.
 * No framework, no external assets.
 */

/* ==========================================================================
   Icon library
   ========================================================================== */
const ICONS = {
  /* Interface icons ------------------------------------------------------- */
  search:
    '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
  moon:
    '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/>',
  "volume-on":
    '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12"/>',
  "volume-off":
    '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6M21 9l-5 6"/>',
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "arrow-left": '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  "check-circle":
    '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers:
    '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  trophy:
    '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M12 13v4M8 21h8M9 17h6"/>',
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  help:
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"/>',
  reset:
    '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  info:
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert:
    '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  sparkles:
    '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
  book:
    '<path d="M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 3V5Z"/><path d="M20 5a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 3V5Z"/>',
  shield:
    '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  lock:
    '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  chart:
    '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-7M20 16v-3"/>',
  eye:
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  trash:
    '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  flask:
    '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7 15h10"/>',
  external:
    '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',

  /* Experiment icons ------------------------------------------------------ */
  dna:
    '<path d="M8 3c0 5 8 5 8 9s-8 4-8 9"/><path d="M16 3c0 5-8 5-8 9s8 4 8 9"/><path d="M9.2 7h5.6M8.2 11h7.6M8.2 15h7.6M9.2 19h5.6"/>',
  pcr:
    '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9h2M11 9h2M15 9h2M7 13h2M11 13h2M15 13h2M6 2v2M18 2v2"/>',
  gel:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M12 4v16M16 4v16"/><path d="M5.5 9h1M9.5 13h1M13.5 7h1M17.5 11h1" stroke-width="2.2"/>',
  scissors:
    '<circle cx="6" cy="7" r="2.2"/><circle cx="6" cy="17" r="2.2"/><path d="M8 8.5 20 19M8 15.5 20 5"/>',
  plasmid:
    '<circle cx="12" cy="12" r="8" stroke-dasharray="40 10" transform="rotate(-35 12 12)"/><path d="M17 5l3 3-3 3"/><circle cx="12" cy="12" r="2"/>',
  bacteria:
    '<ellipse cx="11" cy="12" rx="6" ry="4.5"/><path d="M17 12c2 0 2 3 4 2M5 9C3 8 3 11 1 10M5 15c-2 1-2-2-4-1"/><circle cx="9.5" cy="11" r=".7" fill="currentColor" stroke="none"/><circle cx="12.5" cy="13" r=".7" fill="currentColor" stroke="none"/>',
  crispr:
    '<path d="M12 3l7 4v10l-7 4-7-4V7l7-4Z"/><path d="M9 9l6 6M15 9l-6 6"/>',
  dogma:
    '<path d="M4 6c0 3 4 3 4 6s-4 3-4 6M12 6c0 3-4 3-4 6s4 3 4 6"/><path d="M16 8h5M16 12h5M16 16h5"/>',
  sanger:
    '<path d="M3 18h18"/><path d="M4 16l2-4 2 4 2-8 2 8 2-5 2 5 2-7 2 7"/>',
  blot:
    '<rect x="4" y="4" width="16" height="4" rx="1"/><rect x="3" y="9" width="18" height="4" rx="1"/><rect x="5" y="14" width="14" height="3" rx="1"/><path d="M8 19h8"/>',
  protein:
    '<path d="M5 17c0-4 4-4 4-8s5-4 5 0 5 4 5 8"/><circle cx="5" cy="17" r="1.4"/><circle cx="19" cy="17" r="1.4"/><circle cx="12" cy="10" r="1.2"/>',
  elisa:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M11 4v16M15 4v16M19 4v16M3 9h18M3 14h18"/>',
  flame:
    '<path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-5 1-8Z"/><path d="M8 20h8"/>',
  autoclave:
    '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="4"/><path d="M12 8v2M16 12h-2M12 16v-2M8 12h2M8 2v2M16 2v2"/>',
  plating:
    '<circle cx="12" cy="12" r="8"/><path d="M8 8c3 0 2 3 5 3s3-3 5-3M8 12c3 0 2 3 5 3s3-3 5-3M9 16c2 0 2 1 4 1"/>',
  dilution:
    '<path d="M5 4h4v14a2 2 0 0 1-4 0V4ZM15 4h4v10a2 2 0 0 1-4 0V4Z"/><circle cx="7" cy="15" r=".7" fill="currentColor" stroke="none"/><circle cx="17" cy="11" r=".7" fill="currentColor" stroke="none"/><path d="M5 8h4M15 8h4"/>',
  gram:
    '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="8" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/>',
  growth:
    '<path d="M4 20V4M4 20h16"/><path d="M6 17c2 0 2-1 3-1s1-4 3-6 3-1 4-2 2-1 3-1"/>',
  microscope:
    '<path d="M9 3h5v5H9z"/><path d="M11 8l-3 5h8l-3-5"/><path d="M8 13h8v4H8z"/><path d="M4 21h16M12 17v4"/>',
  antibiotic:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" stroke-dasharray="2 2"/><path d="M12 4v2M20 12h-2M12 20v-2M4 12h2"/>',
  plant:
    '<path d="M12 21V10"/><path d="M12 14c-4 0-6-2-6-5 4 0 6 2 6 5ZM12 11c0-3 2-5 5-5 0 3-2 5-5 5Z"/><path d="M8 21h8"/>',
  cells:
    '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><circle cx="12" cy="16" r="3"/>',
  mitosis:
    '<circle cx="12" cy="12" r="9"/><path d="M8 8l3 3M11 8l-3 3M13 13l3 3M16 13l-3 3"/>',
  fusion:
    '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/><path d="M12 9v6"/>',
  agrobacterium:
    '<path d="M12 21V11"/><path d="M12 14c-4 0-6-2-6-5 4 0 6 2 6 5Z"/><ellipse cx="16" cy="7" rx="3" ry="1.6" transform="rotate(-25 16 7)"/><path d="M18.5 8.5c1.5.5 1 2 2.5 2"/>',
  genegun:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M12 2v3M22 12h-3"/>',
  seedling:
    '<path d="M12 21v-8"/><path d="M12 15c-4 0-6-2-6-5 4 0 6 2 6 5ZM12 12c0-3 2-5 5-5 0 3-2 5-5 5Z"/><circle cx="18" cy="5" r="2"/><path d="M4 21h16"/>',
  biofertilizer:
    '<path d="M20 4C10 4 4 9 4 16c0 2 1 4 3 4 7 0 13-6 13-16Z"/><path d="M7 17c3-4 6-6 10-8"/><circle cx="5" cy="8" r="1" fill="currentColor" stroke="none"/>',
  fermenter:
    '<rect x="6" y="4" width="12" height="16" rx="3"/><path d="M6 8h12M6 16h12"/><circle cx="10" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="14" cy="10" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r=".8" fill="currentColor" stroke="none"/><path d="M9 2h6"/>',
  kinetics:
    '<path d="M4 20V4M4 20h16"/><path d="M6 18c4 0 5-10 12-11"/>',
  chromatography:
    '<path d="M8 3h8v14a4 4 0 0 1-8 0V3Z"/><path d="M8 7h8M8 10h8M8 13h8"/><path d="M12 21v-2"/>',
  spectrophotometer:
    '<rect x="7" y="5" width="10" height="14" rx="2"/><path d="M7 10h10M7 14h10"/><path d="M3 12h4M17 12h4"/>',
  centrifuge:
    '<circle cx="12" cy="12" r="8"/><path d="M12 12l5-5M12 12l-5 5M12 12l5 4M12 12l-4-4"/><circle cx="12" cy="12" r="2"/>',
  bioremediation:
    '<path d="M5 8c3-2 5-2 7 0s4 2 7 0"/><path d="M5 12c3-2 5-2 7 0s4 2 7 0"/><path d="M5 16c3-2 5-2 7 0s4 2 7 0"/>',
  wastewater:
    '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z"/><path d="M9 14c1 1 2 1 3 0s2-1 3 0"/>',
  alignment:
    '<path d="M3 7h7M14 7h7M3 12h18M3 17h7M14 17h7"/><path d="M12 5v14" stroke-dasharray="2 2"/>',
  tree:
    '<path d="M12 21V9M12 13l-5-5M12 13l5-5M7 8V4M17 8V4M12 9V4"/>',
  punnett:
    '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16M9 4v16M14 4v16"/>',
  population:
    '<circle cx="7" cy="7" r="1.5"/><circle cx="13" cy="5" r="1.5"/><circle cx="18" cy="8" r="1.5"/><circle cx="9" cy="13" r="1.5"/><circle cx="16" cy="14" r="1.5"/><circle cx="5" cy="18" r="1.5"/><circle cx="12" cy="19" r="1.5"/><circle cx="19" cy="19" r="1.5"/>',
  molecule:
    '<circle cx="6" cy="16" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="18" cy="15" r="2"/><path d="M8 15l3-5M14 9l3 5M8 16h8"/>',
};

/**
 * Build an inline SVG icon.
 * @param {string} name key in the icon library
 * @param {string} className optional extra classes
 */
export function icon(name, className = "") {
  const body = ICONS[name] ?? ICONS.info;
  const classes = className ? `icon ${className}` : "icon";
  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* ==========================================================================
   Utilities
   ========================================================================== */
export function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ==========================================================================
   Toasts
   ========================================================================== */
const TOAST_ICONS = {
  success: "check-circle",
  error: "alert",
  warning: "alert",
  info: "info",
};
const MAX_TOASTS = 3;

export function toast({ title, message = "", type = "info", duration = 4200 } = {}) {
  const stack = document.getElementById("toast-stack");
  if (!stack || !title) return null;

  while (stack.children.length >= MAX_TOASTS) {
    stack.firstElementChild?.remove();
  }

  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `
    <span class="toast__icon">${icon(TOAST_ICONS[type] ?? "info")}</span>
    <div class="toast__body">
      <p class="toast__title"></p>
      ${message ? '<p class="toast__message"></p>' : ""}
    </div>
    <button class="toast__close" type="button" aria-label="Dismiss notification">${icon("close")}</button>
  `;

  el.querySelector(".toast__title").textContent = title;
  if (message) el.querySelector(".toast__message").textContent = message;

  let timer = null;
  const dismiss = () => {
    if (!el.isConnected) return;
    clearTimeout(timer);
    el.classList.add("is-leaving");
    window.setTimeout(() => el.remove(), 280);
  };

  el.querySelector(".toast__close").addEventListener("click", dismiss);
  const startTimer = () => {
    if (duration > 0) timer = window.setTimeout(dismiss, duration);
  };
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", startTimer);

  stack.append(el);
  startTimer();
  return el;
}

/* ==========================================================================
   Modal
   ========================================================================== */
let activeModal = null;
let modalReturnFocus = null;
let modalCounter = 0;

function focusableElements(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((el) => el.offsetParent !== null);
}

export function openModal({
  title,
  eyebrow = "",
  body = "",
  footer = null,
  wide = false,
  onClose = null,
} = {}) {
  const root = document.getElementById("modal-root");
  if (!root) return null;

  closeModal({ immediate: true });
  modalReturnFocus = document.activeElement;
  modalCounter += 1;
  const titleId = `modal-title-${modalCounter}`;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal${wide ? " modal--wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
      <div class="modal__head">
        <div class="modal__head-text">
          ${eyebrow ? '<p class="modal__eyebrow"></p>' : ""}
          <h2 class="modal__title" id="${titleId}"></h2>
        </div>
        <button class="modal__close" type="button" aria-label="Close dialog">${icon("close")}</button>
      </div>
      <div class="modal__body"></div>
      ${footer ? '<div class="modal__footer"></div>' : ""}
    </div>
  `;

  const modal = backdrop.querySelector(".modal");
  const bodyEl = backdrop.querySelector(".modal__body");
  modal.querySelector(".modal__title").textContent = title ?? "";
  if (eyebrow) modal.querySelector(".modal__eyebrow").textContent = eyebrow;

  if (typeof body === "string") {
    bodyEl.innerHTML = body;
  } else if (body instanceof Node) {
    bodyEl.append(body);
  }

  if (footer) {
    const footerEl = backdrop.querySelector(".modal__footer");
    if (footerEl) {
      if (typeof footer === "string") footerEl.innerHTML = footer;
      else if (footer instanceof Node) footerEl.append(footer);
    }
  }

  const close = ({ immediate = false } = {}) => {
    if (!backdrop.isConnected) return;
    if (immediate || prefersReducedMotion()) {
      backdrop.remove();
    } else {
      backdrop.classList.add("is-closing");
      window.setTimeout(() => backdrop.remove(), 180);
    }
    document.body.classList.remove("modal-open");
    if (activeModal?.element === backdrop) activeModal = null;
    document.removeEventListener("keydown", onKeydown);
    if (modalReturnFocus instanceof HTMLElement && modalReturnFocus.isConnected) {
      modalReturnFocus.focus({ preventScroll: true });
    }
    onClose?.();
  };

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusableElements(modal);
    if (items.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  modal.querySelector(".modal__close").addEventListener("click", () => close());
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeydown);

  root.append(backdrop);
  document.body.classList.add("modal-open");
  activeModal = { element: backdrop, close, modal };
  modal.focus({ preventScroll: true });

  return activeModal;
}

export function closeModal({ immediate = false } = {}) {
  activeModal?.close({ immediate });
}

export function confirmDialog({
  title = "Are you sure?",
  message = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const messageEl = document.createElement("p");
    messageEl.className = "confirm-message";
    messageEl.textContent = message;

    const actions = document.createDocumentFragment();

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--ghost btn--sm";
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = `btn btn--sm ${danger ? "btn--danger" : "btn--primary"}`;
    confirmBtn.textContent = confirmLabel;

    actions.append(cancelBtn, confirmBtn);

    const modal = openModal({
      title,
      body: messageEl,
      footer: actions,
      onClose: () => finish(false),
    });

    cancelBtn.addEventListener("click", () => {
      finish(false);
      modal?.close();
    });
    confirmBtn.addEventListener("click", () => {
      finish(true);
      modal?.close();
    });
  });
}

/* ==========================================================================
   Tooltips
   ========================================================================== */
export function initTooltips() {
  const layer = document.getElementById("tooltip-layer");
  if (!layer) return;

  let tip = null;
  let currentTarget = null;

  const hide = () => {
    currentTarget = null;
    if (tip) {
      tip.remove();
      tip = null;
    }
  };

  const show = (target) => {
    const text = target.getAttribute("data-tip");
    if (!text) return;
    hide();
    currentTarget = target;
    tip = document.createElement("div");
    tip.className = "tooltip";
    tip.textContent = text;
    layer.append(tip);

    const rect = target.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const margin = 10;
    let below = target.getAttribute("data-tip-pos") === "bottom";
    let top = rect.top - tipRect.height - margin;
    if (top < 8) below = true;
    if (below) top = rect.bottom + margin;

    const left = Math.min(
      Math.max(rect.left + rect.width / 2, tipRect.width / 2 + 8),
      window.innerWidth - tipRect.width / 2 - 8,
    );

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.transform = "translate(-50%, 0)";
    if (below) tip.classList.add("tooltip--below");
  };

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const target = event.target.closest?.("[data-tip]");
    if (target) show(target);
  });

  document.addEventListener("pointerout", (event) => {
    if (!currentTarget) return;
    const target = event.target.closest?.("[data-tip]");
    if (target === currentTarget && !currentTarget.contains(event.relatedTarget)) {
      hide();
    }
  });

  document.addEventListener("focusin", (event) => {
    const target = event.target.closest?.("[data-tip]");
    if (target) show(target);
  });

  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("resize", hide, { passive: true });
}

/* ==========================================================================
   Ripple
   ========================================================================== */
export function initRipples() {
  if (prefersReducedMotion()) return;

  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest?.(
      ".btn, .icon-btn, .chip, .viva-option, .lab-back",
    );
    if (!target || target.disabled) return;
    if (target.dataset.noRipple === "true") return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.append(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
    window.setTimeout(() => ripple.remove(), 800);
  });
}

/* ==========================================================================
   Synthesised sound
   ========================================================================== */
let audioContext = null;
let soundEnabled = false;

function ensureAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return audioContext;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  audioContext = new AudioCtx();
  return audioContext;
}

function tone(frequency, duration, { type = "sine", gain = 0.018, delay = 0 } = {}) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const amp = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(amp);
  amp.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

const SOUND_PATTERNS = {
  click: [[620, 0.045, "triangle", 0.012, 0]],
  toggle: [[520, 0.06, "sine", 0.015, 0]],
  open: [
    [440, 0.08, "sine", 0.014, 0],
    [660, 0.1, "sine", 0.012, 0.06],
  ],
  success: [
    [523.25, 0.1, "sine", 0.016, 0],
    [659.25, 0.1, "sine", 0.015, 0.08],
    [783.99, 0.16, "sine", 0.014, 0.16],
  ],
  error: [
    [220, 0.12, "triangle", 0.02, 0],
    [174.61, 0.16, "triangle", 0.018, 0.1],
  ],
  enable: [
    [660, 0.08, "sine", 0.014, 0],
    [880, 0.1, "sine", 0.012, 0.07],
  ],
  disable: [
    [520, 0.08, "sine", 0.012, 0],
    [330, 0.1, "sine", 0.01, 0.07],
  ],
};

export const sound = {
  get enabled() {
    return soundEnabled;
  },
  setEnabled(value) {
    const next = Boolean(value);
    if (next === soundEnabled) return soundEnabled;
    soundEnabled = next;
    if (soundEnabled) {
      ensureAudio();
      SOUND_PATTERNS.enable.forEach(([freq, dur, type, gain, delay]) =>
        tone(freq, dur, { type, gain, delay }),
      );
    }
    return soundEnabled;
  },
  toggle() {
    return this.setEnabled(!soundEnabled);
  },
  play(name = "click") {
    if (!soundEnabled) return;
    const pattern = SOUND_PATTERNS[name] ?? SOUND_PATTERNS.click;
    pattern.forEach(([freq, dur, type, gain, delay]) =>
      tone(freq, dur, { type, gain, delay }),
    );
  },
};
