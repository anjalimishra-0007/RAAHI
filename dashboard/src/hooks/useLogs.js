import { useState, useEffect, useCallback } from 'react';
import { getLogs } from '../services/api';

/**
 * Custom hook for operations console logs with category filtering.
 */
export function useLogs(initialCategory = 'ALL', pollIntervalMs = 2000) {
  const [logs, setLogs] = useState([]);
  const [category, setCategory] = useState(initialCategory);

  const fetchLogsData = useCallback(async () => {
    try {
      const data = await getLogs(40, category);
      if (data && Array.isArray(data.logs)) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.warn('[useLogs] Fetch error:', err);
    }
  }, [category]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await getLogs(40, category);
        if (active && data && Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      } catch (err) {
        console.warn('[useLogs] Fetch error:', err);
      }
    }

    void load();
    const interval = setInterval(load, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [category, pollIntervalMs]);

  return {
    logs,
    category,
    setCategory,
    refreshLogs: fetchLogsData,
  };
}
