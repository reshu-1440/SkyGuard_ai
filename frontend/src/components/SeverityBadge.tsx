import React from 'react';
import { AlertSeverity } from '../types/api';

interface SeverityBadgeProps {
  severity: AlertSeverity | string;
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity }) => {
  let styles = 'bg-slate-800 text-slate-300 border-slate-700';

  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
      styles = 'bg-red-950/70 text-red-400 border-red-800/80 font-semibold';
      break;
    case 'HIGH':
      styles = 'bg-orange-950/70 text-orange-400 border-orange-800/80 font-semibold';
      break;
    case 'MEDIUM':
      styles = 'bg-amber-950/70 text-amber-400 border-amber-800/80';
      break;
    case 'LOW':
      styles = 'bg-sky-950/70 text-sky-400 border-sky-800/80';
      break;
    case 'INFO':
    case 'NOMINAL':
      styles = 'bg-slate-900 text-slate-400 border-slate-800';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono tracking-wider uppercase border ${styles}`}
      style={{ borderRadius: '2px' }}
    >
      {severity}
    </span>
  );
};
