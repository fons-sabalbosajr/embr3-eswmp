import { useState, useEffect, useRef } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";

/* Province boundary overlay — fetches PH province GeoJSON and highlights filtered province */
const PH_GEOJSON_URL =
  "https://raw.githubusercontent.com/macoymejia/geojsonph/master/Province/Provinces.json";
let _phGeoCache = null;

export function ProvinceBoundary({ province }) {
  const map = useMap();
  const [geoData, setGeoData] = useState(null);
  useEffect(() => {
    if (!province) return;
    let cancelled = false;
    const load = async () => {
      if (!_phGeoCache) {
        try {
          const res = await fetch(PH_GEOJSON_URL);
          _phGeoCache = await res.json();
        } catch {
          _phGeoCache = null;
          return;
        }
      }
      if (!_phGeoCache || cancelled) return;
      const match = _phGeoCache.features.filter((f) => {
        const name = (
          f.properties.PROVINCE ||
          f.properties.NAME ||
          f.properties.name ||
          ""
        ).toUpperCase();
        return (
          name === province.toUpperCase() ||
          name.includes(province.toUpperCase()) ||
          province.toUpperCase().includes(name)
        );
      });
      if (cancelled) return;
      if (match.length > 0) {
        const fc = { type: "FeatureCollection", features: match };
        setGeoData(fc);
        try {
          const layer = L.geoJSON(fc);
          map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 11 });
        } catch {}
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [province, map]);
  if (!geoData) return null;
  return (
    <GeoJSON
      data={geoData}
      style={{
        color: "#1890ff",
        weight: 3,
        fillColor: "#1890ff",
        fillOpacity: 0.1,
        dashArray: "6 4",
      }}
    />
  );
}

export function FitBounds({ points }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
      fitted.current = true;
    }
  }, [points, map]);
  return null;
}
