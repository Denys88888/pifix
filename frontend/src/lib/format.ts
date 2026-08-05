import type { TFunction } from 'i18next';

/**
 * Pi amounts arrive as strings and stay strings — parsing them into a Number
 * would reintroduce exactly the float rounding the backend avoids.
 */
export function formatPi(amount: string | null | undefined): string {
  if (!amount) return '0';
  const trimmed = amount.includes('.') ? amount.replace(/0+$/, '').replace(/\.$/, '') : amount;
  return trimmed || '0';
}

export function formatDate(iso: string, locale?: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale ?? 'en', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatDateTime(iso: string, locale?: string): string {
  try {
    return new Date(iso).toLocaleString(locale ?? 'en', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** "3 h ago" style. Falls back to an absolute date beyond a week. */
export function formatRelative(iso: string, locale: string | undefined, t: TFunction): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffSeconds = Math.round((Date.now() - then) / 1000);
  if (diffSeconds < 60) return t('time.justNow');
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('time.daysAgo', { count: days });
  return formatDate(iso, locale);
}

/** Countdown used by the escrow auto-release banner. */
export function timeLeft(iso: string | null, t: TFunction): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;

  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return t('time.inDays', { count: Math.floor(hours / 24) });
  if (hours >= 1) return t('time.inHours', { count: hours });
  return t('time.inMinutes', { count: Math.max(1, Math.floor(ms / 60_000)) });
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function shortWallet(address: string | null | undefined): string {
  if (!address) return '—';
  return address.length <= 14 ? address : `${address.slice(0, 6)}…${address.slice(-5)}`;
}
