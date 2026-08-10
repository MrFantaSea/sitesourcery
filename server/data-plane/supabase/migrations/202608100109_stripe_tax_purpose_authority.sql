-- TAX-PURPOSE-01: persist the exact purpose-bound collection decision.
-- Price tax behavior remains exclusive in both modes. Disabled purposes
-- cannot retain a positive tax amount.

begin;

alter table ss.service_assessment_checkout_attempts
  drop constraint service_assessment_checkout_attempts_tax_mode_check,
  add constraint service_assessment_checkout_attempts_tax_mode_check
    check (tax_mode in ('automatic', 'disabled_by_owner'));

alter table ss.service_assessment_payment_receipts
  drop constraint service_assessment_payment_receipts_tax_mode_check,
  add constraint service_assessment_payment_receipts_tax_mode_check
    check (tax_mode in ('automatic', 'disabled_by_owner')),
  add constraint service_assessment_payment_receipts_disabled_tax_check
    check (tax_mode = 'automatic' or tax_minor = 0);

alter table ss.service_custom_build_checkout_attempts
  drop constraint service_custom_build_checkout_attempts_tax_mode_check,
  add constraint service_custom_build_checkout_attempts_tax_mode_check
    check (tax_mode in ('automatic', 'disabled_by_owner'));

alter table ss.service_custom_build_payment_receipts
  drop constraint service_custom_build_payment_receipts_tax_mode_check,
  add constraint service_custom_build_payment_receipts_tax_mode_check
    check (tax_mode in ('automatic', 'disabled_by_owner')),
  add constraint service_custom_build_payment_receipts_disabled_tax_check
    check (tax_mode = 'automatic' or tax_minor = 0);

alter table ss.service_custom_build_change_checkout_attempts
  drop constraint service_custom_build_change_checkout_attempts_tax_mode_check,
  add constraint service_custom_build_change_checkout_attempts_tax_mode_check
    check (tax_mode in ('automatic', 'disabled_by_owner'));

alter table ss.service_custom_build_change_payment_receipts
  drop constraint service_custom_build_change_payment_receipts_tax_mode_check,
  add constraint service_custom_build_change_payment_receipts_tax_mode_check
    check (tax_mode in ('automatic', 'disabled_by_owner')),
  add constraint service_custom_build_change_payment_receipts_disabled_tax_check
    check (tax_mode = 'automatic' or tax_minor = 0);

alter table ss.service_custom_build_final_checkout_attempts
  drop constraint service_custom_build_final_checkout_attempts_tax_mode_check,
  add constraint service_custom_build_final_checkout_attempts_tax_mode_check
    check (tax_mode in ('automatic', 'disabled_by_owner'));

alter table ss.service_custom_build_final_payment_receipts
  drop constraint service_custom_build_final_payment_receipts_tax_mode_check,
  add constraint service_custom_build_final_payment_receipts_tax_mode_check
    check (tax_mode in ('automatic', 'disabled_by_owner')),
  add constraint service_custom_build_final_payment_receipts_disabled_tax_check
    check (tax_mode = 'automatic' or tax_minor = 0);

commit;
