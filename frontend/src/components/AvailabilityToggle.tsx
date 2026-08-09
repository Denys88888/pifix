import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { mastersApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { MasterProfile } from '../api/types';
import styles from '../styles/AvailabilityToggle.module.css';

/**
 * The master's "I am taking work now" switch. This is what puts their green pin
 * on the map, so it lives on the dashboard rather than buried in the profile
 * form — it is a thing you flip several times a day, not a setting you fill in
 * once.
 */
export function AvailabilityToggle(): JSX.Element | null {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void mastersApi
      .myProfile()
      .then((loaded) => {
        if (!cancelled) setProfile(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // No profile yet means nothing to be available for.
  if (!profile) return null;

  const missingLocation = profile.lat === null || profile.lng === null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setProfile(await mastersApi.setAvailability(!profile.isAvailable));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.text}>
        <span className={styles.title}>
          <i className={profile.isAvailable ? `${styles.dot} ${styles.dotOn}` : styles.dot} />
          {profile.isAvailable ? t('availability.on') : t('availability.off')}
        </span>
        <span className={styles.hint}>
          {missingLocation ? t('availability.needLocation') : t('availability.hint')}
        </span>
      </div>

      {missingLocation ? (
        // Going available without a home point would put the pin nowhere; the
        // server refuses it too, so the UI sends them to fix the cause instead
        // of offering a button that can only fail.
        <Link className="btn btn--secondary" to="/dashboard/profile">
          {t('availability.setLocation')}
        </Link>
      ) : (
        <button
          type="button"
          className={profile.isAvailable ? 'btn btn--secondary' : 'btn'}
          onClick={() => void toggle()}
          disabled={busy}
          aria-pressed={profile.isAvailable}
        >
          {busy ? t('common.loading') : profile.isAvailable ? t('availability.goOffline') : t('availability.goOnline')}
        </button>
      )}

      {error ? <div className="alert alert--error">{error}</div> : null}
    </div>
  );
}
