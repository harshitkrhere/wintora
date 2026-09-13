/**
 * Shared shapes for the reminder and deadline routes.
 *
 * Kept out of the route files because a Next.js route module may export only
 * its handlers, and because two routes each (list/create on the case,
 * update/delete on the item) share exactly this.
 */

export const REMINDER_COLUMNS =
  'id, case_id, title, detail, remind_at, completed_at, notified_at, created_at';

export function publicReminder(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    caseId: row.case_id,
    title: row.title,
    detail: row.detail,
    remindAt: row.remind_at,
    completedAt: row.completed_at,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
  };
}

export const DEADLINE_COLUMNS =
  'id, case_id, label, due_date, is_verified, user_entered, source_id, notes, completed_at, created_at';

export function publicDeadline(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    caseId: row.case_id,
    label: row.label,
    dueDate: row.due_date,
    verified: row.is_verified === true,
    userEntered: row.user_entered === true,
    notes: row.notes,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
