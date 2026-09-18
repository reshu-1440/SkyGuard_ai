import React from 'react';
import { StationOperationalStatus } from '../types/api';

interface StationStatusProps {
  status: StationOperationalStatus | string;
  showDot?: boolean;
}

const STATUS_CONFIG: Record<string, { dot: string; text: string; border: string; bg: string }> = {
  ACTIVE:         { dot: '#10B981', text: '#6EE7B7', border: 'rgba(16,185,129,0.3)',  bg: 'rgba(16,185,129,0.08)' },
  DEGRADED:       { dot: '#F59E0B', text: '#FCD34D', border: 'rgba(245,158,11,0.3)',  bg: 'rgba(245,158,11,0.08)' },
  MAINTENANCE:    { dot: '#818CF8', text: '#C4B5FD', border: 'rgba(129,140,248,0.3)', bg: 'rgba(129,140,248,0.08)' },
  OFFLINE:        { dot: '#334155', text: '#475569', border: '#1F2D45',                bg: 'rgba(0,0,0,0.2)' },
  DECOMMISSIONED: { dot: '#1E293B', text: '#334155', border: '#152030',                bg: 'transparent' },
};

export const StationStatus: React.FC<StationStatusProps> = ({ status, showDot = true }) => {
  const cfg = STATUS_CONFIG[status] ?? { dot: '#334155', text: '#4A5B78', border: '#1F2D45', bg: 'rgba(0,0,0,0.2)' };

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase"
      style={{
        padding: '2px 8px',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.text,
        borderRadius: '2px',
        letterSpacing: '0.06em',
      }}
    >
      {showDot && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: cfg.dot }}
        />
      )}
      {status}
    </span>
  );
};
