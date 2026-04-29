import { useState, useEffect, useCallback, createContext, useContext } from "react";
import api from "../api";
import secureStorage from "./secureStorage";
import { fetchWithCache, invalidateCache } from "./pageCache";

const CACHE_KEY = "data-refs-cache";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const DataRefContext = createContext(null);

/**
 * Provider — fetches all active data references once and caches them.
 * Wrap your app (or admin layout) with this provider.
 */
export function DataRefProvider({ children }) {
  const [refs, setRefs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRefs = useCallback(async () => {
    await fetchWithCache(CACHE_KEY, () => api.get("/data-references").then(({ data }) => data), {
      ttl: CACHE_TTL,
      onData:  (data) => { setRefs(data); setLoading(false); },
      onEnd:   ()     => setLoading(false),
    });
  }, []);

  useEffect(() => {
    fetchRefs();
  }, [fetchRefs]);

  const getValues = useCallback(
    (category) => {
      const ref = refs.find((r) => r.category === category);
      return ref ? ref.values : [];
    },
    [refs],
  );

  const refresh = useCallback(() => {
    invalidateCache(CACHE_KEY);
    return fetchRefs();
  }, [fetchRefs]);

  return (
    <DataRefContext.Provider value={{ refs, loading, getValues, refresh }}>
      {children}
    </DataRefContext.Provider>
  );
}

/**
 * Hook — returns { getValues, refs, loading, refresh }
 *
 * Usage:
 *   const { getValues } = useDataRef();
 *   const provinces = getValues("province");   // ["Aurora", "Bataan", ...]
 */
export function useDataRef() {
  const ctx = useContext(DataRefContext);
  if (!ctx) {
    throw new Error("useDataRef must be used within a <DataRefProvider>");
  }
  return ctx;
}
