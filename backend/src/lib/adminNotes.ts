/**
 * Notes the server itself writes on a withdrawal request.
 *
 * They are stored as a code, not as English prose, so the admin panel can show
 * them in the operator's language: `@code` or `@code: detail`. A note an admin
 * typed by hand never starts with `@` and is shown exactly as written.
 */
export type AdminNoteCode =
  | 'cancelled_by_user'
  | 'rejected_by_admin'
  | 'auto_created'
  | 'payout_failed'
  | 'payout_unconfirmed'
  | 'reconciled_paid'
  | 'reconciled_restored';

export function adminNote(code: AdminNoteCode, detail?: string | null): string {
  return (detail ? `@${code}: ${detail}` : `@${code}`).slice(0, 500);
}
