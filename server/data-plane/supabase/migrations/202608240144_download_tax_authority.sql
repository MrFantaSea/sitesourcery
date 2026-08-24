-- FIN-012 follow-up: every new $20 Download preparation must carry the
-- server-selected tax authority in its immutable purpose digest. Historical
-- $5 rows and the two pre-submit $20 diagnostic attempts remain readable.

begin;

do $$
begin
  if to_regclass('ss.commerce_v2_checkout_preparations') is null
    or to_regclass('ss.commerce_v2_download_dispatches') is null
    or to_regclass('ss.commerce_v2_download_payment_receipts') is null
    or to_regprocedure(
      'ss.validate_commerce_v2_download_dispatch_insert()'
    ) is null
  then
    raise exception
      'Download protection migration 143 must precede tax authority binding'
      using errcode = '55000';
  end if;
end
$$;

-- NOT VALID preserves the forensic shape of the two already-abandoned
-- pre-submit attempts. PostgreSQL still enforces this check for every new row.
alter table ss.commerce_v2_checkout_preparations
  add constraint commerce_v2_download_tax_authority_v144
  check (
    preparation #> '{purpose,price,amountMinor}' = '500'::jsonb
    or (
      preparation #> '{purpose,price,amountMinor}' = '2000'::jsonb
      and preparation #>> '{purpose,taxMode}' in (
        'automatic', 'disabled_by_owner'
      )
    )
  ) not valid;

create function ss.validate_commerce_v2_download_dispatch_tax_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.commerce_v2_checkout_preparations prep
      join ss.commerce_v2_download_quotes quote
        on quote.organization_id = prep.organization_id
       and quote.id = prep.quote_id
     where prep.organization_id = new.organization_id
       and prep.command_id = new.preparation_command_id
       and prep.purpose_digest = new.purpose_digest
       and (
         quote.amount_minor = 500
         or (
           quote.amount_minor = 2000
           and prep.preparation #>> '{purpose,taxMode}' in (
             'automatic', 'disabled_by_owner'
           )
         )
       )
  )
  then
    raise exception
      'Download dispatch requires immutable server tax authority'
      using errcode = '23514';
  end if;
  return new;
end
$$;

-- PostgreSQL fires same-kind triggers in name order. Keep this after the
-- retained dispatch validator so the existing Customer-reconciliation and
-- purpose gates run before this narrower tax-authority assertion.
create trigger commerce_v2_download_dispatches_z_tax_authority
before insert on ss.commerce_v2_download_dispatches
for each row execute function
  ss.validate_commerce_v2_download_dispatch_tax_authority();

create function ss.validate_commerce_v2_download_receipt_tax_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.commerce_v2_checkout_preparations prep
     where prep.organization_id = new.organization_id
       and prep.command_id = new.preparation_command_id
       and prep.purpose_digest = new.purpose_digest
       and (
         new.amount_minor = 500
         or (
           new.amount_minor = 2000
           and prep.preparation #>> '{purpose,taxMode}' =
               new.tax_mode
         )
       )
  )
  then
    raise exception
      'Download receipt tax mode must match immutable server authority'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_receipt_tax_authority
before insert on ss.commerce_v2_download_payment_receipts
for each row execute function
  ss.validate_commerce_v2_download_receipt_tax_authority();

commit;
