import type { BoxCalcInput, PackingMaterialKey, PackingProfile } from '@/lib/boxOptimizer';
import { PACKING_PRESETS } from '@/lib/boxOptimizer';
import { cylinderBoundingBox } from '@/lib/parcelGeometry';

/**
 * Calculator form state.
 *
 * WHY DIMENSIONS ARE STRINGS: typing "0.5" passes through the intermediate
 * "0.", where `parseFloat("0.") || 0` is 0 — so a controlled input bound to the
 * parsed number snaps back and the operator cannot type a decimal. The raw
 * string is kept here and parsed once at the boundary, in toCalcInput().
 *
 * ShipmentForm.tsx used to have exactly that bug and now keeps the same
 * raw-string state (its `parcelText`), so the two forms agree. Don't
 * "simplify" either back to a single numeric source.
 */
export interface BoxFormState {
  shape: 'box' | 'cylinder';
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  diameterIn: string;
  weightLbs: string;
  profile: PackingProfile;
  material: PackingMaterialKey;
  thicknessIn: string;
  /** Once the operator edits thickness, preset changes stop overwriting it. */
  thicknessTouched: boolean;
  nonStandardPackaging: boolean;
  destZip: string;
  residential: boolean;
}

export const INITIAL_FORM: BoxFormState = {
  shape: 'box',
  lengthIn: '',
  widthIn: '',
  heightIn: '',
  diameterIn: '',
  weightLbs: '',
  profile: 'standard',
  material: PACKING_PRESETS.standard.material,
  thicknessIn: String(PACKING_PRESETS.standard.thicknessIn),
  thicknessTouched: false,
  nonStandardPackaging: false,
  destZip: '',
  residential: false,
};

/** Parse a form field to a non-negative number; blank/garbage becomes 0. */
export function num(raw: string): number {
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Form state → the pure lib's input shape. */
export function toCalcInput(form: BoxFormState): BoxCalcInput {
  const item = form.shape === 'cylinder'
    ? cylinderBoundingBox(num(form.lengthIn), num(form.diameterIn))
    : { lengthIn: num(form.lengthIn), widthIn: num(form.widthIn), heightIn: num(form.heightIn) };

  return {
    item,
    weightLbs: num(form.weightLbs),
    profile: form.profile,
    material: form.material,
    thicknessIn: form.thicknessIn === '' ? undefined : num(form.thicknessIn),
    nonStandardPackaging: form.nonStandardPackaging,
    residential: form.residential,
  };
}

/** 5-digit ZIP is the gate for enabling live rates. */
export function hasUsableZip(destZip: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(destZip.trim());
}
