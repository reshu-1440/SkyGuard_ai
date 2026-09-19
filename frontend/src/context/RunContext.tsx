import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  fetchActiveRunContext,
  pauseRun,
  resetRun,
  selectDataSource,
  setReplaySpeed,
  startRun,
} from '../api/runtime';
import { DataSourceType, RunContext, RunMode } from '../types/runtime';


interface RunContextState {
  context: RunContext | null;
  loading: boolean;
  error: string | null;
  refreshContext: () => Promise<void>;
  selectSource: (sourceType: DataSourceType, mode: RunMode, datasetId?: string) => Promise<RunContext>;
  startRun: () => Promise<void>;
  pauseRun: () => Promise<void>;
  resetRun: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  updateContextFromEvent: (partial: Partial<RunContext>) => void;
}

const RunStateContext = createContext<RunContextState | null>(null);

export const RunContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [context, setContext] = useState<RunContext | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef<RunContext | null>(null);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const refreshContext = useCallback(async () => {
    try {
      const data = await fetchActiveRunContext();
      setContext(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error loading canonical RunContext');
    } finally {
      setLoading(false);
    }
  }, []);

  // Adaptive polling to keep fallback synchronized
  useEffect(() => {
    refreshContext();
    const isRunning = context?.status === 'RUNNING';
    const intervalMs = isRunning ? 1500 : 4000;
    const interval = setInterval(refreshContext, intervalMs);
    return () => clearInterval(interval);
  }, [refreshContext, context?.status]);

  const autoStartAttemptedRef = useRef<boolean>(false);

  // Auto-start demo replay if configured via VITE_DEMO_AUTOSTART or backend context
  useEffect(() => {
    if (autoStartAttemptedRef.current || !context) return;
    const isAutostartConfigured =
      (import.meta as any).env?.VITE_DEMO_AUTOSTART === 'true' ||
      Boolean(context.metadata?.demo_autostart);

    if (
      isAutostartConfigured &&
      context.status === 'IDLE' &&
      context.mode === 'SYNTHETIC_REPLAY'
    ) {
      autoStartAttemptedRef.current = true;
      handleStart();
    }
  }, [context]);

  const updateContextFromEvent = useCallback((partial: Partial<RunContext>) => {
    setContext((prev) => (prev ? { ...prev, ...partial } : null));
  }, []);

  const handleSelectSource = async (
    sourceType: DataSourceType,
    mode: RunMode,
    datasetId?: string
  ) => {
    try {
      const newCtx = await selectDataSource(sourceType, mode, datasetId);
      setContext(newCtx);
      setError(null);
      // Invalidate all dependent data queries immediately to avoid cross-source bleed
      queryClient.invalidateQueries({ queryKey: ['stations'] });
      queryClient.invalidateQueries({ queryKey: ['station'] });
      queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      queryClient.invalidateQueries({ queryKey: ['corrections'] });
      queryClient.invalidateQueries({ queryKey: ['system'] });
      queryClient.invalidateQueries({ queryKey: ['replay'] });
      queryClient.invalidateQueries({ queryKey: ['live'] });
      return newCtx;
    } catch (err: any) {
      setError(err.message || 'Failed to select data source');
      throw err;
    }
  };

  const handleStart = async () => {
    try {
      const updated = await startRun();
      setContext(updated);
      queryClient.invalidateQueries({ queryKey: ['replay'] });
    } catch (err: any) {
      setError(err.message || 'Failed to start run');
    }
  };

  const handlePause = async () => {
    try {
      const updated = await pauseRun();
      setContext(updated);
      queryClient.invalidateQueries({ queryKey: ['replay'] });
    } catch (err: any) {
      setError(err.message || 'Failed to pause run');
    }
  };

  const handleReset = async () => {
    try {
      const updated = await resetRun();
      setContext(updated);
      queryClient.invalidateQueries({ queryKey: ['stations'] });
      queryClient.invalidateQueries({ queryKey: ['station'] });
      queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      queryClient.invalidateQueries({ queryKey: ['corrections'] });
      queryClient.invalidateQueries({ queryKey: ['system'] });
      queryClient.invalidateQueries({ queryKey: ['replay'] });
    } catch (err: any) {
      setError(err.message || 'Failed to reset run');
    }
  };

  const handleSetSpeed = async (speed: number) => {
    try {
      const updated = await setReplaySpeed(speed);
      setContext(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to adjust speed');
    }
  };

  const value: RunContextState = {
    context,
    loading,
    error,
    refreshContext,
    selectSource: handleSelectSource,
    startRun: handleStart,
    pauseRun: handlePause,
    resetRun: handleReset,
    setSpeed: handleSetSpeed,
    updateContextFromEvent,
  };

  return (
    <RunStateContext.Provider value={value}>
      {children}
    </RunStateContext.Provider>
  );
};

export function useRunContext(): RunContextState {
  const ctx = useContext(RunStateContext);
  if (!ctx) {
    throw new Error('useRunContext must be used within a RunContextProvider');
  }
  return ctx;
}
