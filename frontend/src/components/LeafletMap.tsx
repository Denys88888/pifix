import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../styles/LeafletMap.module.css';
import type * as LeafletTypes from 'leaflet';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  accent?: boolean;
}

interface Props {
  center: { lat: number; lng: number } | null;
  zoom?: number;
  markers?: MapMarker[];
  /** Enables tap-to-place: the parent gets the picked coordinates. */
  onPick?: (coords: { lat: number; lng: number }) => void;
  /** Draws the working radius circle (km). */
  radiusKm?: number;
  height?: number;
  onMarkerClick?: (id: string) => void;
}

const DEFAULT_CENTER = { lat: 20, lng: 0 };
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; OpenStreetMap';

/**
 * Leaflet + OpenStreetMap: no API key, no billing, works from any country.
 * The library (~40 KB gz) and its CSS are imported dynamically so the first
 * paint on a slow connection never waits for the map.
 */
export function LeafletMap({
  center,
  zoom = 13,
  markers = [],
  onPick,
  radiusKm,
  height = 240,
  onMarkerClick,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletTypes.Map | null>(null);
  const layerRef = useRef<LeafletTypes.LayerGroup | null>(null);
  const circleRef = useRef<LeafletTypes.Circle | null>(null);
  const leafletRef = useRef<typeof LeafletTypes | null>(null);
  const onPickRef = useRef(onPick);
  const onMarkerClickRef = useRef(onMarkerClick);

  onPickRef.current = onPick;
  onMarkerClickRef.current = onMarkerClick;

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [leaflet] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        if (cancelled || !containerRef.current || mapRef.current) return;

        const L = leaflet.default ?? (leaflet as unknown as typeof LeafletTypes);
        leafletRef.current = L;

        const start = center ?? DEFAULT_CENTER;
        const map = L.map(containerRef.current, {
          center: [start.lat, start.lng],
          zoom: center ? zoom : 2,
          zoomControl: true,
          attributionControl: true,
        });

        L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);

        map.on('click', (event: LeafletTypes.LeafletMouseEvent) => {
          onPickRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
        });

        mapRef.current = map;
        setReady(true);

        // The container is often still sizing when the map mounts.
        setTimeout(() => map.invalidateSize(), 120);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      circleRef.current = null;
    };
    // Intentionally mount-only: subsequent prop changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    map.setView([center.lat, center.lng], zoom, { animate: false });
  }, [center?.lat, center?.lng, zoom, center]);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!L || !layer || !ready) return;

    layer.clearLayers();

    for (const marker of markers) {
      // A DivIcon avoids Leaflet's default image assets entirely — no broken
      // marker PNGs after the Vite build.
      const icon = L.divIcon({
        className: '',
        html: `<div class="${styles.pin} ${marker.accent ? styles.pinAccent : ''}">${
          marker.label ? `<span>${escapeHtml(marker.label)}</span>` : ''
        }</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
      });

      const pin = L.marker([marker.lat, marker.lng], { icon }).addTo(layer);
      if (onMarkerClickRef.current) {
        pin.on('click', () => onMarkerClickRef.current?.(marker.id));
      }
    }
  }, [markers, ready]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !ready) return;

    circleRef.current?.remove();
    circleRef.current = null;

    if (radiusKm && center) {
      circleRef.current = L.circle([center.lat, center.lng], {
        radius: radiusKm * 1000,
        color: '#4caf50',
        weight: 1,
        fillColor: '#4caf50',
        fillOpacity: 0.08,
      }).addTo(map);
    }
  }, [radiusKm, center?.lat, center?.lng, ready, center]);

  if (failed) {
    return (
      <div className={styles.fallback} style={{ height }}>
        {t('map.unavailable')}
      </div>
    );
  }

  return (
    <div className={styles.wrap} style={{ height }}>
      <div ref={containerRef} className={styles.map} />
      {!ready ? <div className={styles.loading}>{t('map.loading')}</div> : null}
      {onPick ? <div className={styles.hint}>{t('map.tapHint')}</div> : null}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
