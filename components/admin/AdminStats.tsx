'use client';

import { type ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminStatsProps {
  /** Short label displayed above the value (e.g. "Total Users") */
  title: string;
  /** The primary metric value (e.g. "12,482" or "$34.5K") */
  value: string | number;
  /** Trend percentage — positive = up / green, negative = down / red */
  trend?: number;
  /** Optional label next to the trend arrow (e.g. "vs last month") */
  trendLabel?: string;
  /** Lucide icon or any ReactNode shown top-left */
  icon?: ReactNode;
  /** Accent color for the icon background. Defaults to the brand lime. */
  color?: 'lime' | 'blue' | 'red' | 'amber' | 'emerald';
}

// ---------------------------------------------------------------------------
// Color map for the icon container
// ---------------------------------------------------------------------------

const iconColorClasses: Record<NonNullable<AdminStatsProps['color']>, string> = {
  lime: 'bg-[#cbfb45]/15 text-[#6d8a14]',
  blue: 'bg-blue-50 text-blue-600',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminStats({
  title,
  value,
  trend,
  trendLabel,
  icon,
  color = 'lime',
}: AdminStatsProps) {
  const isPositive = trend !== undefined && trend >= 0;
  const hasTrend = trend !== undefined && trend !== null;

  return (
    <div
      className="
        group rounded-xl border border-[#E2E8F0] bg-white p-6
        transition-shadow duration-200 hover:shadow-lg
      "
    >
      {/* ---- Top row: icon ---- */}
      <div className="flex items-center justify-between">
        {icon && (
          <div
            className={`
              flex h-10 w-10 items-center justify-center rounded-lg
              ${iconColorClasses[color]}
            `}
          >
            {icon}
          </div>
        )}

        {/* ---- Trend badge ---- */}
        {hasTrend && (
          <span
            className={`
              inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium
              ${
                isPositive
                  ? 'bg-emerald-50 text-[#059669]'
                  : 'bg-red-50 text-[#DC2626]'
              }
            `}
          >
            {isPositive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {Math.abs(trend)}%
          </span>
        )}
      </div>

      {/* ---- Value ---- */}
      <p className="mt-4 text-2xl font-bold tracking-tight text-[#0c0c0c]">
        {value}
      </p>

      {/* ---- Title + trend label ---- */}
      <div className="mt-1 flex items-center gap-2">
        <p className="text-sm text-[#6c6a68]">{title}</p>
        {hasTrend && trendLabel && (
          <span className="text-xs text-[#6c6a68]/70">{trendLabel}</span>
        )}
      </div>
    </div>
  );
}
