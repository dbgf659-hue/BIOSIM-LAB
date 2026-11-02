/**
 * BioSim Lab · engine3d/objects/dishes.js
 * ---------------------------------------------------------------------------
 * Petri dishes with instanced colonies, 96-well plates with individually
 * coloured wells, and microscope slides with a stained smear.
 */

import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import { addDisc, addRim, flatLabel, roundedBoxGeometry, seededRandom } from "./common.js";

const COLONY_COLORS = [0xf3e4b0, 0xeab308, 0xf8fafc, 0xdc2626, 0x22c55e, 0xa3e635];

/* ==========================================================================
   Petri dish
   ========================================================================== */
export function buildPetriDish(options = {}, ctx) {
  const {
    diameter = 0.09,
    agarColor = 0xd9b36a,
    agarOpacity = 0.56,
    colonies = 24,
    colonySeed = 7,
    colonyColors = COLONY_COLORS,
    lid = true,
    label = "LB + AMP",
  } = options;
  const radius = diameter / 2;
  const root = new Group();
  root.name = "petri-dish";
  const glass = ctx.library.glass({ color: 0xeafcff, thickness: 0.08, opacity: 0.82 });

  const baseWall = new Mesh(new CylinderGeometry(radius, radius * 0.985, 0.013, 64, 1, true), glass);
  baseWall.position.y = 0.0065;
  root.add(baseWall);
  addDisc(root, radius * 0.98, 0.0011, glass);
  addRim(root, radius, 0.0128, 0.0007, glass, { segments: 64 });

  const agar = new Mesh(
    new CylinderGeometry(radius * 0.94, radius * 0.94, 0.0062, 64),
    ctx.library.agar(agarColor, { opacity: agarOpacity }),
  );
  agar.position.y = 0.0044;
  agar.userData.noCastShadow = true;
  root.add(agar);

  // Colonies are a single InstancedMesh with per-instance colour.
  const count = Math.max(0, Math.min(180, Number(colonies) || 0));
  if (count > 0) {
    const geometry = new SphereGeometry(0.00175, 10, 7);
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.58, metalness: 0 });
    const mesh = new InstancedMesh(geometry, material, count);
    const dummy = new Object3D();
    const random = seededRandom(colonySeed);
    for (let index = 0; index < count; index += 1) {
      // Two loose clusters plus a few satellites, so a streak plate reads.
      const cluster = index % 5 === 0 ? 0 : index % 3 === 0 ? 1 : 2;
      const centreAngle = cluster === 0 ? 0.4 : cluster === 1 ? 3.4 : 5.3;
      const centreRadius = cluster === 0 ? radius * 0.28 : cluster === 1 ? radius * 0.52 : radius * 0.68;
      const spread = cluster === 2 ? radius * 0.78 : radius * 0.45;
      const angle = centreAngle + (random() - 0.5) * spread;
      const distance = Math.min(radius * 0.88, centreRadius + (random() - 0.5) * radius * 0.55);
      const scale = 0.55 + random() * 1.25;
      dummy.position.set(
        Math.cos(angle) * distance,
        0.0079 + 0.0006 * (scale - 1),
        Math.sin(angle) * distance,
      );
      dummy.scale.set(scale, scale * (0.6 + random() * 0.3), scale);
      dummy.rotation.y = random() * Math.PI;
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, new Color(colonyColors[index % colonyColors.length]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = Boolean(ctx.quality.shadows);
    root.add(mesh);
    root.userData.parts = { colonies: mesh };
  }

  if (lid) {
    const lidGroup = new Group();
    lidGroup.name = "lid";
    const lidWall = new Mesh(new CylinderGeometry(radius * 1.035, radius * 1.035, 0.008, 64, 1, true), glass);
    lidWall.position.y = 0.016;
    lidGroup.add(lidWall);
    const lidTop = new Mesh(new CircleGeometry(radius * 1.035, 64), glass);
    lidTop.rotation.x = -Math.PI / 2;
    lidTop.position.y = 0.02;
    lidGroup.add(lidTop);
    addRim(lidGroup, radius * 1.035, 0.0121, 0.00055, glass, { segments: 64 });
    addRim(lidGroup, radius * 1.035, 0.0199, 0.00045, glass, { segments: 64 });
    lidGroup.position.x = 0.0015;
    root.add(lidGroup);
    root.userData.parts = { ...(root.userData.parts ?? {}), lid: lidGroup };
  }

  if (label) {
    const texture = ctx.library.textTexture({
      text: label,
      sub: "37 °C · 24 h",
      width: 384,
      height: 112,
      background: "rgba(238,246,236,0.9)",
      foreground: "#17302c",
      accent: "#0e8f7e",
    });
    const tag = new Mesh(new PlaneGeometry(0.034, 0.0105), ctx.library.label(texture));
    tag.rotation.x = -Math.PI / 2;
    tag.position.set(0, 0.0205, -radius * 0.45);
    tag.userData.noShadow = true;
    root.add(tag);
  }

  return root;
}

/* ==========================================================================
   96-well plate
   ========================================================================== */
export function buildWellPlate(options = {}, ctx) {
  const {
    rows = 8,
    cols = 12,
    filled = 0,
    fillColors = [0xfbbf24, 0x38bdf8, 0xa78bfa, 0x22c55e, 0xfb7185],
    label = "96-WELL PLATE",
  } = options;
  const width = 0.1278;
  const depth = 0.0855;
  const height = 0.009;
  const root = new Group();
  root.name = "well-plate";
  const frameMaterial = ctx.library.plastic(0xf1f7f5, { roughness: 0.42, clearcoat: 0.25 });
  const frame = new Mesh(roundedBoxGeometry(width, height, depth, 0.006, 0.0015), frameMaterial);
  frame.position.y = height / 2;
  root.add(frame);

  const spacingX = (width * 0.84) / Math.max(1, cols - 1);
  const spacingZ = (depth * 0.78) / Math.max(1, rows - 1);
  const wellGeometry = new CylinderGeometry(0.0029, 0.0029, 0.0055, 14, 1, true);
  const wellMaterial = ctx.library.plasticTranslucent(0xe8f4f2, { opacity: 0.4 });
  const wells = new InstancedMesh(wellGeometry, wellMaterial, rows * cols);
  const dummy = new Object3D();
  const positions = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const x = -width * 0.42 + col * spacingX;
      const z = -depth * 0.39 + row * spacingZ;
      positions.push([x, z]);
      dummy.position.set(x, height - 0.0012, z);
      dummy.updateMatrix();
      wells.setMatrixAt(index, dummy.matrix);
    }
  }
  wells.instanceMatrix.needsUpdate = true;
  wells.userData.noShadow = true;
  root.add(wells);

  // Coloured liquid in the first `filled` wells.
  const count = Math.max(0, Math.min(rows * cols, Number(filled) || 0));
  if (count > 0) {
    const liquidGeometry = new CircleGeometry(0.00255, 14);
    const liquidMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0,
      transparent: true,
      opacity: 0.86,
      side: 2,
    });
    const liquids = new InstancedMesh(liquidGeometry, liquidMaterial, count);
    for (let index = 0; index < count; index += 1) {
      const [x, z] = positions[index];
      dummy.position.set(x, height - 0.0017, z);
      dummy.rotation.x = -Math.PI / 2;
      dummy.updateMatrix();
      liquids.setMatrixAt(index, dummy.matrix);
      liquids.setColorAt(index, new Color(fillColors[index % fillColors.length]));
    }
    liquids.instanceMatrix.needsUpdate = true;
    if (liquids.instanceColor) liquids.instanceColor.needsUpdate = true;
    liquids.userData.noShadow = true;
    root.add(liquids);
    root.userData.parts = { liquids };
  }

  const texture = ctx.library.textTexture({
    text: label,
    sub: "flat bottom · sterile",
    width: 384,
    height: 112,
    background: "rgba(238,246,236,0.9)",
    foreground: "#17302c",
  });
  const tag = flatLabel({
    texture,
    width: 0.05,
    height: 0.008,
    y: height * 0.55,
    z: depth / 2 + 0.0014,
    material: ctx.library.label(texture),
  });
  root.add(tag);

  root.userData.parts = { ...(root.userData.parts ?? {}), wells };
  root.userData.plate = { rows, cols, filled: count };
  return root;
}

/* ==========================================================================
   Microscope slide
   ========================================================================== */
export function buildSlide(options = {}, ctx) {
  const { stain = 0x8b1a2b, label = "" } = options;
  const root = new Group();
  root.name = "microscope-slide";
  const glass = ctx.library.glass({ color: 0xeafcff, thickness: 0.02, opacity: 0.72 });
  const slide = new Mesh(new BoxGeometry(0.025, 0.001, 0.075), glass);
  slide.position.y = 0.0008;
  root.add(slide);

  const smear = new Mesh(new CircleGeometry(0.007, 32), ctx.library.matte(stain, { roughness: 0.5, opacity: 0.72 }));
  smear.rotation.x = -Math.PI / 2;
  smear.scale.set(1, 1.8, 1);
  smear.position.set(0, 0.0014, 0.006);
  smear.userData.noShadow = true;
  root.add(smear);

  const cover = new Mesh(new BoxGeometry(0.019, 0.00035, 0.028), glass);
  cover.position.set(0, 0.0021, 0.006);
  root.add(cover);

  if (label) {
    const texture = ctx.library.textTexture({ text: label, width: 256, height: 96 });
    const tag = flatLabel({
      texture,
      width: 0.016,
      height: 0.006,
      y: 0.0015,
      z: -0.028,
      material: ctx.library.label(texture),
    });
    // Lie the tag flat on the slide.
    tag.rotation.x = -Math.PI / 2;
    tag.position.y = 0.0016;
    tag.position.z = -0.028;
    root.add(tag);
  }
  root.userData.parts = { slide, smear, cover };
  return root;
}

export const DISH_TYPES = {
  petriDish: buildPetriDish,
  wellPlate: buildWellPlate,
  slide: buildSlide,
};

export default DISH_TYPES;
