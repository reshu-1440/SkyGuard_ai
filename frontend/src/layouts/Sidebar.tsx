import React, { useState } from 'react';
import { NavLink, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useStations } from '../hooks/useStations';
import {
  Network,
  Activity,
  Radio,
  AlertTriangle,
  HeartPulse,
  GitCompare,
  History,
  Cpu,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

const navItems = [
  { to: '/network',     label: 'Network Overview',       icon: Network },
  { to: '/live',        label: 'Live Monitoring',         icon: Activity },
  {
    label: 'Station Details',
    icon: Radio,
    activeMatch: (pathname: string) => pathname.startsWith('/stations'),
    getDest: (defaultId: string) => defaultId ? `/stations/${defaultId}` : '/network',
  },
  {
    to: '/anomalies',
    label: 'Anomaly Investigation',
    icon: AlertTriangle,
    activeMatch: (pathname: string) => pathname.startsWith('/anomalies'),
  },
  { to: '/health',      label: 'Sensor Health',           icon: HeartPulse },
  { to: '/corrections', label: 'Correction Review',       icon: GitCompare },
  { to: '/history',     label: 'Historical Analysis',     icon: History },
  { to: '/system',      label: 'System Status',           icon: Cpu },
];

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const { data: stations = [] } = useStations();
  const navigate = useNavigate();
  const { stationId: routeStationId } = useParams<{ stationId?: string }>();
  const location = useLocation();

  const defaultStationId = stations.length > 0 ? stations[0].station_id : '';
  const activeStationId = routeStationId || defaultStationId;

  // Sort stations by health score ascending (most degraded first)
  const sortedStations = [...stations].sort((a, b) => {
    const healthA = a.latest_snapshot?.latest_health_score ?? 100;
    const healthB = b.latest_snapshot?.latest_health_score ?? 100;
    return healthA - healthB;
  });

  const getStationHealthColor = (score: number) => {
    if (score < 60) return { text: '#EF4444', bg: '#EF4444' };
    if (score < 85) return { text: '#F59E0B', bg: '#F59E0B' };
    return { text: '#10B981', bg: '#10B981' };
  };

  return (
    <aside
      style={{
        background: '#090D14',
        borderRight: '1px solid #1F2D45',
        width: collapsed ? '44px' : '220px',
        transition: 'width 200ms ease',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 48px - 36px)', // account for h-12 TopBar + banner
        zIndex: 20,
      }}
    >
      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <div className="px-1.5 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const to = 'getDest' in item ? item.getDest!(activeStationId) : (item.to ?? '/network');
            const isMatch = item.activeMatch
              ? item.activeMatch(location.pathname)
              : location.pathname === item.to;

            return (
              <NavLink
                key={item.label}
                to={to}
                title={collapsed ? item.label : undefined}
                className="flex items-center gap-2.5 px-2.5 py-2 text-[12px] font-medium transition-colors no-underline"
                style={() => ({
                  borderLeft: isMatch ? '2px solid #38BDF8' : '2px solid transparent',
                  background: isMatch ? 'rgba(56,189,248,0.08)' : 'transparent',
                  color: isMatch ? '#E8EEF7' : '#4A5B78',
                  borderRadius: '2px',
                })}
                onMouseEnter={(e) => {
                  if (!isMatch) {
                    (e.currentTarget as HTMLElement).style.color = '#94A3B8';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isMatch) {
                    (e.currentTarget as HTMLElement).style.color = '#4A5B78';
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }
                }}
              >
                <Icon
                  className="flex-shrink-0"
                  size={15}
                  color={isMatch ? '#38BDF8' : '#4A5B78'}
                />
                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
              </NavLink>
            );
          })}
        </div>

        {/* Station roster — severity-sorted quick navigation */}
        {!collapsed && sortedStations.length > 0 && (
          <div className="mt-3 px-1.5">
            {/* Section header */}
            <div
              className="flex items-center justify-between px-2 pb-1.5 pt-2 border-t"
              style={{ borderColor: '#1F2D45' }}
            >
              <span
                className="font-mono text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: '#2A3E60', letterSpacing: '0.1em' }}
              >
                Stations ({sortedStations.length})
              </span>
              <span
                className="font-mono text-[10px]"
                style={{ color: '#2A3E60' }}
              >
                Health
              </span>
            </div>

            <div className="space-y-px max-h-52 overflow-y-auto">
              {sortedStations.map((stn) => {
                const score = stn.latest_snapshot?.latest_health_score ?? 100;
                const anomCount = stn.latest_snapshot?.active_anomaly_count_24h ?? 0;
                const isSelected = activeStationId === stn.station_id && location.pathname.startsWith('/stations');
                const { text: scoreColor, bg: dotColor } = getStationHealthColor(score);

                return (
                  <button
                    key={stn.station_id}
                    onClick={() => navigate(`/stations/${stn.station_id}`)}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-left text-[11px] font-mono transition-colors"
                    style={{
                      borderLeft: isSelected ? '2px solid #38BDF8' : '2px solid transparent',
                      background: isSelected ? 'rgba(56,189,248,0.06)' : 'transparent',
                      color: isSelected ? '#E8EEF7' : '#4A5B78',
                      borderRadius: '2px',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        (e.currentTarget as HTMLElement).style.color = '#7B90B2';
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        (e.currentTarget as HTMLElement).style.color = '#4A5B78';
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      {/* Status dot — color communicates health tier, no animation */}
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: dotColor }}
                      />
                      <span className="truncate">{stn.station_id}</span>
                      {/* Anomaly count badge — shown only when non-zero */}
                      {anomCount > 0 && (
                        <span
                          className="px-1 text-[9px] font-bold flex-shrink-0"
                          style={{
                            background: 'rgba(239,68,68,0.12)',
                            color: '#FCA5A5',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: '2px',
                          }}
                        >
                          {anomCount}
                        </span>
                      )}
                    </div>
                    <span className="font-semibold flex-shrink-0 ml-1" style={{ color: scoreColor }}>
                      {Math.round(score)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Collapse toggle */}
      <div
        className="flex-shrink-0 p-2 border-t"
        style={{ borderColor: '#1F2D45', background: '#090D14' }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-1.5 transition-colors"
          style={{ borderRadius: '2px', color: '#2A3E60' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#4A5B78')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#2A3E60')}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <PanelLeftOpen className="w-4 h-4" />
            : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
};
