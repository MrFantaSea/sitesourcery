import assert from 'node:assert/strict';
import test from 'node:test';
import {careCatalogPaymentProblem, reserveCareCatalogNotification} from '../care-catalog-notifications.mjs';

test('payment condition is separate from paid-period receipt authority',()=>{
  assert.equal(careCatalogPaymentProblem({providerStatus:'active'}),'resolved');
  assert.equal(careCatalogPaymentProblem({providerStatus:'past_due'}),'past_due');
  assert.equal(careCatalogPaymentProblem({providerStatus:'unpaid'}),'unpaid');
  for(const providerStatus of [null,'incomplete','canceled'])assert.equal(careCatalogPaymentProblem({providerStatus}),null);
  assert.equal(careCatalogPaymentProblem({period:true,invalidationReason:'disputed'}),'disputed');
  assert.equal(careCatalogPaymentProblem({period:true,invalidationReason:'refunded'}),'refunded');
  assert.equal(careCatalogPaymentProblem({period:true,invalidationReason:null}),'resolved');
});

test('known unavailable recipient skips mail; infrastructure failures remain failures',async()=>{
  let calls=0;
  const agreement={id:'agreement',customer_user_id:'customer',organization_id:'organization',project_id:'project'};
  assert.equal(await reserveCareCatalogNotification({async query(){calls++;return {rows:[{eligible:false}]};}},agreement,'care_catalog_payment_problem','unpaid'),null);
  assert.equal(calls,1);
  await assert.rejects(reserveCareCatalogNotification({async query(){throw new Error('database unavailable');}},agreement,'care_catalog_payment_problem','unpaid'),/database unavailable/);
});
