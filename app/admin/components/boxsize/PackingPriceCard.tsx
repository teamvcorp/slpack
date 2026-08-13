"use client";

import {
  PACKING_PRESETS,
  money,
  type PackingPrice,
  type PackingProfile,
} from '@/lib/boxOptimizer';
import { CARD, CARD_TITLE, CARD_SUB, NOTE } from './styles';

interface Props {
  price: PackingPrice;
  profile: PackingProfile;
  /** False until the item dimensions are complete. */
  ready: boolean;
}

const cent = (rate: number) => `${Math.round(rate * 100)}¢`;

/**
 * Shop packing charge, billed on the finished box's outside surface area.
 *
 * Both figures are shown deliberately: staff need the cost to know their
 * margin, and the retail price is the only number a customer should hear. The
 * cost is labelled and de-emphasised so the two never get confused at the
 * counter.
 */
export default function PackingPriceCard({ price, profile, ready }: Props) {
  if (!ready) return null;

  const preset = PACKING_PRESETS[profile];

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>Packing charge</h2>
      <p className={CARD_SUB}>
        {price.surfaceAreaIn2.toLocaleString()} sq in of box surface × {cent(price.ratePerSqIn)} per sq in
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-navy/15 bg-navy/5 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/40">
            Cost to shop
          </div>
          <div className="text-xl font-bold text-navy/70">{money(price.costUSD)}</div>
          <div className="text-[10px] text-navy/40">internal — do not quote</div>
        </div>
        <div className="rounded-xl border border-blue/30 bg-blue/5 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-blue">
            Charge customer
          </div>
          <div className="text-xl font-bold text-navy">{money(price.retailUSD)}</div>
          <div className="text-[10px] text-navy/40">cost × {price.retailMultiplier}</div>
        </div>
      </div>

      <ul className="mt-3 space-y-1 border-t border-navy/10 pt-3 text-[12px]">
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-navy/60">
            {preset.label} packing materials
            <span className="block text-[10px] text-navy/40">
              {cent(price.materialRatePerSqIn)}/sq in · {preset.description}
            </span>
          </span>
          <span className="shrink-0 font-semibold text-navy">{money(price.materialCostUSD)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-navy/60">
            Box construction
            <span className="block text-[10px] text-navy/40">{cent(price.boxRatePerSqIn)}/sq in</span>
          </span>
          <span className="shrink-0 font-semibold text-navy">{money(price.boxCostUSD)}</span>
        </li>
      </ul>

      <p className={NOTE}>
        Surface area is 2 × (L×W + L×H + W×H) of the finished box, so a thicker packing choice raises this
        charge as well as the box size. Packing is separate from postage — add it to the shipping rate,
        never in place of it.
      </p>
    </section>
  );
}
