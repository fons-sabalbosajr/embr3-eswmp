import { useEffect, useState } from "react";
import { fetchMediaMeta, getCachedMediaMeta, needsMediaMeta } from "./mediaFiles";

/**
 * Resolve display metadata (real file name + MIME type) for stored media URLs
 * whose type cannot be determined from the URL alone.
 *
 * Only URLs that actually need a lookup are requested, and they go out as ONE
 * batched call for the whole list rather than one per tile. Already-cached URLs
 * resolve synchronously on the first render, so a re-opened modal does not
 * flash unknown-type placeholders.
 *
 * @param {string[]} urls
 * @returns {Record<string, {fileName: string, mimeType: string}>}
 */
export default function useMediaMeta(urls) {
  const [meta, setMeta] = useState(() => {
    const seed = {};
    (urls || []).forEach((url) => {
      const cached = getCachedMediaMeta(url);
      if (cached) seed[url] = cached;
    });
    return seed;
  });

  // A stable primitive key keeps the effect from re-running on every render just
  // because the caller rebuilt the array literal.
  const key = (urls || []).join("|");

  useEffect(() => {
    const list = key ? key.split("|") : [];
    const pending = list.filter((url) => needsMediaMeta(url) && !getCachedMediaMeta(url));
    const cachedOnly = {};
    list.forEach((url) => {
      const cached = getCachedMediaMeta(url);
      if (cached) cachedOnly[url] = cached;
    });

    if (Object.keys(cachedOnly).length) {
      setMeta((prev) => ({ ...cachedOnly, ...prev }));
    }
    if (!pending.length) return undefined;

    let active = true;
    fetchMediaMeta(pending).then((resolved) => {
      if (active) setMeta((prev) => ({ ...prev, ...resolved }));
    });
    return () => {
      active = false;
    };
  }, [key]);

  return meta;
}
