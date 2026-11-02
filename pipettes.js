/**
 * BioSim Lab · engine3d/objects/pipettes.js
 * ---------------------------------------------------------------------------
 * Micropipettes (P2–P1000 colour language), their volume windows, and a
 * colour-coded tip box. The dial and plunger are separate child groups so a
 * later interaction phase can rotate/press them without rebuilding the prop.
 */

import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  TorusGeometry,
} from "three";
import { addMesh, flatLabel, roundedBoxGeometry } from "./common.js";

export const PIPETTE_RANGES = Object.freeze({
  P2: { max: 2, body: 0xa855f7, accent: 0xf5d0fe, label: "P2" },
  P10: { max: 10, body: 0x94a3b8, accent: 0xfde68a, label: "P10" },
  P20: { max: 20, body: 0xeab308, accent: 0xfef9c3, label: "P20" },
  P200: { max: 200, body: 0xfde68a, accent: 0x2563eb, label: "P200" },
  P1000: { max: 1000, body: 0x2563eb, accent: 0xbfdbfe, label: "P1000" },
});

function rangeKey(value = "P200") {
  const key = String(value).toUpperCase();
  return PIPETTE_RANGES[key] ? key : "P200";
}

/**
 * @param {{range?: string, volume?: number, color?: *, tipColor?: *, tip?: boolean,
 *          lying?: boolean}} options
 */
export function buildMicropipette(options = {}, ctx) {
  const range = rangeKey(options.range);
  const preset = PIPETTE_RANGES[range];
  const bodyColor = options.color ?? preset.body;
  const accentColor = preset.accent;
  const tipColor = options.tipColor ?? 0xfef08a;
  const volume = options.volume ?? Math.round(preset.max * 0.42);
  const root = new Group();
  root.name = "micropipette";

  const body = ctx.library.plastic(bodyColor, { roughness: 0.27, clearcoat: 0.8 });
  const accent = ctx.library.plastic(accentColor, { roughness: 0.3, clearcoat: 0.7 });
  const dark = ctx.library.plastic(0x0b1c1f, { roughness: 0.4, clearcoat: 0.3 });
  const steel = ctx.library.metal(0xc7d6d8, { roughness: 0.24 });
  const tipMaterial = ctx.library.plasticTranslucent(tipColor, { opacity: 0.46 });
  const display = ctx.library.textTexture({
    text: `${volume} µL`,
    sub: preset.label,
    width: 256,
    height: 112,
  });

  // Ejector shaft + tip cone.
  const tipY = 0.001;
  if (options.tip !== false) {
    const tip = new Mesh(new ConeGeometry(0.0034, 0.045, 24, 1, true), tipMaterial);
    tip.position.y = tipY + 0.0225;
    tip.rotation.x = Math.PI;
    tip.userData.part = "tip";
    tip.userData.noShadow = true;
    root.add(tip);
    root.userData.parts = { tip };
  }

  const shaft = new Mesh(new CylinderGeometry(0.0019, 0.0023, 0.042, 16), steel);
  shaft.position.y = 0.062;
  root.add(shaft);
  const sleeve = new Mesh(new CylinderGeometry(0.0036, 0.0028, 0.024, 20), dark);
  sleeve.position.y = 0.079;
  root.add(sleeve);

  // Lower grip and upper body.
  const grip = new Mesh(new CylinderGeometry(0.0072, 0.008, 0.034, 32), body);
  grip.position.y = 0.108;
  root.add(grip);
  const collar = new Mesh(new CylinderGeometry(0.0092, 0.0092, 0.005, 32), accent);
  collar.position.y = 0.127;
  root.add(collar);

  // Rotating volume dial. The volume window is parented to the dial so a later
  // drag interaction can rotate the whole assembly.
  const dial = new Group();
  dial.name = "volume-dial";
  dial.position.y = 0.142;
  const dialBody = new Mesh(new CylinderGeometry(0.0092, 0.0092, 0.022, 32), dark);
  dial.add(dialBody);
  const dialRing = new Mesh(new TorusGeometry(0.0093, 0.00045, 6, 40), accent);
  dialRing.rotation.x = Math.PI / 2;
  dialRing.position.y = 0.0095;
  dial.add(dialRing);
  const window = flatLabel({
    texture: display,
    width: 0.017,
    height: 0.0074,
    y: 0,
    z: 0.00925,
    material: ctx.library.label(display),
  });
  dial.add(window);
  for (let index = 0; index < 12; index += 1) {
    const tick = new Mesh(new BoxGeometry(0.00045, 0.0026, 0.00035), accent);
    const angle = (index / 12) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.0088, -0.008, Math.sin(angle) * 0.0088);
    tick.rotation.y = -angle;
    tick.rotation.z = 0.2;
    tick.userData.noShadow = true;
    dial.add(tick);
  }
  root.add(dial);

  const upper = new Mesh(new CylinderGeometry(0.0074, 0.0088, 0.028, 32), body);
  upper.position.y = 0.168;
  root.add(upper);
  const band = new Mesh(new CylinderGeometry(0.0076, 0.0076, 0.006, 32), accent);
  band.position.y = 0.158;
  root.add(band);

  const stem = new Mesh(new CylinderGeometry(0.0023, 0.0023, 0.017, 16), steel);
  stem.position.y = 0.19;
  root.add(stem);
  const plunger = new Group();
  plunger.name = "plunger";
  plunger.position.y = 0.198;
  const button = new Mesh(new CylinderGeometry(0.0048, 0.0056, 0.012, 24), body);
  button.position.y = 0.004;
  plunger.add(button);
  const buttonCap = new Mesh(new CylinderGeometry(0.0049, 0.0049, 0.003, 24), accent);
  buttonCap.position.y = 0.0105;
  plunger.add(buttonCap);
  root.add(plunger);

  // Ejector button on the lower grip.
  const ejector = new Mesh(new CylinderGeometry(0.0022, 0.0022, 0.008, 16), accent);
  ejector.rotation.z = Math.PI / 2;
  ejector.position.set(0.0086, 0.116, 0);
  root.add(ejector);

  root.userData.parts = {
    ...(root.userData.parts ?? {}),
    dial,
    plunger,
    ejector,
    display,
  };
  root.userData.pipette = { range, max: preset.max, volume };

  if (options.lying !== false) {
    root.rotation.z = -Math.PI / 2;
    root.position.y = 0.0105;
  }
  return root;
}

/* ==========================================================================
   Tip box
   ========================================================================== */
export function buildTipBox(options = {}, ctx) {
  const {
    tips = 24,
    color = 0xfef08a,
    boxColor = 0xf3c95a,
    label = "200 µL TIPS",
  } = options;
  const width = 0.104;
  const depth = 0.076;
  const height = 0.044;
  const root = new Group();
  root.name = "tip-box";

  const boxMaterial = ctx.library.plasticTranslucent(boxColor, { opacity: 0.32 });
  const lidMaterial = ctx.library.plasticTranslucent(boxColor, { opacity: 0.24 });
  const rackMaterial = ctx.library.plastic(0x1f8f83, { roughness: 0.4 });

  const base = new Mesh(roundedBoxGeometry(width, height * 0.72, depth, 0.006, 0.0015), boxMaterial);
  base.position.y = height * 0.36;
  root.add(base);

  const rack = new Mesh(roundedBoxGeometry(width * 0.9, 0.006, depth * 0.82, 0.004, 0.001), rackMaterial);
  rack.position.y = height * 0.5;
  root.add(rack);

  // Tip geometry shared by every instance; counts are small enough that an
  // InstancedMesh is still worthwhile (24–96 tips per box).
  const cols = 6;
  const rows = Math.max(1, Math.ceil(Math.max(1, tips) / cols));
  const count = Math.max(1, Math.min(96, tips));
  const tipGeometry = new ConeGeometry(0.0026, 0.034, 14, 1, true);
  const tipMaterial = ctx.library.plasticTranslucent(color, { opacity: 0.55 });
  const mesh = new InstancedMesh(tipGeometry, tipMaterial, count);
  const dummy = new Object3D();
  const spacingX = (width * 0.8) / Math.max(1, cols - 1);
  const spacingZ = (depth * 0.7) / Math.max(1, rows - 1);
  for (let index = 0; index < count; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    dummy.position.set(
      -width * 0.4 + col * spacingX,
      height * 0.63,
      -depth * 0.35 + row * spacingZ,
    );
    dummy.rotation.x = Math.PI;
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.noShadow = true;
  root.add(mesh);

  // Open lid, hinged at the back.
  const lid = new Group();
  lid.position.set(0, height * 0.74, -depth / 2);
  const lidMesh = new Mesh(roundedBoxGeometry(width * 1.01, 0.007, depth * 1.01, 0.005, 0.0012), lidMaterial);
  lidMesh.position.set(0, 0.01, depth / 2);
  lid.add(lidMesh);
  lid.rotation.x = -1.15;
  root.add(lid);

  const latch = new Mesh(new BoxGeometry(0.014, 0.005, 0.004), rackMaterial);
  latch.position.set(0, height * 0.6, depth / 2 + 0.001);
  root.add(latch);

  const texture = ctx.library.textTexture({
    text: label,
    sub: "sterile · 96 rack",
    width: 384,
    height: 128,
    background: "rgba(56,38,3,0.92)",
    foreground: "#fff8d6",
    accent: "#fbbf24",
  });
  const tag = flatLabel({
    texture,
    width: 0.058,
    height: 0.013,
    y: height * 0.43,
    z: depth / 2 + 0.0022,
    material: ctx.library.label(texture),
  });
  root.add(tag);

  root.userData.parts = { lid, tips: mesh };
  root.userData.tipBox = { count, color };
  return root;
}

export const PIPETTE_TYPES = {
  micropipette: buildMicropipette,
  tipBox: buildTipBox,
};

export default PIPETTE_TYPES;
