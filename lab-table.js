/**
 * BioSim Lab · engine/lab-table.js
 * ---------------------------------------------------------------------------
 * The virtual bench shell that every hands-on experiment mounts.
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ title · modes · time control · undo/reset/save                    │
 *   ├───────────────────────────────────────────────────────────────────┤
 *   │ aim / procedure / hint drawer                                     │
 *   ├──────────────┬─────────────────────────────────┬──────────────────┤
 *   │ equipment &  │  bench with drop slots          │ readouts,        │
 *   │ reagent      │  + next-action banner           │ controls, graph, │
 *   │ shelf        │                                 │ log, results     │
 *   └──────────────┴─────────────────────────────────┴──────────────────┘
 *
 * It owns no scientific logic: experiments drive it through
 *   table.setReadouts(...), table.setControls(...), table.setGraph(...)
 * and receive intent through the tiny emitter (`table.on("slotDrop", ...)`).
 */

import { escapeHTML, formatVolume, prefersReducedMotion, uid } from "./util.js";
import { DragManager } from "./draggable.js";
import { drawSeries } from "./results-engine.js";

/* ==========================================================================
   Equipment visuals — inline SVG, one definition per bench item type
   ========================================================================== */
const GLASS_DEFS = `
  <defs>
    <linearGradient id="glassGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.34)" />
      <stop offset="45%" stop-color="rgba(255,255,255,0.06)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0.16)" />
    </linearGradient>
    <linearGradient id="metalGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7f98a0" />
      <stop offset="55%" stop-color="#41565e" />
      <stop offset="100%" stop-color="#25343a" />
    </linearGradient>
  </defs>`;

function liquidBand({ x, y, width, height, level, color, clipId, bubbles = 0 }) {
  if (level <= 0) return "";
  const h = Math.max(1, height * Math.min(1, level));
  const top = y + (height - h);
  const bubbleCount = Math.round(bubbles * 5);
  const bubblesMarkup = Array.from({ length: bubbleCount }, (_, i) => {
    const bx = x + ((i + 1) / (bubbleCount + 1)) * width;
    const by = top + 8 + ((i * 7) % Math.max(8, h - 12));
    return `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${1.2 + (i % 3) * 0.6}" fill="rgba(255,255,255,0.55)" />`;
  }).join("");
  return `
    <g clip-path="url(#${clipId})">
      <rect x="${x}" y="${top}" width="${width}" height="${h}" fill="${color}" opacity="0.82" />
      <rect x="${x}" y="${top}" width="${width}" height="2" fill="rgba(255,255,255,0.5)" />
      ${bubblesMarkup}
    </g>`;
}

function svgShell(inner, { width = 84, height = 108, label = "" } = {}) {
  return `<svg viewBox="0 0 ${width} ${height}" class="equip__svg" role="img" aria-label="${escapeHTML(label)}">
    ${GLASS_DEFS}${inner}
  </svg>`;
}

/**
 * Render one bench item.
 * @param {string} type flask | beaker | tube | bottle | plate | gel | tank | tips | pipette | rack | slide | machine
 * @param {{level?: number, color?: string, label?: string, temperatureC?: number, glow?: boolean, pellet?: boolean}} view
 */
export function equipmentSVG(type, view = {}) {
  const level = view.level ?? 0;
  const color = view.color ?? "rgb(46,230,197)";
  const temp = view.temperatureC;
  const hot = Number(temp) > 60;
  const clipId = uid("clip");

  switch (type) {
    case "flask":
      return svgShell(
        `<defs><clipPath id="flaskClip"><path d="M38 14 h8 v26 l20 40 a8 8 0 0 1 -7 12 H25 a8 8 0 0 1 -7 -12 l20 -40 Z" /></clipPath></defs>
         <path d="M38 14 h8 v26 l20 40 a8 8 0 0 1 -7 12 H25 a8 8 0 0 1 -7 -12 l20 -40 Z"
               fill="url(#glassGrad)" stroke="rgba(190,240,235,0.6)" stroke-width="1.4" />
         ${liquidBand({ x: 20, y: 45, width: 44, height: 47, level: level * 1.35, color, clipId: "flaskClip", bubbles: view.bubbles ?? 0 })}
         <rect x="36" y="10" width="12" height="6" rx="2" fill="url(#metalGrad)" />
         ${hot ? '<circle cx="42" cy="72" r="22" fill="rgba(251,113,133,0.16)" />' : ""}`,
        { label: view.label || "Conical flask" },
      );

    case "beaker":
      return svgShell(
        `<defs><clipPath id="beakerClip"><rect x="18" y="20" width="48" height="66" rx="5" /></clipPath></defs>
         <rect x="18" y="20" width="48" height="66" rx="5" fill="url(#glassGrad)" stroke="rgba(190,240,235,0.6)" stroke-width="1.4" />
         ${liquidBand({ x: 18, y: 20, width: 48, height: 66, level, color, clipId: "beakerClip" })}
         <path d="M18 20 h14 M18 30 h8 M18 40 h6" stroke="rgba(220,250,245,0.5)" stroke-width="1" />`,
        { label: view.label || "Beaker" },
      );

    case "tube":
      return svgShell(
        `<defs><clipPath id="tubeClip"><rect x="33" y="16" width="18" height="74" rx="9" /></clipPath></defs>
         <rect x="33" y="16" width="18" height="74" rx="9" fill="url(#glassGrad)" stroke="rgba(190,240,235,0.55)" stroke-width="1.3" />
         ${liquidBand({ x: 33, y: 16, width: 18, height: 74, level, color, clipId: "tubeClip" })}
         <rect x="31" y="10" width="22" height="8" rx="3" fill="url(#metalGrad)" />
         <path d="M36 96 a6 6 0 0 0 12 0" fill="none" stroke="rgba(190,240,235,0.5)" stroke-width="1.2" />`,
        { label: view.label || "Microcentrifuge tube" },
      );

    case "bottle":
      return svgShell(
        `<defs><clipPath id="bottleClip"><rect x="24" y="28" width="36" height="62" rx="6" /></clipPath></defs>
         <rect x="24" y="28" width="36" height="62" rx="6" fill="url(#glassGrad)" stroke="rgba(190,240,235,0.6)" stroke-width="1.4" />
         ${liquidBand({ x: 24, y: 28, width: 36, height: 62, level, color, clipId: "bottleClip" })}
         <rect x="34" y="14" width="16" height="14" rx="3" fill="url(#metalGrad)" />
         <rect x="28" y="46" width="28" height="16" rx="2" fill="rgba(8,24,27,0.72)" stroke="rgba(190,240,235,0.3)" />`,
        { label: view.label || "Reagent bottle" },
      );

    case "plate":
      return svgShell(
        `<ellipse cx="42" cy="62" rx="32" ry="24" fill="rgba(120,190,180,0.16)" stroke="rgba(190,240,235,0.55)" stroke-width="1.4" />
         <ellipse cx="42" cy="58" rx="32" ry="24" fill="url(#glassGrad)" stroke="rgba(190,240,235,0.6)" stroke-width="1.4" />
         <ellipse cx="42" cy="58" rx="26" ry="19" fill="${level > 0 ? color : "rgba(190,240,235,0.08)"}" opacity="0.55" />
         ${(view.colonies || 0) > 0
           ? Array.from({ length: Math.min(18, view.colonies) }, (_, i) => {
               const angle = (i / 18) * Math.PI * 2;
               const r = 6 + (i % 4) * 4;
               return `<circle cx="${(42 + Math.cos(angle) * r).toFixed(1)}" cy="${(58 + Math.sin(angle) * r * 0.7).toFixed(1)}" r="1.6" fill="rgba(255,255,255,0.75)" />`;
             }).join("")
           : ""}`,
        { label: view.label || "Petri dish" },
      );

    case "gel":
      return svgShell(
        `<rect x="14" y="30" width="56" height="48" rx="4" fill="${level > 0 ? color : "rgba(120,200,190,0.22)"}" opacity="0.55" stroke="rgba(190,240,235,0.6)" stroke-width="1.3" />
         ${Array.from({ length: 6 }, (_, i) => `<rect x="${20 + i * 8}" y="36" width="5" height="4" rx="1" fill="rgba(8,20,22,0.65)" />`).join("")}
         ${(view.bands || []).map((band) => `<rect x="${20 + band.lane * 8}" y="${(52 + band.y).toFixed(1)}" width="6" height="2.4" rx="1" fill="${band.color || "#f97316"}" opacity="${band.opacity ?? 0.9}" />`).join("")}`,
        { width: 84, height: 108, label: view.label || "Agarose gel" },
      );

    case "tank":
      return svgShell(
        `<rect x="12" y="34" width="60" height="46" rx="4" fill="rgba(80,160,190,0.18)" stroke="rgba(190,240,235,0.5)" stroke-width="1.3" />
         <rect x="16" y="52" width="52" height="1.4" fill="rgba(190,240,235,0.35)" />
         <rect x="16" y="40" width="6" height="30" rx="2" fill="url(#metalGrad)" />
         <rect x="62" y="40" width="6" height="30" rx="2" fill="url(#metalGrad)" />
         ${view.glow ? '<circle cx="19" cy="70" r="8" fill="rgba(46,230,197,0.25)" /><circle cx="65" cy="70" r="8" fill="rgba(251,113,133,0.25)" />' : ""}`,
        { label: view.label || "Gel tank" },
      );

    case "tips":
      return svgShell(
        `<rect x="18" y="40" width="48" height="42" rx="4" fill="url(#glassGrad)" stroke="rgba(190,240,235,0.45)" stroke-width="1.2" />
         ${Array.from({ length: 12 }, (_, i) => {
           const col = i % 4;
           const row = Math.floor(i / 4);
           return `<path d="M${24 + col * 11} ${46 + row * 11} h7 l-3.5 7 z" fill="${view.tipColor || "#fef08a"}" opacity="0.85" />`;
         }).join("")}`,
        { label: view.label || "Tip box" },
      );

    case "pipette":
      return svgShell(
        `<rect x="36" y="8" width="12" height="22" rx="5" fill="${view.color || "rgb(46,230,197)"}" />
         <rect x="38" y="28" width="8" height="44" rx="3" fill="url(#glassGrad)" stroke="rgba(190,240,235,0.5)" stroke-width="1.1" />
         <rect x="39" y="70" width="6" height="8" fill="rgba(255,255,255,0.4)" />
         <path d="M39 78 l3 16 l3 -16 z" fill="${view.tipColor || "#fef08a"}" opacity="0.9" />
         <rect x="34" y="16" width="16" height="8" rx="2" fill="rgba(8,24,27,0.8)" />`,
        { label: view.label || "Micropipette" },
      );

    case "rack":
      return svgShell(
        `<rect x="14" y="44" width="56" height="36" rx="4" fill="url(#metalGrad)" opacity="0.55" />
         ${Array.from({ length: 8 }, (_, i) => `<circle cx="${21 + i * 6}" cy="52" r="2.2" fill="rgba(8,20,22,0.8)" />`).join("")}`,
        { label: view.label || "Tube rack" },
      );

    case "slide":
      return svgShell(
        `<rect x="22" y="34" width="40" height="56" rx="3" fill="rgba(230,250,250,0.22)" stroke="rgba(220,250,245,0.6)" stroke-width="1.2" />
         <rect x="30" y="46" width="24" height="24" rx="2" fill="${color}" opacity="0.6" />`,
        { label: view.label || "Microscope slide" },
      );

    case "machine":
    default:
      return svgShell(
        `<rect x="12" y="34" width="60" height="52" rx="6" fill="url(#metalGrad)" opacity="0.85" />
         <rect x="18" y="42" width="48" height="18" rx="3" fill="rgba(4,18,20,0.85)" stroke="rgba(46,230,197,0.35)" />
         <text x="42" y="55" text-anchor="middle" font-size="9" font-family="monospace" fill="${view.color || "#2ee6c5"}">${escapeHTML(view.display || "—")}</text>
         <circle cx="26" cy="74" r="4" fill="${view.running ? "#3ddc97" : "#546a70"}" />
         <circle cx="42" cy="74" r="3" fill="rgba(255,255,255,0.25)" />
         <circle cx="56" cy="74" r="3" fill="rgba(255,255,255,0.25)" />`,
        { label: view.label || "Instrument" },
      );
  }
}

/* ==========================================================================
   LabTable
   ========================================================================== */
export class LabTable {
  /**
   * @param {HTMLElement} root
   * @param {{
   *   title: string, eyebrow?: string, aim?: string, principle?: string,
   *   procedure?: Array<{title: string, hint: string}>,
   *   slots?: Array<{id: string, label: string, accepts?: string[], hint?: string}>,
   *   shelf?: Array<{id: string, label: string, type: string, group?: string, color?: string}>,
   *   mode?: "guided"|"free"|"exam",
   *   onExit?: Function
   * }} config
   */
  constructor(root, config = {}) {
    this.root = root;
    this.config = config;
    this.mode = config.mode ?? "guided";
    this.speed = 1;
    this.listeners = new Map();
    this.drag = null;
    this.placed = new Map();
    this.currentTab = "bench";
    this.hintVisible = true;
    this._cleanups = [];
    this._destroyed = false;
    this._controls = [];
    this._readouts = [];
  }

  /* ------------------------------------------------------------- emitter */
  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  emit(event, detail) {
    for (const handler of this.listeners.get(event) ?? []) {
      try {
        handler(detail);
      } catch (error) {
        console.warn(`[LabTable] "${event}" listener failed`, error);
      }
    }
  }

  /* ---------------------------------------------------------------- mount */
  mount() {
    const config = this.config;
    this.root.innerHTML = `
      <div class="labtable" data-mode="${escapeHTML(this.mode)}">
        <header class="labtable__top">
          <div class="labtable__top-inner">
            <button class="labtable__back" type="button" data-action="exit">← Library</button>
            <div class="labtable__title">
              <span class="labtable__eyebrow">${escapeHTML(config.eyebrow ?? "Virtual bench")}</span>
              <h1>${escapeHTML(config.title ?? "Experiment")}</h1>
            </div>
            <div class="labtable__modes" role="group" aria-label="Help mode">
              ${["guided", "free", "exam"]
                .map(
                  (mode) =>
                    `<button type="button" data-mode="${mode}" class="${mode === this.mode ? "is-active" : ""}">${mode[0].toUpperCase()}${mode.slice(1)}</button>`,
                )
                .join("")}
            </div>
            <div class="labtable__time" role="group" aria-label="Time control">
              ${[1, 2, 10]
                .map(
                  (speed) =>
                    `<button type="button" data-speed="${speed}" class="${speed === this.speed ? "is-active" : ""}">${speed}×</button>`,
                )
                .join("")}
              <button type="button" data-action="skip">Skip</button>
            </div>
            <div class="labtable__history">
              <button type="button" data-action="undo" aria-label="Undo">Undo</button>
              <button type="button" data-action="reset" aria-label="Reset bench">Reset</button>
              <button type="button" data-action="save" aria-label="Save bench">Save</button>
            </div>
          </div>
        </header>

        <section class="labtable__drawer">
          <div class="labtable__drawer-tabs" role="tablist">
            <button type="button" role="tab" data-drawer="aim" class="is-active">Aim</button>
            <button type="button" role="tab" data-drawer="procedure">Procedure</button>
            <button type="button" role="tab" data-drawer="hint">Hint</button>
            <button type="button" class="labtable__hint-toggle" data-action="toggle-hint" aria-pressed="${this.hintVisible}">
              ${this.hintVisible ? "Hints on" : "Hints off"}
            </button>
          </div>
          <div class="labtable__drawer-body" id="labtable-drawer-body"></div>
        </section>

        <div class="labtable__grid">
          <aside class="labtable__shelf" aria-label="Equipment and reagents">
            <label class="labtable__search">
              <span class="sr-only">Search equipment</span>
              <input type="search" placeholder="Search equipment…" data-shelf-search />
            </label>
            <div class="labtable__shelf-list" data-shelf></div>
          </aside>

          <section class="labtable__bench" aria-label="Bench">
            <div class="labtable__banner" data-banner></div>
            <div class="labtable__slots" data-slots></div>
          </section>

          <aside class="labtable__panel" aria-label="Instrument panel">
            <div class="labtable__tabs" role="tablist">
              <button type="button" role="tab" data-tab="bench" class="is-active">Bench</button>
              <button type="button" role="tab" data-tab="log">Log</button>
              <button type="button" role="tab" data-tab="results">Results</button>
            </div>
            <div class="labtable__panel-body">
              <section data-panel="bench">
                <div class="labtable__readouts" data-readouts></div>
                <div class="labtable__controls" data-controls></div>
                <div class="labtable__graph">
                  <canvas data-graph></canvas>
                </div>
              </section>
              <section data-panel="log" hidden>
                <ol class="labtable__log" data-log></ol>
              </section>
              <section data-panel="results" hidden data-results></section>
            </div>
          </aside>
        </div>
      </div>
    `;

    this.els = {
      root: this.root.querySelector(".labtable"),
      shelf: this.root.querySelector("[data-shelf]"),
      slots: this.root.querySelector("[data-slots]"),
      banner: this.root.querySelector("[data-banner]"),
      drawerBody: this.root.querySelector("#labtable-drawer-body"),
      readouts: this.root.querySelector("[data-readouts]"),
      controls: this.root.querySelector("[data-controls]"),
      graph: this.root.querySelector("[data-graph]"),
      log: this.root.querySelector("[data-log]"),
      results: this.root.querySelector("[data-results]"),
    };

    this.drag = new DragManager({ root: this.els.root });
    this._bindChrome();
    this.renderShelf();
    this.renderSlots();
    this.renderDrawer("aim");
    this.setHint(null);
    return this;
  }

  /* --------------------------------------------------------------- chrome */
  _bindChrome() {
    const root = this.els.root;
    const click = (event) => {
      // Scope to the buttons: the .labtable root also carries data-mode, so a
      // bare closest("[data-mode]") would swallow every other click.
      const modeButton = event.target.closest("button[data-mode]");
      if (modeButton) {
        this.setMode(modeButton.dataset.mode);
        return;
      }
      const speedButton = event.target.closest("[data-speed]");
      if (speedButton) {
        this.setSpeed(Number(speedButton.dataset.speed));
        return;
      }
      const drawer = event.target.closest("button[data-drawer]");
      if (drawer) {
        this.renderDrawer(drawer.dataset.drawer);
        return;
      }
      const tab = event.target.closest("button[data-tab]");
      if (tab) {
        this.setTab(tab.dataset.tab);
        return;
      }
      const action = event.target.closest("button[data-action]");
      if (!action) return;
      switch (action.dataset.action) {
        case "exit":
          this.emit("exit");
          break;
        case "undo":
          this.emit("undo");
          break;
        case "reset":
          this.emit("reset");
          break;
        case "save":
          this.emit("save");
          break;
        case "skip":
          this.emit("skip");
          break;
        case "toggle-hint":
          this.hintVisible = !this.hintVisible;
          action.setAttribute("aria-pressed", String(this.hintVisible));
          action.textContent = this.hintVisible ? "Hints on" : "Hints off";
          this.els.root.dataset.hints = this.hintVisible ? "on" : "off";
          this.emit("hintToggle", this.hintVisible);
          // Refresh the open drawer and the banner immediately.
          this.setHint(this.currentStep);
          {
            const active = this.root.querySelector("button[data-drawer].is-active");
            if (active) this.renderDrawer(active.dataset.drawer);
          }
          break;
        default:
          break;
      }
    };
    root.addEventListener("click", click);
    this._cleanups.push(() => root.removeEventListener("click", click));

    const search = this.root.querySelector("[data-shelf-search]");
    const filter = () => {
      const term = search.value.trim().toLowerCase();
      for (const item of this.els.shelf.querySelectorAll("[data-shelf-item]")) {
        const haystack = item.dataset.search ?? "";
        item.hidden = term.length > 0 && !haystack.includes(term);
      }
    };
    search.addEventListener("input", filter);
    this._cleanups.push(() => search.removeEventListener("input", filter));
  }

  /* ---------------------------------------------------------------- shelf */
  renderShelf() {
    const shelf = this.config.shelf ?? [];
    const groups = new Map();
    for (const item of shelf) {
      const group = item.group ?? "Equipment";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }

    this.els.shelf.innerHTML = [...groups.entries()]
      .map(
        ([group, items]) => `
        <div class="labtable__shelf-group">
          <h3>${escapeHTML(group)}</h3>
          ${items
            .map(
              (item) => `
            <button type="button" class="shelf-item" data-shelf-item="${escapeHTML(item.id)}"
              data-search="${escapeHTML(`${item.label} ${group}`.toLowerCase())}"
              aria-label="${escapeHTML(item.label)}">
              <span class="shelf-item__art">${equipmentSVG(item.type, { color: item.color, label: item.label })}</span>
              <span class="shelf-item__label">${escapeHTML(item.label)}</span>
            </button>`,
            )
            .join("")}
        </div>`,
      )
      .join("");

    for (const button of this.els.shelf.querySelectorAll("[data-shelf-item]")) {
      const item = shelf.find((entry) => entry.id === button.dataset.shelfItem);
      this.drag.registerSource(button, {
        data: item,
        type: item.type,
        label: item.label,
        onDrop: (data, zone) => {
          this.emit("shelfDrop", { item: data, slotId: zone?.slotId ?? null });
        },
      });
    }
  }

  /* ---------------------------------------------------------------- slots */
  renderSlots() {
    const slots = this.config.slots ?? [];
    this.els.slots.innerHTML = slots
      .map(
        (slot) => `
      <div class="bench-slot" data-slot="${escapeHTML(slot.id)}">
        <span class="bench-slot__label">${escapeHTML(slot.label)}</span>
        <div class="bench-slot__art" data-slot-art="${escapeHTML(slot.id)}">
          <span class="bench-slot__empty">${escapeHTML(slot.hint ?? "drop here")}</span>
        </div>
      </div>`,
      )
      .join("");

    for (const zoneEl of this.els.slots.querySelectorAll("[data-slot]")) {
      const slot = slots.find((entry) => entry.id === zoneEl.dataset.slot);
      this.drag.registerZone(zoneEl, {
        slotId: slot.id,
        label: slot.label,
        accept: (data) => !slot.accepts || (data && slot.accepts.includes(data.type)),
        onDrop: (data, _record, zone) => {
          this.placeInSlot(slot.id, data);
          this.emit("slotDrop", { slotId: zone.slotId, item: data });
        },
      });
    }
  }

  /**
   * Put an item in a slot and render it.
   * @param {string} slotId
   * @param {{id: string, label: string, type: string}} item
   * @param {object} view liquid / display state for the artwork
   */
  placeInSlot(slotId, item, view = {}) {
    const art = this.els.slots.querySelector(`[data-slot-art="${slotId}"]`);
    if (!art || !item) return;
    this.placed.set(slotId, { item, view });
    art.innerHTML = `
      <span class="bench-item" data-bench-item="${escapeHTML(item.id)}" data-type="${escapeHTML(item.type)}">
        ${equipmentSVG(item.type, { ...view, label: item.label })}
        <span class="bench-item__name">${escapeHTML(item.label)}</span>
      </span>`;
    this.drag.registerSource(art.querySelector(".bench-item"), {
      data: { ...item, slotId },
      type: item.type,
      label: item.label,
      onDrop: (data, zone) => this.emit("moveItem", { from: slotId, to: zone?.slotId ?? null, item: data }),
    });
  }

  /** Refresh the artwork of a placed item without recreating it. */
  updateSlot(slotId, view = {}) {
    const placed = this.placed.get(slotId);
    if (!placed) return;
    const art = this.els.slots.querySelector(`[data-slot-art="${slotId}"]`);
    if (!art) return;
    placed.view = { ...placed.view, ...view };
    const svg = art.querySelector(".equip__svg");
    if (svg) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = equipmentSVG(placed.item.type, { ...placed.view, label: placed.item.label });
      svg.replaceWith(wrapper.firstElementChild);
    }
  }

  clearSlot(slotId) {
    const slot = (this.config.slots ?? []).find((entry) => entry.id === slotId);
    const art = this.els.slots.querySelector(`[data-slot-art="${slotId}"]`);
    if (!art) return;
    this.placed.delete(slotId);
    art.innerHTML = `<span class="bench-slot__empty">${escapeHTML(slot?.hint ?? "drop here")}</span>`;
  }

  /** Clear every occupied slot in one go (used by Reset and Undo). */
  clearAll() {
    for (const slotId of [...this.placed.keys()]) this.clearSlot(slotId);
  }

  /* --------------------------------------------------------------- drawer */
  renderDrawer(tab) {
    const config = this.config;
    const body = this.els.drawerBody;
    for (const button of this.root.querySelectorAll("[data-drawer]")) {
      button.classList.toggle("is-active", button.dataset.drawer === tab);
    }
    if (tab === "aim") {
      body.innerHTML = `
        <p class="labtable__aim">${escapeHTML(config.aim ?? "Run the protocol on the bench.")}</p>
        ${config.principle ? `<p class="labtable__principle">${escapeHTML(config.principle)}</p>` : ""}`;
    } else if (tab === "procedure") {
      const steps = config.procedure ?? [];
      body.innerHTML = steps.length
        ? `<ol class="labtable__steps">${steps
            .map(
              (step, index) => `<li data-step-index="${index}">
                <strong>${escapeHTML(step.title)}</strong>
                <span>${escapeHTML(step.hint ?? "")}</span>
              </li>`,
            )
            .join("")}</ol>`
        : `<p class="labtable__empty">No procedure registered.</p>`;
      // Paint the freshly created list from the last known step so the drawer
      // is correct the moment it opens, not only after the next refresh tick.
      this._paintSteps(this._activeStepIndex());
    } else {
      const hidden = !this.hintVisible;
      const steps = config.procedure ?? [];
      const hint = this.currentStep
        ? this.currentStep.hint ?? this.currentStep.title
        : steps.length
          ? "Procedure complete — open Results to review the run, or the Viva to test yourself."
          : "Pick the next action from the shelf.";
      body.innerHTML = hidden
        ? `<p class="labtable__empty">Hints are off. In Free and Exam mode you must recall the next step yourself.</p>`
        : `<p class="labtable__aim" data-hint-text>${escapeHTML(hint)}</p>`;
    }
  }

  /** Show the next guided action, and mark the matching procedure step. */
  setHint(step, text = null) {
    this.currentStep = step;
    this.els.root.dataset.hints = this.hintVisible ? "on" : "off";
    if (this.els.banner) {
      const show = this.mode === "guided" && this.hintVisible && step;
      this.els.banner.hidden = !show;
      this.els.banner.innerHTML = show
        ? `<span class="labtable__banner-dot"></span><span><b>Next:</b> ${escapeHTML(text ?? step.hint ?? step.title ?? "")}</span>`
        : "";
    }
    const steps = this.config.procedure ?? [];
    const activeIndex = step ? steps.findIndex((entry) => entry.title === step.title) : steps.length;
    const hintText = this.root.querySelector("[data-hint-text]");
    if (hintText) {
      hintText.textContent = !this.hintVisible
        ? "Hints are off. Switch them back on to see the next step."
        : step
          ? text ?? step.hint ?? step.title ?? "Follow the procedure."
          : steps.length
            ? "Procedure complete — open Results to review the run, or the Viva to test yourself."
            : "Follow the procedure.";
    }
    this._paintSteps(activeIndex);
  }

  /** Index of `currentStep` inside the configured procedure (steps.length = done). */
  _activeStepIndex() {
    const steps = this.config.procedure ?? [];
    return this.currentStep ? steps.findIndex((entry) => entry.title === this.currentStep.title) : steps.length;
  }

  /** Mark the procedure list: completed above the active step, current on it. */
  _paintSteps(activeIndex) {
    for (const entry of this.root.querySelectorAll("[data-step-index]")) {
      const index = Number(entry.dataset.stepIndex);
      entry.classList.toggle("is-current", activeIndex >= 0 && index === activeIndex);
      entry.classList.toggle("is-done", index < activeIndex);
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.els.root.dataset.mode = mode;
    for (const button of this.root.querySelectorAll("button[data-mode]")) {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    }
    this.setHint(this.currentStep);
    this.emit("mode", mode);
  }

  setSpeed(speed) {
    this.speed = speed;
    for (const button of this.root.querySelectorAll("[data-speed]")) {
      button.classList.toggle("is-active", Number(button.dataset.speed) === speed);
    }
    this.emit("speed", speed);
  }

  setTab(tab) {
    this.currentTab = tab;
    for (const button of this.root.querySelectorAll("[data-tab]")) {
      button.classList.toggle("is-active", button.dataset.tab === tab);
    }
    for (const panel of this.root.querySelectorAll("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== tab;
    }
    this.emit("tab", tab);
  }

  /* -------------------------------------------------------------- readouts */
  /** @param {Array<{label: string, value: string|number, unit?: string, status?: string}>} rows */
  setReadouts(rows) {
    this._readouts = rows;
    this.els.readouts.innerHTML = rows
      .map(
        (row) => `
      <div class="readout ${row.status ? `readout--${row.status}` : ""}">
        <span class="readout__label">${escapeHTML(row.label)}</span>
        <span class="readout__value">${escapeHTML(String(row.value ?? "—"))}${
          row.unit ? `<small>${escapeHTML(row.unit)}</small>` : ""
        }</span>
      </div>`,
      )
      .join("");
  }

  /* -------------------------------------------------------------- controls */
  /**
   * @param {Array<{key:string,label:string,min:number,max:number,step:number,
   *                value:number,unit?:string}>} controls
   * @param {(key:string, value:number)=>void} onChange
   */
  setControls(controls, onChange = null) {
    this._controls = controls;
    this._onControlChange = onChange ?? this._onControlChange;
    this.els.controls.innerHTML = controls
      .map(
        (control) => `
      <label class="lab-control">
        <span class="lab-control__top">
          <span>${escapeHTML(control.label)}</span>
          <b data-control-value="${escapeHTML(control.key)}">${control.value}${control.unit ? ` ${escapeHTML(control.unit)}` : ""}</b>
        </span>
        <input type="range" data-control="${escapeHTML(control.key)}"
          min="${control.min}" max="${control.max}" step="${control.step}" value="${control.value}"
          aria-label="${escapeHTML(control.label)}" />
      </label>`,
      )
      .join("");

    for (const input of this.els.controls.querySelectorAll("[data-control]")) {
      const handler = () => {
        const key = input.dataset.control;
        const value = Number(input.value);
        const display = this.els.controls.querySelector(`[data-control-value="${key}"]`);
        const def = controls.find((entry) => entry.key === key);
        if (display) display.textContent = `${value}${def?.unit ? ` ${def.unit}` : ""}`;
        this._onControlChange?.(key, value);
        this.emit("control", { key, value });
      };
      input.addEventListener("input", handler);
      this._cleanups.push(() => input.removeEventListener("input", handler));
    }
  }

  /* ----------------------------------------------------------------- graph */
  setGraph({ series = [], xLabel = "", yLabel = "", logY = false } = {}) {
    this._graph = { series, xLabel, yLabel, logY };
    if (prefersReducedMotion()) {
      drawSeries(this.els.graph, this._graph);
      return;
    }
    drawSeries(this.els.graph, this._graph);
  }

  /* ------------------------------------------------------------------- log */
  setLog(entries = []) {
    this.els.log.innerHTML = entries.length
      ? entries
          .slice(-120)
          .reverse()
          .map(
            (entry) =>
              `<li class="labtable__log-entry labtable__log-entry--${escapeHTML(entry.type)}">
                <time>${escapeHTML(entry.clock)}</time>
                <span>${escapeHTML(entry.message)}</span>
              </li>`,
          )
          .join("")
      : `<li class="labtable__log-empty">No actions yet.</li>`;
  }

  /* --------------------------------------------------------------- results */
  setResults(html) {
    this.els.results.innerHTML = html;
    this.setTab("results");
  }

  /* --------------------------------------------------------------- teardown */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const cleanup of this._cleanups) cleanup();
    this._cleanups.length = 0;
    this.drag?.destroy();
    this.drag = null;
    this.listeners.clear();
    this.placed.clear();
    this.root.innerHTML = "";
  }
}

export default LabTable;
