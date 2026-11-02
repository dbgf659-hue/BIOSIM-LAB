/**
 * BioSim Lab · model registry
 * ---------------------------------------------------------------------------
 * Single lookup for the forty experiment models. Order matches the catalogue.
 */

import { MOLECULAR_A } from "./molecular.js";
import { MOLECULAR_B } from "./molecular-assays.js";
import { MICROBIOLOGY } from "./microbiology.js";
import { CELL_AGRI } from "./cell-agri.js";
import { INDUSTRIAL } from "./industrial.js";
import { BIOINFORMATICS } from "./bioinformatics.js";

const ALL = [
  ...MOLECULAR_A,
  ...MOLECULAR_B,
  ...MICROBIOLOGY,
  ...CELL_AGRI,
  ...INDUSTRIAL,
  ...BIOINFORMATICS,
];

export const MODELS = new Map(ALL.map((model) => [model.id, model]));

export const MODEL_IDS = ALL.map((model) => model.id);

export function getModel(id) {
  return MODELS.get(id) ?? null;
}

export const MODEL_COUNT = ALL.length;
