/**
 * What is coming up across an account's cases, for the home page.
 *
 * Open reminders and dates from every case, as one list the domain sorts and
 * trims. Nothing here decides what matters; it reads what the customer set.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { upcoming, type DueItem } from '@/domain/reminders/notice';

export async function loadUpcoming(
  admin: SupabaseClient,
  userId: string,
  cases: readonly { id: string; title: string }[],
  now: Date = new Date(),
): Promise<DueItem[]> {
  if (cases.length === 0) return [];
  const ids = cases.map((c) => c.id);
  const titleById = new Map(cases.map((c) => [c.id, c.title]));

  const [{ data: reminders }, { data: deadlines }] = await Promise.all([
    admin
      .from('reminders')
      .select('id, case_id, title, remind_at')
      .eq('user_id', userId)
      .in('case_id', ids)
      .is('completed_at', null)
      .order('remind_at', { ascending: true })
      .limit(100),
    admin
      .from('deadlines')
      .select('id, case_id, label, due_date, is_verified')
      .eq('user_id', userId)
      .in('case_id', ids)
      .is('completed_at', null)
      .order('due_date', { ascending: true })
      .limit(100),
  ]);

  const items: DueItem[] = [
    ...((reminders ?? []) as { id: string; case_id: string; title: string; remind_at: string }[]).map((r) => ({
      id: r.id,
      caseId: r.case_id,
      caseTitle: titleById.get(r.case_id) ?? 'Case',
      kind: 'reminder' as const,
      label: r.title,
      at: r.remind_at,
      verified: false,
      completed: false,
    })),
    ...((deadlines ?? []) as { id: string; case_id: string; label: string; due_date: string; is_verified: boolean }[]).map((d) => ({
      id: d.id,
      caseId: d.case_id,
      caseTitle: titleById.get(d.case_id) ?? 'Case',
      kind: 'deadline' as const,
      label: d.label,
      at: d.due_date,
      verified: d.is_verified,
      completed: false,
    })),
  ];

  return upcoming(items, now, 14);
}
