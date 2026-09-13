/**
 * Who is on the account.
 *
 * There is no "people" table: a household member exists because at least one
 * case is assigned to their label. The distinct labels across an account's
 * cases are the household, and their count is what HOUSEHOLD_MEMBERS limits.
 * Labels are matched without regard to case, so "maya" and "Maya" are one
 * person and the first spelling wins.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface HouseholdMember {
  readonly label: string;
  readonly relationship: string | null;
  readonly caseCount: number;
}

export async function listHousehold(admin: SupabaseClient, userId: string): Promise<HouseholdMember[]> {
  const { data } = await admin
    .from('case_members')
    .select('member_label, relationship, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const byKey = new Map<string, { label: string; relationship: string | null; caseCount: number }>();
  for (const row of (data ?? []) as { member_label: string; relationship: string | null }[]) {
    const key = row.member_label.trim().toLowerCase();
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { label: row.member_label.trim(), relationship: row.relationship, caseCount: 1 });
    } else {
      existing.caseCount += 1;
      if (existing.relationship === null && row.relationship !== null) existing.relationship = row.relationship;
    }
  }
  return [...byKey.values()];
}

export async function countHouseholdMembers(
  admin: SupabaseClient,
  userId: string,
): Promise<{ labels: string[] }> {
  const members = await listHousehold(admin, userId);
  return { labels: members.map((m) => m.label) };
}
