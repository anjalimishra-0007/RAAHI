import { useState, useEffect, useCallback } from 'react';
import { getEvents } from '../services/api';

/**
 * Custom hook for candidate events list and selected event state.
 */
export function useEvents(pollIntervalMs = 2000, limit = 25) {
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchEventsData = useCallback(async () => {
    try {
      const data = await getEvents(limit);
      if (data && Array.isArray(data.events)) {
        setEvents(data.events);
      }
    } catch (err) {
      console.warn('[useEvents] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await getEvents(limit);
        if (active && data && Array.isArray(data.events)) {
          setEvents(data.events);
        }
      } catch (err) {
        console.warn('[useEvents] Fetch error:', err);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    const interval = setInterval(load, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [limit, pollIntervalMs]);

  return {
    events,
    selectedEvent,
    setSelectedEvent,
    loading,
    refreshEvents: fetchEventsData,
  };
}
