import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApiClient } from '../../api/endpoints';
import { ApiError, setAdminToken } from '../../api/client';
import styles from '../../styles/Admin.module.css';

export default function AdminLogin(): JSX.Element {
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
        <p className="muted" style={{ margin: 0 }}>
          Sign in with the credentials from the server environment.
        </p>

        <label>
          <span className="label">Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          <span className="label">Password</span>
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
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
