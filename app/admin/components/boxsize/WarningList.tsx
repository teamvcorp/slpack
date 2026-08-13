"use client";

import type { ThresholdWarning } from '@/lib/boxOptimizer';
import { BANNER_CRITICAL, BANNER_WARN, BANNER_INFO } from './styles';

const STYLE: Record<ThresholdWarning['level'], string> = {
  critical: BANNER_CRITICAL,
  warn: BANNER_WARN,
  info: BANNER_INFO,
};

const ICON: Record<ThresholdWarning['level'], string> = {
  critical: '⚠',
  warn: '⚠',
  info: 'ℹ',
};

/** Threshold-proximity and packing warnings, most severe first. */
export default function WarningList({ warnings }: { warnings: ThresholdWarning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <div key={w.id} className={STYLE[w.level]}>
          <span className="mr-1.5 font-semibold">{ICON[w.level]}</span>
          {w.message}
        </div>
      ))}
    </div>
  );
}
