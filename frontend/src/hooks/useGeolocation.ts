import { useCallback, useState } from 'react';

export interface Coordinates {
  lat: number;
  lng: number;
  accuracy?: number;
}

export type GeoErrorCode = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'insecure';

export interface GeolocationState {
  coords: Coordinates | null;
  loading: boolean;
  errorCode: GeoErrorCode | null;
}

/**
 * Geolocation in Pi Browser only works over HTTPS AND only when requested from
 * a real user gesture — otherwise it fails silently. So this hook never asks on
 * mount: `request()` is wired to a button, and every failure mode returns a
 * code the UI turns into the manual address fallback.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    coords: null,
    loading: false,
    errorCode: null,
  });

  const request = useCallback(async (): Promise<Coordinates | null> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState({ coords: null, loading: false, errorCode: 'unsupported' });
      return null;
    }
    // Secure context is required; localhost counts as secure.
    if (!window.isSecureContext) {
      setState({ coords: null, loading: false, errorCode: 'insecure' });
      return null;
    }

    setState((current) => ({ ...current, loading: true, errorCode: null }));

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords: Coordinates = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };
          setState({ coords, loading: false, errorCode: null });
          resolve(coords);
        },
        (error) => {
          const code: GeoErrorCode =
            error.code === error.PERMISSION_DENIED
              ? 'denied'
              : error.code === error.TIMEOUT
                ? 'timeout'
                : 'unavailable';
          setState({ coords: null, loading: false, errorCode: code });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
      );
    });
  }, []);

  const setManual = useCallback((coords: Coordinates) => {
    setState({ coords, loading: false, errorCode: null });
  }, []);

  const clear = useCallback(() => {
    setState({ coords: null, loading: false, errorCode: null });
  }, []);

  return { ...state, request, setManual, clear };
}
