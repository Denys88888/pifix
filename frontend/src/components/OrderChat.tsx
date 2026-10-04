import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, ChatPage } from '../api/types';
import { uploadsApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { formatDateTime } from '../lib/format';
import styles from '../styles/OrderChat.module.css';

const MESSAGE_MAX = 1000;
const PHOTOS_MAX = 4;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

/**
 * The chat on an order, used by both sides and by the admin.
 *
 * Pi Browser has no WebSocket and no push, so new messages arrive by polling —
 * only the ones newer than the last seen, so a quiet chat costs one tiny
 * request every few seconds, and none while the app is in the background.
 */
export function OrderChat({
  load,
  send,
  asAdmin = false,
  fullScreen = false,
}: {
  load: (after?: string) => Promise<ChatPage>;
  send: (text: string, photos: string[]) => Promise<ChatMessage>;
  /** The admin sees both sides as "theirs" and writes as the administration. */
  asAdmin?: boolean;
  /** On its own page the thread fills the screen and the composer stays at the bottom. */
  fullScreen?: boolean;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const { settings } = usePlatformSettings();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastAt = useRef<string | undefined>(undefined);

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id));
      const fresh = incoming.filter((message) => !known.has(message.id));
      return fresh.length ? [...current, ...fresh] : current;
    });
    lastAt.current = incoming[incoming.length - 1].createdAt;
  }, []);

  usePolling(() => load(lastAt.current), {
    intervalMs: 6_000,
    onData: (page) => {
      merge(page.items);
      setOpen(page.open);
      setLoaded(true);
    },
  });

  // Keep the newest message in view as the thread grows. After the next frame:
  // on the chat page the list gets its height from the layout only once the
  // messages are in, and scrolling before that left the thread at the top.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);

  const describe = (caught: unknown): string =>
    caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic');

  const attach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = PHOTOS_MAX - photos.length;
    const picked = Array.from(files).slice(0, room);
    if (picked.some((file) => !PHOTO_TYPES.includes(file.type))) {
      setError(t('chat.photoType'));
      return;
    }
    if (picked.some((file) => file.size > PHOTO_MAX_BYTES)) {
      setError(t('chat.photoSize'));
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadsApi.images('chat', picked);
      setPhotos((current) => [...current, ...uploaded.map((file) => file.url)].slice(0, PHOTOS_MAX));
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    const text = draft.trim();
    if ((!text && photos.length === 0) || sending || uploading) return;
    setSending(true);
    setError(null);
    try {
      const created = await send(text, photos);
      merge([created]);
      setDraft('');
      setPhotos([]);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setSending(false);
    }
  };

  const author = (message: ChatMessage): string => {
    if (message.role === 'ADMIN') return t('chat.admin');
    if (message.mine) return t('chat.you');
    const who = message.role === 'CLIENT' ? t('chat.client') : t('chat.master');
    return message.username ? `${who} @${message.username}` : who;
  };

  /** The server writes the admin's decision as `@resolution:<action>` + note. */
  const body = (message: ChatMessage): string => {
    const match = /^@resolution:([a-z_]+)\n?([\s\S]*)$/.exec(message.text);
    if (!match) return message.text;
    const [, action, note] = match;
    const decision = t(`dispute.resolution.${action}`, { defaultValue: action });
    return note ? `${t('dispute.decision')}: ${decision}\n${note}` : `${t('dispute.decision')}: ${decision}`;
  };

  const canAttach = settings?.uploadsEnabled !== false && photos.length < PHOTOS_MAX;

  return (
    <div className={`${styles.chat} ${fullScreen ? styles.full : ''}`}>
      <div ref={listRef} className={styles.list} aria-live="polite">
        {loaded && messages.length === 0 ? (
          <p className="muted">{t(asAdmin ? 'chat.emptyAdmin' : 'chat.empty')}</p>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.message} ${
              message.role === 'ADMIN' ? styles.admin : message.mine ? styles.mine : styles.theirs
            }`}
          >
            <span className={styles.meta}>
              {author(message)} · {formatDateTime(message.createdAt, i18n.resolvedLanguage)}
            </span>
            {message.photos?.length ? (
              <span className={styles.photos}>
                {message.photos.map((url) => (
                  <button key={url} type="button" className={styles.photoBtn} onClick={() => setViewer(url)}>
                    <img src={url} alt={t('chat.photo')} loading="lazy" />
                  </button>
                ))}
              </span>
            ) : null}
            {message.text ? <span className={styles.text}>{body(message)}</span> : null}
          </div>
        ))}
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {open || asAdmin ? (
        <div className={styles.composer}>
          {photos.length > 0 ? (
            <div className={styles.pending}>
              {photos.map((url) => (
                <span key={url} className={styles.pendingItem}>
                  <img src={url} alt="" />
                  <button
                    type="button"
                    aria-label={t('chat.removePhoto')}
                    onClick={() => setPhotos((current) => current.filter((item) => item !== url))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className={styles.row}>
            {canAttach ? (
              <>
                <button
                  type="button"
                  className={styles.attach}
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || sending}
                  aria-label={t('chat.addPhoto')}
                >
                  {uploading ? '…' : '📷'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  hidden
                  onChange={(event) => void attach(event.target.files)}
                />
              </>
            ) : null}
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, MESSAGE_MAX))}
              placeholder={t(asAdmin ? 'chat.placeholderAdmin' : 'chat.placeholder')}
              rows={fullScreen ? 1 : 2}
            />
            <button
              className={`btn ${styles.send}`}
              onClick={() => void submit()}
              disabled={sending || uploading || (!draft.trim() && photos.length === 0)}
              aria-label={t('chat.send')}
            >
              {sending ? '…' : '➤'}
            </button>
          </div>
        </div>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {t('chat.closed')}
        </p>
      )}

      {viewer ? (
        <button type="button" className={styles.viewer} onClick={() => setViewer(null)} aria-label={t('common.close')}>
          <img src={viewer} alt={t('chat.photo')} />
        </button>
      ) : null}
    </div>
  );
}
