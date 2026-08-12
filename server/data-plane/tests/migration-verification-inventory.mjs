import assert from "node:assert/strict";

const RETAINED_CHECKPOINT_POST_PRIVACY_NAMES = Object.freeze([
  "202608080049_alakazam_lifecycle_renewal.sql",
  "202608080050_alakazam_lifecycle_incidents.sql",
  "202608080051_alakazam_lifecycle_cancellation.sql",
  "202608080052_alakazam_lifecycle_reversal.sql",
  "202608080101_alakazam_customer_publication_controls.sql",
  "202608080102_alakazam_35_fulfillment.sql",
  "202608080103_alakazam_50_authority.sql",
  "202608080104_publication_control_authority.sql",
  "202608090104_alakazam_retained_premium_state.sql",
  "202608090105_hosted_joint_legal_v4_authority.sql",
  "202608100106_customer_engagement_bootstrap.sql",
  "202608100107_durable_mail_lifecycle.sql",
  "202608100108_professional_services_reversals.sql",
  "202608100109_stripe_tax_purpose_authority.sql",
  "202608100110_support_privacy_case_lifecycle.sql",
  "202608100111_hosted_identity_delivery_acceptance.sql",
  "202608100112_operator_work_queue.sql",
  "202608100113_custom_direct_opportunity.sql",
  "202608100114_commerce_transition_notifications.sql",
  "202608100115_accounting_purpose_journal.sql",
  "202608100116_alakazam_policy_authority.sql",
  "202608100117_direct_custom_reversal_normalization.sql",
  "202608110118_hosted_mail_dispatch_claims.sql",
  "202608110119_domain_provider_route_persistence.sql",
  "202608110120_responder_core.sql",
  "202608110121_care_core.sql",
  "202608110122_alakazam_invoice_finalization.sql",
  "202608110123_domain_lifecycle_persistence.sql",
  "202608110124_care_commerce_persistence.sql"
]);

export function resolveMigrationVerificationInventory(
  names,
  expectedMigrationNames = null
) {
  const releaseName = "202608060048_hosted_privacy_v3.sql";
  const releaseIndex = names.indexOf(releaseName);
  assert.equal(releaseIndex, 47);
  if (expectedMigrationNames === null) {
    assert.equal(
      names.length,
      releaseIndex + 1 + RETAINED_CHECKPOINT_POST_PRIVACY_NAMES.length,
      "retained checkpoint migration proof requires its exact reviewed inventory"
    );
    assert.deepEqual(
      names.slice(releaseIndex + 1),
      RETAINED_CHECKPOINT_POST_PRIVACY_NAMES
    );
  } else {
    assert.ok(
      Array.isArray(expectedMigrationNames) &&
        expectedMigrationNames.length > 0 &&
        expectedMigrationNames.every(
          (name) =>
            typeof name === "string" &&
            /^[0-9]{12}_[a-z0-9_]+\.sql$/u.test(name)
        ),
      "successor migration inventory must supply exact ordered filenames"
    );
    assert.deepEqual(
      names,
      expectedMigrationNames,
      "migration files must exactly match the verified successor release inventory"
    );
  }
  return Object.freeze({
    releaseIndex,
    releaseName,
    postPrivacyNames: Object.freeze(names.slice(releaseIndex + 1))
  });
}
