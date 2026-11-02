/**
 * BioSim Lab · engine/draggable.js
 * ---------------------------------------------------------------------------
 * One pointer-driven drag manager for the whole bench: mouse, pen and touch.
 *
 * • Sources are the shelf items and any equipment already on the bench.
 * • Zones are bench slots, the waste bin, or an instrument dropping area.
 * • A semi-transparent ghost follows the pointer; the target slot highlights
 *   when the payload is accepted, and shakes when it is not.
 * • Keyboard access: focus a source, press Enter to pick it up, then Enter on a
 *   zone to drop (Escape cancels).
 */

import { uid } from "./util.js";

const DRAG_THRESHOLD_PX = 5;

export class DragManager {
  constructor({
    root = document.body,
    ghostClass = "drag-ghost",
    draggingClass = "is-dragging",
    invalidClass = "is-invalid",
    pickingClass = "is-picked",
    acceptsClass = "is-accepting",
  } = {}) {
    this.root = root;
    this.ghostClass = ghostClass;
    this.draggingClass = draggingClass;
    this.invalidClass = invalidClass;
    this.pickingClass = pickingClass;
    this.acceptsClass = acceptsClass;

    this.sources = new Map();
    this.zones = new Map();
    this.drag = null;
    this.picked = null;
    this._cleanups = [];
    this._bound = false;
    this._bind();
  }

  /* ------------------------------------------------------------- binding */
  _bind() {
    const move = (event) => this._onPointerMove(event);
    const up = (event) => this._onPointerUp(event);
    const key = (event) => this._onKeyDown(event);

    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("keydown", key);

    this._cleanups.push(() => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("keydown", key);
    });
    this._bound = true;
  }

  /**
   * @param {HTMLElement} element
   * @param {{data?: any, label?: string, onDragStart?: Function,
   *          onDrop?: Function, onCancel?: Function, type?: string}} options
   */
  registerSource(element, options = {}) {
    if (!element) return () => {};
    const record = {
      element,
      data: options.data ?? null,
      label: options.label ?? element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "item",
      type: options.type ?? "item",
      onDragStart: options.onDragStart ?? null,
      onDrop: options.onDrop ?? null,
      onCancel: options.onCancel ?? null,
      disabled: Boolean(options.disabled),
    };
    this.sources.set(element, record);
    element.classList.add("drag-source");
    if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "0");
    if (!element.hasAttribute("role")) element.setAttribute("role", "button");

    const down = (event) => this._onPointerDown(event, element);
    const keydown = (event) => this._onSourceKey(event, element);
    element.addEventListener("pointerdown", down);
    element.addEventListener("keydown", keydown);

    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("keydown", keydown);
      this.sources.delete(element);
    };
  }

  /**
   * @param {HTMLElement} element
   * @param {{accept?: (data:any, record:object)=>boolean, onDrop: Function,
   *          slotId?: string, label?: string, hoverClass?: string}} options
   */
  registerZone(element, options = {}) {
    if (!element) return () => {};
    const record = {
      element,
      accept: options.accept ?? (() => true),
      onDrop: options.onDrop ?? (() => {}),
      slotId: options.slotId ?? element.dataset.slot ?? null,
      label: options.label ?? "slot",
      hoverClass: options.hoverClass ?? "is-hover",
    };
    this.zones.set(element, record);
    element.classList.add("dropzone");
    element.setAttribute("tabindex", element.getAttribute("tabindex") ?? "0");

    const keydown = (event) => {
      if (!this.picked) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this._keyboardDrop(element);
      }
    };
    element.addEventListener("keydown", keydown);
    element.addEventListener("click", (event) => {
      if (this.picked) {
        event.preventDefault();
        this._keyboardDrop(element);
      }
    });

    return () => {
      element.removeEventListener("keydown", keydown);
      this.zones.delete(element);
    };
  }

  /* -------------------------------------------------------------- pointer */
  _onPointerDown(event, element) {
    const record = this.sources.get(element);
    if (!record || record.disabled) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest("[data-no-drag]")) return;

    this.drag = {
      record,
      element,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      pointerId: event.pointerId,
      ghost: null,
      zone: null,
      viaKeyboard: false,
    };
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      /* synthetic pointer events have no capture target */
    }
  }

  _onPointerMove(event) {
    const drag = this.drag;
    if (!drag) return;
    drag.x = event.clientX;
    drag.y = event.clientY;

    if (!drag.active) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      this._beginDrag(drag);
    }
    event.preventDefault();
    this._moveGhost(drag);
    this._highlightZone(drag, this._zoneAt(event.clientX, event.clientY));
  }

  _onPointerUp() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;

    if (!drag.active) {
      this._releaseCapture(drag);
      return;
    }

    const zone = drag.zone;
    this._clearGhost(drag);
    drag.element.classList.remove(this.draggingClass);
    this._clearZoneHighlight();

    if (zone) {
      if (zone.accept(drag.record.data, drag.record)) {
        zone.onDrop(drag.record.data, drag.record, zone);
        drag.record.onDrop?.(drag.record.data, zone);
      } else {
        this._shake(zone.element);
        drag.record.onCancel?.(drag.record.data);
      }
    } else {
      drag.record.onCancel?.(drag.record.data);
    }
    this._releaseCapture(drag);
  }

  _releaseCapture(drag) {
    try {
      drag.element.releasePointerCapture?.(drag.pointerId);
    } catch {
      /* pointer already released */
    }
  }

  _beginDrag(drag) {
    drag.active = true;
    drag.element.classList.add(this.draggingClass);
    drag.record.onDragStart?.(drag.record.data);
    const ghost = drag.element.cloneNode(true);
    ghost.classList.add(this.ghostClass);
    ghost.classList.remove(this.draggingClass);
    ghost.setAttribute("aria-hidden", "true");
    ghost.dataset.ghostFor = uid("ghost");
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    this._moveGhost(drag);
    document.body.classList.add("drag-in-progress");
  }

  _moveGhost(drag) {
    if (!drag.ghost) return;
    const rect = drag.ghost.getBoundingClientRect();
    drag.ghost.style.left = `${drag.x - rect.width / 2}px`;
    drag.ghost.style.top = `${drag.y - rect.height / 2}px`;
  }

  _clearGhost(drag) {
    drag.ghost?.remove();
    drag.ghost = null;
    document.body.classList.remove("drag-in-progress");
  }

  _zoneAt(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!element) return null;
    let node = element;
    while (node) {
      const zone = this.zones.get(node);
      if (zone) return zone;
      node = node.parentElement;
    }
    return null;
  }

  _highlightZone(drag, zone) {
    if (drag.zone === zone) return;
    this._clearZoneHighlight();
    drag.zone = zone;
    if (!zone) return;
    zone.element.classList.add(zone.hoverClass);
    zone.element.classList.add(
      zone.accept(drag.record.data, drag.record) ? this.acceptsClass : this.invalidClass,
    );
  }

  _clearZoneHighlight() {
    for (const zone of this.zones.values()) {
      zone.element.classList.remove(zone.hoverClass, this.acceptsClass, this.invalidClass);
    }
  }

  _shake(element) {
    if (!element) return;
    element.classList.remove(this.invalidClass);
    void element.offsetWidth; // restart the animation
    element.classList.add(this.invalidClass);
    setTimeout(() => element.classList.remove(this.invalidClass), 420);
  }

  /* ------------------------------------------------------------- keyboard */
  _onSourceKey(event, element) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (this.picked) return;
    const record = this.sources.get(element);
    if (!record || record.disabled) return;
    event.preventDefault();
    this.picked = { record };
    element.classList.add(this.pickingClass, "drag-source--picked");
    for (const zone of this.zones.values()) {
      zone.element.classList.add(this.acceptsClass);
    }
    this.root.dispatchEvent(
      new CustomEvent("lab:pick", { bubbles: true, detail: { label: record.label } }),
    );
  }

  _keyboardDrop(zoneElement) {
    const zone = this.zones.get(zoneElement);
    const picked = this.picked;
    if (!zone || !picked) return;
    this._endKeyboardPick();
    if (zone.accept(picked.record.data, picked.record)) {
      zone.onDrop(picked.record.data, picked.record, zone);
      picked.record.onDrop?.(picked.record.data, zone);
    } else {
      this._shake(zoneElement);
      picked.record.onCancel?.(picked.record.data);
    }
  }

  _onKeyDown(event) {
    if (event.key === "Escape" && this.picked) {
      this.picked.record.onCancel?.(this.picked.record.data);
      this._endKeyboardPick();
    }
  }

  _endKeyboardPick() {
    if (!this.picked) return;
    this.picked.record.element.classList.remove(this.pickingClass, "drag-source--picked");
    this.picked = null;
    this._clearZoneHighlight();
    for (const zone of this.zones.values()) {
      zone.element.classList.remove(this.acceptsClass, this.invalidClass);
    }
  }

  /* --------------------------------------------------------------- teardown */
  destroy() {
    if (this.drag?.ghost) this._clearGhost(this.drag);
    this.drag = null;
    this.picked = null;
    this._clearZoneHighlight();
    for (const cleanup of this._cleanups) cleanup();
    this._cleanups.length = 0;
    this.sources.clear();
    this.zones.clear();
    this._bound = false;
  }
}

export function createDragManager(options) {
  return new DragManager(options);
}

export default DragManager;
