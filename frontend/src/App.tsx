import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './layouts/AppLayout';
import { NetworkOverviewPage } from './pages/NetworkOverviewPage';
import { LiveMonitoringPage } from './pages/LiveMonitoringPage';
import { StationDetailsPage } from './pages/StationDetailsPage';
import { AnomalyInvestigationPage } from './pages/AnomalyInvestigationPage';
import { SensorHealthPage } from './pages/SensorHealthPage';
import { CorrectionReviewPage } from './pages/CorrectionReviewPage';
import { HistoricalAnalysisPage } from './pages/HistoricalAnalysisPage';
import { SystemStatusPage } from './pages/SystemStatusPage';

import { RunContextProvider } from './context/RunContext';
import { RealtimeStreamProvider } from './context/RealtimeStreamContext';

// Configure TanStack Query Client with optimal defaults
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <RunContextProvider>
        <RealtimeStreamProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Navigate to="/network" replace />} />
                <Route path="/network" element={<NetworkOverviewPage />} />
                <Route path="/live" element={<LiveMonitoringPage />} />
                <Route path="/stations" element={<StationDetailsPage />} />
                <Route path="/stations/:stationId" element={<StationDetailsPage />} />
                <Route path="/anomalies" element={<AnomalyInvestigationPage />} />
                <Route path="/anomalies/:eventId" element={<AnomalyInvestigationPage />} />
                <Route path="/health" element={<SensorHealthPage />} />
                <Route path="/corrections" element={<CorrectionReviewPage />} />
                <Route path="/history" element={<HistoricalAnalysisPage />} />
                <Route path="/system" element={<SystemStatusPage />} />
                <Route path="*" element={<Navigate to="/network" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </RealtimeStreamProvider>
      </RunContextProvider>
    </QueryClientProvider>
  );
};

export default App;

