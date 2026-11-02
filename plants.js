/**
 * BioSim Lab · engine3d/objects/plants.js
 * ---------------------------------------------------------------------------
 * Tissue-culture jar with MS medium and a rooted plantlet. Leaves are
 * flattened low-poly spheres: cheap, readable and easy to animate later.
 */

import {
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { addDisc, addRim, flatLabel, seededRandom } from "./common.js";

/**
 * @param {{mediumColor?: *, leaves?: number, lid?: boolean, label?: string}} options
 */
export function buildPlantJar(options = {}, ctx) {
  const {
    height = 0.095,
    radius = 0.036,
    mediumColor = 0xb7e4a1,
    leaves = 9,
    lid = true,
    label = "MS + BA",
  } = options;
  const root = new Group();
  root.name = "plant-jar";
  const glass = ctx.library.glass({ color: 0xeafcff, thickness: 0.12, opacity: 0.8 });
  const mediumMaterial = ctx.library.agar(mediumColor, { opacity: 0.62, roughness: 0.45, transmission: 0.08 });
  const stemMaterial = ctx.library.plastic(0x3f8f3a, { roughness: 0.6, clearcoat: 0.25 });
  const leafMaterial = ctx.library.plastic(0x61c25b, { roughness: 0.55, clearcoat: 0.3 });
  const leafDark = ctx.library.plastic(0x2f7a34, { roughness: 0.6 });

  const wall = new Mesh(new CylinderGeometry(radius, radius * 0.97, height, 56, 1, true), glass);
  wall.position.y = height / 2;
  root.add(wall);
  addDisc(root, radius * 0.96, 0.0012, glass, { segments: 48 });
  addRim(root, radius, height - 0.0006, 0.0008, glass, { segments: 56 });

  // MS medium with a slightly domed top.
  const medium = new Mesh(new CylinderGeometry(radius * 0.93, radius * 0.94, 0.024, 56), mediumMaterial);
  medium.position.y = 0.012;
  medium.userData.noCastShadow = true;
  root.add(medium);
  const meniscus = new Mesh(new SphereGeometry(1, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), mediumMaterial);
  meniscus.scale.set(radius * 0.93, 0.0022, radius * 0.93);
  meniscus.position.y = 0.024;
  meniscus.userData.noCastShadow = true;
  root.add(meniscus);

  // Plantlet.
  const plant = new Group();
  plant.name = "plantlet";
  const random = seededRandom(19);
  const stems = [
    { x: -0.009, z: 0.002, lean: -0.18, top: 0.063 },
    { x: 0.001, z: -0.004, lean: 0.04, top: 0.078 },
    { x: 0.01, z: 0.004, lean: 0.22, top: 0.057 },
  ];
  for (const [index, stem] of stems.entries()) {
    const stemHeight = stem.top - 0.023;
    const stemMesh = new Mesh(new CylinderGeometry(0.00075, 0.0011, stemHeight, 7), index === 1 ? stemMaterial : leafDark);
    stemMesh.position.set(stem.x, 0.023 + stemHeight / 2, stem.z);
    stemMesh.rotation.z = stem.lean;
    plant.add(stemMesh);

    for (let leaf = 0; leaf < Math.ceil(leaves / stems.length); leaf += 1) {
      const y = 0.032 + ((leaf + 0.5) / Math.ceil(leaves / stems.length)) * stemHeight * 0.92;
      const angle = random() * Math.PI * 2;
      const reach = 0.007 + random() * 0.007;
      const size = 0.006 + random() * 0.005;
      const leafMesh = new Mesh(new SphereGeometry(1, 10, 6), leaf === 1 ? leafDark : leafMaterial);
      leafMesh.scale.set(size * 0.72, size * 0.22, size);
      leafMesh.position.set(
        stem.x + Math.cos(angle) * reach + stem.lean * (y - 0.023),
        y,
        stem.z + Math.sin(angle) * reach,
      );
      leafMesh.rotation.set(0.35 + random() * 0.3, -angle, 0.22 + random() * 0.35);
      leafMesh.userData.noShadow = true;
      plant.add(leafMesh);
    }
  }

  // Two roots dipping into the medium.
  for (let index = 0; index < 3; index += 1) {
    const rootMesh = new Mesh(new CylinderGeometry(0.00045, 0.0003, 0.012, 5), ctx.library.plastic(0xd8e9c8, { roughness: 0.7 }));
    rootMesh.position.set(-0.005 + index * 0.005, 0.019, 0.002 - index * 0.001);
    rootMesh.rotation.z = 0.5 - index * 0.4;
    rootMesh.userData.noShadow = true;
    plant.add(rootMesh);
  }
  root.add(plant);

  if (lid) {
    const lidGroup = new Group();
    lidGroup.name = "lid";
    const lidMaterial = ctx.library.metal(0xb7c6c8, { roughness: 0.36, brushed: true });
    const cap = new Mesh(new CylinderGeometry(radius * 1.04, radius * 1.04, 0.014, 40), lidMaterial);
    cap.position.y = height + 0.006;
    lidGroup.add(cap);
    const ridge = new Mesh(new TorusGeometry(radius * 1.045, 0.0008, 5, 40), lidMaterial);
    ridge.rotation.x = Math.PI / 2;
    ridge.position.y = height + 0.002;
    lidGroup.add(ridge);
    root.add(lidGroup);
    root.userData.parts = { lid: lidGroup };
  }

  const texture = ctx.library.textTexture({
    text: label,
    sub: "25 °C · 16 h light",
    width: 384,
    height: 112,
    background: "rgba(238,246,236,0.9)",
    foreground: "#17302c",
  });
  const tag = flatLabel({
    texture,
    width: 0.036,
    height: 0.0105,
    y: height * 0.5,
    z: radius + 0.0016,
    material: ctx.library.label(texture),
  });
  root.add(tag);

  root.userData.parts = { ...(root.userData.parts ?? {}), medium, plant };
  return root;
}

/** A small callus lump on agar, useful for transformation scenes later. */
export function buildCallus(options = {}, ctx) {
  const root = new Group();
  root.name = "callus";
  const material = ctx.library.plastic(options.color ?? 0xc9d98a, { roughness: 0.75, clearcoat: 0.1 });
  const random = seededRandom(5);
  for (let index = 0; index < 5; index += 1) {
    const lump = new Mesh(new SphereGeometry(0.004 + random() * 0.003, 10, 7), material);
    lump.position.set((random() - 0.5) * 0.015, 0.004 + random() * 0.004, (random() - 0.5) * 0.012);
    lump.scale.y = 0.7;
    root.add(lump);
  }
  return root;
}

export const PLANT_TYPES = {
  plantJar: buildPlantJar,
  callus: buildCallus,
};

export default PLANT_TYPES;
