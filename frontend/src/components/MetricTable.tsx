import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { LoadingSkeleton, EmptyState } from './StateFeedback';

export interface ColumnDef<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

interface MetricTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  selectedRowId?: string;
  rowIdKey?: keyof T;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (key: string) => void;
}

export function MetricTable<T>({
  columns,
  data,
  isLoading = false,
  emptyMessage = 'No telemetry records found.',
  onRowClick,
  selectedRowId,
  rowIdKey,
  sortColumn,
  sortDirection,
  onSort,
}: MetricTableProps<T>) {
  if (isLoading) {
    return <LoadingSkeleton rows={5} height="h-10" />;
  }

  if (data.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div
      className="w-full overflow-x-auto"
      style={{ background: '#0D1420', border: '1px solid #1F2D45', borderRadius: '2px' }}
    >
      <table className="w-full text-left border-collapse">
        <thead>
          <tr style={{ background: '#090D14', borderBottom: '1px solid #1F2D45' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.sortable ? 'cursor-pointer select-none' : ''}
                style={{
                  padding: '7px 12px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '10px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: col.sortable && sortColumn === col.key ? '#38BDF8' : '#2A3E60',
                  textAlign: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => col.sortable && onSort && onSort(col.key)}
              >
                <span className="inline-flex items-center gap-1" style={{
                  justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start',
                }}>
                  {col.header}
                  {col.sortable && sortColumn === col.key && (
                    sortDirection === 'asc'
                      ? <ChevronUp className="w-3 h-3 text-ops-weather" />
                      : <ChevronDown className="w-3 h-3 text-ops-weather" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const rowId = rowIdKey ? String(row[rowIdKey]) : String(idx);
            const isSelected = selectedRowId === rowId;

            return (
              <tr
                key={rowId}
                onClick={() => onRowClick && onRowClick(row)}
                style={{
                  borderBottom: idx < data.length - 1 ? '1px solid #152030' : 'none',
                  borderLeft: isSelected ? '2px solid #38BDF8' : '2px solid transparent',
                  background: isSelected ? 'rgba(56,189,248,0.05)' : 'transparent',
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background 120ms ease',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#131C2E';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: '8px 12px',
                      fontSize: '12px',
                      color: '#E8EEF7',
                      textAlign: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left',
                      fontFamily: col.align === 'right' ? "'JetBrains Mono', monospace" : undefined,
                    }}
                  >
                    {col.render
                      ? col.render(row)
                      : String((row as Record<string, unknown>)[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
