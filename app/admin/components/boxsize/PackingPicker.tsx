"use client";

import { PACKING_MATERIALS, PACKING_PRESETS, type PackingMaterialKey, type PackingProfile } from '@/lib/boxOptimizer';
import { CARD, CARD_TITLE, CARD_SUB, LABEL, INPUT, HELP } from './styles';
import type { BoxFormState } from './formState';

interface Props {
  value: BoxFormState;
  onChange: (patch: Partial<BoxFormState>) => void;
  /** Largest per-side thickness that still clears the Large Package cliff. */
  maxSafeIn: number;
}

const PROFILES: PackingProfile[] = ['light', 'standard', 'fragile'];
const MATERIAL_KEYS = Object.keys(PACKING_MATERIALS) as PackingMaterialKey[];

/**
 * Protection level → material + per-side thickness, with an override.
 *
 * Picking a preset resets `thicknessTouched` so the preset's number wins;
 * editing the number sets it, after which changing material no longer clobbers
 * the operator's value.
 */
export default function PackingPicker({ value, onChange, maxSafeIn }: Props) {
  const material = PACKING_MATERIALS[value.material];

  function pickProfile(profile: PackingProfile) {
    const preset = PACKING_PRESETS[profile];
    onChange({
      profile,
      material: preset.material,
      thicknessIn: String(preset.thicknessIn),
      thicknessTouched: false,
    });
  }

  function pickMaterial(key: PackingMaterialKey) {
    const patch: Partial<BoxFormState> = { material: key };
    if (!value.thicknessTouched) {
      patch.thicknessIn = String(PACKING_MATERIALS[key].recommendedThicknessIn);
    }
    onChange(patch);
  }

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>Packing</h2>
      <p className={CARD_SUB}>Thickness is per side — it is added to both ends of every dimension.</p>

      <div className="mt-4 space-y-4">
        <div>
          <label className={LABEL}>Protection level</label>
          <div className="grid grid-cols-3 gap-2">
            {PROFILES.map((p) => {
              const preset = PACKING_PRESETS[p];
              const active = value.profile === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => pickProfile(p)}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? 'border-blue bg-blue text-white'
                      : 'border-navy/20 text-navy/70 hover:bg-cream'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <p className={HELP}>{PACKING_PRESETS[value.profile].description}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Material</label>
            <select
              className={INPUT}
              value={value.material}
              onChange={(e) => pickMaterial(e.target.value as PackingMaterialKey)}
            >
              {MATERIAL_KEYS.map((k) => (
                <option key={k} value={k}>{PACKING_MATERIALS[k].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Thickness per side (in)</label>
            <input
              className={INPUT}
              type="number" min="0" step="0.25" inputMode="decimal"
              value={value.thicknessIn}
              onChange={(e) => onChange({ thicknessIn: e.target.value, thicknessTouched: true })}
            />
          </div>
        </div>

        <p className={HELP}>
          {material.label}: minimum {material.minThicknessIn}&quot;, recommended{' '}
          {material.recommendedThicknessIn}&quot; per side.
          {material.note ? ` ${material.note}` : ''}
        </p>

        {maxSafeIn > 0 && (
          <p className="rounded-lg bg-navy/5 px-3 py-2 text-[12px] leading-relaxed text-navy/60">
            <strong className="text-navy">Up to {maxSafeIn}&quot; per side</strong> keeps this item under
            the Large Package threshold. Every 1&quot; of padding adds 10&quot; to length + girth.
          </p>
        )}
      </div>
    </section>
  );
}
