import { useState, useEffect, useCallback } from 'react';
import { getStorageStats } from '../services/api';

/**
 * Custom hook for local SQLite and MP4 evidence storage metrics.
 */
export function useStorageStats(pollIntervalMs = 3000) {
  const [storageStats, setStorageStats] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getStorageStats();
      if (data) setStorageStats(data);
    } catch (err) {
      console.warn('[useStorageStats] Fetch error:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await getStorageStats();
        if (active && data) {
          setStorageStats(data);
        }
      } catch (err) {
        console.warn('[useStorageStats] Fetch error:', err);
      }
    }

    void load();
    const interval = setInterval(load, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollIntervalMs]);

  return { storageStats, refreshStorageStats: fetchStats };
}
