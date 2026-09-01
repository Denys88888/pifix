import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApiClient } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { AdminSettings as Settings } from '../../api/types';
import styles from '../../styles/Admin.module.css';

/** Label and hint live in the translation bundle under `admin.field.<key>`. */
interface FieldSpec {
  key: keyof Settings;
  type: 'decimal' | 'percent' | 'int';
}

const FIELDS: FieldSpec[] = [
  { key: 'connectPricePi', type: 'decimal' },
  { key: 'clientFeePercent', type: 'percent' },
  { key: 'masterFeePercent', type: 'percent' },
  { key: 'expressFeePi', type: 'decimal' },
  { key: 'profileBoostPricePi', type: 'decimal' },
  { key: 'proSubscriptionPricePi', type: 'decimal' },
  { key: 'escrowTimeoutDays', type: 'int' },
  { key: 'referralBonusDirectPi', type: 'decimal' },
  { key: 'referralBonusIndirectPi', type: 'decimal' },
  { key: 'minBudgetPi', type: 'decimal' },
  { key: 'maxOpenOrdersPerClient', type: 'int' },
  { key: 'maxActiveResponsesPerMaster', type: 'int' },
  { key: 'connectRefundWindowMinutes', type: 'int' },
  { key: 'minWithdrawalPi', type: 'decimal' },
  { key: 'autoWithdrawalPi', type: 'decimal' },
  { key: 'piUsdRate', type: 'decimal' },
];

export default function AdminSettings(): JSX.Element {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [maintenance, setMaintenance] = useState(false);
  const [supportContact, setSupportContact] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void adminApiClient
      .settings()
      .then((settings) => {
        const next: Record<string, string> = {};
        for (const field of FIELDS) next[field.key] = String(settings[field.key] ?? '');
        setValues(next);
        setMaintenance(settings.maintenanceMode);
        setSupportContact(settings.supportContact ?? '');
        setUpdatedAt(settings.updatedAt);
      })
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // supportContact is sent even when empty: clearing it is how an operator
      // takes the channel down, so a blank must reach the server.
      const patch: Record<string, string | number | boolean> = {
        maintenanceMode: maintenance,
        supportContact: supportContact.trim(),
      };
      for (const field of FIELDS) {
        const raw = values[field.key]?.trim();
        if (raw === undefined || raw === '') continue;
        patch[field.key] = field.type === 'int' ? Number(raw) : raw;
      }
      const saved = await adminApiClient.saveSettings(patch);
      setUpdatedAt(saved.updatedAt);
      setMessage(t('admin.saved'));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1 style={{ margin: 0 }}>{t('admin.platformSettings')}</h1>
      <p className="hint" style={{ margin: 0 }}>
        {t('admin.lastUpdated')}: {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}
      </p>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {message ? <div className="alert alert--info">{message}</div> : null}

      <div className={styles.panel}>
        <div className={styles.settingsGrid}>
          {FIELDS.map((field) => (
            <div key={field.key} className={styles.field}>
              <label htmlFor={field.key}>{t(`admin.field.${field.key}.label`)}</label>
              <input
                id={field.key}
                inputMode="decimal"
                value={values[field.key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
              <small>{t(`admin.field.${field.key}.hint`)}</small>
            </div>
          ))}
        </div>

        <div className={styles.field}>
          <label htmlFor="supportContact">{t('admin.supportContact.label')}</label>
          <input
            id="supportContact"
            value={supportContact}
            placeholder={t('admin.supportContact.placeholder')}
            onChange={(event) => setSupportContact(event.target.value.slice(0, 200))}
          />
          <small>{t('admin.supportContact.hint')}</small>
        </div>

        <label className="row" style={{ gap: 10 }}>
          <input
            type="checkbox"
            checked={maintenance}
            onChange={(event) => setMaintenance(event.target.checked)}
            style={{ width: 20, minHeight: 20 }}
          />
          <span>
            {t('admin.maintenanceLabel')}
          </span>
        </label>

        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? t('admin.saving') : t('admin.saveSettings')}
        </button>
      </div>
    </>
  );
}
