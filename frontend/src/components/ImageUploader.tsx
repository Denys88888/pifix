import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadsApi, type UploadFolder } from '../api/endpoints';
import { ApiError } from '../api/client';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import styles from '../styles/ImageUploader.module.css';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png'];

interface Props {
  folder: UploadFolder;
  value: string[];
  onChange: (urls: string[]) => void;
  max: number;
  label?: string;
  hint?: string;
}

/**
 * Client-side gate (type + size) before anything leaves the device — the server
 * re-checks both plus the magic bytes, but on a 3G connection it matters that a
 * 12 MB photo is refused instantly instead of after a minute of upload.
 */
export function ImageUploader({ folder, value, onChange, max, label, hint }: Props): JSX.Element {
  const { t } = useTranslation();
  const { settings } = usePlatformSettings();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);

      const room = max - value.length;
      if (room <= 0) {
        setError(t('upload.limit', { count: max }));
        return;
      }

      const chosen = Array.from(files).slice(0, room);

      for (const file of chosen) {
        if (!ALLOWED.includes(file.type)) {
          setError(t('upload.badType'));
          return;
        }
        if (file.size > MAX_BYTES) {
          setError(t('upload.tooLarge', { name: file.name }));
          return;
        }
      }

      setBusy(true);
      setProgress(0);
      try {
        const uploaded = await uploadsApi.images(folder, chosen, setProgress);
        onChange([...value, ...uploaded.map((item) => item.url)]);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('upload.failed'));
      } finally {
        setBusy(false);
        setProgress(0);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [folder, max, onChange, t, value],
  );

  const remove = (url: string) => onChange(value.filter((item) => item !== url));

  // Optimistic while settings are still in flight: the picker only disappears
  // once the server has actually reported uploads as off. Already-attached
  // photos stay visible and removable — only adding new ones is withdrawn.
  const uploadsOff = settings ? !settings.uploadsEnabled : false;

  return (
    <div className={styles.wrap}>
      {label ? <span className="label">{label}</span> : null}

      <div className={styles.grid}>
        {value.map((url) => (
          <div key={url} className={styles.thumb}>
            <img src={url} alt="" loading="lazy" />
            <button
              type="button"
              className={styles.remove}
              onClick={() => remove(url)}
              aria-label={t('common.remove')}
            >
              ×
            </button>
          </div>
        ))}

        {value.length < max && !uploadsOff ? (
          <button
            type="button"
            className={styles.add}
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? <span className={styles.progress}>{progress}%</span> : <span className={styles.plus}>＋</span>}
            <span className={styles.addLabel}>
              {busy ? t('upload.uploading') : t('upload.add', { current: value.length, max })}
            </span>
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple={max > 1}
        // `capture` is absent on purpose: with it Android jumps straight to the
        // camera, which stops people from picking an existing photo.
        className={styles.input}
        onChange={(event) => void pick(event.target.files)}
      />

      {uploadsOff ? <p className="hint">{t('upload.unavailable')}</p> : null}
      {hint && !uploadsOff ? <p className="hint">{hint}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
