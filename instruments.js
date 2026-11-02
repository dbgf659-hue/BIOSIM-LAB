/**
 * BioSim Lab · engine3d/objects/instruments.js
 * ---------------------------------------------------------------------------
 * Instrument props. Phase 3D-1 ships the microcentrifuge as the reference
 * instrument: a moulded body, domed lid, live LCD, physical knob and a power
 * LED that is bright enough to catch the bloom pass.
 *
 * Later phases add the gel tank, power supply, thermocycler, water bath,
 * balance and the rest; they share the same parts/LCD contract used here.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { flatLabel, roundedBoxGeometry } from "./common.js";

/**
 * @param {{display?: object, running?: boolean, accent?: *, label?: string}} options
 */
export function buildMiniCentrifuge(options = {}, ctx) {
  const accent = options.accent ?? 0x2ee6c5;
  const root = new Group();
  root.name = "mini-centrifuge";

  const bodyMaterial = ctx.library.plastic(0x122326, { roughness: 0.26, clearcoat: 0.9, metalness: 0.05 });
  const bodySoft = ctx.library.plastic(0x0b1719, { roughness: 0.42, clearcoat: 0.5 });
  const lidMaterial = ctx.library.plastic(0x0a191c, { roughness: 0.18, clearcoat: 1 });
  const trimMaterial = ctx.library.metal(0x8fa4a8, { roughness: 0.28 });
  const accentMaterial = ctx.library.plastic(accent, { roughness: 0.3, clearcoat: 0.7 });
  const rubber = ctx.library.rubber(0x0a1011);

  const plinth = new Mesh(roundedBoxGeometry(0.25, 0.022, 0.225, 0.012, 0.002), bodySoft);
  plinth.position.y = 0.011;
  root.add(plinth);

  const body = new Mesh(roundedBoxGeometry(0.236, 0.132, 0.212, 0.016, 0.0025), bodyMaterial);
  body.position.y = 0.088;
  root.add(body);

  // Front fascia, slightly proud of the body so the panel has a shadow line.
  const fascia = new Mesh(roundedBoxGeometry(0.2, 0.104, 0.012, 0.012, 0.0015), bodySoft);
  fascia.position.set(0, 0.088, 0.106);
  root.add(fascia);

  // Domed lid.
  const dome = new Mesh(new SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), lidMaterial);
  dome.scale.set(0.123, 0.082, 0.108);
  dome.position.set(0, 0.154, -0.004);
  root.add(dome);
  const seam = new Mesh(new TorusGeometry(0.12, 0.0016, 6, 48), trimMaterial);
  seam.rotation.x = Math.PI / 2;
  seam.position.set(0, 0.154, -0.004);
  root.add(seam);
  const latch = new Mesh(new BoxGeometry(0.026, 0.008, 0.006), trimMaterial);
  latch.position.set(0, 0.152, 0.105);
  root.add(latch);

  // A thin teal status strip under the lid seam.
  const strip = new Mesh(new BoxGeometry(0.14, 0.0018, 0.002), ctx.library.glow(accent, { intensity: 2.4 }));
  strip.position.set(0, 0.151, 0.104);
  strip.userData.noShadow = true;
  root.add(strip);

  // LCD + bezel.
  const lcd = ctx.library.createLCD({ width: 256, height: 128, maxFps: 10 });
  const displayModel = {
    title: options.label ?? "MICROFUGE",
    value: "13.4",
    unit: "×1000 rpm",
    lines: ["12,000 × g", "00:45"],
    accent: "#7cf0a7",
    status: "ok",
    running: true,
    progress: 0.62,
    ...(options.display ?? {}),
  };
  lcd.render(displayModel, { force: true });
  const screen = new Mesh(new BoxGeometry(0.112, 0.062, 0.003), bodySoft);
  screen.position.set(0, 0.106, 0.113);
  root.add(screen);
  const screenFace = flatLabel({
    texture: lcd.texture,
    width: 0.104,
    height: 0.052,
    y: 0.106,
    z: 0.1152,
    material: lcd.material,
  });
  root.add(screenFace);

  // Brand strip.
  const brandTexture = ctx.library.textTexture({
    text: "BIOFUGE · MINI",
    sub: "bench microcentrifuge",
    width: 512,
    height: 96,
    background: "rgba(4,18,19,0.92)",
    foreground: "#a8c8c4",
    accent: "#2ee6c5",
  });
  const brand = flatLabel({
    texture: brandTexture,
    width: 0.13,
    height: 0.012,
    y: 0.145,
    z: 0.1128,
    material: ctx.library.label(brandTexture),
  });
  root.add(brand);

  // Physical speed knob. The pointer is part of the knob group.
  const knob = new Group();
  knob.name = "knob";
  knob.position.set(0.083, 0.064, 0.115);
  const knobBody = new Mesh(new CylinderGeometry(0.0125, 0.0125, 0.009, 24), trimMaterial);
  knobBody.rotation.x = Math.PI / 2;
  knob.add(knobBody);
  const knobCap = new Mesh(new CylinderGeometry(0.0105, 0.0105, 0.002, 24), accentMaterial);
  knobCap.rotation.x = Math.PI / 2;
  knobCap.position.z = 0.005;
  knob.add(knobCap);
  const pointer = new Mesh(new BoxGeometry(0.0016, 0.007, 0.001), ctx.library.matte(0x071516));
  pointer.position.set(0, 0.003, 0.0065);
  knob.add(pointer);
  root.add(knob);

  // Three membrane buttons.
  const buttonColors = [0x2ee6c5, 0xfbbf24, 0xfb7185];
  const buttons = [];
  buttonColors.forEach((color, index) => {
    const button = new Mesh(new CylinderGeometry(0.0052, 0.0052, 0.003, 20), ctx.library.plastic(color, { clearcoat: 0.9 }));
    button.rotation.x = Math.PI / 2;
    button.position.set(0.022 + index * 0.017, 0.064, 0.1155);
    button.userData.part = "button";
    buttons.push(button);
    root.add(button);
  });

  // Power LED and its local spill light.
  const ledMaterial = ctx.library.glow(0x3ddc97, { intensity: 3.2 });
  const led = new Mesh(new SphereGeometry(0.0026, 12, 8), ledMaterial);
  led.position.set(-0.092, 0.064, 0.115);
  led.userData.noShadow = true;
  root.add(led);

  // Rubber feet.
  for (const x of [-0.09, 0.09]) {
    for (const z of [-0.075, 0.075]) {
      const foot = new Mesh(new CylinderGeometry(0.011, 0.012, 0.008, 16), rubber);
      foot.position.set(x, 0.004, z);
      root.add(foot);
    }
  }

  // Vent slots.
  const ventMaterial = ctx.library.matte(0x041012, { roughness: 0.8 });
  for (let index = 0; index < 5; index += 1) {
    const slot = new Mesh(new BoxGeometry(0.054, 0.0022, 0.002), ventMaterial);
    slot.position.set(-0.07, 0.036 + index * 0.0045, 0.1135);
    slot.userData.noShadow = true;
    root.add(slot);
  }

  root.userData.parts = { knob, buttons, led, lid: dome, screen: screenFace };
  root.userData.setDisplay = (model, { force = false } = {}) => {
    lcd.render({ ...displayModel, ...model }, { force });
  };
  root.userData.setRunning = (running) => {
    lcd.render({ ...displayModel, status: running ? "ok" : "off", running, progress: running ? 0.62 : 0 }, { force: true });
  };
  root.userData.instrument = { type: "microcentrifuge", label: "Microcentrifuge" };
  return root;
}

/* ==========================================================================
   Compact power supply (kept here so later 3D-4 can extend it)
   ========================================================================== */
export function buildPowerSupply(options = {}, ctx) {
  const root = new Group();
  root.name = "power-supply";
  const bodyMaterial = ctx.library.plastic(0x16292c, { roughness: 0.3, clearcoat: 0.6 });
  const dark = ctx.library.plastic(0x071617, { roughness: 0.45 });
  const body = new Mesh(roundedBoxGeometry(0.24, 0.115, 0.185, 0.014, 0.002), bodyMaterial);
  body.position.y = 0.065;
  root.add(body);
  const face = new Mesh(roundedBoxGeometry(0.2, 0.085, 0.01, 0.01, 0.0015), dark);
  face.position.set(0, 0.065, 0.094);
  root.add(face);

  const lcd = ctx.library.createLCD({ width: 256, height: 128, maxFps: 10 });
  lcd.render(
    {
      title: "POWER SUPPLY",
      value: options.voltage ?? "100",
      unit: "V",
      lines: [`${options.current ?? "40"} mA · ${options.minutes ?? "25"} min`],
      accent: "#38bdf8",
      status: "ok",
      progress: 0.45,
    },
    { force: true },
  );
  root.add(
    flatLabel({
      texture: lcd.texture,
      width: 0.115,
      height: 0.055,
      y: 0.077,
      z: 0.1005,
      material: lcd.material,
    }),
  );

  // Colour-coded terminals: red +, black −.
  for (const [x, color] of [
    [-0.068, 0xef4444],
    [0.068, 0x1f2937],
  ]) {
    const socket = new Mesh(new CylinderGeometry(0.011, 0.011, 0.012, 20), ctx.library.plastic(color, { clearcoat: 0.9 }));
    socket.rotation.x = Math.PI / 2;
    socket.position.set(x, 0.035, 0.1);
    root.add(socket);
    const hole = new Mesh(new CylinderGeometry(0.0035, 0.0035, 0.004, 12), dark);
    hole.rotation.x = Math.PI / 2;
    hole.position.set(x, 0.035, 0.107);
    root.add(hole);
  }

  const knob = new Mesh(new CylinderGeometry(0.014, 0.014, 0.01, 24), ctx.library.plastic(0x38bdf8, { clearcoat: 0.8 }));
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.083, 0.035, 0.099);
  root.add(knob);

  root.userData.parts = { knob };
  root.userData.setDisplay = (model) => lcd.render({ ...model }, { force: true });
  root.userData.instrument = { type: "powerSupply", label: "Power supply" };
  return root;
}

export const INSTRUMENT_TYPES = {
  microcentrifuge: buildMiniCentrifuge,
  miniCentrifuge: buildMiniCentrifuge,
  centrifuge: buildMiniCentrifuge,
  powerSupply: buildPowerSupply,
};

export default INSTRUMENT_TYPES;
