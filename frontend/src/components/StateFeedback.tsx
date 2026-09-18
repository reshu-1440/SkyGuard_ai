import React from 'react';
import { AlertTriangle, DatabaseZap, RefreshCw } from 'lucide-react';

// Loading skeleton — animate-pulse is appropriate as it indicates loading state
export const LoadingSkeleton: React.FC<{ rows?: number; height?: string }> = ({
  rows = 4,
  height = 'h-8',
}) => (
  <div className="space-y-1.5 animate-pulse w-full">
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className={`w-full ${height}`}
        style={{ background: '#131C2E', border: '1px solid #152030', borderRadius: '2px' }}
      />
    ))}
  </div>
);

export const ErrorState: React.FC<{
  title?: string;
  message?: string;
  onRetry?: () => void;
}> = ({
  title = 'Service Communication Error',
  message = 'Failed to fetch telemetry data from backend API.',
  onRetry,
}) => (
  <div
    className="p-6 text-center my-4"
    style={{
      background: 'rgba(239,68,68,0.05)',
      border: '1px solid rgba(239,68,68,0.2)',
      borderLeft: '3px solid #EF4444',
      borderRadius: '2px',
    }}
  >
    <div
      className="inline-flex p-2.5 mb-3"
      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '2px' }}
    >
      <AlertTriangle className="w-5 h-5 text-red-400" />
    </div>
    <h3 className="font-semibold text-[14px]" style={{ color: '#E8EEF7' }}>{title}</h3>
    <p className="text-[12px] mt-1 max-w-md mx-auto" style={{ color: '#7B90B2' }}>{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] border text-slate-300 hover:text-slate-100 transition-colors"
        style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px' }}
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Retry Request
      </button>
    )}
  </div>
);

export const EmptyState: React.FC<{
  title?: string;
  message?: string;
}> = ({
  title = 'No Telemetry Available',
  message = 'No records match the selected operational filters or time window.',
}) => (
  <div
    className="p-8 text-center my-4"
    style={{ background: '#0D1420', border: '1px solid #1F2D45', borderRadius: '2px' }}
  >
    <div
      className="inline-flex p-2.5 mb-3"
      style={{ background: '#131C2E', border: '1px solid #1F2D45', borderRadius: '2px' }}
    >
      <DatabaseZap className="w-5 h-5" style={{ color: '#2A3E60' }} />
    </div>
    <h3 className="font-semibold text-[13px]" style={{ color: '#7B90B2' }}>{title}</h3>
    <p className="text-[12px] mt-1 max-w-md mx-auto" style={{ color: '#4A5B78' }}>{message}</p>
  </div>
);

// DegradedModeBanner — only rendered when WebSocket ML layer is degraded (state-driven)
export const DegradedModeBanner: React.FC = () => (
  <div
    className="px-4 py-2 flex items-center gap-2 text-[12px] border-b"
    style={{
      background: 'rgba(245,158,11,0.07)',
      borderColor: 'rgba(245,158,11,0.3)',
      borderLeft: '3px solid #F59E0B',
      color: '#FCD34D',
    }}
  >
    <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400" />
    <span>
      <strong>Degraded Operational Mode:</strong>{' '}
      <span style={{ color: '#94A3B8' }}>ML model inference unavailable — operating in rule-based fallback mode.</span>
    </span>
  </div>
);
