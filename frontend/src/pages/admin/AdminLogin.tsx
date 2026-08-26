import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { adminApiClient } from '../../api/endpoints';
import { ApiError, setAdminToken } from '../../api/client';
import styles from '../../styles/Admin.module.css';

export default function AdminLogin(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await adminApiClient.login(username.trim(), password);
      setAdminToken(result.token);
      navigate('/admin', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.loginWrap}>
      <form className={styles.loginCard} onSubmit={submit}>
        <h1 style={{ margin: 0 }}>
          Pi<span style={{ color: 'var(--accent)' }}>Fix</span> admin
        </h1>
        <p className="muted" style={{ margin: 0 }}>{t('admin.signInHint')}</p>

        <label>
          <span className="label">{t('admin.username')}</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          <span className="label">{t('admin.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <div className="alert alert--error">{error}</div> : null}

        <button className="btn" type="submit" disabled={busy || !username || !password}>
          {busy ? t('admin.signingIn') : t('admin.signIn')}
        </button>
      </form>
    </div>
  );
}
