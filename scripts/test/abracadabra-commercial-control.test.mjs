import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const control = JSON.parse(
  await readFile(
    new URL("../../data/abracadabra-commercial-control.json", import.meta.url),
    "utf8",
  ),
);

test("Abracadabra commerce stays held until exact owner and staging gates pass", () => {
  assert.equal(control.schema, "sitesourcery.abracadabra-commercial-control/v1");
  assert.equal(control.state, "hold");
  assert.equal(control.checkout.enabled, false);
  assert.deepEqual(control.checkout.requiresBeforeEnable, [
    "owner_approved_tenure_prices",
    "owner_approved_customer_terms",
    "stripe_test_price_ids",
    "verified_stripe_test_webhook",
    "staging_end_to_end_pass",
    "separate_live_payment_authority",
  ]);
});

test("domain checkout stays held but the customer journey never redirects to a registrar", () => {
  assert.equal(control.domainCheckout.enabled, false);
  assert.equal(control.domainCheckout.customerLeavesSiteSourceryToPurchase, false);
  assert.deepEqual(control.domainCheckout.requiresBeforeEnable, [
    "owner_approved_domain_price_treatment",
    "owner_approved_domain_customer_terms",
    "owner_approved_domain_renewal_policy",
    "registrar_adapter_conformance_pass",
    "stripe_domain_payment_reconciliation_pass",
    "staging_domain_journey_pass_without_real_purchase",
    "separate_live_domain_purchase_authority",
  ]);
});

test("launch cost policy cannot silently restore fixed subscriptions or overages", () => {
  const policy = control.costPolicy;
  assert.equal(policy.baselineMonthlyCommitmentCents, 0);
  assert.equal(policy.automaticProviderUpgradesAllowed, false);
  assert.equal(policy.automaticUsageOveragesAllowed, false);
  assert.equal(policy.providerPurchasesAuthorized, false);
  assert.equal(policy.hardStopBeforeBillableUsageRequired, true);
  assert.equal(policy.ownerApprovalRequiredBeforeAnyFixedSpend, true);
  assert.equal(policy.hostingDecisionState, "under_owner_review");
  assert.equal(Object.hasOwn(policy, "selectedLaunchStack"), false);
  assert.deepEqual(policy.notSelected.sort(), ["supabase_pro", "vercel_pro"]);
  assert.equal(
    policy.fleetCandidateStack.sourceTestingAndReleaseControl,
    "github_not_pages_hosting",
  );
  assert.equal(policy.githubBoundary.githubPagesCommercialHostingSelected, false);
  assert.equal(policy.githubBoundary.customerAccountsStoredOnGitHub, false);
  assert.equal(policy.githubBoundary.privateCustomerDraftsStoredOnGitHub, false);
  assert.equal(
    policy.githubBoundary.paymentOrRegistrantRecordsStoredOnGitHub,
    false,
  );
});

test("Rent, Own, and Owned + managed remain distinct unresolved tenure choices", () => {
  const modes = Object.fromEntries(
    control.tenureModes.map((mode) => [mode.id, mode]),
  );
  assert.deepEqual(Object.keys(modes).sort(), [
    "own",
    "owned_managed",
    "rent",
  ]);

  assert.equal(modes.rent.billingShape, "recurring");
  assert.equal(modes.rent.priceState, "unresolved");
  assert.equal(modes.rent.stripePriceId, null);
  assert.equal(modes.rent.deliverableOwnership, "licensed_while_eligible_and_active");
  assert.equal(modes.rent.cancelAnytime, true);
  assert.equal(modes.rent.paymentGraceDays, 14);

  assert.equal(modes.own.billingShape, "one_time");
  assert.equal(modes.own.priceState, "unresolved");
  assert.equal(modes.own.stripePriceId, null);
  assert.equal(modes.own.platformHostingIncluded, false);
  assert.equal(modes.own.cancelAnytime, null);
  assert.equal(modes.own.paymentGraceDays, null);

  assert.equal(modes.owned_managed.billingShape, "one_time_plus_recurring");
  assert.equal(modes.owned_managed.priceState, "unresolved");
  assert.equal(modes.owned_managed.oneTimeStripePriceId, null);
  assert.equal(modes.owned_managed.recurringStripePriceId, null);
  assert.equal(
    modes.owned_managed.deliverableOwnership,
    "transfers_after_final_one_time_payment",
  );
  assert.equal(modes.owned_managed.cancelAnytime, true);
  assert.equal(modes.owned_managed.paymentGraceDays, 14);

  for (const mode of Object.values(modes)) {
    assert.equal(mode.retentionAndExportDays, 90);
  }
});

test("domain choice, existing build tiers, and Host care cannot invent an Abracadabra price", () => {
  assert.equal(control.sharedProductBoundary.pageLimit, 1);
  assert.equal(control.sharedProductBoundary.activeServingAddressLimit, 1);
  assert.equal(control.sharedProductBoundary.freeTrialDays, 0);
  assert.equal(
    control.sharedProductBoundary.customerOwnedDomainConnectionIncludedWhereHosted,
    true,
  );
  assert.equal(
    control.sharedProductBoundary.customerOwnedDomainProcurementOfferedInApp,
    true,
  );
  assert.equal(
    control.sharedProductBoundary.customerOwnedDomainRegistrationIncludedInWebsitePrice,
    false,
  );
  assert.equal(control.sharedProductBoundary.registrarRedirectRequired, false);
  assert.equal(
    control.sharedProductBoundary.customerOwnedDomainRegistrant,
    "customer",
  );
  assert.equal(
    control.catalogSeparation.existingCustomBuildTiersAuthorizeAbracadabraPrices,
    false,
  );
  assert.equal(
    control.catalogSeparation.existingCareHostLineAuthorizesAbracadabraPrice,
    false,
  );
  assert.equal(
    control.catalogSeparation.customerDomainChoiceChangesDeliverableOwnership,
    false,
  );
});

test("in-app domain procurement is customer-owned, disclosed, ordered, and fail-closed", () => {
  const domain = control.domainProcurementBoundary;

  assert.equal(domain.storefrontAndMerchant, "site_sourcery");
  assert.equal(domain.underlyingRegistrarCandidate, "spaceship");
  assert.equal(domain.underlyingRegistrarMustBeDisclosed, true);
  assert.equal(domain.siteSourceryRepresentsItselfAsIcannAccredited, false);
  assert.equal(domain.customerIsRegistrant, true);
  assert.equal(domain.siteSourceryActsOnlyWithRecordedAuthority, true);
  assert.equal(domain.registrationPriceState, "unresolved");
  assert.equal(domain.serviceFeeState, "unresolved");
  assert.equal(domain.registrationFeeIsSeparateFromWebsiteOwnership, true);
  assert.equal(domain.providerPurchasesAuthorized, false);
  assert.deepEqual(domain.requiredOrderSequence, [
    "server_side_availability_and_price_quote",
    "registrant_contact_validation",
    "versioned_registrar_terms_and_agent_consent",
    "site_sourcery_payment_verified",
    "fresh_availability_and_price_readback",
    "explicit_irreversible_registration_confirm",
    "asynchronous_provider_operation_poll",
    "registration_success_receipt_before_ownership_claim",
    "dns_configuration",
    "renewal_notice_and_customer_control",
    "transfer_out_and_export_available",
  ]);
  assert.deepEqual(domain.failClosedRules, [
    "never_register_without_verified_payment",
    "never_register_from_an_expired_quote",
    "never_register_after_an_unapproved_price_change",
    "never_retry_irreversible_confirm_without_idempotency_proof",
    "never_claim_registration_before_provider_success",
    "never_hide_the_underlying_registrar",
    "never_make_site_ownership_depend_on_domain_choice",
  ]);
});
