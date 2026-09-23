import React, { useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { Header } from './components/layout/Header';
import { PipelineOverview } from './components/pipeline/PipelineOverview';
import { LiveCamera } from './components/camera/LiveCamera';
import { TelemetryGrid } from './components/telemetry/TelemetryGrid';
import { EventPanel } from './components/events/EventPanel';
import { SystemLogs } from './components/diagnostics/SystemLogs';
import { SettingsModal } from './components/modals/SettingsModal';
import { DiagnosticsModal } from './components/modals/DiagnosticsModal';
import { EventEvidence } from './components/events/EventEvidence';

import { usePipelineStatus } from './hooks/usePipelineStatus';
import { useEvents } from './hooks/useEvents';
import { useStorageStats } from './hooks/useStorageStats';
import { useTransmissionStats } from './hooks/useTransmissionStats';
import { usePhoneDiagnostics } from './hooks/usePhoneDiagnostics';
import { useLogs } from './hooks/useLogs';
import { startPipeline, stopPipeline, restartPipeline } from './services/api';
import { isPipelineLive } from './utils/telemetry';

export default function App() {
  const [showLivePreview, setShowLivePreview] = useState(true);
  const [showPhoneDiag, setShowPhoneDiag] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const status = usePipelineStatus();
  const { events, selectedEvent, setSelectedEvent } = useEvents();
  const { storageStats } = useStorageStats();
  const { transmissionStats } = useTransmissionStats();
  const { phoneDiag } = usePhoneDiagnostics();
  const { logs, category, setCategory } = useLogs();

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleAction = async (actionFn, successMsg, failMsg) => {
    try {
      await actionFn();
      showToast(successMsg);
      status.refreshStatus();
    } catch (err) {
      showToast(`${failMsg}: ${err.message}`);
    }
  };

  const isStreamLive = isPipelineLive(status.components, status.inputFps);

  return (
    <AppShell toastMessage={toastMessage}>
      <Header
        busId={status.busId}
        isStreamLive={isStreamLive}
        isPipelineRunning={status.isRunning}
        onStart={() => handleAction(startPipeline, 'Pipeline started', 'Failed to start')}
        onStop={() => handleAction(stopPipeline, 'Pipeline stopped', 'Failed to stop')}
        onRestart={() => handleAction(restartPipeline, 'Pipeline restarted', 'Failed to restart')}
        showLivePreview={showLivePreview}
        onTogglePreview={() => setShowLivePreview(!showLivePreview)}
        onOpenPhoneDiag={() => setShowPhoneDiag(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <PipelineOverview
        components={status.components}
        metrics={status.metrics}
        latestGps={status.latestGps}
        isStreamLive={isStreamLive}
        storageStats={storageStats}
        transmissionStats={transmissionStats}
      />

      <main className="ops-body-grid">
        <div className="ops-left-column">
          <LiveCamera
            showLivePreview={showLivePreview}
            isStreamLive={isStreamLive}
            busId={status.busId}
            resolution={status.resolution}
            inputFps={status.inputFps}
            avgInputFps={status.avgInputFps}
            aiLatencyMs={status.aiLatencyMs}
            processingFps={status.processingFps}
            framesReceived={status.framesReceived}
            framesDropped={status.framesDropped}
          />
          <TelemetryGrid
            metrics={status.metrics}
            traffic={status.traffic}
            aiLatencyMs={status.aiLatencyMs}
            processingFps={status.processingFps}
            latestGps={status.latestGps}
            storageStats={storageStats}
            transmissionStats={transmissionStats}
          />
        </div>

        <div className="ops-right-column">
          <EventPanel events={events} onSelectEvent={setSelectedEvent} />
          <SystemLogs logs={logs} category={category} onSelectCategory={setCategory} />
        </div>
      </main>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={showToast}
      />
      <DiagnosticsModal
        isOpen={showPhoneDiag}
        onClose={() => setShowPhoneDiag(false)}
        phoneDiag={phoneDiag}
      />
      <EventEvidence
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </AppShell>
  );
}
