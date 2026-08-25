import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGeolocation } from '../hooks/useGeolocation';
import styles from '../styles/LeafletMap.module.css';
import type * as LeafletTypes from 'leaflet';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  accent?: boolean;
  /** Pin colour. Red = a job to be done, green = a master ready to do it. */
  tone?: 'task' | 'worker' | 'neutral';
  /** Draws the pulsing ring that marks a master as online right now. */
  live?: boolean;
  /** Popup contents. Omit to keep the marker click-only. */
  popup?: MarkerPopup;
}

export interface MarkerPopup {
  title: string;
  /** Short lines under the title: price, rating, distance. */
  lines?: string[];
  action?: { label: string; href: string };
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
  /**
   * Called when a popup action is tapped. Popups live outside React, so the
   * parent passes navigate() in rather than the popup rendering a <Link>.
   */
  onNavigate?: (href: string) => void;
}

const DEFAULT_CENTER = { lat: 20, lng: 0 };

// CartoDB Positron — светлая карта с русскими подписями, без API ключа.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const ATTRIBUTION = '&copy; OpenStreetMap &copy; CARTO';
const MAX_ZOOM = 20;

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
  onNavigate,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletTypes.Map | null>(null);
  const layerRef = useRef<LeafletTypes.LayerGroup | null>(null);
  const circleRef = useRef<LeafletTypes.Circle | null>(null);
  const leafletRef = useRef<typeof LeafletTypes | null>(null);
  const onPickRef = useRef(onPick);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onNavigateRef = useRef(onNavigate);

  onPickRef.current = onPick;
  onMarkerClickRef.current = onMarkerClick;
  onNavigateRef.current = onNavigate;

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const geo = useGeolocation();

  /**
   * The crosshair every map app has. It recentres, and where the map is a
   * picker it drops the pin too — otherwise finding yourself would leave the
   * order still pointing at wherever the map happened to open.
   */
  const locateMe = useCallback(async () => {
    const coords = await geo.request();
    const map = mapRef.current;
    if (!coords || !map) return;
    map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), 15));
    onPickRef.current?.({ lat: coords.lat, lng: coords.lng });
  }, [geo]);

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

        L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: MAX_ZOOM }).addTo(map);
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
      const toneClass =
        marker.tone === 'task'
          ? styles.pinTask
          : marker.tone === 'worker'
            ? styles.pinWorker
            : '';

      // A DivIcon avoids Leaflet's default image assets entirely — no broken
      // marker PNGs after the Vite build.
      const icon = L.divIcon({
        className: '',
        html: `<div class="${styles.pin} ${toneClass} ${marker.accent ? styles.pinAccent : ''} ${
          marker.live ? styles.pinLive : ''
        }">${marker.label ? `<span>${escapeHtml(marker.label)}</span>` : ''}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
      });

      const pin = L.marker([marker.lat, marker.lng], { icon }).addTo(layer);

      if (marker.popup) {
        // Built as an element, not an HTML string: the action is a real anchor
        // whose click is handed to the router, so tapping "Respond" inside a
        // popup does a client-side navigation instead of reloading the SPA.
        pin.bindPopup(buildPopup(marker.popup, (href) => onNavigateRef.current?.(href)), {
          closeButton: true,
          autoPan: true,
          maxWidth: 260,
        });
      }

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
      {ready ? (
        <button
          type="button"
          className={styles.locate}
          onClick={() => void locateMe()}
          disabled={geo.loading}
          title={t('geo.useMyLocation')}
          aria-label={t('geo.useMyLocation')}
        >
          {geo.loading ? '…' : '◎'}
        </button>
      ) : null}
      {geo.errorCode ? <div className={styles.geoError}>{t(`geo.${geo.errorCode}`)}</div> : null}
      {!ready ? <div className={styles.loading}>{t('map.loading')}</div> : null}
      {onPick ? <div className={styles.hint}>{t('map.tapHint')}</div> : null}
    </div>
  );
}

/**
 * Popups are built with DOM APIs rather than an HTML string. Two reasons:
 * every value is user-supplied (job titles, master display names), so using
 * textContent removes the injection question entirely instead of relying on
 * remembering to escape; and the action stays a real element whose click can be
 * routed through React Router instead of reloading the whole SPA.
 */
function buildPopup(popup: MarkerPopup, navigate: (href: string) => void): HTMLElement {
  const root = document.createElement('div');
  root.className = styles.popup;

  const title = document.createElement('strong');
  title.className = styles.popupTitle;
  title.textContent = popup.title;
  root.appendChild(title);

  for (const line of popup.lines ?? []) {
    const row = document.createElement('span');
    row.className = styles.popupLine;
    row.textContent = line;
    root.appendChild(row);
  }

  if (popup.action) {
    const link = document.createElement('a');
    link.className = styles.popupAction;
    link.href = popup.action.href;
    link.textContent = popup.action.label;
    link.addEventListener('click', (event) => {
      // Plain left-click goes through the router; ctrl/cmd-click and the
      // context menu keep their normal "open in a new tab" behaviour.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(popup.action!.href);
    });
    root.appendChild(link);
  }

  return root;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
