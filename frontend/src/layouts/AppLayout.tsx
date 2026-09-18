import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ActiveSourceBanner } from '../components/common/ActiveSourceBanner';
import { CsvPreviewModal } from '../components/common/CsvPreviewModal';
import { DataSourceSelectorModal } from '../components/common/DataSourceSelectorModal';
import { DatasetInfoDrawer } from '../components/common/DatasetInfoDrawer';
import { RunHistoryModal } from '../components/common/RunHistoryModal';
import { DegradedModeBanner } from '../components/StateFeedback';
import { useRealtimeStream } from '../hooks/useRealtimeStream';
import { useRunContext } from '../hooks/useRunContext';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export const AppLayout: React.FC = () => {
  const { isDegraded } = useRealtimeStream();
  const { context, selectSource, startRun, pauseRun, resetRun, setSpeed } = useRunContext();

  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: '#080C12', color: '#E8EEF7' }}>
      {/* h-12 TopBar — command rail */}
      <TopBar />

      {/* Active Source Control Rail */}
      <ActiveSourceBanner
        context={context}
        onOpenSelector={() => setIsSelectorOpen(true)}
        onOpenDrawer={() => setIsDrawerOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onStart={startRun}
        onPause={pauseRun}
        onReset={resetRun}
        onSetSpeed={setSpeed}
      />

      {/* Degraded Mode Alert Banner — only rendered when WebSocket is degraded */}
      {isDegraded && <DegradedModeBanner />}

      {/* Main workspace: sidebar + scrollable page canvas */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main
          className="flex-1 overflow-y-auto p-5"
          style={{ background: '#080C12' }}
        >
          <Outlet />
        </main>
      </div>

      {/* Modals & Drawers */}
      <DataSourceSelectorModal
        isOpen={isSelectorOpen}
        onClose={() => setIsSelectorOpen(false)}
        onSelect={selectSource}
        onOpenCsvModal={() => setIsCsvModalOpen(true)}
      />

      <DatasetInfoDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        context={context}
      />

      <CsvPreviewModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        onConfirm={selectSource}
      />

      <RunHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
};
