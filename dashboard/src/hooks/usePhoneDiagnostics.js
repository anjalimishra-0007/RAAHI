import { useState, useEffect, useCallback } from 'react';
import { getPhoneDiagnostics } from '../services/api';

/**
 * Custom hook for Samsung Galaxy S23 FE physical diagnostics (ADB, hotspot IP, ping).
 */
export function usePhoneDiagnostics(pollIntervalMs = 3000) {
  const [phoneDiag, setPhoneDiag] = useState(null);

  const fetchDiagnostics = useCallback(async () => {
    try {
      const data = await getPhoneDiagnostics();
      if (data) setPhoneDiag(data);
    } catch (err) {
      console.warn('[usePhoneDiagnostics] Fetch error:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await getPhoneDiagnostics();
        if (active && data) {
          setPhoneDiag(data);
        }
      } catch (err) {
        console.warn('[usePhoneDiagnostics] Fetch error:', err);
      }
    }

    void load();
    const interval = setInterval(load, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollIntervalMs]);

  return { phoneDiag, refreshPhoneDiagnostics: fetchDiagnostics };
}
