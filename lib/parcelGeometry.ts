/**
 * Parcel geometry primitives — length, girth, cubic volume and dimensional
 * weight. Pure, zero-dependency, carrier-agnostic.
 *
 * Every UPS/FedEx size surcharge keys off numbers computed here, so this module
 * deliberately knows NOTHING about carriers, thresholds or money. Carrier rules
 * live in lib/boxOptimizer.ts; see box_surcharge_notes.md for the tariffs.
 *
 * NOTE: app/api/shipping/usps/route.ts computes the same girth inline (its own
 * lines ~76-79). That duplication is intentional for now — the USPS route is a
 * working production quote path and was left untouched. Consolidating it is a
 * separate, isolated change.
 */

/**
 * Dimensional-weight divisor. UPS and FedEx both use 139 for US domestic retail
 * and daily rates (both moved off 166 years ago). International can differ by
 * destination — verify before reusing this for non-US lanes.
 */
export const DIM_DIVISOR = 139;

/** Package dimensions in inches. Field names match ShipmentInput repo-wide. */
export interface Dims {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

/** Every derived measurement a carrier rule might test. All inches / lbs. */
export interface ParcelMeasure {
  /** Dimensions sorted longest → shortest. */
  sorted: [number, number, number];
  longestIn: number;
  secondLongestIn: number;
  shortestIn: number;
  /** 2 × (second-longest + shortest). */
  girthIn: number;
  /** Longest + girth — the number the Large Package / Oversize cliff tests. */
  lengthPlusGirthIn: number;
  /** L × W × H. Carriers added cubic-volume triggers in Jan 2026. */
  cubicIn: number;
  /** 2(LW + LH + WH) — outside surface. Drives the packing charge. */
  surfaceAreaIn2: number;
  /** ceil(cubic / divisor), never negative. */
  dimWeightLbs: number;
}

/** Coerce one dimension to a finite, non-negative number. */
function clean(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Dimensions sorted longest → shortest.
 *
 * ALWAYS sort before applying any threshold. Carriers measure the physical box,
 * not whatever order the operator typed the numbers in — a package entered as
 * 7 × 43 × 37 is the same parcel as 43 × 37 × 7.
 */
export function sortDimsDesc(dims: Dims): [number, number, number] {
  const sorted = [clean(dims.lengthIn), clean(dims.widthIn), clean(dims.heightIn)]
    .sort((a, b) => b - a);
  return [sorted[0], sorted[1], sorted[2]];
}

/** Girth = 2 × (second-longest + shortest). */
export function girthIn(dims: Dims): number {
  const [, second, shortest] = sortDimsDesc(dims);
  return 2 * (second + shortest);
}

/** Length + girth = longest + 2 × (second-longest + shortest). */
export function lengthPlusGirthIn(dims: Dims): number {
  const [longest, second, shortest] = sortDimsDesc(dims);
  return longest + 2 * (second + shortest);
}

/** Cubic volume in cubic inches (L × W × H). */
export function cubicIn(dims: Dims): number {
  const [a, b, c] = sortDimsDesc(dims);
  return a * b * c;
}

/**
 * Outside surface area in square inches: 2(LW + LH + WH).
 *
 * This is the corrugated needed to make the box and the wrap needed to line it,
 * so it is the basis for the shop's packing charge (see lib/boxOptimizer.ts
 * computePackingPrice). Orientation-invariant, like every other measure here.
 */
export function surfaceAreaIn2(dims: Dims): number {
  const [a, b, c] = sortDimsDesc(dims);
  return 2 * (a * b + a * c + b * c);
}

/**
 * Dimensional weight, rounded UP to the next whole pound.
 * Billed weight is max(actual, dim) — that comparison lives in boxOptimizer.
 */
export function dimWeightLbs(dims: Dims, divisor: number = DIM_DIVISOR): number {
  const d = Number(divisor) || DIM_DIVISOR;
  return Math.ceil(cubicIn(dims) / d);
}

/** All derived measurements in one pass — the only function most callers need. */
export function measureParcel(dims: Dims, divisor: number = DIM_DIVISOR): ParcelMeasure {
  const sorted = sortDimsDesc(dims);
  const [longest, second, shortest] = sorted;
  const girth = 2 * (second + shortest);
  const cubic = longest * second * shortest;
  const d = Number(divisor) || DIM_DIVISOR;
  return {
    sorted,
    longestIn: longest,
    secondLongestIn: second,
    shortestIn: shortest,
    girthIn: girth,
    lengthPlusGirthIn: longest + girth,
    cubicIn: cubic,
    surfaceAreaIn2: 2 * (longest * second + longest * shortest + second * shortest),
    dimWeightLbs: Math.ceil(cubic / d),
  };
}

/** How a carrier rounds measured dimensions before rating. */
export type DimRounding = 'ceil' | 'nearest' | 'none';

/**
 * Apply a rounding policy before classifying.
 *
 * We classify on CEIL-rounded dimensions by default: a 47.6" box that a hub
 * rounds to 48" is safe, but 48.2" rounding to 49" is not, and it is far better
 * to warn the counter early than to surprise the shop with a billing
 * adjustment weeks later. Exact gross dimensions are displayed alongside.
 */
export function roundDimsForRating(dims: Dims, policy: DimRounding): Dims {
  if (policy === 'none') {
    return { lengthIn: clean(dims.lengthIn), widthIn: clean(dims.widthIn), heightIn: clean(dims.heightIn) };
  }
  const fn = policy === 'ceil' ? Math.ceil : Math.round;
  return {
    lengthIn: fn(clean(dims.lengthIn)),
    widthIn: fn(clean(dims.widthIn)),
    heightIn: fn(clean(dims.heightIn)),
  };
}

/** True when all three dimensions are finite and greater than zero. */
export function hasUsableDims(dims: Dims): boolean {
  return clean(dims.lengthIn) > 0 && clean(dims.widthIn) > 0 && clean(dims.heightIn) > 0;
}

/**
 * Smallest rectangular bounding box for a cylinder (tube, rolled poster, drum).
 * Length stays the length; width and height both become the diameter.
 */
export function cylinderBoundingBox(lengthIn: number, diameterIn: number): Dims {
  const d = clean(diameterIn);
  return { lengthIn: clean(lengthIn), widthIn: d, heightIn: d };
}

/**
 * Longest rigid item that fits a box corner-to-corner: √(L² + W² + H²).
 * A 30" rod fits a 28 × 10 × 10 box. Advisory only — useful for rods, tubes and
 * framed art, meaningless for anything bulky.
 */
export function diagonalIn(dims: Dims): number {
  const [a, b, c] = sortDimsDesc(dims);
  return Math.sqrt(a * a + b * b + c * c);
}
