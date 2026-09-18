import {
  CSVDatasetPreview,
  DataSourceType,
  ProviderInfo,
  RunContext,
  RunHistoryItem,
  RunMode,
} from '../types/runtime';

const API_BASE = '/api/v1/runtime';

export async function fetchActiveRunContext(): Promise<RunContext> {
  const res = await fetch(`${API_BASE}/context`);
  if (!res.ok) {
    throw new Error(`Failed to fetch RunContext: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  const res = await fetch(`${API_BASE}/providers`);
  if (!res.ok) {
    throw new Error(`Failed to fetch providers: ${res.statusText}`);
  }
  return res.json();
}

export async function selectDataSource(
  sourceType: DataSourceType,
  mode: RunMode,
  datasetId?: string,
  config?: Record<string, any>
): Promise<RunContext> {
  const res = await fetch(`${API_BASE}/source/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_type: sourceType,
      mode,
      dataset_id: datasetId,
      config,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Failed to select data source');
  }
  return res.json();
}

export async function startRun(): Promise<RunContext> {
  const res = await fetch(`${API_BASE}/run/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start run');
  return res.json();
}

export async function pauseRun(): Promise<RunContext> {
  const res = await fetch(`${API_BASE}/run/pause`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to pause run');
  return res.json();
}

export async function resetRun(): Promise<RunContext> {
  const res = await fetch(`${API_BASE}/run/reset`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reset run');
  return res.json();
}

export async function setReplaySpeed(speed: number): Promise<RunContext> {
  const res = await fetch(`${API_BASE}/run/speed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speed }),
  });
  if (!res.ok) throw new Error('Failed to set replay speed');
  return res.json();
}


export async function uploadCsvPreview(file: File): Promise<CSVDatasetPreview> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/csv/preview`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Failed to preview CSV');
  }
  return res.json();
}

export async function fetchRunHistory(): Promise<RunHistoryItem[]> {
  const res = await fetch(`${API_BASE}/history`);
  if (!res.ok) throw new Error('Failed to fetch run history');
  return res.json();
}
