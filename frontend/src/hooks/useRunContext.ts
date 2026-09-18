import { useCallback, useEffect, useState } from 'react';
import {
  fetchActiveRunContext,
  pauseRun,
  resetRun,
  selectDataSource,
  setReplaySpeed,
  startRun,
} from '../api/runtime';
import { DataSourceType, RunContext, RunMode } from '../types/runtime';

export function useRunContext() {
  const [context, setContext] = useState<RunContext | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshContext = useCallback(async () => {
    try {
      const data = await fetchActiveRunContext();
      setContext(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error loading RunContext');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshContext();
    // Adaptive polling: 1.5s when active running/replaying, 4s when idle/paused
    const isRunning = context?.status === 'RUNNING';
    const intervalMs = isRunning ? 1500 : 4000;
    const interval = setInterval(refreshContext, intervalMs);
    return () => clearInterval(interval);
  }, [refreshContext, context?.status]);

  const handleSelectSource = async (
    sourceType: DataSourceType,
    mode: RunMode,
    datasetId?: string
  ) => {
    try {
      const newCtx = await selectDataSource(sourceType, mode, datasetId);
      setContext(newCtx);
      return newCtx;
    } catch (err: any) {
      setError(err.message || 'Failed to select data source');
      throw err;
    }
  };

  const handleStart = async () => {
    const updated = await startRun();
    setContext(updated);
  };

  const handlePause = async () => {
    const updated = await pauseRun();
    setContext(updated);
  };

  const handleReset = async () => {
    const updated = await resetRun();
    setContext(updated);
  };

  const handleSetSpeed = async (speed: number) => {
    const updated = await setReplaySpeed(speed);
    setContext(updated);
  };

  return {
    context,
    loading,
    error,
    refreshContext,
    selectSource: handleSelectSource,
    startRun: handleStart,
    pauseRun: handlePause,
    resetRun: handleReset,
    setSpeed: handleSetSpeed,
  };
}

