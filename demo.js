/**
 * BioSim Lab · engine3d/demo.js
 * ---------------------------------------------------------------------------
 * Phase 3D-1 test scene. This is the only file that knows the content of the
 * preview bench; the engine modules themselves are experiment-agnostic.
 *
 * The page deliberately exercises the contracts that Phase 3D-2 will rely on:
 *   Bench3D.init / destroy      repeated mount cycles
 *   createObject types          a broad prop palette
 *   live LCD updates            instrument API + render invalidation
 *   theme + quality + presets   overlay and camera integrations
 */

import { Bench3D } from "./bench3d.js";

const container = document.getElementById("bench3d");

const CAMERA_PRESETS = {
  overview: {
    label: "Overview",
    hint: "The whole bench",
    position: [1.5, 1.3, 2.05],
    target: [0, 0.25, -0.04],
  },
  closeup: {
    label: "Close-up",
    hint: "PBS, LB and the sample rack",
    position: [0.12, 0.68, 1.42],
    target: [-0.3, 0.12, 0.02],
  },
  top: {
    label: "Top",
    hint: "Plan view of the bench",
    position: [0.02, 3.25, 0.35],
    target: [0, 0.06, -0.02],
  },
  instrument: {
    label: "Instrument",
    hint: "The microcentrifuge",
    position: [0.65, 0.38, 0.82],
    target: [0.26, 0.12, 0.06],
  },
  shelf: {
    label: "Shelf",
    hint: "Stock bottles and the light bar",
    position: [0.18, 0.98, 1.45],
    target: [0, 0.6, -0.62],
  },
};

const SCENE_OBJECTS = [
  {
    type: "tubeRack",
    id: "sample-rack",
    position: [-0.85, 0, 0.02],
    rotationY: 0.08,
    label: "SAMPLES",
    displayLabel: "Sample rack",
    tubes: 10,
    liquidLevel: 0.56,
    meta: { accent: "#fbbf24", note: "2 × 6 rack, 1.5 mL tubes" },
  },
  {
    type: "beaker",
    id: "beaker-pbs",
    position: [-0.5, 0, 0.27],
    label: "PBS",
    displayLabel: "PBS beaker",
    diameter: 0.07,
    height: 0.095,
    stirBar: true,
    liquid: { level: 0.6, color: 0x38bdf8, opacity: 0.62, turbidity: 0.12, bubbles: 4 },
    meta: { accent: "#38bdf8" },
  },
  {
    type: "flask",
    id: "flask-lb",
    position: [-0.38, 0, -0.1],
    label: "LB",
    displayLabel: "LB flask",
    scale: 0.98,
    liquid: { level: 0.42, color: 0x2ee6c5, opacity: 0.56, glow: 0.22, turbidity: 0.28 },
    meta: { accent: "#2ee6c5" },
  },
  {
    type: "graduatedCylinder",
    id: "cylinder-nacl",
    position: [0.8, 0, -0.28],
    label: "NaCl",
    displayLabel: "NaCl cylinder",
    diameter: 0.034,
    height: 0.2,
    liquid: { level: 0.58, color: 0xfbbf24, opacity: 0.66, turbidity: 0.18 },
    meta: { accent: "#fbbf24" },
  },
  {
    type: "microcentrifuge",
    id: "microcentrifuge",
    position: [0.28, 0, 0.06],
    rotationY: -0.04,
    scale: 1.2,
    label: "MICROFUGE",
    displayLabel: "Microcentrifuge",
    accent: 0x2ee6c5,
    meta: { accent: "#7cf0a7", note: "Live LCD · 13.4k rpm" },
  },
  {
    type: "petriDish",
    id: "petri-lb",
    position: [-0.78, 0, 0.38],
    label: "LB + AMP",
    displayLabel: "Petri dish",
    diameter: 0.09,
    agarColor: 0xd9b36a,
    colonies: 26,
    colonySeed: 11,
    meta: { accent: "#a3e635" },
  },
  {
    type: "wellPlate",
    id: "well-plate",
    position: [0, 0, 0.34],
    rotationY: -0.06,
    label: "96-WELL PLATE",
    displayLabel: "96-well plate",
    filled: 60,
    meta: { accent: "#f472b6" },
  },
  {
    type: "micropipette",
    id: "pipette-p200",
    position: [0.72, 0, 0.24],
    rotationY: 1.18,
    displayLabel: "P200",
    range: "P200",
    volume: 120,
    meta: { accent: "#60a5fa", note: "20–200 µL" },
  },
  {
    type: "tipBox",
    id: "tip-box",
    position: [-1.1, 0, 0.34],
    rotationY: 0.12,
    label: "200 µL TIPS",
    displayLabel: "Tip box",
    tips: 24,
    meta: { accent: "#fde68a" },
  },
  {
    type: "reagentBottle",
    id: "ethanol",
    position: [1.02, 0, -0.04],
    label: "ETHANOL",
    displayLabel: "70% ethanol",
    scale: 0.72,
    amber: true,
    subtitle: "Molecular grade",
    footer: "BioSim Lab · BSL-1",
    hazard: "FLAMMABLE",
    capColor: 0x3f2a12,
    liquid: { level: 0.5, color: 0xd9a441, opacity: 0.72 },
    meta: { accent: "#f59e0b" },
  },
  {
    type: "plantJar",
    id: "plant-culture",
    position: [-1.07, 0, -0.05],
    label: "MS + BA",
    displayLabel: "Plant culture",
    leaves: 9,
    meta: { accent: "#7cf0a7" },
  },
  {
    type: "falconTube",
    id: "falcon-15",
    position: [0.6, 0, -0.4],
    displayLabel: "Falcon tube",
    labelVisible: false,
    size: 15,
    capColor: 0x2563eb,
    liquid: { level: 0.45, color: 0xf472b6, opacity: 0.7 },
    meta: { accent: "#38bdf8" },
  },
  {
    type: "powerSupply",
    id: "power-supply",
    position: [-0.68, 0, -0.36],
    displayLabel: "Power supply",
    labelVisible: false,
    voltage: 100,
    current: 40,
    minutes: 25,
    meta: { accent: "#94a3b8" },
  },
  {
    type: "slide",
    id: "gram-slide",
    position: [0.34, 0, 0.4],
    rotationY: 0.16,
    label: "GRAM",
    displayLabel: "Gram stain",
    labelVisible: false,
    stain: 0x8b1a2b,
    meta: { accent: "#fb7185" },
  },
];

if (container) boot();

function boot() {
  const inventory = document.querySelector('[data-role="inventory"]');
  const inventoryCount = document.querySelector('[data-role="inventory-count"]');
  const mountCount = document.querySelector('[data-role="mount-count"]');
  const sceneStatus = document.querySelector('[data-role="scene-status"]');
  const remountButton = document.getElementById("bench-remount");
  const centrifugeButton = document.getElementById("centrifuge-toggle");
  const centrifugeLabel = document.querySelector('[data-role="centrifuge-label"]');
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  let bench = null;
  let mounts = 0;
  let running = true;
  let tick = 0;
  let liveTimer = 0;

  renderInventory(inventory, inventoryCount);
  updateCentrifugeButton();

  const baseConfig = {
    title: "The procedural bench",
    subtitle: "Glass, steel and light, generated in the browser. Drag to explore.",
    quality: "auto",
    camera: { initial: "overview", presets: CAMERA_PRESETS },
    // Props stay life-size; a slight lift keeps their silhouettes clear on the
    // deep resin counter without making the glassware look like toys.
    objects: SCENE_OBJECTS.map((object) => ({ scale: 1.4, ...object })),
    environment: {},
    fallbackHref: "index.html",
    onReady: (instance) => {
      const stats = instance.getStats();
      setStatus(`live · ${stats.meshes} meshes`);
      startLive();
    },
    onSelect: (object) => {
      if (!object) return;
      const label = object.userData?.label;
      if (label) setStatus(`selected · ${label}`);
    },
    onFallback: () => setStatus("2D fallback"),
  };

  function setStatus(text) {
    if (sceneStatus) sceneStatus.textContent = text;
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function startBench() {
    stopLive();
    if (bench) {
      bench.destroy();
      bench = null;
    }
    setStatus("building…");
    bench = Bench3D.init(container, {
      ...baseConfig,
      theme: currentTheme(),
    });
    mounts += 1;
    if (mountCount) mountCount.textContent = String(mounts);
    window.__benchDemo = {
      get bench() {
        return bench;
      },
      config: baseConfig,
      get mounts() {
        return mounts;
      },
    };
  }

  function remount() {
    startBench();
  }

  function startLive() {
    stopLive();
    liveTimer = window.setInterval(() => {
      if (!bench || !running || document.hidden) return;
      tick = (tick + 1) % 1000;
      const phase = tick / 42;
      const rpm = 13.4 + Math.sin(phase) * 0.12;
      const gForce = Math.round(rpm * 894);
      const seconds = 45 - (tick % 45);
      bench.setDisplay("microcentrifuge", {
        title: "MICROFUGE",
        value: rpm.toFixed(1),
        unit: "×1000 rpm",
        lines: [`${gForce.toLocaleString("en-US")} × g`, `00:${String(seconds).padStart(2, "0")}`],
        accent: "#7cf0a7",
        status: "ok",
        running: true,
        progress: 0.3 + Math.abs(Math.sin(phase * 0.5)) * 0.55,
      });
    }, 1700);
  }

  function stopLive() {
    window.clearInterval(liveTimer);
    liveTimer = 0;
  }

  function updateCentrifugeButton() {
    if (!centrifugeButton) return;
    centrifugeButton.setAttribute("aria-pressed", String(!running));
    if (centrifugeLabel) centrifugeLabel.textContent = running ? "Pause demo" : "Resume demo";
  }

  function setRunning(next) {
    running = Boolean(next);
    updateCentrifugeButton();
    if (!bench) return;
    if (running) {
      bench.setDisplay("microcentrifuge", {
        title: "MICROFUGE",
        value: "13.4",
        unit: "×1000 rpm",
        lines: ["11,980 × g", "00:45"],
        accent: "#7cf0a7",
        status: "ok",
        running: true,
        progress: 0.62,
      });
    } else {
      bench.setDisplay("microcentrifuge", {
        title: "MICROFUGE",
        value: "0.0",
        unit: "×1000 rpm",
        lines: ["lid released", "standby"],
        accent: "#fbbf24",
        status: "off",
        running: false,
        progress: 0,
      });
    }
  }

  function syncTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    if (themeMeta) themeMeta.setAttribute("content", next === "light" ? "#eef6f3" : "#040a0b");
    try {
      localStorage.setItem("biosimlab.theme", next);
    } catch {
      /* private mode */
    }
  }

  remountButton?.addEventListener("click", remount);
  centrifugeButton?.addEventListener("click", () => setRunning(!running));

  container.addEventListener("bench3d:ready", (event) => {
    if (event.detail?.instance !== bench) return;
    const stats = bench.getStats();
    setStatus(`live · ${stats.meshes} meshes`);
  });
  container.addEventListener("bench3d:select", (event) => {
    const label = event.detail?.label;
    if (label) setStatus(`selected · ${label}`);
  });
  container.addEventListener("bench3d:theme", (event) => {
    syncTheme(event.detail?.theme);
  });
  container.addEventListener("bench3d:quality", (event) => {
    const tier = event.detail?.tier;
    if (tier) setStatus(`${tier} quality · remounted`);
  });
  container.addEventListener("bench3d:fallback", () => setStatus("2D fallback"));

  window.addEventListener("pagehide", () => {
    stopLive();
    if (bench) {
      bench.destroy();
      bench = null;
    }
  });

  startBench();
}

function renderInventory(list, count) {
  if (!list) return;
  const fragment = document.createDocumentFragment();
  for (const object of SCENE_OBJECTS) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.className = "b3d-inventory__name";
    const dot = document.createElement("i");
    dot.className = "b3d-inventory__dot";
    dot.style.setProperty("--inv-color", object.meta?.accent ?? "#2ee6c5");
    dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = object.label ?? object.type;
    name.append(dot, text);
    const type = document.createElement("span");
    type.className = "b3d-inventory__type";
    type.textContent = object.type;
    item.append(name, type);
    fragment.appendChild(item);
  }
  list.replaceChildren(fragment);
  if (count) count.textContent = `${SCENE_OBJECTS.length} props`;
}

export { CAMERA_PRESETS, SCENE_OBJECTS };
