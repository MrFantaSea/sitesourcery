-- FIN-007: converge every newly-issued held commercial record on the approved
-- SS-COMMERCIAL-2026.6 catalog while preserving all historical identities and
-- amounts. This migration creates no provider, payment, publication, or Care
-- activation authority.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_mail_purpose_notification_contract_v1()') is null
    or to_regclass('ss.service_catalog_policies') is null
    or to_regclass('ss.care_catalog_identities') is null
    or to_regclass('ss.care_commerce_quotes') is null
  then
    raise exception
      'Site Sourcery migration 140 and the retained commercial foundations must precede FIN-007 convergence'
      using errcode = '55000';
  end if;
end
$$;

insert into ss.legal_documents (
  id, kind, version, content_digest, content_uri, effective_at
) values (
  '00000000-0000-4000-8000-000000001410',
  'custom_services',
  'SS-CUSTOM-SERVICES-2026-08-19.2',
  '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d',
  'urn:sitesourcery:custom-services:2026-08-19.2',
  '2026-08-19T00:00:00Z'
);

insert into ss.service_catalog_policies (
  id, catalog_version, service_key, display_name, pricing_mode,
  billing_cadence, currency, unit_amount_minor, unit_label,
  minimum_quantity, maximum_quantity, scope_boundary, legal_document_id,
  commercial_contract_id, commercial_contract_digest, publication_state,
  active_from
)
select
  '00000000-0000-4000-8000-000000001411',
  'SS-PROFESSIONAL-2026.2',
  'website_assessment_standard',
  'Website assessment',
  'fixed', 'one_time', 'USD', 35000, 'assessment', 1, 1,
  jsonb_build_object(
    'catalogDigest',
      '3416befc73dccbf2f8dc0f40233d4cd7c1833e4e329bd1047ce8bf41fd2e4de0',
    'credit', jsonb_build_object(
      'amountMinor', 35000,
      'applicationScope', 'custom_base_build',
      'maximumApplications', 1,
      'nonCash', true,
      'sameOrganizationAndProjectOnly', true
    ),
    'deliverable',
      'written assessment with screenshot evidence and real findings ranked by severity',
    'expandedAssessmentState', 'separately_quoted',
    'maximumFindings', 10,
    'maximumRepresentativePagesOrTypes', 5,
    'maximumWebsites', 1,
    'requiredViewports', jsonb_build_array('desktop', 'phone'),
    'scopeState', 'must_be_stated_before_sale',
    'turnaroundState', 'must_be_stated_before_sale',
    'taxDisplay', 'exclusive',
    'taxState', 'disabled_by_owner'
  ),
  document.id, document.version, document.content_digest,
  'held', '2026-08-19T00:00:00Z'
from ss.legal_documents document
where document.id = '00000000-0000-4000-8000-000000001410';

insert into ss.service_catalog_coverage (
  policy_id, coverage_key, coverage_mode, scope_identity_kind,
  boundary_digest
)
select
  policy.id, coverage.coverage_key, 'includes', coverage.identity_kind,
  policy.scope_boundary_digest
from ss.service_catalog_policies policy
cross join (
  values
    ('public_site_inventory', 'project'),
    ('representative_page_review', 'page_set'),
    ('screenshot_findings', 'page_set')
) as coverage(coverage_key, identity_kind)
where policy.id = '00000000-0000-4000-8000-000000001411';

insert into ss.service_catalog_policies (
  id, catalog_version, service_key, display_name, pricing_mode,
  billing_cadence, currency, unit_amount_minor, unit_label,
  minimum_quantity, maximum_quantity, scope_boundary, legal_document_id,
  commercial_contract_id, commercial_contract_digest, publication_state,
  active_from
)
select
  tier.policy_id,
  'SS-TIERS-2026.6',
  'custom_build_' || replace(tier.tier_id, '-', '_'),
  tier.label || ' Custom website build',
  tier.pricing_mode,
  'one_time', 'USD', tier.amount_minor, 'base build', 1, 1,
  jsonb_build_object(
    'assessmentCredit', jsonb_build_object(
      'amountMinor', 35000,
      'applicationScope', 'custom_base_build',
      'currency', 'USD',
      'maximumApplications', 1,
      'nonCash', true,
      'sameOrganizationAndProjectOnly', true
    ),
    'baseBuild', jsonb_build_object(
      'amountMinor', tier.amount_minor,
      'limits', jsonb_build_object(
        'contentWords', tier.maximum_words,
        'craftedPages', tier.maximum_pages,
        'sections', tier.maximum_sections,
        'suppliedMedia', tier.maximum_media,
        'uniqueLayouts', tier.maximum_layouts
      ),
      'tierId', tier.tier_id
    ),
    'catalogDigest',
      '3416befc73dccbf2f8dc0f40233d4cd7c1833e4e329bd1047ce8bf41fd2e4de0',
    'creativityLevel', 'essential',
    'paymentSchedules', jsonb_build_object(
      'cardThroughCardPlus', 'full_before_work',
      'siteThroughScale', 'half_before_work_half_before_handoff'
    ),
    'scale', case when tier.tier_id = 'scale' then jsonb_build_object(
      'allowancePerUnit', jsonb_build_object(
        'contentWords', 500, 'craftedPages', 1, 'sections', 4,
        'suppliedMedia', 4, 'uniqueLayouts', 1
      ),
      'baseAmountMinor', 360000,
      'baseTierId', 'flagship',
      'maximumCapacityUnits', 15,
      'minimumCapacityUnits', 1,
      'unitAmountMinor', 24000
    ) else null end,
    'taxDisplay', 'exclusive',
    'taxState', 'disabled_by_owner',
    'workmanshipCorrectionDays', 30
  ),
  document.id, document.version, document.content_digest,
  'held', '2026-08-19T00:00:00Z'
from (
  values
    ('00000000-0000-4000-8000-000000001412'::uuid, 'card',
      'Card', 'fixed', 35000::bigint, 1, 5, 1, 500, 2),
    ('00000000-0000-4000-8000-000000001413'::uuid, 'card-plus',
      'Card Plus', 'fixed', 60000::bigint, 1, 8, 1, 900, 8),
    ('00000000-0000-4000-8000-000000001414'::uuid, 'site',
      'Site', 'fixed', 100000::bigint, 4, 16, 4, 1800, 12),
    ('00000000-0000-4000-8000-000000001415'::uuid, 'site-plus',
      'Site Plus', 'fixed', 160000::bigint, 7, 28, 7, 3000, 24),
    ('00000000-0000-4000-8000-000000001416'::uuid, 'signature',
      'Signature', 'fixed', 240000::bigint, 10, 40, 10, 4500, 36),
    ('00000000-0000-4000-8000-000000001417'::uuid, 'flagship',
      'Flagship', 'fixed', 360000::bigint, 15, 60, 15, 7000, 60),
    ('00000000-0000-4000-8000-000000001418'::uuid, 'scale',
      'Scale', 'banded', null::bigint, 30, 120, 30, 14500, 120)
) as tier(
  policy_id, tier_id, label, pricing_mode, amount_minor, maximum_pages,
  maximum_sections, maximum_layouts, maximum_words, maximum_media
)
cross join ss.legal_documents document
where document.id = '00000000-0000-4000-8000-000000001410';

insert into ss.service_catalog_coverage (
  policy_id, coverage_key, coverage_mode, scope_identity_kind,
  boundary_digest
)
select policy.id, coverage.coverage_key, 'includes', 'project',
  policy.scope_boundary_digest
from ss.service_catalog_policies policy
cross join (
  values ('custom_base_build'), ('essential_design'),
    ('responsive_build'), ('workmanship_correction')
) as coverage(coverage_key)
where policy.id between
  '00000000-0000-4000-8000-000000001412'::uuid and
  '00000000-0000-4000-8000-000000001418'::uuid;

-- Historical and successor Care identities coexist. All successor plans stay
-- held and bind to the exact successor legal/catalog contract.
alter table ss.care_catalog_identities
  drop constraint care_catalog_identities_catalog_version_check,
  add constraint care_catalog_identities_catalog_version_check
    check (catalog_version in ('SS-CARE-CORE-2026.1', 'SS-CARE-CORE-2026.2')),
  drop constraint care_catalog_identities_contract_kind_check,
  add constraint care_catalog_identities_contract_kind_check
    check (contract_kind in (
      'rescue', 'custom_care', 'outside_management', 'alakazam_care',
      'catalog_care'
    )),
  drop constraint care_catalog_identities_check1,
  add constraint care_catalog_identities_shape_check
    check (
      (contract_kind = 'rescue' and site_origin = 'any_supported'
        and billing_cadence = 'one_time' and capacity_unit_kind = 'repair_unit')
      or (contract_kind = 'custom_care' and site_origin = 'sitesourcery_custom'
        and billing_cadence = 'month' and capacity_unit_kind = 'repair_unit')
      or (contract_kind = 'outside_management' and site_origin = 'external'
        and billing_cadence = 'month' and capacity_unit_kind = 'repair_unit')
      or (contract_kind = 'alakazam_care' and site_origin = 'alakazam'
        and billing_cadence = 'month' and capacity_unit_kind = 'care_request')
      or (contract_kind = 'catalog_care' and site_origin = 'sitesourcery_custom'
        and billing_cadence = 'month' and capacity_unit_kind = 'care_request')
    );

insert into ss.care_catalog_identities (
  id, catalog_version, service_key, contract_kind, site_origin,
  billing_cadence, capacity_unit_kind, commercial_authority_state,
  commercial_contract_id, commercial_contract_digest, legal_document_id
) values
  ('00000000-0000-4000-8000-000000001421', 'SS-CARE-CORE-2026.2',
    'plan_host', 'catalog_care', 'sitesourcery_custom', 'month',
    'care_request', 'exact_held', 'SS-CUSTOM-SERVICES-2026-08-19.2',
    '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d',
    '00000000-0000-4000-8000-000000001410'),
  ('00000000-0000-4000-8000-000000001422', 'SS-CARE-CORE-2026.2',
    'plan_care_lite', 'catalog_care', 'sitesourcery_custom', 'month',
    'care_request', 'exact_held', 'SS-CUSTOM-SERVICES-2026-08-19.2',
    '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d',
    '00000000-0000-4000-8000-000000001410'),
  ('00000000-0000-4000-8000-000000001423', 'SS-CARE-CORE-2026.2',
    'plan_care', 'catalog_care', 'sitesourcery_custom', 'month',
    'care_request', 'exact_held', 'SS-CUSTOM-SERVICES-2026-08-19.2',
    '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d',
    '00000000-0000-4000-8000-000000001410'),
  ('00000000-0000-4000-8000-000000001424', 'SS-CARE-CORE-2026.2',
    'plan_care_plus', 'catalog_care', 'sitesourcery_custom', 'month',
    'care_request', 'exact_held', 'SS-CUSTOM-SERVICES-2026-08-19.2',
    '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d',
    '00000000-0000-4000-8000-000000001410'),
  ('00000000-0000-4000-8000-000000001425', 'SS-CARE-CORE-2026.2',
    'plan_partner', 'catalog_care', 'sitesourcery_custom', 'month',
    'care_request', 'exact_held', 'SS-CUSTOM-SERVICES-2026-08-19.2',
    '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d',
    '00000000-0000-4000-8000-000000001410');

alter table ss.care_commerce_quotes
  drop constraint care_commerce_quotes_catalog_version_check,
  add constraint care_commerce_quotes_catalog_version_check
    check (catalog_version in (
      'SS-CARE-COMMERCE-2026.1', 'SS-CARE-COMMERCE-2026.2'
    )),
  drop constraint care_commerce_quotes_care_core_catalog_version_check,
  add constraint care_commerce_quotes_care_core_catalog_version_check
    check (care_core_catalog_version in (
      'SS-CARE-CORE-2026.1', 'SS-CARE-CORE-2026.2'
    )),
  drop constraint care_commerce_quotes_price_version_check,
  add constraint care_commerce_quotes_price_version_check
    check (price_version in (
      'SS-CUSTOM-SERVICES-2026-08-05.1', 'SS-COMMERCIAL-2026.6'
    )),
  drop constraint care_commerce_quotes_commercial_contract_digest_check,
  add constraint care_commerce_quotes_commercial_contract_digest_check
    check (commercial_contract_digest in (
      '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8',
      '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d'
    ));

-- Price/tax constraints admit retained historical rows and the successor
-- values. Contract-bound tables additionally require the matching exact pair.
alter table ss.service_quote_revisions
  drop constraint service_quote_revisions_service_amount_minor_check,
  add constraint service_quote_revisions_service_amount_minor_check
    check (service_amount_minor in (20000, 35000)),
  drop constraint service_quote_revisions_subtotal_minor_check,
  add constraint service_quote_revisions_subtotal_minor_check
    check (subtotal_minor in (20000, 35000)),
  drop constraint service_quote_revisions_tax_state_check,
  add constraint service_quote_revisions_tax_state_check
    check (tax_state in ('calculation_required', 'disabled_by_owner')),
  drop constraint service_quote_revisions_check5,
  add constraint service_quote_revisions_contract_identity_check
    check (
      (commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-05.1'
        and commercial_contract_digest =
          '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
        and service_amount_minor = 20000
        and subtotal_minor = 20000
        and tax_state = 'calculation_required')
      or
      (commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-19.2'
        and commercial_contract_digest =
          '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d'
        and service_amount_minor = 35000
        and subtotal_minor = 35000
        and tax_state = 'disabled_by_owner')
    );

alter table ss.service_quote_lines
  drop constraint service_quote_lines_unit_amount_minor_check,
  add constraint service_quote_lines_unit_amount_minor_check
    check (unit_amount_minor in (20000, 35000)),
  drop constraint service_quote_lines_customer_amount_minor_check,
  add constraint service_quote_lines_customer_amount_minor_check
    check (customer_amount_minor in (20000, 35000));

alter table ss.service_quote_installments
  drop constraint service_quote_installments_amount_minor_check,
  add constraint service_quote_installments_amount_minor_check
    check (amount_minor in (20000, 35000));

alter table ss.service_invoices
  drop constraint service_invoices_subtotal_minor_check,
  add constraint service_invoices_subtotal_minor_check
    check (subtotal_minor in (20000, 35000)),
  drop constraint service_invoices_tax_state_check,
  add constraint service_invoices_tax_state_check
    check (tax_state in ('calculation_required', 'disabled_by_owner'));

alter table ss.service_invoice_lines
  drop constraint service_invoice_lines_unit_amount_minor_check,
  add constraint service_invoice_lines_unit_amount_minor_check
    check (unit_amount_minor in (20000, 35000)),
  drop constraint service_invoice_lines_subtotal_minor_check,
  add constraint service_invoice_lines_subtotal_minor_check
    check (subtotal_minor in (20000, 35000));

alter table ss.service_payment_reservations
  drop constraint service_payment_reservations_expected_subtotal_minor_check,
  add constraint service_payment_reservations_expected_subtotal_minor_check
    check (expected_subtotal_minor in (20000, 35000)),
  drop constraint service_payment_reservations_hold_reason_check,
  add constraint service_payment_reservations_hold_reason_check
    check (hold_reason in (
      'tax_calculation_required', 'tax_disabled_by_owner'
    ));

alter table ss.service_assessment_checkout_attempts
  drop constraint service_assessment_checkout_attem_expected_subtotal_minor_check,
  add constraint service_assessment_checkout_attempts_subtotal_check
    check (expected_subtotal_minor in (20000, 35000));

alter table ss.service_assessment_payment_receipts
  drop constraint service_assessment_payment_receipts_subtotal_minor_check,
  add constraint service_assessment_payment_receipts_subtotal_minor_check
    check (subtotal_minor in (20000, 35000));

alter table ss.service_credit_grants
  drop constraint service_credit_grants_amount_minor_check,
  add constraint service_credit_grants_amount_minor_check
    check (amount_minor in (20000, 35000));

alter table ss.service_custom_build_quote_revisions
  drop constraint service_custom_build_quote_revisions_service_amount_minor_check,
  add constraint service_custom_build_quote_revisions_service_amount_minor_check
    check (service_amount_minor >= 35000),
  drop constraint service_custom_build_quote_revisions_credit_amount_minor_check,
  add constraint service_custom_build_quote_revisions_credit_amount_minor_check
    check (credit_amount_minor in (0, 20000, 35000)),
  drop constraint service_custom_build_quote_revisions_start_credit_minor_check,
  add constraint service_custom_build_quote_revisions_start_credit_minor_check
    check (start_credit_minor in (0, 20000, 35000)),
  drop constraint service_custom_build_quote_revisions_credit_authority_check,
  add constraint service_custom_build_quote_revisions_credit_authority_check
    check (
      (credit_amount_minor = 0 and credit_grant_id is null
        and credit_digest is null and credit_acceptance_cutoff is null
        and start_credit_minor = 0)
      or (credit_amount_minor in (20000, 35000)
        and credit_grant_id is not null and credit_digest is not null
        and credit_acceptance_cutoff is not null
        and start_credit_minor = credit_amount_minor)
    ),
  drop constraint service_custom_build_quote_revisions_tax_state_check,
  add constraint service_custom_build_quote_revisions_tax_state_check
    check (tax_state in ('calculation_required', 'disabled_by_owner')),
  drop constraint service_custom_build_quote_revisions_check1,
  add constraint service_custom_build_quote_revisions_policy_identity_check
    check (
      policy_id = ss.custom_build_policy_id(tier_id)
      or (commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-05.1'
        and policy_id = case tier_id
          when 'card' then '00000000-0000-4000-8000-000000000411'::uuid
          when 'card-plus' then '00000000-0000-4000-8000-000000000412'::uuid
          when 'site' then '00000000-0000-4000-8000-000000000413'::uuid
          when 'site-plus' then '00000000-0000-4000-8000-000000000414'::uuid
          when 'signature' then '00000000-0000-4000-8000-000000000415'::uuid
          when 'flagship' then '00000000-0000-4000-8000-000000000416'::uuid
          when 'scale' then '00000000-0000-4000-8000-000000000417'::uuid
        end)
    ),
  drop constraint service_custom_build_quote_revisions_check3,
  add constraint service_custom_build_quote_revisions_amount_identity_check
    check (
      (commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-05.1'
        and service_amount_minor = case tier_id
          when 'card' then 40000 when 'card-plus' then 65000
          when 'site' then 120000 when 'site-plus' then 180000
          when 'signature' then 280000 when 'flagship' then 400000
          when 'scale' then 400000 + scale_units::bigint * 27000
        end)
      or (commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-19.2'
        and service_amount_minor = ss.custom_build_amount_minor(
          tier_id, scale_units
        ))
    ),
  drop constraint service_custom_build_quote_revisions_check14,
  add constraint service_custom_build_quote_revisions_contract_identity_check
    check (
      (commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-05.1'
        and commercial_contract_digest =
          '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
        and credit_amount_minor in (0, 20000)
        and tax_state = 'calculation_required')
      or
      (commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-19.2'
        and commercial_contract_digest =
          '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d'
        and credit_amount_minor in (0, 35000)
        and tax_state = 'disabled_by_owner')
    );

alter table ss.service_custom_build_quote_base_lines
  drop constraint service_custom_build_quote_base_lines_unit_amount_minor_check,
  add constraint service_custom_build_quote_base_lines_unit_amount_minor_check
    check (unit_amount_minor >= 35000),
  drop constraint service_custom_build_quote_base_lines_credit_amount_minor_check,
  add constraint service_custom_build_quote_base_lines_credit_amount_minor_check
    check (credit_amount_minor in (0, 20000, 35000));

alter table ss.service_custom_build_quote_installments
  drop constraint service_custom_build_quote_installmen_credit_amount_minor_check,
  add constraint service_custom_build_quote_installments_credit_amount_minor_check
    check (credit_amount_minor in (0, 20000, 35000)),
  drop constraint service_custom_build_quote_installments_kind_check,
  add constraint service_custom_build_quote_installments_kind_check
    check (
      (installment_number = 1 and installment_kind = 'start'
        and credit_amount_minor in (0, 20000, 35000)
        and due_trigger = 'before_work')
      or (installment_number = 2 and installment_kind = 'final'
        and credit_amount_minor = 0 and due_trigger = 'before_handoff')
    );

alter table ss.service_credit_applications
  drop constraint service_credit_applications_amount_minor_check,
  add constraint service_credit_applications_amount_minor_check
    check (amount_minor in (20000, 35000));

alter table ss.service_custom_build_invoices
  drop constraint service_custom_build_invoices_subtotal_minor_check,
  add constraint service_custom_build_invoices_subtotal_minor_check
    check (subtotal_minor >= 0),
  drop constraint service_custom_build_invoices_credit_minor_check,
  add constraint service_custom_build_invoices_credit_minor_check
    check (credit_minor in (0, 20000, 35000)),
  drop constraint service_custom_build_invoices_credit_authority_check,
  add constraint service_custom_build_invoices_credit_authority_check
    check (
      (credit_minor = 0 and credit_application_id is null)
      or (credit_minor in (20000, 35000)
        and credit_application_id is not null)
    ),
  drop constraint service_custom_build_invoices_tax_state_check,
  add constraint service_custom_build_invoices_tax_state_check
    check (tax_state in ('calculation_required', 'disabled_by_owner')),
  drop constraint service_custom_build_invoices_state_check,
  add constraint service_custom_build_invoices_state_check
    check (state in ('tax_calculation_pending', 'credit_settled')),
  drop constraint service_custom_build_invoices_check1,
  add constraint service_custom_build_invoices_settlement_state_check
    check (
      (subtotal_minor > 0
        and state = 'tax_calculation_pending'
        and payment_deadline = issued_at + interval '7 days')
      or
      (subtotal_minor = 0
        and state = 'credit_settled'
        and tier_id = 'card'
        and gross_start_minor = 35000
        and credit_minor = 35000
        and credit_application_id is not null
        and tax_state = 'disabled_by_owner'
        and payment_deadline = issued_at + interval '7 days')
    );

alter table ss.service_custom_build_invoice_lines
  drop constraint service_custom_build_invoice_lines_check,
  add constraint service_custom_build_invoice_lines_amount_check
    check (
      (line_number = 1 and component_key = 'custom_build_start'
        and amount_minor > 0)
      or (line_number = 2 and component_key = 'assessment_build_credit'
        and amount_minor in (-20000, -35000))
    );

alter table ss.service_custom_build_jobs
  alter column payment_receipt_id drop not null,
  add column start_settlement_kind text generated always as (
    case
      when payment_receipt_id is null then 'credit_only'
      else 'provider_payment'
    end
  ) stored,
  drop constraint service_custom_build_jobs_start_credit_minor_check,
  add constraint service_custom_build_jobs_start_credit_minor_check
    check (start_credit_minor in (0, 20000, 35000)),
  drop constraint service_custom_build_jobs_start_paid_subtotal_minor_check,
  add constraint service_custom_build_jobs_start_paid_subtotal_minor_check
    check (start_paid_subtotal_minor >= 0),
  add constraint service_custom_build_jobs_start_settlement_kind_check
    check (
      (start_settlement_kind = 'provider_payment'
        and payment_receipt_id is not null
        and start_paid_subtotal_minor > 0)
      or
      (start_settlement_kind = 'credit_only'
        and payment_receipt_id is null
        and tier_id = 'card'
        and start_gross_minor = 35000
        and start_credit_minor = 35000
        and start_paid_subtotal_minor = 0)
    );

alter table ss.service_custom_build_change_invoices
  drop constraint service_custom_build_change_invoices_tax_state_check,
  add constraint service_custom_build_change_invoices_tax_state_check
    check (tax_state in ('calculation_required', 'disabled_by_owner'));

alter table ss.service_custom_build_final_invoices
  drop constraint service_custom_build_final_invoices_tax_state_check,
  add constraint service_custom_build_final_invoices_tax_state_check
    check (tax_state in ('calculation_required', 'disabled_by_owner'));

-- New issue paths use the successor values. Historical rows retain their exact
-- stored identities and are admitted by the constraints above.
create or replace function ss.custom_build_amount_minor(
  selected_tier_id text,
  selected_scale_units integer
)
returns bigint
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case selected_tier_id
    when 'card' then 35000
    when 'card-plus' then 60000
    when 'site' then 100000
    when 'site-plus' then 160000
    when 'signature' then 240000
    when 'flagship' then 360000
    when 'scale' then case
      when selected_scale_units between 1 and 15
        then 360000 + selected_scale_units::bigint * 24000
      else null end
    else null
  end
$$;

create or replace function ss.custom_build_policy_id(selected_tier_id text)
returns uuid
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case selected_tier_id
    when 'card' then '00000000-0000-4000-8000-000000001412'::uuid
    when 'card-plus' then '00000000-0000-4000-8000-000000001413'::uuid
    when 'site' then '00000000-0000-4000-8000-000000001414'::uuid
    when 'site-plus' then '00000000-0000-4000-8000-000000001415'::uuid
    when 'signature' then '00000000-0000-4000-8000-000000001416'::uuid
    when 'flagship' then '00000000-0000-4000-8000-000000001417'::uuid
    when 'scale' then '00000000-0000-4000-8000-000000001418'::uuid
    else null
  end
$$;

create function pg_temp.rewrite_fin007_function(
  target regprocedure,
  old_values text[],
  new_values text[]
)
returns void
language plpgsql
as $$
declare
  definition text;
  position integer;
begin
  if cardinality(old_values) <> cardinality(new_values) then
    raise exception 'FIN-007 replacement arrays must have equal cardinality';
  end if;
  select pg_get_functiondef(target::oid) into strict definition;
  for position in 1..cardinality(old_values) loop
    if strpos(definition, old_values[position]) > 0 then
      definition := replace(
        definition, old_values[position], new_values[position]
      );
    end if;
  end loop;
  execute definition;
end
$$;

do $$
declare
  target regprocedure;
begin
  foreach target in array array[
    'ss.prepare_service_quote()'::regprocedure,
    'ss.prepare_service_quote_revision()'::regprocedure,
    'ss.materialize_standard_assessment_quote()'::regprocedure,
    'ss.ensure_service_assessment_invoice(uuid)'::regprocedure,
    'ss.guard_service_assessment_checkout_attempt()'::regprocedure,
    'ss.materialize_service_assessment_delivery()'::regprocedure
  ] loop
    perform pg_temp.rewrite_fin007_function(
      target,
      array[
        'tax_calculation_required', 'calculation_required',
        'SS-PROFESSIONAL-2026.1',
        'SS-CUSTOM-SERVICES-2026-08-05.1',
        '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8',
        '00000000-0000-4000-8000-000000000341',
        '00000000-0000-4000-8000-000000000342',
        '20000'
      ],
      array[
        'tax_disabled_by_owner', 'disabled_by_owner',
        'SS-PROFESSIONAL-2026.2',
        'SS-CUSTOM-SERVICES-2026-08-19.2',
        '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d',
        '00000000-0000-4000-8000-000000001411',
        '00000000-0000-4000-8000-000000001410',
        '35000'
      ]
    );
  end loop;
end
$$;

do $$
declare
  target regprocedure;
begin
  foreach target in array array[
    'ss.prepare_service_custom_build_quote_revision()'::regprocedure,
    'ss.prepare_service_custom_build_quote_acceptance()'::regprocedure,
    'ss.materialize_service_custom_build_acceptance()'::regprocedure,
    'ss.ensure_service_custom_build_invoice(uuid)'::regprocedure,
    'ss.guard_service_custom_build_checkout_attempt()'::regprocedure,
    'ss.ensure_service_custom_build_change_invoice(uuid)'::regprocedure,
    'ss.ensure_service_custom_build_final_obligation(uuid)'::regprocedure
  ] loop
    perform pg_temp.rewrite_fin007_function(
      target,
      array[
        'calculation_required', 'SS-PROFESSIONAL-2026.2',
        'SS-CUSTOM-SERVICES-2026-08-05.1',
        '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8',
        '00000000-0000-4000-8000-000000000342', '20000'
      ],
      array[
        'disabled_by_owner', 'SS-TIERS-2026.6',
        'SS-CUSTOM-SERVICES-2026-08-19.2',
        '0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d',
        '00000000-0000-4000-8000-000000001410', '35000'
      ]
    );
  end loop;
end
$$;

-- A successor Card build can be fully satisfied by the exact $350 assessment
-- credit. That is a noncash settlement: it opens the work record without
-- inventing a zero-dollar Stripe Checkout, event, or payment receipt.
create or replace function ss.guard_service_custom_build_settlement_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() = 'system'
    and ss.current_service_actor_org_id() is not distinct from new.organization_id
  then
    return new;
  end if;

  if tg_table_schema = 'ss'
    and tg_table_name = 'service_custom_build_jobs'
    and ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() is not distinct from new.organization_id
    and ss.current_service_actor_user_id() is not distinct from new.customer_user_id
    and new.payment_receipt_id is null
    and new.tier_id = 'card'
    and new.start_gross_minor = 35000
    and new.start_credit_minor = 35000
    and new.start_paid_subtotal_minor = 0
    and new.purpose = 'custom_build'
    and new.state = 'open'
    and exists (
      select 1
      from ss.service_custom_build_invoices invoice
      join ss.service_credit_applications application
        on application.organization_id = invoice.organization_id
       and application.id = invoice.credit_application_id
      join ss.service_custom_build_quote_revisions revision
        on revision.organization_id = invoice.organization_id
       and revision.quote_id = invoice.quote_id
       and revision.quote_revision = invoice.quote_revision
       and revision.id = invoice.quote_revision_id
      where invoice.organization_id = new.organization_id
        and invoice.id = new.invoice_id
        and invoice.project_id = new.project_id
        and invoice.case_id = new.case_id
        and invoice.customer_user_id = new.customer_user_id
        and invoice.quote_id = new.quote_id
        and invoice.quote_revision = new.quote_revision
        and invoice.quote_revision_id = new.quote_revision_id
        and invoice.quote_acceptance_id = new.quote_acceptance_id
        and invoice.policy_id = new.policy_id
        and invoice.scope_boundary_digest = new.scope_boundary_digest
        and invoice.tier_id = new.tier_id
        and invoice.accepted_quote_digest = new.accepted_quote_digest
        and invoice.accepted_disclosure_digest = new.accepted_disclosure_digest
        and invoice.gross_start_minor = new.start_gross_minor
        and invoice.credit_minor = new.start_credit_minor
        and invoice.subtotal_minor = new.start_paid_subtotal_minor
        and invoice.final_due_minor = new.final_due_minor
        and invoice.currency = new.currency
        and invoice.state = 'credit_settled'
        and invoice.charge_occurred = false
        and invoice.issued_at = new.opened_at
        and application.state = 'reserved'
        and application.amount_minor = 35000
        and revision.commercial_contract_id =
          'SS-CUSTOM-SERVICES-2026-08-19.2'
        and revision.scope_statement = new.scope_statement
        and revision.crafted_pages = new.crafted_pages
        and revision.sections = new.sections
        and revision.unique_layouts = new.unique_layouts
        and revision.content_words = new.content_words
        and revision.supplied_media = new.supplied_media
        and revision.target_completion_date = new.target_completion_date
        and not exists (
          select 1
          from ss.service_custom_build_checkout_attempts attempt
          where attempt.organization_id = invoice.organization_id
            and attempt.invoice_id = invoice.id
        )
        and not exists (
          select 1
          from ss.service_custom_build_stripe_events event
          where event.organization_id = invoice.organization_id
            and event.invoice_id = invoice.id
        )
        and not exists (
          select 1
          from ss.service_custom_build_payment_receipts receipt
          where receipt.organization_id = invoice.organization_id
            and receipt.invoice_id = invoice.id
        )
    )
  then
    return new;
  end if;

  raise exception 'Custom build settlement mutation lacks exact authority'
    using errcode = '42501';
end
$$;

create or replace function ss.guard_service_credit_application()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'service credit application history is append-only'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'reserved'
      or new.reserved_at is null
      or new.settled_at is not null
      or new.released_at is not null
      or ss.current_service_actor_kind() <> 'customer'
      or ss.current_service_actor_org_id() is distinct from new.organization_id
      or ss.current_service_actor_user_id() is distinct from new.customer_user_id
      or not exists (
        select 1
        from ss.service_custom_build_quote_acceptances acceptance
        join ss.service_custom_build_quote_revisions revision
          on revision.organization_id = acceptance.organization_id
         and revision.quote_id = acceptance.quote_id
         and revision.quote_revision = acceptance.quote_revision
         and revision.id = acceptance.quote_revision_id
        where acceptance.organization_id = new.organization_id
          and acceptance.id = new.quote_acceptance_id
          and acceptance.quote_id = new.quote_id
          and acceptance.customer_user_id = new.customer_user_id
          and revision.project_id = new.project_id
          and revision.credit_grant_id = new.credit_grant_id
          and revision.credit_digest = new.credit_digest
          and revision.credit_amount_minor = new.amount_minor
          and revision.currency = new.currency
      )
    then
      raise exception 'service credit reservation lacks exact acceptance evidence'
        using errcode = '42501';
    end if;
    new.created_at := new.reserved_at;
    new.updated_at := new.reserved_at;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.credit_grant_id, new.credit_digest, new.quote_id,
    new.quote_acceptance_id, new.amount_minor, new.currency,
    new.reserved_at, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.credit_grant_id, old.credit_digest, old.quote_id,
    old.quote_acceptance_id, old.amount_minor, old.currency,
    old.reserved_at, old.created_at
  ) or old.state <> 'reserved'
  then
    raise exception 'service credit application identity or source state changed'
      using errcode = '55000';
  end if;

  if new.state = 'released'
    and new.settled_at is null
    and new.released_at is not null
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(), 'service_quote_author', new.released_at
    )
    and exists (
      select 1 from ss.service_custom_build_quote_voids quote_void
      where quote_void.quote_id = old.quote_id
        and quote_void.organization_id = old.organization_id
        and quote_void.voided_at = new.released_at
    )
  then
    new.updated_at := new.released_at;
    return new;
  end if;

  if new.state = 'settled'
    and new.settled_at is not null
    and new.released_at is null
    and ss.current_service_actor_kind() = 'system'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and exists (
      select 1
      from ss.service_custom_build_payment_receipts receipt
      where receipt.organization_id = old.organization_id
        and receipt.credit_application_id = old.id
        and receipt.settled_at = new.settled_at
    )
  then
    new.updated_at := new.settled_at;
    return new;
  end if;

  if new.state = 'settled'
    and new.settled_at is not null
    and new.released_at is null
    and old.amount_minor = 35000
    and ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and ss.current_service_actor_user_id() is not distinct from old.customer_user_id
    and exists (
      select 1
      from ss.service_custom_build_invoices invoice
      join ss.service_custom_build_jobs job
        on job.organization_id = invoice.organization_id
       and job.invoice_id = invoice.id
      where invoice.organization_id = old.organization_id
        and invoice.credit_application_id = old.id
        and invoice.quote_acceptance_id = old.quote_acceptance_id
        and invoice.customer_user_id = old.customer_user_id
        and invoice.tier_id = 'card'
        and invoice.gross_start_minor = 35000
        and invoice.credit_minor = 35000
        and invoice.subtotal_minor = 0
        and invoice.state = 'credit_settled'
        and invoice.charge_occurred = false
        and job.payment_receipt_id is null
        and job.start_settlement_kind = 'credit_only'
        and job.start_gross_minor = 35000
        and job.start_credit_minor = 35000
        and job.start_paid_subtotal_minor = 0
        and job.opened_at = new.settled_at
    )
  then
    new.updated_at := new.settled_at;
    return new;
  end if;

  if new.state = 'reconciliation_required'
    and new.settled_at is null
    and ss.current_service_actor_kind() = 'system'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and exists (
      select 1
      from ss.service_custom_build_invoices invoice
      join ss.service_custom_build_stripe_events event
        on event.organization_id = invoice.organization_id
       and event.invoice_id = invoice.id
      where invoice.organization_id = old.organization_id
        and invoice.credit_application_id = old.id
        and event.state = 'reconciliation_required'
    )
  then
    new.updated_at := clock_timestamp();
    return new;
  end if;

  raise exception 'service credit application transition lacks exact evidence'
    using errcode = '42501';
end
$$;

create or replace function ss.ensure_service_custom_build_invoice(
  target_acceptance_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  accepted record;
  selected_invoice_id uuid;
  selected_job_id uuid;
begin
  select invoice.id into selected_invoice_id
  from ss.service_custom_build_invoices invoice
  where invoice.quote_acceptance_id = target_acceptance_id;
  if found then
    return selected_invoice_id;
  end if;

  select
    acceptance.organization_id,
    acceptance.project_id,
    acceptance.case_id,
    acceptance.customer_user_id,
    acceptance.quote_id,
    acceptance.quote_revision,
    acceptance.quote_revision_id,
    acceptance.id as acceptance_id,
    acceptance.accepted_quote_digest,
    acceptance.accepted_disclosure_digest,
    acceptance.accepted_at,
    revision.commercial_contract_id,
    revision.policy_id,
    revision.scope_boundary_digest,
    revision.tier_id,
    revision.scope_statement,
    revision.crafted_pages,
    revision.sections,
    revision.unique_layouts,
    revision.content_words,
    revision.supplied_media,
    revision.target_completion_date,
    revision.start_value_minor,
    revision.start_credit_minor,
    revision.start_due_minor,
    revision.final_due_minor,
    revision.currency,
    revision.tax_state,
    application.id as credit_application_id,
    application.state as credit_application_state,
    installment.id as quote_installment_id
  into accepted
  from ss.service_custom_build_quote_acceptances acceptance
  join ss.service_custom_build_quotes quote
    on quote.organization_id = acceptance.organization_id
   and quote.id = acceptance.quote_id
  join ss.service_custom_build_quote_revisions revision
    on revision.organization_id = acceptance.organization_id
   and revision.quote_id = acceptance.quote_id
   and revision.quote_revision = acceptance.quote_revision
   and revision.id = acceptance.quote_revision_id
  left join ss.service_credit_applications application
    on application.organization_id = acceptance.organization_id
   and application.quote_acceptance_id = acceptance.id
  join ss.service_custom_build_quote_installments installment
    on installment.organization_id = revision.organization_id
   and installment.quote_revision_id = revision.id
   and installment.installment_number = 1
  where acceptance.id = target_acceptance_id
    and quote.state = 'accepted'
    and (
      (revision.start_credit_minor = 0 and application.id is null)
      or
      (revision.commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-05.1'
        and revision.start_credit_minor = 20000
        and application.state = 'reserved')
      or
      (revision.commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-19.2'
        and revision.start_credit_minor = 35000
        and application.state = 'reserved')
    )
    and (
      revision.start_due_minor > 0
      or (
        revision.commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-19.2'
        and revision.tier_id = 'card'
        and revision.start_value_minor = 35000
        and revision.start_credit_minor = 35000
        and revision.start_due_minor = 0
        and revision.final_due_minor = 0
        and revision.tax_state = 'disabled_by_owner'
      )
    )
    and installment.gross_value_minor = revision.start_value_minor
    and installment.credit_amount_minor = revision.start_credit_minor
    and installment.amount_due_minor = revision.start_due_minor;

  if not found then
    raise exception 'Custom build invoice requires one exact accepted first installment'
      using errcode = '55000';
  end if;

  insert into ss.service_custom_build_invoices (
    organization_id, project_id, case_id, customer_user_id, purpose,
    quote_id, quote_revision, quote_revision_id, quote_acceptance_id,
    credit_application_id, policy_id, scope_boundary_digest, tier_id,
    accepted_quote_digest, accepted_disclosure_digest,
    gross_start_minor, credit_minor, subtotal_minor, final_due_minor,
    currency, tax_state, state, charge_occurred,
    issued_at, payment_deadline, created_at
  ) values (
    accepted.organization_id, accepted.project_id, accepted.case_id,
    accepted.customer_user_id, 'custom_build_start', accepted.quote_id,
    accepted.quote_revision, accepted.quote_revision_id,
    accepted.acceptance_id, accepted.credit_application_id,
    accepted.policy_id, accepted.scope_boundary_digest, accepted.tier_id,
    accepted.accepted_quote_digest, accepted.accepted_disclosure_digest,
    accepted.start_value_minor, accepted.start_credit_minor,
    accepted.start_due_minor, accepted.final_due_minor, accepted.currency,
    accepted.tax_state,
    case when accepted.start_due_minor = 0
      then 'credit_settled' else 'tax_calculation_pending' end,
    false, accepted.accepted_at,
    accepted.accepted_at + interval '7 days',
    clock_timestamp()
  ) returning id into selected_invoice_id;

  insert into ss.service_custom_build_invoice_lines (
    organization_id, invoice_id, quote_installment_id, line_number,
    component_key, display_name, amount_minor, currency, created_at
  ) values (
    accepted.organization_id, selected_invoice_id,
    accepted.quote_installment_id, 1, 'custom_build_start',
    ss.custom_build_tier_label(accepted.tier_id) || ' first installment',
    accepted.start_value_minor, 'USD', accepted.accepted_at
  );

  if accepted.start_credit_minor > 0 then
    insert into ss.service_custom_build_invoice_lines (
      organization_id, invoice_id, quote_installment_id, line_number,
      component_key, display_name, amount_minor, currency, created_at
    ) values (
      accepted.organization_id, selected_invoice_id,
      accepted.quote_installment_id, 2, 'assessment_build_credit',
      'Website assessment build credit', -accepted.start_credit_minor,
      'USD', accepted.accepted_at
    );
  end if;

  if accepted.start_due_minor = 0 then
    selected_job_id := extensions.gen_random_uuid();
    insert into ss.service_custom_build_jobs (
      id, organization_id, project_id, case_id, customer_user_id,
      invoice_id, payment_receipt_id, quote_id, quote_revision,
      quote_revision_id, quote_acceptance_id, policy_id,
      scope_boundary_digest, tier_id, scope_statement, crafted_pages,
      sections, unique_layouts, content_words, supplied_media,
      target_completion_date, accepted_quote_digest,
      accepted_disclosure_digest, start_gross_minor, start_credit_minor,
      start_paid_subtotal_minor, final_due_minor, final_payment_state,
      currency, purpose, state, opened_at, created_at
    ) values (
      selected_job_id, accepted.organization_id, accepted.project_id,
      accepted.case_id, accepted.customer_user_id, selected_invoice_id,
      null, accepted.quote_id, accepted.quote_revision,
      accepted.quote_revision_id, accepted.acceptance_id,
      accepted.policy_id, accepted.scope_boundary_digest,
      accepted.tier_id, accepted.scope_statement, accepted.crafted_pages,
      accepted.sections, accepted.unique_layouts, accepted.content_words,
      accepted.supplied_media, accepted.target_completion_date,
      accepted.accepted_quote_digest, accepted.accepted_disclosure_digest,
      accepted.start_value_minor, accepted.start_credit_minor, 0,
      accepted.final_due_minor, 'not_required', accepted.currency,
      'custom_build', 'open', accepted.accepted_at, clock_timestamp()
    );

    update ss.service_credit_applications
    set state = 'settled', settled_at = accepted.accepted_at
    where organization_id = accepted.organization_id
      and id = accepted.credit_application_id
      and state = 'reserved';
    if not found then
      raise exception 'Credit-only Card settlement lost its exact reservation'
        using errcode = '55000';
    end if;
  end if;

  return selected_invoice_id;
end
$$;

create function ss.commercial_catalog_convergence_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v141-commercial-2026.6-credit-only-card-held-historical-compatible'::text
$$;

revoke all on function ss.commercial_catalog_convergence_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.commercial_catalog_convergence_contract_v1()
to service_role;

commit;
