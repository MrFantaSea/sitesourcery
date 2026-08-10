-- DIRECT-REVERSAL-02: direct/no-credit Custom receipts join the existing
-- evidence-first professional reversal lifecycle without manufacturing an
-- assessment credit application. The credited branches below are retained
-- unchanged; the three new branches are disjoint, explicit direct authority.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v108()') is null
    or to_regprocedure('ss.custom_build_direct_contract_v1()') is null
    or to_regclass('ss.service_professional_payment_bindings') is null
    or to_regclass('ss.service_custom_build_invoices') is null
    or to_regclass('ss.service_custom_build_payment_receipts') is null
    or to_regclass('ss.service_custom_build_change_payment_receipts') is null
    or to_regclass('ss.service_custom_build_final_payment_receipts') is null
  then
    raise exception
      'Professional reversals and direct Custom authority must precede DIRECT-REVERSAL-02'
      using errcode = '55000';
  end if;
end
$$;

-- CREATE OR REPLACE preserves every existing dependent read boundary. The
-- four original normalized branches remain byte-for-byte equivalent; only
-- the three explicitly direct/no-credit branches are additive.
create or replace view ss.service_professional_payment_bindings as
select
  'assessment'::text as payment_purpose,
  receipt.id as receipt_id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  coalesce(application.state, 'none') as credit_state,
  coalesce(quote.state, 'none') as quote_state
from ss.service_assessment_payment_receipts receipt
left join ss.service_credit_grants credit
  on credit.organization_id = receipt.organization_id
 and credit.source_payment_receipt_id = receipt.id
left join lateral (
  select selected.state
  from ss.service_credit_applications selected
  where selected.organization_id = credit.organization_id
    and selected.credit_grant_id = credit.id
  order by selected.created_at desc, selected.id desc
  limit 1
) application on true
left join ss.service_assessment_reports report
  on report.organization_id = receipt.organization_id
 and report.payment_receipt_id = receipt.id
left join lateral (
  select selected.state
  from ss.service_custom_build_quotes selected
  where selected.organization_id = receipt.organization_id
    and selected.source_report_id = report.id
  order by selected.created_at desc, selected.id desc
  limit 1
) quote on true

union all

select
  'custom_build_initial'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  application.state,
  quote.state
from ss.service_custom_build_payment_receipts receipt
join ss.service_credit_applications application
  on application.organization_id = receipt.organization_id
 and application.id = receipt.credit_application_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = application.organization_id
 and quote.id = application.quote_id

union all

select
  'custom_build_change'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  application.state,
  quote.state
from ss.service_custom_build_change_payment_receipts receipt
join ss.service_custom_build_jobs job
  on job.organization_id = receipt.organization_id
 and job.id = receipt.job_id
join ss.service_custom_build_payment_receipts initial_receipt
  on initial_receipt.organization_id = job.organization_id
 and initial_receipt.id = job.payment_receipt_id
join ss.service_credit_applications application
  on application.organization_id = initial_receipt.organization_id
 and application.id = initial_receipt.credit_application_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = application.organization_id
 and quote.id = application.quote_id

union all

select
  'custom_build_final'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  application.state,
  quote.state
from ss.service_custom_build_final_payment_receipts receipt
join ss.service_custom_build_jobs job
  on job.organization_id = receipt.organization_id
 and job.id = receipt.job_id
join ss.service_custom_build_payment_receipts initial_receipt
  on initial_receipt.organization_id = job.organization_id
 and initial_receipt.id = job.payment_receipt_id
join ss.service_credit_applications application
  on application.organization_id = initial_receipt.organization_id
 and application.id = initial_receipt.credit_application_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = application.organization_id
 and quote.id = application.quote_id

union all

select
  'custom_build_initial'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  'none'::text,
  quote.state
from ss.service_custom_build_payment_receipts receipt
join ss.service_custom_build_invoices invoice
  on invoice.organization_id = receipt.organization_id
 and invoice.id = receipt.invoice_id
 and invoice.project_id = receipt.project_id
 and invoice.case_id = receipt.case_id
 and invoice.customer_user_id = receipt.customer_user_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = invoice.organization_id
 and quote.id = invoice.quote_id
 and quote.project_id = invoice.project_id
 and quote.case_id = invoice.case_id
 and quote.customer_user_id = invoice.customer_user_id
where receipt.credit_application_id is null
  and invoice.credit_application_id is null
  and invoice.credit_minor = 0
  and quote.origin = 'direct'
  and quote.credit_selection = 'no_credit'

union all

select
  'custom_build_change'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  'none'::text,
  quote.state
from ss.service_custom_build_change_payment_receipts receipt
join ss.service_custom_build_jobs job
  on job.organization_id = receipt.organization_id
 and job.id = receipt.job_id
 and job.project_id = receipt.project_id
 and job.case_id = receipt.case_id
 and job.customer_user_id = receipt.customer_user_id
join ss.service_custom_build_payment_receipts initial_receipt
  on initial_receipt.organization_id = job.organization_id
 and initial_receipt.id = job.payment_receipt_id
 and initial_receipt.project_id = job.project_id
 and initial_receipt.case_id = job.case_id
 and initial_receipt.customer_user_id = job.customer_user_id
join ss.service_custom_build_invoices invoice
  on invoice.organization_id = initial_receipt.organization_id
 and invoice.id = initial_receipt.invoice_id
 and invoice.project_id = initial_receipt.project_id
 and invoice.case_id = initial_receipt.case_id
 and invoice.customer_user_id = initial_receipt.customer_user_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = job.organization_id
 and quote.id = job.quote_id
 and quote.id = invoice.quote_id
 and quote.project_id = job.project_id
 and quote.case_id = job.case_id
 and quote.customer_user_id = job.customer_user_id
where initial_receipt.credit_application_id is null
  and invoice.credit_application_id is null
  and invoice.credit_minor = 0
  and job.start_credit_minor = 0
  and quote.origin = 'direct'
  and quote.credit_selection = 'no_credit'

union all

select
  'custom_build_final'::text,
  receipt.id,
  receipt.organization_id,
  receipt.project_id,
  receipt.customer_user_id,
  receipt.payment_intent_id,
  receipt.total_minor,
  receipt.currency,
  'none'::text,
  quote.state
from ss.service_custom_build_final_payment_receipts receipt
join ss.service_custom_build_jobs job
  on job.organization_id = receipt.organization_id
 and job.id = receipt.job_id
 and job.project_id = receipt.project_id
 and job.case_id = receipt.case_id
 and job.customer_user_id = receipt.customer_user_id
join ss.service_custom_build_payment_receipts initial_receipt
  on initial_receipt.organization_id = job.organization_id
 and initial_receipt.id = job.payment_receipt_id
 and initial_receipt.project_id = job.project_id
 and initial_receipt.case_id = job.case_id
 and initial_receipt.customer_user_id = job.customer_user_id
join ss.service_custom_build_invoices invoice
  on invoice.organization_id = initial_receipt.organization_id
 and invoice.id = initial_receipt.invoice_id
 and invoice.project_id = initial_receipt.project_id
 and invoice.case_id = initial_receipt.case_id
 and invoice.customer_user_id = initial_receipt.customer_user_id
join ss.service_custom_build_quotes quote
  on quote.organization_id = job.organization_id
 and quote.id = job.quote_id
 and quote.id = invoice.quote_id
 and quote.project_id = job.project_id
 and quote.case_id = job.case_id
 and quote.customer_user_id = job.customer_user_id
where initial_receipt.credit_application_id is null
  and invoice.credit_application_id is null
  and invoice.credit_minor = 0
  and job.start_credit_minor = 0
  and quote.origin = 'direct'
  and quote.credit_selection = 'no_credit';

revoke all on ss.service_professional_payment_bindings
from public, anon, authenticated, service_role;

create function ss.direct_custom_reversal_normalization_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-direct-custom-reversal-normalization-v1-held'::text
$$;

revoke all on function
  ss.direct_custom_reversal_normalization_contract_v1()
from public, anon, authenticated;
grant execute on function
  ss.direct_custom_reversal_normalization_contract_v1()
to service_role;

commit;
