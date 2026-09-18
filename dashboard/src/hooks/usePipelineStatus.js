import { useState, useEffect, useCallback } from 'react';
import { getPipelineStatus, createTelemetryWebSocket } from '../services/api';

/**
 * Custom hook providing real-time pipeline telemetry via WebSocket with REST fallback.
 */
export function usePipelineStatus(pollIntervalMs = 2000) {
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await getPipelineStatus();
      setPipelineStatus(data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 1. Establish WebSocket connection for sub-second telemetry updates
  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;

    const connect = () => {
      try {
        ws = createTelemetryWebSocket(
          (data) => {
            if (data.health) {
              setPipelineStatus(data.health);
              setLoading(false);
            }
          },
          () => {
            if (ws) ws.close();
          },
          () => {
            reconnectTimeout = setTimeout(connect, 2500);
          }
        );
      } catch {
        reconnectTimeout = setTimeout(connect, 2500);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  // 2. Periodic REST poll fallback
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const data = await getPipelineStatus();
        if (active) {
          setPipelineStatus(data);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err);
          setLoading(false);
        }
      }
    }

    void poll();
    const interval = setInterval(poll, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollIntervalMs]);

  const components = pipelineStatus?.components || {};
  const metrics = pipelineStatus?.metrics || {};
  const latestGps = pipelineStatus?.latestGps || null;
  const busId = pipelineStatus?.busId || 'RAAHI-001';
  const isRunning = pipelineStatus?.pipelineRunning || false;

  // Genuine separated telemetry metrics
  const inputFps = metrics.inputFps ?? metrics.receiverFps ?? 0.0;
  const avgInputFps = metrics.averageInputFps ?? 0.0;
  const aiLatencyMs = metrics.inferenceLatencyMs ?? 0.0;
  const processingFps = metrics.processingFps ?? metrics.inferenceFps ?? 0.0;
  const framesReceived = metrics.framesReceived ?? metrics.processedFrames ?? 0;
  const framesDropped = metrics.framesDropped ?? metrics.droppedFrames ?? 0;
  const resolution = metrics.resolution || '1920x1080';

  return {
    pipelineStatus,
    components,
    metrics,
    latestGps,
    busId,
    isRunning,
    inputFps,
    avgInputFps,
    aiLatencyMs,
    processingFps,
    framesReceived,
    framesDropped,
    resolution,
    loading,
    error,
    refreshStatus,
  };
}
