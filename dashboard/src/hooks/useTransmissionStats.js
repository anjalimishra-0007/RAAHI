import { useState, useEffect, useCallback } from 'react';
import { getTransmissionStats } from '../services/api';

/**
 * Custom hook for central cloud sync queue and uplink metrics.
 */
export function useTransmissionStats(pollIntervalMs = 2500) {
  const [transmissionStats, setTransmissionStats] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getTransmissionStats();
      if (data) setTransmissionStats(data);
    } catch (err) {
      console.warn('[useTransmissionStats] Fetch error:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await getTransmissionStats();
        if (active && data) {
          setTransmissionStats(data);
        }
      } catch (err) {
        console.warn('[useTransmissionStats] Fetch error:', err);
      }
    }

    void load();
    const interval = setInterval(load, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollIntervalMs]);

  return { transmissionStats, refreshTransmissionStats: fetchStats };
}
