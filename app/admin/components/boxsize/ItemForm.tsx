"use client";

import { CARD, CARD_TITLE, CARD_SUB, LABEL, INPUT, HELP, CHECKBOX, CHECKBOX_ROW } from './styles';
import type { BoxFormState } from './formState';

interface Props {
  value: BoxFormState;
  onChange: (patch: Partial<BoxFormState>) => void;
}

/**
 * Bare-item measurements. NOTE the inputs are the ITEM, not the box — the
 * packing allowance is added downstream. Every other form in this app takes
 * final package dimensions, so the labels say "bare item" explicitly.
 */
export default function ItemForm({ value, onChange }: Props) {
  const isCylinder = value.shape === 'cylinder';

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>Item</h2>
      <p className={CARD_SUB}>Measure the bare item — packing is added below.</p>

      <div className="mt-4 space-y-4">
        <div>
          <label className={LABEL}>Shape</label>
          <select
            className={INPUT}
            value={value.shape}
            onChange={(e) => onChange({ shape: e.target.value as BoxFormState['shape'] })}
          >
            <option value="box">Rectangular</option>
            <option value="cylinder">Cylinder / tube / rolled</option>
          </select>
          <p className={HELP}>
            Irregular items: use the smallest box that would contain the item, and measure the widest
            protrusion — not the body.
          </p>
        </div>

        {isCylinder ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Length (in)</label>
              <input
                className={INPUT}
                type="number" min="0" step="0.25" inputMode="decimal"
                value={value.lengthIn}
                onChange={(e) => onChange({ lengthIn: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL}>Diameter (in)</label>
              <input
                className={INPUT}
                type="number" min="0" step="0.25" inputMode="decimal"
                value={value.diameterIn}
                onChange={(e) => onChange({ diameterIn: e.target.value })}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL}>Length (in)</label>
              <input
                className={INPUT}
                type="number" min="0" step="0.25" inputMode="decimal"
                value={value.lengthIn}
                onChange={(e) => onChange({ lengthIn: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL}>Width (in)</label>
              <input
                className={INPUT}
                type="number" min="0" step="0.25" inputMode="decimal"
                value={value.widthIn}
                onChange={(e) => onChange({ widthIn: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL}>Height (in)</label>
              <input
                className={INPUT}
                type="number" min="0" step="0.25" inputMode="decimal"
                value={value.heightIn}
                onChange={(e) => onChange({ heightIn: e.target.value })}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Weight (lbs)</label>
            <input
              className={INPUT}
              type="number" min="0" step="0.1" inputMode="decimal"
              value={value.weightLbs}
              onChange={(e) => onChange({ weightLbs: e.target.value })}
            />
            <p className={HELP}>Packed weight, including the box.</p>
          </div>
          <div>
            <label className={LABEL}>Destination ZIP</label>
            <input
              className={INPUT}
              type="text" inputMode="numeric" maxLength={10} placeholder="Optional"
              value={value.destZip}
              onChange={(e) => onChange({ destZip: e.target.value })}
            />
            <p className={HELP}>Only needed for live rates.</p>
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <label className={CHECKBOX_ROW}>
            <input
              className={CHECKBOX}
              type="checkbox"
              checked={value.residential}
              onChange={(e) => onChange({ residential: e.target.checked })}
            />
            Residential delivery
          </label>
          <label className={CHECKBOX_ROW}>
            <input
              className={CHECKBOX}
              type="checkbox"
              checked={value.nonStandardPackaging}
              onChange={(e) => onChange({ nonStandardPackaging: e.target.checked })}
            />
            Not a plain corrugated box
          </label>
          <p className={HELP}>
            Tick the second box for wood, metal, hard plastic, drums or tyres, anything banded with metal
            or plastic strapping, or anything with wheels, handles or straps — each triggers Additional
            Handling on its own.
          </p>
        </div>
      </div>
    </section>
  );
}
