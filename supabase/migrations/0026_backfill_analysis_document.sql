-- 0026_backfill_analysis_document.sql
-- Which document a check checked.
--
-- Until September 2026 a check run from the upload flow was recorded
-- without the document its figures came from (document_id null); only the
-- comparison page recorded both documents. A case's next step is decided
-- from that link (src/lib/cases/next-step.ts: a bill counts as checked
-- when a completed check names it), so the old rows are filled in where
-- the answer is unambiguous: a completed bill check on a case that had
-- exactly one kept bill when the check ran. Everything else is left as it
-- is. For those rows the application treats an unattributed check that
-- ran after a bill arrived as that bill's check, which covers them.
--
-- Idempotent: a second run finds nothing left to fill.

update public.analyses a
set document_id = one.document_id
from (
  select
    a2.id as analysis_id,
    min(d2.id::text)::uuid as document_id
  from public.analyses a2
  join public.documents d2
    on d2.case_id = a2.case_id
   and d2.user_id = a2.user_id
   and d2.deleted_at is null
   and d2.scan_status = 'CLEAN'
   and d2.document_type in ('BILL', 'ITEMIZED_BILL', 'STATEMENT')
   and d2.created_at <= a2.created_at
  where a2.document_id is null
    and a2.compare_document_id is null
    and a2.status = 'COMPLETED'
    and a2.analysis_type = 'BILL_CONSISTENCY'
  group by a2.id
  having count(*) = 1
) one
where a.id = one.analysis_id;
