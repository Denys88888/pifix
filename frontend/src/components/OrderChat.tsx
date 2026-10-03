import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage, ChatPage } from '../api/types';
import { ApiError } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { formatDateTime } from '../lib/format';
import styles from '../styles/OrderChat.module.css';

const MESSAGE_MAX = 1000;

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
}: {
  load: (after?: string) => Promise<ChatPage>;
  send: (text: string) => Promise<ChatMessage>;
  /** The admin sees both sides as "theirs" and writes as the administration. */
  asAdmin?: boolean;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
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
    },
  });

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await send(text);
      merge([created]);
      setDraft('');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? t(`errors.${caught.code}`, { defaultValue: caught.message }) : t('errors.generic'),
      );
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

  return (
    <div className={styles.chat}>
      <div ref={listRef} className={styles.list} aria-live="polite">
        {messages.length === 0 ? <p className="muted">{t(asAdmin ? 'chat.emptyAdmin' : 'chat.empty')}</p> : null}
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
            <span className={styles.text}>{body(message)}</span>
          </div>
        ))}
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {open || asAdmin ? (
        <div className={styles.composer}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MESSAGE_MAX))}
            placeholder={t(asAdmin ? 'chat.placeholderAdmin' : 'chat.placeholder')}
            rows={2}
          />
          <button className="btn" onClick={() => void submit()} disabled={sending || !draft.trim()}>
            {sending ? t('chat.sending') : t('chat.send')}
          </button>
        </div>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {t('chat.closed')}
        </p>
      )}
    </div>
  );
}
