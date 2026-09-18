import React from 'react';
import { AnomalyEventRecord } from '../types/api';
import { SeverityBadge } from './SeverityBadge';
import { LoadingSkeleton, EmptyState } from './StateFeedback';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface AlertListProps {
  anomalies: AnomalyEventRecord[];
  isLoading?: boolean;
  limit?: number;
}

export const AlertList: React.FC<AlertListProps> = ({
  anomalies,
  isLoading = false,
  limit = 10,
}) => {
  const navigate = useNavigate();

  if (isLoading) {
    return <LoadingSkeleton rows={4} height="h-12" />;
  }

  const displayed = anomalies.slice(0, limit);

  if (displayed.length === 0) {
    return <EmptyState title="No Active Anomaly Events" message="All station sensors operating within nominal limits." />;
  }

  return (
    <div style={{ borderRadius: '0' }}>
      {displayed.map((anom, idx) => {
        // Severity stripe color
        const sev = (anom.severity || '').toLowerCase();
        const stripeColor = sev === 'critical' ? '#EF4444'
          : sev === 'high' ? '#F97316'
          : sev === 'medium' ? '#F59E0B'
          : '#60A5FA';

        return (
          <div
            key={anom.event_id}
            onClick={() => navigate(`/anomalies/${anom.event_id}`)}
            className="flex items-center justify-between gap-3 cursor-pointer transition-colors"
            style={{
              padding: '10px 12px',
              borderBottom: idx < displayed.length - 1 ? '1px solid #152030' : 'none',
              borderLeft: `2px solid ${stripeColor}`,
              background: 'transparent',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#131C2E')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <SeverityBadge severity={anom.severity} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-[12px]" style={{ color: '#E8EEF7' }}>
                    {anom.station_id}
                  </span>
                  <span className="font-mono text-[10px]" style={{ color: '#4A5B78' }}>
                    {anom.decision}
                  </span>
                </div>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: '#7B90B2', maxWidth: '280px' }}>
                  {anom.explanation_summary}
                </p>
                <div className="flex items-center gap-2 mt-1 font-mono text-[10px]" style={{ color: '#2A3E60' }}>
                  <span>{new Date(anom.timestamp).toISOString().substring(0, 19)}Z</span>
                  <span style={{ color: '#1F2D45' }}>·</span>
                  <span className="truncate">ID: {anom.event_id}</span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: '#2A3E60' }} />
          </div>
        );
      })}
    </div>
  );
};
