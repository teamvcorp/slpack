/**
 * Box size optimizer — packing allowances, UPS/FedEx size-surcharge
 * classification, threshold warnings and fix suggestions.
 *
 * Pure and dependency-free apart from lib/parcelGeometry (math) and
 * lib/localDate (peak-season window). Nothing here talks to a carrier API.
 *
 * SOURCE OF TRUTH: box_surcharge_notes.md — verified 2026-08-13 against the
 * 2026 UPS and FedEx published tariffs. **Re-verify every January**; both
 * carriers reprice and re-scope these in the first two weeks of the year.
 *
 * WHY RANGES, NOT PRICES: since 2026 these surcharges are zone-dependent, and
 * the base rate needs zone × billed weight × service, which only the carriers
 * have. This module therefore estimates SURCHARGES ONLY, as a min–max range.
 * The live-rate button on /admin/box-size is the source of truth for dollars.
 * See box_surcharge_notes.md §6.
 */

import {
  type Dims,
  type ParcelMeasure,
  type DimRounding,
  measureParcel,
  roundDimsForRating,
  hasUsableDims,
  diagonalIn,
} from './parcelGeometry';
import { localDateStamp } from './localDate';

// ─────────────────────────────── Provenance ────────────────────────────────

/** Tariff year the fee tables below come from. Rendered in the UI. */
export const FEE_SCHEDULE_YEAR = 2026;

/** Date the fee tables were last checked against carrier sources (ISO). */
export const FEE_VERIFIED_ON = '2026-08-13';

// ──────────────────────────── Packing materials ────────────────────────────

export type PackingMaterialKey =
  | 'none'
  | 'foamBoard'
  | 'peanuts'
  | 'bubbleSingle'
  | 'bubbleDouble'
  | 'foamSheet'
  | 'foamInPlace'
  | 'airPillows'
  | 'kraftPaper'
  | 'corrugatedInsert';

export interface PackingMaterial {
  key: PackingMaterialKey;
  label: string;
  /** Minimum defensible thickness per side, in inches. */
  minThicknessIn: number;
  /** Recommended thickness per side, in inches. */
  recommendedThicknessIn: number;
  note?: string;
}

/**
 * Per-side thickness table. Thickness is applied to BOTH sides of every axis,
 * so a 1" selection adds 2" to each of length, width and height.
 */
export const PACKING_MATERIALS: Readonly<Record<PackingMaterialKey, PackingMaterial>> = {
  none: {
    key: 'none', label: 'No packing (rigid item)',
    minThicknessIn: 0.5, recommendedThicknessIn: 0.5,
    note: 'Always allow at least 0.5" per side for the box wall itself.',
  },
  foamBoard: {
    key: 'foamBoard', label: 'Foam board (1.5")',
    minThicknessIn: 1.5, recommendedThicknessIn: 1.5,
    note: 'Rigid sheet, consistent thickness. Shop standard for fragile items.',
  },
  peanuts: {
    key: 'peanuts', label: 'Foam peanuts',
    minThicknessIn: 2, recommendedThicknessIn: 3,
    note: 'Settles in transit and compresses under heavy items — add extra on the bottom.',
  },
  bubbleSingle: {
    key: 'bubbleSingle', label: 'Bubble wrap (single wall)',
    minThicknessIn: 0.5, recommendedThicknessIn: 1,
    note: 'Most shippers use 1–2 layers.',
  },
  bubbleDouble: {
    key: 'bubbleDouble', label: 'Bubble wrap (double wall)',
    minThicknessIn: 1, recommendedThicknessIn: 1.5,
    note: 'Heavier items; 1.5" per side is standard for electronics.',
  },
  foamSheet: {
    key: 'foamSheet', label: 'Foam sheet (polyethylene)',
    minThicknessIn: 0.25, recommendedThicknessIn: 0.5,
    note: 'Thin wrap for light items — often combined with peanuts.',
  },
  foamInPlace: {
    key: 'foamInPlace', label: 'Foam-in-place',
    minThicknessIn: 1, recommendedThicknessIn: 1.5,
    note: 'Custom moulded — best for irregular shapes.',
  },
  airPillows: {
    key: 'airPillows', label: 'Air pillows',
    minThicknessIn: 1, recommendedThicknessIn: 2,
    note: 'Void fill only — not primary cushioning for fragile items.',
  },
  kraftPaper: {
    key: 'kraftPaper', label: 'Crumpled kraft paper',
    minThicknessIn: 1, recommendedThicknessIn: 2,
    note: 'Compresses more than foam — use 2–3" for fragile items.',
  },
  corrugatedInsert: {
    key: 'corrugatedInsert', label: 'Cardboard insert / divider',
    minThicknessIn: 0.125, recommendedThicknessIn: 0.125,
    note: 'Structural only — negligible thickness.',
  },
};

export type PackingProfile = 'light' | 'standard' | 'fragile';

export interface PackingPreset {
  label: string;
  material: PackingMaterialKey;
  thicknessIn: number;
  /** Below this, the calculator warns that the item is under-protected. */
  minThicknessIn: number;
  description: string;
}

/**
 * How much protection the item needs → material and per-side thickness.
 * Fragile is the shop's foam-board build: 1.5" board plus a 1" bubble layer.
 */
export const PACKING_PRESETS: Readonly<Record<PackingProfile, PackingPreset>> = {
  light: {
    label: 'Light', material: 'bubbleSingle',
    thicknessIn: 1, minThicknessIn: 0.5,
    description: 'Single-wall bubble wrap, 1" per side',
  },
  standard: {
    label: 'Standard', material: 'peanuts',
    thicknessIn: 2, minThicknessIn: 2,
    description: 'Foam peanuts, 2" per side',
  },
  fragile: {
    label: 'Fragile', material: 'foamBoard',
    thicknessIn: 2.5, minThicknessIn: 2.5,
    description: '1.5" foam board + 1" bubble wrap, 2.5" per side',
  },
};

/** Absolute minimum clearance per side, even for a rigid item with no packing. */
export const MIN_CLEARANCE_IN = 0.5;

/**
 * Every 1" of uniform per-side padding adds 10" to length + girth.
 *
 * Derivation: L+G = a + 2b + 2c. Uniform padding t adds 2t to each axis, so
 * L+G grows by 2t + 2(2t) + 2(2t) = 10t. Padding the LONGEST axis costs only
 * 2" per inch; padding either short axis costs 4" — double. That asymmetry is
 * the single most useful thing this tool teaches.
 */
export const LPG_PER_INCH_OF_PADDING = 10;

// ───────────────────────────── Carrier rules ───────────────────────────────

export type ParcelCarrier = 'ups' | 'fedex';

export type SizeClass =
  | 'STANDARD'
  | 'ADDITIONAL_HANDLING'
  | 'LARGE_PACKAGE'
  | 'OVER_MAX';

/** A fee that varies by zone: we know the band, not the exact cell. */
export interface FeeRange {
  minUSD: number;
  maxUSD: number;
}

export interface CarrierRuleSet {
  carrier: ParcelCarrier;
  label: string;
  dimRounding: DimRounding;

  /** Additional Handling triggers. */
  ahLongestIn: number;
  ahSecondLongestIn: number;
  ahLengthPlusGirthIn: number;
  ahCubicIn: number;
  ahWeightLbs: number;

  /** Large Package (UPS) / Oversize (FedEx) triggers. */
  largeLongestIn: number;
  largeLengthPlusGirthIn: number;
  largeCubicIn: number;
  largeWeightLbs: number;
  /** Minimum billable weight forced by the Large/Oversize class. */
  largeMinBillableLbs: number;

  /** Over Maximum Limits (UPS) / Unauthorized Package (FedEx). */
  maxLongestIn: number;
  maxLengthPlusGirthIn: number;
  maxWeightLbs: number;

  /**
   * FedEx suppresses only the DIMENSION-based AHS under Oversize, so a
   * weight-based AHS still bills alongside it. UPS waives Additional Handling
   * entirely. See box_surcharge_notes.md §5 ruling (b).
   */
  ahWeightSurvivesLarge: boolean;

  /** Published fee ranges across zones (see notes §3/§4). */
  largeFeeCommercial: FeeRange;
  largeFeeResidential: FeeRange;
  ahSizeFee: FeeRange;
  ahWeightFee: FeeRange;
  ahPackagingFee: FeeRange;
  overMaxFeeUSD: number;
}

/**
 * Verified 2026 thresholds and published fee ranges.
 *
 * Thresholds are identical across the two carriers this year; the fees and the
 * AH-suppression behaviour are not. Kept as data so an annual tariff update is
 * a constant edit, never a logic edit.
 */
export const CARRIER_RULES: Readonly<Record<ParcelCarrier, CarrierRuleSet>> = {
  ups: {
    carrier: 'ups', label: 'UPS', dimRounding: 'ceil',
    ahLongestIn: 48, ahSecondLongestIn: 30, ahLengthPlusGirthIn: 105,
    ahCubicIn: 10368, ahWeightLbs: 50,
    largeLongestIn: 96, largeLengthPlusGirthIn: 130,
    largeCubicIn: 17280, largeWeightLbs: 110, largeMinBillableLbs: 90,
    maxLongestIn: 108, maxLengthPlusGirthIn: 165, maxWeightLbs: 150,
    ahWeightSurvivesLarge: false,
    largeFeeCommercial: { minUSD: 219.5, maxUSD: 286 },
    largeFeeResidential: { minUSD: 254.5, maxUSD: 331 },
    ahSizeFee: { minUSD: 28, maxUSD: 36 },
    ahWeightFee: { minUSD: 43.5, maxUSD: 52.75 },
    ahPackagingFee: { minUSD: 25, maxUSD: 31 },
    overMaxFeeUSD: 1875,
  },
  fedex: {
    carrier: 'fedex', label: 'FedEx', dimRounding: 'ceil',
    ahLongestIn: 48, ahSecondLongestIn: 30, ahLengthPlusGirthIn: 105,
    ahCubicIn: 10368, ahWeightLbs: 50,
    largeLongestIn: 96, largeLengthPlusGirthIn: 130,
    largeCubicIn: 17280, largeWeightLbs: 110, largeMinBillableLbs: 90,
    maxLongestIn: 108, maxLengthPlusGirthIn: 165, maxWeightLbs: 150,
    ahWeightSurvivesLarge: true,
    largeFeeCommercial: { minUSD: 255, maxUSD: 330 },
    largeFeeResidential: { minUSD: 255, maxUSD: 330 },
    ahSizeFee: { minUSD: 29.5, maxUSD: 40.75 },
    ahWeightFee: { minUSD: 29.5, maxUSD: 40.75 },
    ahPackagingFee: { minUSD: 29.5, maxUSD: 40.75 },
    overMaxFeeUSD: 1875,
  },
};

export const PARCEL_CARRIERS: ParcelCarrier[] = ['ups', 'fedex'];

/** Proximity bands for "you are close to a cliff" warnings. */
export const PROXIMITY = {
  lengthPlusGirthWarnFrom: 125,
  lengthPlusGirthCriticalFrom: 128,
  longestWarnFrom: 45,
  longestCriticalFrom: 47,
  cubicWarnFraction: 0.92,
  overMaxWarnMarginIn: 10,
  overMaxCriticalMarginIn: 3,
} as const;

/** Freight fallback triggers (see box_surcharge_notes.md §6). */
export const FREIGHT_LIGHT_LARGE_WEIGHT_LBS = 50;
export const FREIGHT_PARCEL_COST_USD = 400;

// ─────────────────────────────── Result types ──────────────────────────────

export type WarnLevel = 'info' | 'warn' | 'critical';

/** One threshold that a package crossed, with the numbers behind it. */
export interface TriggerHit {
  rule: string;
  label: string;
  value: number;
  limit: number;
  unit: 'in' | 'in³' | 'lb';
}

export type SurchargeCode =
  | 'LARGE_PACKAGE'
  | 'ADDITIONAL_HANDLING_SIZE'
  | 'ADDITIONAL_HANDLING_WEIGHT'
  | 'ADDITIONAL_HANDLING_PACKAGING'
  | 'OVER_MAX'
  | 'PEAK';

export interface SurchargeLine {
  code: SurchargeCode;
  label: string;
  /** null when the charge applies but the amount varies too much to quote. */
  fee: FeeRange | null;
  reason: string;
  /** Present when this line was triggered but is not billed. */
  supersededBy?: SurchargeCode;
}

export interface ThresholdWarning {
  id: string;
  level: WarnLevel;
  carrier: ParcelCarrier | 'both';
  message: string;
  /** Inches (or lbs) of headroom left before the next cliff, when meaningful. */
  marginIn: number | null;
}

export interface CarrierAssessment {
  carrier: ParcelCarrier;
  label: string;
  /** Dimensions after this carrier's rounding policy — what we classify on. */
  ratedDims: Dims;
  measure: ParcelMeasure;
  sizeClass: SizeClass;
  actualWeightLbs: number;
  dimWeightLbs: number;
  billedWeightLbs: number;
  /** Charges that actually bill. */
  surcharges: SurchargeLine[];
  /** Triggered but not billed — shown greyed so staff see why a fee is absent. */
  suppressed: SurchargeLine[];
  surchargeTotal: FeeRange;
  shippable: boolean;
  blockReason: string | null;
  triggers: {
    large: TriggerHit[];
    ahSize: TriggerHit[];
    ahWeight: TriggerHit | null;
    overMax: TriggerHit[];
  };
}

export interface FreightRecommendation {
  recommended: boolean;
  reasons: string[];
  /** True when the only unevaluated trigger is the >$400 rule. */
  needsLiveRate: boolean;
}

export interface ResolvedPacking {
  material: PackingMaterial;
  thicknessIn: number;
  belowMin: boolean;
  belowClearance: boolean;
}

export interface BoxCalcInput {
  /** BARE item dimensions (or its smallest bounding box). */
  item: Dims;
  weightLbs: number;
  profile: PackingProfile;
  material: PackingMaterialKey;
  /** Per-side thickness override. Omit to use the preset/material default. */
  thicknessIn?: number;
  /** Outer container is not plain corrugated (wood, metal, banded, cylindrical). */
  nonStandardPackaging?: boolean;
  residential?: boolean;
  onDate?: Date;
}

export interface BoxCalcResult {
  ok: boolean;
  incompleteReason: string | null;
  item: Dims;
  packing: ResolvedPacking;
  /** THE ANSWER: required outside box dimensions. */
  grossDims: Dims;
  grossMeasure: ParcelMeasure;
  carriers: Record<ParcelCarrier, CarrierAssessment>;
  /** Worst class across carriers — drives the headline badge. */
  worstClass: SizeClass;
  warnings: ThresholdWarning[];
  suggestions: Suggestion[];
  freight: FreightRecommendation;
  isPeak: boolean;
  feeScheduleYear: number;
}

// ────────────────────────────── Small helpers ──────────────────────────────

/** Round to cents. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "$285.00" */
export function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/** "$219.50–$331.00", or a single figure when the range is flat. */
export function moneyRange(fee: FeeRange | null): string {
  if (!fee) return 'varies';
  if (Math.abs(fee.maxUSD - fee.minUSD) < 0.005) return money(fee.minUSD);
  return `${money(fee.minUSD)}–${money(fee.maxUSD)}`;
}

function addRange(a: FeeRange, b: FeeRange | null): FeeRange {
  if (!b) return a;
  return { minUSD: cents(a.minUSD + b.minUSD), maxUSD: cents(a.maxUSD + b.maxUSD) };
}

/** Trim floating-point noise from inch math (0.1 + 0.2 problems). */
function inches(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

// ──────────────────────────────── Packing ──────────────────────────────────

/**
 * Resolve preset + material + operator override into a final per-side thickness.
 * An explicit `thicknessIn` always wins — the operator can see the item.
 */
export function resolvePacking(input: {
  profile: PackingProfile;
  material: PackingMaterialKey;
  thicknessIn?: number;
}): ResolvedPacking {
  const material = PACKING_MATERIALS[input.material] ?? PACKING_MATERIALS.none;
  const preset = PACKING_PRESETS[input.profile] ?? PACKING_PRESETS.standard;

  const raw = input.thicknessIn;
  const explicit = raw !== undefined && raw !== null && Number.isFinite(Number(raw));
  const thicknessIn = explicit ? Math.max(0, Number(raw)) : preset.thicknessIn;

  // The floor to judge against: whichever of the material's own minimum and the
  // chosen protection level is stricter.
  const floor = Math.max(material.minThicknessIn, preset.minThicknessIn);

  return {
    material,
    thicknessIn: inches(thicknessIn),
    belowMin: thicknessIn < floor,
    belowClearance: thicknessIn < MIN_CLEARANCE_IN,
  };
}

/** Item dimensions + 2 × per-side thickness on every axis. */
export function grossDims(item: Dims, thicknessIn: number): Dims {
  const pad = 2 * Math.max(0, Number(thicknessIn) || 0);
  return {
    lengthIn: inches((Number(item.lengthIn) || 0) + pad),
    widthIn: inches((Number(item.widthIn) || 0) + pad),
    heightIn: inches((Number(item.heightIn) || 0) + pad),
  };
}

// ───────────────────────────── Classification ──────────────────────────────

function hit(rule: string, label: string, value: number, limit: number, unit: TriggerHit['unit']): TriggerHit {
  return { rule, label, value, limit, unit };
}

/**
 * Which thresholds this parcel crosses, for one carrier.
 *
 * ALL comparisons are strictly greater-than: L+G of exactly 130.0" and a
 * longest side of exactly 48.0" are both SAFE. Using >= would penalize
 * compliant boxes. See box_surcharge_notes.md §2.
 */
export function findTriggers(
  measure: ParcelMeasure,
  actualWeightLbs: number,
  rules: CarrierRuleSet,
  nonStandardPackaging = false
): CarrierAssessment['triggers'] {
  const w = Math.max(0, Number(actualWeightLbs) || 0);
  const { longestIn, secondLongestIn, lengthPlusGirthIn, cubicIn } = measure;

  const overMax: TriggerHit[] = [];
  if (longestIn > rules.maxLongestIn) overMax.push(hit('maxLongest', 'Longest side', longestIn, rules.maxLongestIn, 'in'));
  if (lengthPlusGirthIn > rules.maxLengthPlusGirthIn) overMax.push(hit('maxLpg', 'Length + girth', lengthPlusGirthIn, rules.maxLengthPlusGirthIn, 'in'));
  if (w > rules.maxWeightLbs) overMax.push(hit('maxWeight', 'Weight', w, rules.maxWeightLbs, 'lb'));

  const large: TriggerHit[] = [];
  if (longestIn > rules.largeLongestIn) large.push(hit('largeLongest', 'Longest side', longestIn, rules.largeLongestIn, 'in'));
  if (lengthPlusGirthIn > rules.largeLengthPlusGirthIn) large.push(hit('largeLpg', 'Length + girth', lengthPlusGirthIn, rules.largeLengthPlusGirthIn, 'in'));
  if (cubicIn > rules.largeCubicIn) large.push(hit('largeCubic', 'Cubic volume', cubicIn, rules.largeCubicIn, 'in³'));
  if (w > rules.largeWeightLbs) large.push(hit('largeWeight', 'Weight', w, rules.largeWeightLbs, 'lb'));

  const ahSize: TriggerHit[] = [];
  if (longestIn > rules.ahLongestIn) ahSize.push(hit('ahLongest', 'Longest side', longestIn, rules.ahLongestIn, 'in'));
  if (secondLongestIn > rules.ahSecondLongestIn) ahSize.push(hit('ahSecond', 'Second-longest side', secondLongestIn, rules.ahSecondLongestIn, 'in'));
  if (lengthPlusGirthIn > rules.ahLengthPlusGirthIn) ahSize.push(hit('ahLpg', 'Length + girth', lengthPlusGirthIn, rules.ahLengthPlusGirthIn, 'in'));
  if (cubicIn > rules.ahCubicIn) ahSize.push(hit('ahCubic', 'Cubic volume', cubicIn, rules.ahCubicIn, 'in³'));
  if (nonStandardPackaging) ahSize.push(hit('ahPackaging', 'Non-corrugated packaging', 1, 0, 'in'));

  const ahWeight = w > rules.ahWeightLbs
    ? hit('ahWeight', 'Weight', w, rules.ahWeightLbs, 'lb')
    : null;

  return { large, ahSize, ahWeight, overMax };
}

/** Exclusive size tier. Highest applicable wins — the tiers never stack. */
export function classifySize(triggers: CarrierAssessment['triggers']): SizeClass {
  if (triggers.overMax.length > 0) return 'OVER_MAX';
  if (triggers.large.length > 0) return 'LARGE_PACKAGE';
  if (triggers.ahSize.length > 0 || triggers.ahWeight) return 'ADDITIONAL_HANDLING';
  return 'STANDARD';
}

/**
 * Billed weight = max(actual, dimensional), then the Large/Oversize 90 lb floor.
 * The floor is a billing artifact — never feed it back into a weight trigger.
 */
export function billedWeightLbs(
  actualLbs: number,
  dimLbs: number,
  sizeClass: SizeClass,
  rules: CarrierRuleSet
): number {
  const base = Math.max(Math.max(0, Number(actualLbs) || 0), Math.max(0, Number(dimLbs) || 0));
  if (sizeClass === 'LARGE_PACKAGE') return Math.max(base, rules.largeMinBillableLbs);
  return base;
}

function describe(hits: TriggerHit[]): string {
  return hits
    .map((h) => (h.rule === 'ahPackaging'
      ? 'non-corrugated packaging'
      : `${h.label.toLowerCase()} ${h.value.toLocaleString()}${h.unit} > ${h.limit.toLocaleString()}${h.unit}`))
    .join('; ');
}

/**
 * Charged and suppressed surcharge lines for one carrier.
 *
 * Rules encoded here (box_surcharge_notes.md §5):
 *  - Only ONE Additional Handling charge per package. UPS bills the most
 *    expensive, prioritized weight → dimensions → packaging; FedEx prices every
 *    AHS category identically, so the priority only affects the reason text.
 *  - Large Package / Oversize replaces Additional Handling — except at FedEx,
 *    where a WEIGHT-based AHS still bills alongside Oversize.
 *  - Peak/demand surcharges stack on top of everything.
 */
export function estimateSurcharges(
  triggers: CarrierAssessment['triggers'],
  sizeClass: SizeClass,
  rules: CarrierRuleSet,
  opts: { peak?: boolean; residential?: boolean } = {}
): { charged: SurchargeLine[]; suppressed: SurchargeLine[]; total: FeeRange } {
  const charged: SurchargeLine[] = [];
  const suppressed: SurchargeLine[] = [];

  const ahWeightLine = (): SurchargeLine => ({
    code: 'ADDITIONAL_HANDLING_WEIGHT',
    label: 'Additional Handling — weight',
    fee: rules.ahWeightFee,
    reason: describe(triggers.ahWeight ? [triggers.ahWeight] : []),
  });
  const ahSizeLine = (): SurchargeLine => ({
    code: 'ADDITIONAL_HANDLING_SIZE',
    label: 'Additional Handling — size',
    fee: rules.ahSizeFee,
    reason: describe(triggers.ahSize),
  });

  if (sizeClass === 'OVER_MAX') {
    charged.push({
      code: 'OVER_MAX',
      label: rules.carrier === 'ups' ? 'Over Maximum Limits' : 'Unauthorized Package',
      fee: { minUSD: rules.overMaxFeeUSD, maxUSD: rules.overMaxFeeUSD },
      reason: describe(triggers.overMax),
    });
  } else if (sizeClass === 'LARGE_PACKAGE') {
    charged.push({
      code: 'LARGE_PACKAGE',
      label: rules.carrier === 'ups' ? 'Large Package Surcharge' : 'Oversize Charge',
      fee: opts.residential ? rules.largeFeeResidential : rules.largeFeeCommercial,
      reason: describe(triggers.large),
    });
    // FedEx keeps a weight-based AHS under Oversize; UPS waives all handling.
    if (triggers.ahWeight && rules.ahWeightSurvivesLarge) {
      charged.push(ahWeightLine());
    } else if (triggers.ahWeight) {
      suppressed.push({ ...ahWeightLine(), supersededBy: 'LARGE_PACKAGE' });
    }
    if (triggers.ahSize.length > 0) {
      suppressed.push({ ...ahSizeLine(), supersededBy: 'LARGE_PACKAGE' });
    }
  } else if (sizeClass === 'ADDITIONAL_HANDLING') {
    // One AH only — weight outranks size at UPS because it costs more.
    if (triggers.ahWeight) {
      charged.push(ahWeightLine());
      if (triggers.ahSize.length > 0) {
        suppressed.push({ ...ahSizeLine(), supersededBy: 'ADDITIONAL_HANDLING_WEIGHT' });
      }
    } else if (triggers.ahSize.length > 0) {
      charged.push(ahSizeLine());
    }
  }

  if (opts.peak && sizeClass !== 'STANDARD') {
    charged.push({
      code: 'PEAK',
      label: 'Peak / demand surcharge',
      fee: null,
      reason: 'Peak season is active — carriers add a demand surcharge on top of the charges above',
    });
  }

  const total = charged.reduce<FeeRange>(
    (acc, line) => addRange(acc, line.fee),
    { minUSD: 0, maxUSD: 0 }
  );

  return { charged, suppressed, total };
}

/** Full per-carrier assessment: round → measure → classify → weigh → price. */
export function assessCarrier(
  gross: Dims,
  actualWeightLbs: number,
  carrier: ParcelCarrier,
  opts: { peak?: boolean; residential?: boolean; nonStandardPackaging?: boolean } = {}
): CarrierAssessment {
  const rules = CARRIER_RULES[carrier];
  const ratedDims = roundDimsForRating(gross, rules.dimRounding);
  const measure = measureParcel(ratedDims);
  const actual = Math.max(0, Number(actualWeightLbs) || 0);

  const triggers = findTriggers(measure, actual, rules, opts.nonStandardPackaging);
  const sizeClass = classifySize(triggers);
  const billed = billedWeightLbs(actual, measure.dimWeightLbs, sizeClass, rules);
  const { charged, suppressed, total } = estimateSurcharges(triggers, sizeClass, rules, opts);

  return {
    carrier,
    label: rules.label,
    ratedDims,
    measure,
    sizeClass,
    actualWeightLbs: actual,
    dimWeightLbs: measure.dimWeightLbs,
    billedWeightLbs: billed,
    surcharges: charged,
    suppressed,
    surchargeTotal: total,
    shippable: sizeClass !== 'OVER_MAX',
    blockReason: sizeClass === 'OVER_MAX'
      ? `Exceeds ${rules.label} parcel limits (${describe(triggers.overMax)}). Ship LTL freight.`
      : null,
    triggers,
  };
}

// ──────────────────────────────── Peak season ──────────────────────────────

/**
 * True inside the carriers' peak/demand window (late Sept → mid Jan).
 * Store-local date via lib/localDate — a UTC date rolls a day forward after
 * 7 pm Central and would flip the window a day early at each boundary.
 */
export function isPeakSeason(date: Date = new Date()): boolean {
  const [, mm, dd] = localDateStamp(date).split('-').map(Number);
  if (mm === 9) return dd >= 29;
  if (mm >= 10) return true;
  if (mm === 1) return dd <= 18;
  return false;
}

// ──────────────────────────────── Warnings ─────────────────────────────────

/**
 * Proximity and hard-limit warnings.
 *
 * Bands are implemented as ranges, not the spec's integer buckets: "125–129"
 * would leave a parcel at 129.5" unwarned while sitting half an inch from a
 * ~$285 cliff.
 */
export function thresholdWarnings(
  grossMeasure: ParcelMeasure,
  carriers: Record<ParcelCarrier, CarrierAssessment>,
  packing: ResolvedPacking,
  bareMeasure: ParcelMeasure
): ThresholdWarning[] {
  const out: ThresholdWarning[] = [];
  const { lengthPlusGirthIn, longestIn, cubicIn } = grossMeasure;
  const rules = CARRIER_RULES.ups; // thresholds are identical across carriers in 2026

  const anyLarge = PARCEL_CARRIERS.some((c) => carriers[c].sizeClass === 'LARGE_PACKAGE');
  const anyOverMax = PARCEL_CARRIERS.some((c) => carriers[c].sizeClass === 'OVER_MAX');

  // Packing pushed it over — say so, or staff blame the item.
  if (packing.thicknessIn > 0 && (anyLarge || anyOverMax)) {
    const bareClass = classifySize(findTriggers(bareMeasure, 0, rules));
    if (bareClass === 'STANDARD' || bareClass === 'ADDITIONAL_HANDLING') {
      out.push({
        id: 'packing-caused',
        level: 'critical',
        carrier: 'both',
        message: `The item itself is under the limit — the ${packing.thicknessIn}" per-side packing is what pushes this box over. Every 1" of padding adds 10" to length + girth.`,
        marginIn: null,
      });
    }
  }

  if (!anyOverMax && !anyLarge) {
    if (lengthPlusGirthIn > PROXIMITY.lengthPlusGirthCriticalFrom) {
      out.push({
        id: 'lpg-critical', level: 'critical', carrier: 'both',
        message: `Length + girth is ${lengthPlusGirthIn}" — only ${inches(rules.largeLengthPlusGirthIn - lengthPlusGirthIn)}" under the 130" Large Package cliff. Adding any more packing will cost ~$220–$331 plus 90 lb minimum billing.`,
        marginIn: inches(rules.largeLengthPlusGirthIn - lengthPlusGirthIn),
      });
    } else if (lengthPlusGirthIn > PROXIMITY.lengthPlusGirthWarnFrom) {
      out.push({
        id: 'lpg-warn', level: 'warn', carrier: 'both',
        message: `Length + girth is ${lengthPlusGirthIn}", within ${inches(rules.largeLengthPlusGirthIn - lengthPlusGirthIn)}" of the 130" Large Package threshold.`,
        marginIn: inches(rules.largeLengthPlusGirthIn - lengthPlusGirthIn),
      });
    }

    if (cubicIn > rules.largeCubicIn * PROXIMITY.cubicWarnFraction) {
      out.push({
        id: 'cubic-warn', level: 'warn', carrier: 'both',
        message: `Cubic volume is ${Math.round(cubicIn).toLocaleString()} in³, close to the 17,280 in³ Large Package trigger. This one is easy to miss — it fires even when length + girth is fine.`,
        marginIn: null,
      });
    }
  }

  if (longestIn <= rules.ahLongestIn && longestIn > PROXIMITY.longestWarnFrom) {
    out.push({
      id: 'longest-warn',
      level: longestIn > PROXIMITY.longestCriticalFrom ? 'critical' : 'warn',
      carrier: 'both',
      message: `Longest side is ${longestIn}", within ${inches(rules.ahLongestIn - longestIn)}" of the 48" Additional Handling threshold.`,
      marginIn: inches(rules.ahLongestIn - longestIn),
    });
  }

  if (anyLarge && !anyOverMax) {
    const lpgMargin = inches(rules.maxLengthPlusGirthIn - lengthPlusGirthIn);
    if (lpgMargin <= PROXIMITY.overMaxWarnMarginIn) {
      out.push({
        id: 'overmax-near',
        level: lpgMargin <= PROXIMITY.overMaxCriticalMarginIn ? 'critical' : 'warn',
        carrier: 'both',
        message: `Length + girth is ${lengthPlusGirthIn}", only ${lpgMargin}" under the 165" limit. Past that the carriers refuse the package or bill $1,875.`,
        marginIn: lpgMargin,
      });
    }
  }

  if (packing.belowClearance) {
    out.push({
      id: 'below-clearance', level: 'critical', carrier: 'both',
      message: `Packing is under the ${MIN_CLEARANCE_IN}" minimum clearance — there is no room for the box wall.`,
      marginIn: null,
    });
  } else if (packing.belowMin) {
    out.push({
      id: 'below-min', level: 'warn', carrier: 'both',
      message: `${packing.thicknessIn}" per side is below the ${packing.material.label} minimum for this protection level. The box may be under the surcharge limit, but the contents are under-protected.`,
      marginIn: null,
    });
  }

  // Carrier divergence is money on the table.
  const upsClass = carriers.ups.sizeClass;
  const fedexClass = carriers.fedex.sizeClass;
  if (upsClass !== fedexClass) {
    const cheaper = CLASS_RANK[upsClass] < CLASS_RANK[fedexClass] ? carriers.ups : carriers.fedex;
    out.push({
      id: 'carrier-divergence', level: 'info', carrier: 'both',
      message: `${cheaper.label} classifies this box lower (${LABELS[cheaper.sizeClass]}) than the other carrier. Compare live rates before choosing.`,
      marginIn: null,
    });
  }

  const order: Record<WarnLevel, number> = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

const CLASS_RANK: Record<SizeClass, number> = {
  STANDARD: 0,
  ADDITIONAL_HANDLING: 1,
  LARGE_PACKAGE: 2,
  OVER_MAX: 3,
};

export const LABELS: Record<SizeClass, string> = {
  STANDARD: 'Standard parcel',
  ADDITIONAL_HANDLING: 'Additional Handling',
  LARGE_PACKAGE: 'Large Package / Oversize',
  OVER_MAX: 'Over maximum — freight only',
};

/** Worst (most expensive) classification across the carriers. */
export function worstClassOf(carriers: Record<ParcelCarrier, CarrierAssessment>): SizeClass {
  return PARCEL_CARRIERS
    .map((c) => carriers[c].sizeClass)
    .reduce((worst, cls) => (CLASS_RANK[cls] > CLASS_RANK[worst] ? cls : worst), 'STANDARD' as SizeClass);
}

// ──────────────────────────────── Freight ──────────────────────────────────

/**
 * LTL freight fallback. Structural triggers always evaluate; the >$400 rule
 * only once a live rate exists, so the UI can say so instead of skipping it.
 */
export function recommendFreight(
  carriers: Record<ParcelCarrier, CarrierAssessment>,
  actualWeightLbs: number,
  parcelCostUSD?: number
): FreightRecommendation {
  const reasons: string[] = [];
  const worst = worstClassOf(carriers);

  if (worst === 'OVER_MAX') {
    reasons.push('Exceeds parcel limits at both carriers — freight is the only option.');
  } else if (worst === 'LARGE_PACKAGE' && actualWeightLbs < FREIGHT_LIGHT_LARGE_WEIGHT_LBS) {
    reasons.push(
      `Large Package on a ${actualWeightLbs} lb item: the 90 lb minimum billing plus the surcharge is disproportionate. LTL freight is often far cheaper for light bulky goods.`
    );
  }

  const costKnown = typeof parcelCostUSD === 'number' && Number.isFinite(parcelCostUSD);
  if (costKnown && (parcelCostUSD as number) > FREIGHT_PARCEL_COST_USD) {
    reasons.push(`Live parcel rate of ${money(parcelCostUSD as number)} is over the ${money(FREIGHT_PARCEL_COST_USD)} freight-comparison threshold.`);
  }

  return {
    recommended: reasons.length > 0,
    reasons,
    needsLiveRate: !costKnown && worst === 'LARGE_PACKAGE',
  };
}

// ─────────────────────────────── Suggestions ───────────────────────────────

export type SuggestionKind =
  | 'reduce-padding'
  | 'reallocate-padding'
  | 'shave-dim'
  | 'switch-carrier'
  | 'split-shipment'
  | 'freight'
  | 'diagonal-fit';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  label: string;
  detail: string;
  /** false = the math says this cannot get under the threshold. */
  achievable: boolean;
  savings: FeeRange | null;
}

/**
 * Largest uniform per-side thickness that keeps length + girth at or under
 * `limitIn`. Closed form: uniform padding preserves the sort order, so
 * L+G grows exactly 10× per inch of padding — no search needed.
 */
export function maxThicknessForLengthPlusGirth(item: Dims, limitIn = 130): number {
  const bare = measureParcel(item).lengthPlusGirthIn;
  return Math.max(0, (limitIn - bare) / LPG_PER_INCH_OF_PADDING);
}

/** Largest uniform per-side thickness keeping the longest side at or under `limitIn`. */
export function maxThicknessForLongest(item: Dims, limitIn = 48): number {
  const bare = measureParcel(item).longestIn;
  return Math.max(0, (limitIn - bare) / 2);
}

/** The safe-pad number: min of both limits, snapped DOWN to a practical 0.25". */
export function maxSafeThickness(item: Dims): number {
  const t = Math.min(
    maxThicknessForLengthPlusGirth(item, CARRIER_RULES.ups.largeLengthPlusGirthIn),
    maxThicknessForLongest(item, CARRIER_RULES.ups.largeLongestIn)
  );
  return Math.max(0, Math.floor(t * 4) / 4);
}

/**
 * Inches to shave off the LONGEST gross dimension to reach `target`, or null.
 *
 * Scans rather than inverting a formula: L+G drops 1" per inch shaved only
 * while that axis stays longest. Once it drops below the second-longest side,
 * further shaving comes off a girth term and drops L+G at 2" per inch. A
 * closed form would get that piecewise boundary wrong.
 */
export function shaveToReachClass(
  gross: Dims,
  weightLbs: number,
  carrier: ParcelCarrier,
  target: SizeClass,
  opts: { maxShaveIn?: number; stepIn?: number } = {}
): number | null {
  const step = opts.stepIn ?? 0.25;
  const cap = opts.maxShaveIn ?? 12;
  const sorted = [gross.lengthIn, gross.widthIn, gross.heightIn].sort((a, b) => b - a);
  const longest = sorted[0];

  for (let d = step; d <= Math.min(cap, longest - 1); d = inches(d + step)) {
    const candidate: Dims = { lengthIn: inches(longest - d), widthIn: sorted[1], heightIn: sorted[2] };
    const cls = assessCarrier(candidate, weightLbs, carrier).sizeClass;
    if (CLASS_RANK[cls] <= CLASS_RANK[target]) return d;
  }
  return null;
}

/**
 * Shift a fixed padding budget toward the long axis, where it costs half as
 * much length+girth. Returns the resulting per-axis padding and L+G.
 */
export function reallocatePadding(
  item: Dims,
  uniformThicknessIn: number,
  minPerSideIn: number
): { longestIn: number; othersIn: number; lengthPlusGirthIn: number } {
  const t = Math.max(0, uniformThicknessIn);
  const floor = Math.max(0, Math.min(minPerSideIn, t));
  // Total per-side material budget across the three axes, held constant.
  const budget = 3 * t;
  const others = floor;
  const longest = Math.max(floor, budget - 2 * others);
  const m = measureParcel(item);
  const lpg = m.lengthPlusGirthIn + 2 * longest + 4 * others + 4 * others;
  return { longestIn: inches(longest), othersIn: inches(others), lengthPlusGirthIn: inches(lpg) };
}

function rangeDelta(a: FeeRange, b: FeeRange): FeeRange | null {
  const min = cents(a.minUSD - b.minUSD);
  const max = cents(a.maxUSD - b.maxUSD);
  if (min <= 0 && max <= 0) return null;
  return { minUSD: Math.max(0, min), maxUSD: Math.max(0, max) };
}

function totalAcross(carriers: Record<ParcelCarrier, CarrierAssessment>): FeeRange {
  // Cheapest carrier is what the shop would actually pick.
  return PARCEL_CARRIERS
    .map((c) => carriers[c].surchargeTotal)
    .reduce((best, r) => (r.minUSD < best.minUSD ? r : best));
}

function assessAll(
  gross: Dims,
  weightLbs: number,
  opts: { peak?: boolean; residential?: boolean; nonStandardPackaging?: boolean }
): Record<ParcelCarrier, CarrierAssessment> {
  return {
    ups: assessCarrier(gross, weightLbs, 'ups', opts),
    fedex: assessCarrier(gross, weightLbs, 'fedex', opts),
  };
}

/**
 * Ranked fix list. Every suggestion is validated by re-running the real
 * assessment on the modified box, so a promised class is the class the tool
 * would actually report.
 *
 * Deliberately absent: "re-orient the box". Every threshold is a symmetric
 * function of the sorted dimensions, and the algorithm sorts first, so
 * relabelling axes cannot change any result. Padding reallocation is the real
 * version of that idea.
 */
export function buildSuggestions(
  input: BoxCalcInput,
  packing: ResolvedPacking,
  gross: Dims,
  carriers: Record<ParcelCarrier, CarrierAssessment>
): Suggestion[] {
  const out: Suggestion[] = [];
  const worst = worstClassOf(carriers);
  if (worst === 'STANDARD') return out;

  const weight = Math.max(0, Number(input.weightLbs) || 0);
  const opts = {
    peak: isPeakSeason(input.onDate),
    residential: input.residential,
    nonStandardPackaging: input.nonStandardPackaging,
  };
  const currentTotal = totalAcross(carriers);
  const floor = Math.max(packing.material.minThicknessIn, PACKING_PRESETS[input.profile].minThicknessIn);

  // 1. Thinner padding — only down to the material minimum, never below.
  const safeT = maxSafeThickness(input.item);
  if (safeT < packing.thicknessIn && safeT >= floor) {
    const candidate = grossDims(input.item, safeT);
    const after = assessAll(candidate, weight, opts);
    if (CLASS_RANK[worstClassOf(after)] < CLASS_RANK[worst]) {
      out.push({
        id: 'reduce-padding',
        kind: 'reduce-padding',
        label: `Drop to ${safeT}" of padding per side`,
        detail: `Still at or above the ${packing.material.label} minimum of ${floor}". Box becomes ${candidate.lengthIn}" × ${candidate.widthIn}" × ${candidate.heightIn}" → ${LABELS[worstClassOf(after)]}.`,
        achievable: true,
        savings: rangeDelta(currentTotal, totalAcross(after)),
      });
    }
  } else if (safeT < floor && packing.thicknessIn > 0) {
    out.push({
      id: 'padding-impossible',
      kind: 'reduce-padding',
      label: `Padding cannot be thinned enough`,
      detail: `Staying under the threshold would need ${safeT}" per side, below the ${floor}" minimum for ${packing.material.label}. Under-protecting the item is not worth the saving — look at a different box shape, splitting the shipment, or freight.`,
      achievable: false,
      savings: null,
    });
  }

  // 2. Reallocate the same material toward the long axis (costs half as much L+G).
  if (packing.thicknessIn > floor) {
    const re = reallocatePadding(input.item, packing.thicknessIn, floor);
    const m = measureParcel(gross);
    if (re.lengthPlusGirthIn < m.lengthPlusGirthIn - 0.5) {
      out.push({
        id: 'reallocate-padding',
        kind: 'reallocate-padding',
        label: `Put the thick padding on the long axis only`,
        detail: `Same amount of material: ${re.longestIn}" on the two long-axis ends, ${re.othersIn}" on the other four sides, brings length + girth from ${m.lengthPlusGirthIn}" to ~${re.lengthPlusGirthIn}". Padding a short side costs 4" of length + girth per inch; the long axis costs only 2".`,
        achievable: true,
        savings: null,
      });
    }
  }

  // 3. Shave the longest dimension.
  const targetClass: SizeClass = worst === 'OVER_MAX' ? 'LARGE_PACKAGE' : 'STANDARD';
  const shave = shaveToReachClass(gross, weight, 'ups', targetClass);
  if (shave !== null) {
    const achievableNow = shave <= 3;
    out.push({
      id: 'shave-dim',
      kind: 'shave-dim',
      label: `Lose ${shave}" off the longest side`,
      detail: achievableNow
        ? `A ${shave}" shorter box drops this to ${LABELS[targetClass]}. Usually possible with a tighter box or trimming the flap overhang.`
        : `Would need ${shave}" off the longest side — more than repacking realistically gets you. Consider splitting the shipment or freight.`,
      achievable: achievableNow,
      savings: null,
    });
  }

  // 4. Carrier divergence.
  if (carriers.ups.sizeClass !== carriers.fedex.sizeClass) {
    const cheaper = CLASS_RANK[carriers.ups.sizeClass] < CLASS_RANK[carriers.fedex.sizeClass]
      ? carriers.ups : carriers.fedex;
    out.push({
      id: 'switch-carrier',
      kind: 'switch-carrier',
      label: `Ship ${cheaper.label} — it classifies this box lower`,
      detail: `${cheaper.label}: ${LABELS[cheaper.sizeClass]}. Confirm with live rates, since the base rate may offset the difference.`,
      achievable: true,
      savings: null,
    });
  }

  // 5. Split — advisory; only a human knows if the contents divide.
  if (worst === 'LARGE_PACKAGE' || worst === 'OVER_MAX') {
    out.push({
      id: 'split-shipment',
      kind: 'split-shipment',
      label: 'Split into two smaller boxes',
      detail: 'Two standard parcels almost always beat one Large Package, because the surcharge and the 90 lb minimum billing apply per package. Only viable if the contents divide.',
      achievable: true,
      savings: null,
    });
  }

  // 6. Diagonal fit — rods, tubes, framed art only.
  const m = measureParcel(input.item);
  if (m.longestIn / Math.max(1, m.secondLongestIn) >= 4) {
    out.push({
      id: 'diagonal-fit',
      kind: 'diagonal-fit',
      label: 'Check a corner-to-corner (diagonal) fit',
      detail: `A rigid ${m.longestIn}" item fits diagonally in a shorter box: any box whose diagonal √(L²+W²+H²) is at least ${Math.ceil(m.longestIn)}" will take it. A ${Math.ceil(m.longestIn)}" rod fits a box ~${Math.ceil(m.longestIn * 0.93)}" long. Only for rigid, thin items.`,
      achievable: true,
      savings: null,
    });
  }

  return out.sort((a, b) => {
    if (a.achievable !== b.achievable) return a.achievable ? -1 : 1;
    const sa = a.savings?.minUSD ?? 0;
    const sb = b.savings?.minUSD ?? 0;
    return sb - sa;
  });
}

// ──────────────────────────────── Entry point ──────────────────────────────

const EMPTY_MEASURE = measureParcel({ lengthIn: 0, widthIn: 0, heightIn: 0 });

/**
 * The one function the UI calls. Pure, synchronous, and safe on partial input:
 * incomplete dimensions return `ok: false` rather than a misleading STANDARD.
 */
export function calculateBox(input: BoxCalcInput): BoxCalcResult {
  const packing = resolvePacking(input);
  const peak = isPeakSeason(input.onDate);
  const weight = Math.max(0, Number(input.weightLbs) || 0);

  const base: Omit<BoxCalcResult, 'carriers' | 'warnings' | 'suggestions' | 'freight' | 'worstClass'> = {
    ok: false,
    incompleteReason: null,
    item: input.item,
    packing,
    grossDims: grossDims(input.item, packing.thicknessIn),
    grossMeasure: EMPTY_MEASURE,
    isPeak: peak,
    feeScheduleYear: FEE_SCHEDULE_YEAR,
  };

  if (!hasUsableDims(input.item)) {
    const empty = assessAll({ lengthIn: 0, widthIn: 0, heightIn: 0 }, 0, {});
    return {
      ...base,
      incompleteReason: "Enter the item's bare length, width and height.",
      carriers: empty,
      worstClass: 'STANDARD',
      warnings: [],
      suggestions: [],
      freight: { recommended: false, reasons: [], needsLiveRate: false },
    };
  }

  if (weight <= 0) {
    const empty = assessAll({ lengthIn: 0, widthIn: 0, heightIn: 0 }, 0, {});
    return {
      ...base,
      incompleteReason: 'Enter the item weight — it drives dimensional weight and the weight-based surcharges.',
      carriers: empty,
      worstClass: 'STANDARD',
      warnings: [],
      suggestions: [],
      freight: { recommended: false, reasons: [], needsLiveRate: false },
    };
  }

  const gross = grossDims(input.item, packing.thicknessIn);
  const opts = { peak, residential: input.residential, nonStandardPackaging: input.nonStandardPackaging };
  const carriers = assessAll(gross, weight, opts);
  const grossMeasure = measureParcel(gross);

  return {
    ...base,
    ok: true,
    grossDims: gross,
    grossMeasure,
    carriers,
    worstClass: worstClassOf(carriers),
    warnings: thresholdWarnings(grossMeasure, carriers, packing, measureParcel(input.item)),
    suggestions: buildSuggestions(input, packing, gross, carriers),
    freight: recommendFreight(carriers, weight),
  };
}

/** Longest rigid item that fits a box corner-to-corner. Re-exported for the UI. */
export { diagonalIn };
