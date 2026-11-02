/**
 * BioSim Lab · engine3d/objects/misc.js
 * ---------------------------------------------------------------------------
 * The room itself: a rounded resin bench on a dark cabinet, a soft-gradient
 * backsplash, a lit equipment shelf with out-of-focus stock bottles, a floor
 * shadow and a little ambient dust.
 *
 * The environment is one group so the scene can dispose it in a single pass.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  TorusGeometry,
  BufferGeometry,
  Vector2,
} from "three";
import { addMesh, roundedBoxGeometry, roundedRectShape, seededRandom } from "./common.js";

const WALL_GRADIENT = { top: "#0c292c", bottom: "#020607", noise: 0.022 };

function buildBenchTop(ctx, { width = 2.6, depth = 0.98 } = {}) {
  const shape = roundedRectShape(width, depth, 0.11);
  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.085,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 3,
    curveSegments: 24,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.max.y, 0);
  geometry.computeVertexNormals();

  // Dark epoxy-resin counter, the way a real wet lab bench reads under warm
  // task light. A pale top washed every coloured prop out of the frame.
  const material = ctx.library.plastic(0x1e3b3e, {
    roughness: 0.32,
    clearcoat: 0.78,
    metalness: 0.04,
  });
  const top = new Mesh(geometry, material);
  top.name = "bench-top";
  top.receiveShadow = Boolean(ctx.quality.shadows);
  top.castShadow = false;

  // A dark resin edge under the counter.
  const edge = new Mesh(roundedBoxGeometry(width + 0.01, 0.035, depth + 0.01, 0.12, 0.003), ctx.library.plastic(0x081a1b, { roughness: 0.42, clearcoat: 0.5 }));
  edge.position.y = -0.095;
  edge.name = "bench-edge";
  top.add(edge);

  // A thin task-light strip catches the front edge and gives the bench a
  // readable silhouette against the dark room.
  const strip = new Mesh(new BoxGeometry(width * 0.92, 0.0022, 0.0045), ctx.library.glow(0x2ee6c5, { intensity: 1.15, opacity: 0.9 }));
  strip.position.set(0, -0.041, depth / 2 + 0.004);
  strip.name = "bench-edge-light";
  strip.userData.noShadow = true;
  strip.userData.ignoreBounds = true;
  top.add(strip);
  return top;
}

function buildCabinet(ctx, { width = 2.46, depth = 0.82 } = {}) {
  const cabinet = new Group();
  cabinet.name = "bench-cabinet";
  const bodyMaterial = ctx.library.plastic(0x0a2022, { roughness: 0.42, clearcoat: 0.35 });
  const panelMaterial = ctx.library.plastic(0x103133, { roughness: 0.36, clearcoat: 0.5 });
  const metal = ctx.library.metal(0x9dafb2, { roughness: 0.32, brushed: true });

  const body = new Mesh(roundedBoxGeometry(width, 0.64, depth, 0.035, 0.003), bodyMaterial);
  body.position.set(0, -0.43, -0.04);
  cabinet.add(body);

  // Two flush doors with a gap and a pair of slim handles.
  for (const side of [-1, 1]) {
    const panel = new Mesh(roundedBoxGeometry(width / 2 - 0.06, 0.55, 0.016, 0.016, 0.002), panelMaterial);
    panel.position.set(side * (width / 4), -0.42, depth / 2 - 0.075);
    cabinet.add(panel);
    const handle = new Mesh(new CylinderGeometry(0.007, 0.007, 0.2, 18), metal);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(side * 0.11, -0.31, depth / 2 - 0.055);
    cabinet.add(handle);
    for (const x of [-0.08, 0.08]) {
      const post = new Mesh(new CylinderGeometry(0.005, 0.005, 0.03, 12), metal);
      post.rotation.x = Math.PI / 2;
      post.position.set(side * 0.11 + x, -0.31, depth / 2 - 0.068);
      cabinet.add(post);
    }
  }

  // Recessed toe kick.
  const kick = new Mesh(new BoxGeometry(width - 0.25, 0.09, 0.06), ctx.library.matte(0x031011, { roughness: 0.9 }));
  kick.position.set(0, -0.735, depth / 2 - 0.15);
  cabinet.add(kick);

  // Warm under-counter strip, a small piece of practical light that makes the
  // joinery readable without lifting the whole room.
  const strip = new Mesh(new BoxGeometry(width * 0.8, 0.004, 0.008), ctx.library.glow(0xffd7a1, { intensity: 1.25, opacity: 0.9 }));
  strip.position.set(0, -0.085, depth / 2 - 0.02);
  strip.userData.noShadow = true;
  strip.userData.ignoreBounds = true;
  cabinet.add(strip);

  const footMaterial = ctx.library.rubber(0x071111);
  for (const x of [-0.96, 0.96]) {
    for (const z of [-0.26, 0.26]) {
      const foot = new Mesh(new CylinderGeometry(0.035, 0.04, 0.06, 14), footMaterial);
      foot.position.set(x, -0.78, z);
      cabinet.add(foot);
    }
  }
  return cabinet;
}

function backgroundBottle(color, height, ctx) {
  const group = new Group();
  group.name = "stock-bottle";
  const material = ctx.library.plasticTranslucent(color, { opacity: 0.46 });
  const capMaterial = ctx.library.plastic(0x1e3436, { roughness: 0.42 });
  const profile = [
    [0.0002, 0.002],
    [0.021, 0.002],
    [0.023, 0.008],
    [0.023, height * 0.62],
    [0.018, height * 0.74],
    [0.0115, height * 0.8],
    [0.0115, height * 0.94],
    [0.0125, height * 0.96],
  ];
  const geometry = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 28);
  const bottle = new Mesh(geometry, material);
  group.add(bottle);
  const cap = new Mesh(new CylinderGeometry(0.0135, 0.0135, 0.016, 20), capMaterial);
  cap.position.y = height * 0.97;
  group.add(cap);
  const band = new Mesh(new CylinderGeometry(0.0233, 0.0233, 0.022, 28, 1, true), ctx.library.matte(0xe9f4ee, { opacity: 0.68, roughness: 0.7 }));
  band.position.y = height * 0.38;
  band.userData.noShadow = true;
  group.add(band);
  return group;
}

function buildShelf(ctx, { width = 2.7 } = {}) {
  const shelf = new Group();
  shelf.name = "equipment-shelf";
  const plankMaterial = ctx.library.plastic(0x173233, { roughness: 0.38, clearcoat: 0.55 });
  const bracketMaterial = ctx.library.metal(0x6f8c90, { roughness: 0.34 });

  const plank = new Mesh(roundedBoxGeometry(width, 0.045, 0.25, 0.012, 0.002), plankMaterial);
  plank.position.set(0, 0.58, -0.6);
  shelf.add(plank);

  // A brushed metal nosing gives the shelf a crisp edge against the wall.
  const nosing = new Mesh(new BoxGeometry(width, 0.012, 0.006), bracketMaterial);
  nosing.position.set(0, 0.574, -0.473);
  nosing.userData.noShadow = true;
  nosing.userData.ignoreBounds = true;
  shelf.add(nosing);

  for (const side of [-1, 1]) {
    const vertical = new Mesh(new BoxGeometry(0.026, 0.4, 0.032), bracketMaterial);
    vertical.position.set(side * (width / 2 - 0.2), 0.37, -0.725);
    shelf.add(vertical);
    const lip = new Mesh(new BoxGeometry(0.16, 0.02, 0.24), bracketMaterial);
    lip.position.set(side * (width / 2 - 0.12), 0.558, -0.6);
    shelf.add(lip);
  }

  // Under-shelf light bar.
  const lightBar = new Mesh(new BoxGeometry(width * 0.9, 0.009, 0.016), ctx.library.glow(0xd8fff8, { intensity: 1.35 }));
  lightBar.position.set(0, 0.552, -0.48);
  lightBar.userData.noShadow = true;
  shelf.add(lightBar);

  const colors = [0x8a4b1f, 0x2f6f79, 0x4c3d78, 0x2f6a45, 0x7a3c3c, 0x315e7a];
  const heights = [0.15, 0.13, 0.17, 0.14, 0.16, 0.135];
  const shadowMaterial = ctx.library.contactShadowMaterial();
  const shadowGeometry = ctx.resources.geometry("contact-shadow-plane", () => new PlaneGeometry(1, 1));
  colors.forEach((color, index) => {
    const bottle = backgroundBottle(color, heights[index], ctx);
    bottle.position.set(-1.02 + index * 0.408, 0.604, -0.6 + (index % 2) * 0.014);
    bottle.rotation.y = index * 0.6;
    shelf.add(bottle);

    const contact = new Mesh(shadowGeometry, shadowMaterial);
    contact.rotation.x = -Math.PI / 2;
    contact.scale.setScalar(0.085);
    contact.position.set(bottle.position.x, 0.6035, bottle.position.z);
    contact.userData.ignoreBounds = true;
    contact.userData.noShadow = true;
    contact.renderOrder = -1;
    shelf.add(contact);
  });
  return shelf;
}

function buildFloor(ctx) {
  const floor = new Group();
  floor.name = "floor";
  const material = new MeshStandardMaterial({ color: 0x03090a, roughness: 0.86, metalness: 0.05 });
  const plane = new Mesh(new PlaneGeometry(12, 12), material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(0, -0.81, 0.4);
  plane.receiveShadow = Boolean(ctx.quality.shadows);
  floor.add(plane);

  const shadow = new Mesh(new PlaneGeometry(4.0, 2.7), ctx.library.contactShadowMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -0.805, 0.08);
  shadow.userData.noShadow = true;
  shadow.renderOrder = -2;
  floor.add(shadow);
  return floor;
}

function buildDust(ctx, count) {
  const total = Math.max(0, Number(count) || 0);
  if (total <= 0) return null;
  const positions = new Float32Array(total * 3);
  const random = seededRandom(99);
  for (let index = 0; index < total; index += 1) {
    positions[index * 3] = (random() - 0.5) * 2.5;
    positions[index * 3 + 1] = 0.08 + random() * 0.95;
    positions[index * 3 + 2] = -0.68 + random() * 1.15;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: 0xbfe9e4,
    size: 0.0045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: 2,
    toneMapped: false,
  });
  const dust = new Points(geometry, material);
  dust.name = "ambient-dust";
  dust.frustumCulled = false;
  dust.userData.noShadow = true;
  dust.userData.ignoreBounds = true;
  return dust;
}

/**
 * Build the whole room. `ctx.three` is supplied by the factory so this module
 * does not need a second Three import for the background lathe.
 */
export function buildLabEnvironment(options = {}, ctx) {
  const root = new Group();
  root.name = "lab-environment";

  const bench = buildBenchTop(ctx, options);
  bench.position.y = 0;
  root.add(bench);

  const cabinet = buildCabinet(ctx, options);
  cabinet.position.y = 0;
  root.add(cabinet);

  // Backsplash wall.
  const wallTexture = ctx.library.gradientTexture(WALL_GRADIENT);
  const wallMaterial = new MeshStandardMaterial({
    map: wallTexture,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.2,
  });
  const wall = new Mesh(new PlaneGeometry(8, 2.6), wallMaterial);
  wall.position.set(0, 1.05, -0.74);
  wall.receiveShadow = false;
  root.add(wall);

  const backsplash = new Mesh(roundedBoxGeometry(2.78, 0.24, 0.026, 0.026, 0.002), ctx.library.plastic(0x2b5152, { roughness: 0.3, clearcoat: 0.8 }));
  backsplash.position.set(0, 0.12, -0.506);
  backsplash.name = "backsplash";
  root.add(backsplash);

  const shelf = buildShelf(ctx, options);
  root.add(shelf);

  const floor = buildFloor(ctx);
  root.add(floor);

  const dust = buildDust(ctx, options.dust ?? ctx.quality.dust);
  if (dust) root.add(dust);

  root.userData.parts = { bench, cabinet, shelf, wall, floor, dust };
  root.userData.role = "environment";
  root.userData.preset = {
    shelf: { position: [0.2, 0.92, 0.68], target: [0, 0.63, -0.6] },
  };
  return root;
}

/** A small ice bucket; useful as a shelf prop in later phases. */
export function buildIceBucket(options = {}, ctx) {
  const root = new Group();
  root.name = "ice-bucket";
  const bucket = new Mesh(new CylinderGeometry(0.055, 0.045, 0.11, 40, 1, true), ctx.library.plastic(0xb7d6d2, { roughness: 0.4, clearcoat: 0.4 }));
  bucket.position.y = 0.055;
  root.add(bucket);
  const iceMaterial = ctx.library.plasticTranslucent(0xd9ffff, { opacity: 0.55 });
  const iceGeometry = new SphereGeometry(0.012, 8, 6);
  const random = seededRandom(3);
  for (let index = 0; index < 14; index += 1) {
    const ice = new Mesh(iceGeometry, iceMaterial);
    ice.position.set((random() - 0.5) * 0.075, 0.085 + random() * 0.035, (random() - 0.5) * 0.075);
    ice.rotation.set(random() * 3, random() * 3, random() * 3);
    root.add(ice);
  }
  return root;
}

export const MISC_TYPES = {
  labEnvironment: buildLabEnvironment,
  iceBucket: buildIceBucket,
};

export default MISC_TYPES;
