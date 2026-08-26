import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApiClient } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { AdminSettings as Settings } from '../../api/types';
import styles from '../../styles/Admin.module.css';

interface FieldSpec {
  key: keyof Settings;
  label: string;
  hint: string;
  type: 'decimal' | 'percent' | 'int';
}

const FIELDS: FieldSpec[] = [
  { key: 'connectPricePi', label: 'Connect price (π)', hint: 'Paid by a master to respond to an order.', type: 'decimal' },
  { key: 'clientFeePercent', label: 'Client fee (%)', hint: 'Commission added on top of the budget.', type: 'percent' },
  { key: 'masterFeePercent', label: 'Master fee (%)', hint: '0 = the master receives the full budget.', type: 'percent' },
  { key: 'expressFeePi', label: 'Express fee (π)', hint: 'Added when the order is marked urgent.', type: 'decimal' },
  { key: 'profileBoostPricePi', label: 'Profile boost (π)', hint: '7 days at the top of search.', type: 'decimal' },
  { key: 'proSubscriptionPricePi', label: 'PRO subscription (π)', hint: '30 days.', type: 'decimal' },
  { key: 'escrowTimeoutDays', label: 'Escrow timeout (days)', hint: 'Auto-release after this many days.', type: 'int' },
  { key: 'referralBonusDirectPi', label: 'Referral bonus L1 (π)', hint: 'Paid after the referral’s first deal.', type: 'decimal' },
  { key: 'referralBonusIndirectPi', label: 'Referral bonus L2 (π)', hint: 'Second-level referral bonus.', type: 'decimal' },
  { key: 'minBudgetPi', label: 'Minimum budget (π)', hint: 'Lowest allowed order budget.', type: 'decimal' },
  { key: 'maxOpenOrdersPerClient', label: 'Max open orders / client', hint: 'Active orders at once.', type: 'int' },
  { key: 'maxActiveResponsesPerMaster', label: 'Max responses / master', hint: 'Active responses at once.', type: 'int' },
  { key: 'connectRefundWindowMinutes', label: 'Connect refund window (min)', hint: 'Refund allowed inside this window.', type: 'int' },
  { key: 'minWithdrawalPi', label: 'Minimum withdrawal (π)', hint: 'Below this, withdrawals are refused.', type: 'decimal' },
  { key: 'autoWithdrawalPi', label: 'Auto-withdrawal threshold (π)', hint: '0 = always manual.', type: 'decimal' },
  { key: 'piUsdRate', label: 'Pi→USD rate', hint: 'Dashboard display only. Never used for on-chain math.', type: 'decimal' },
];

export default function AdminSettings(): JSX.Element {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [maintenance, setMaintenance] = useState(false);
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
      const patch: Record<string, string | number | boolean> = { maintenanceMode: maintenance };
      for (const field of FIELDS) {
        const raw = values[field.key]?.trim();
        if (raw === undefined || raw === '') continue;
        patch[field.key] = field.type === 'int' ? Number(raw) : raw;
      }
      const saved = await adminApiClient.saveSettings(patch);
      setUpdatedAt(saved.updatedAt);
      setMessage('Saved. New prices apply to the next request — no deploy needed.');
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
        Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}
      </p>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {message ? <div className="alert alert--info">{message}</div> : null}

      <div className={styles.panel}>
        <div className={styles.settingsGrid}>
          {FIELDS.map((field) => (
            <div key={field.key} className={styles.field}>
              <label htmlFor={field.key}>{field.label}</label>
              <input
                id={field.key}
                inputMode="decimal"
                value={values[field.key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
              <small>{field.hint}</small>
            </div>
          ))}
        </div>

        <label className="row" style={{ gap: 10 }}>
          <input
            type="checkbox"
            checked={maintenance}
            onChange={(event) => setMaintenance(event.target.checked)}
            style={{ width: 20, minHeight: 20 }}
          />
          <span>
            Maintenance mode — blocks new orders and shows a banner in the app.
          </span>
        </label>

        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? t('admin.saving') : t('admin.saveSettings')}
        </button>
      </div>
    </>
  );
}
