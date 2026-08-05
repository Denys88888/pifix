import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { mastersApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { ImageUploader } from '../components/ImageUploader';
import { LeafletMap } from '../components/LeafletMap';
import { SkeletonList } from '../components/SkeletonCard';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { useGeolocation } from '../hooks/useGeolocation';
import { useAuth } from '../hooks/useAuth';
import styles from '../styles/Pages.module.css';

const BIO_MAX = 1000;

export default function MasterProfileEdit(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { categories } = usePlatformSettings();
  const { refreshUser } = useAuth();
  const geo = useGeolocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string[]>([]);
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [certificates, setCertificates] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [radiusKm, setRadiusKm] = useState(20);
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void mastersApi
      .myProfile()
      .then((profile) => {
        if (cancelled || !profile) return;
        setDisplayName(profile.displayName);
        setBio(profile.bio);
        setAvatar(profile.avatarUrl ? [profile.avatarUrl] : []);
        setPortfolio(profile.portfolio);
        setCertificates(profile.certificates);
        setSelected(profile.categories);
        setRadiusKm(profile.radiusKm);
        setAddress(profile.address ?? '');
        if (profile.lat !== null && profile.lng !== null) {
          setPoint({ lat: profile.lat, lng: profile.lng });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCategory = (slug: string) => {
    setSelected((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  };

  const locate = async () => {
    const coords = await geo.request();
    if (coords) setPoint({ lat: coords.lat, lng: coords.lng });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await mastersApi.saveProfile({
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatarUrl: avatar[0] ?? null,
        address: address.trim(),
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        radiusKm,
        categories: selected,
        portfolio,
        certificates,
      });
      await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'),
      );
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    displayName.trim().length >= 2 && bio.trim().length >= 10 && selected.length > 0 && !saving;

  if (loading) {
    return (
      <main className="page">
        <SkeletonList count={3} />
      </main>
    );
  }

  return (
    <main className="page stack">
      <h1>{t('masterProfile.title')}</h1>

      <div className="card">
        <ImageUploader
          folder="avatars"
          value={avatar}
          onChange={setAvatar}
          max={1}
          label={t('masterProfile.avatar')}
        />
      </div>

      <label className="card">
        <span className="label">{t('masterProfile.name')}</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value.slice(0, 80))}
          placeholder={t('masterProfile.namePlaceholder')}
        />
      </label>

      <label className="card">
        <span className="label">{t('masterProfile.bio')}</span>
        <textarea
          value={bio}
          onChange={(event) => setBio(event.target.value.slice(0, BIO_MAX))}
          maxLength={BIO_MAX}
          placeholder={t('masterProfile.bioPlaceholder')}
        />
        <p className="hint">
          {bio.length}/{BIO_MAX}
        </p>
      </label>

      <div className="card stack">
        <span className="label">{t('masterProfile.categories')}</span>
        <div className={styles.categoryGrid}>
          {categories.map((category) => (
            <button
              key={category.slug}
              type="button"
              className={
                selected.includes(category.slug)
                  ? `${styles.categoryTile} ${styles.categoryTileActive}`
                  : styles.categoryTile
              }
              onClick={() => toggleCategory(category.slug)}
            >
              <span className={styles.categoryIcon} aria-hidden="true">
                {category.icon}
              </span>
              {t(`categories.${category.slug}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="card stack">
        <label>
          <span className="label">{t('masterProfile.radius', { km: radiusKm })}</span>
          <input
            className={styles.slider}
            type="range"
            min={1}
            max={100}
            value={radiusKm}
            onChange={(event) => setRadiusKm(Number(event.target.value))}
          />
        </label>

        <label>
          <span className="label">{t('masterProfile.baseAddress')}</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value.slice(0, 300))}
            placeholder={t('createOrder.addressPlaceholder')}
          />
        </label>

        <button className="btn btn--secondary" onClick={() => void locate()} disabled={geo.loading}>
          {geo.loading ? t('geo.locating') : t('geo.useMyLocation')}
        </button>
        {geo.errorCode ? <p className="hint">{t(`geo.${geo.errorCode}`)} — {t('geo.manualFallback')}</p> : null}

        <LeafletMap
          center={point ?? geo.coords}
          markers={point ? [{ id: 'base', lat: point.lat, lng: point.lng, accent: true }] : []}
          onPick={setPoint}
          radiusKm={point ? radiusKm : undefined}
          height={230}
          zoom={11}
        />
      </div>

      <div className="card">
        <ImageUploader
          folder="portfolio"
          value={portfolio}
          onChange={setPortfolio}
          max={10}
          label={t('masterProfile.portfolio')}
          hint={t('masterProfile.portfolioHint')}
        />
      </div>

      <div className="card">
        <ImageUploader
          folder="certificates"
          value={certificates}
          onChange={setCertificates}
          max={10}
          label={t('masterProfile.certificates')}
          hint={t('masterProfile.certificatesHint')}
        />
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <button className="btn" onClick={() => void save()} disabled={!canSave}>
        {saving ? t('common.loading') : t('common.save')}
      </button>
    </main>
  );
}
