import assert from 'node:assert/strict';
import test from 'node:test';
import {careCatalogPaymentProblem, reserveCareCatalogNotification} from '../care-catalog-notifications.mjs';
import {digest} from '../security.mjs';

test('payment condition is separate from paid-period receipt authority',()=>{
  assert.equal(careCatalogPaymentProblem({providerStatus:'active'}),'resolved');
  assert.equal(careCatalogPaymentProblem({providerStatus:'past_due'}),'past_due');
  assert.equal(careCatalogPaymentProblem({providerStatus:'unpaid'}),'unpaid');
  for(const providerStatus of [null,'incomplete','canceled'])assert.equal(careCatalogPaymentProblem({providerStatus}),null);
  assert.equal(careCatalogPaymentProblem({period:true,invalidationReason:'disputed'}),'disputed');
  assert.equal(careCatalogPaymentProblem({period:true,invalidationReason:'refunded'}),'refunded');
  assert.equal(careCatalogPaymentProblem({period:true,invalidationReason:null}),'resolved');
});

test('all five Care notices skip durable suppression before event, actor or outbox writes',async()=>{
  const agreement={id:'c2ad4f61-06ee-4e20-8108-dd0497700440',customer_user_id:'customer',organization_id:'organization',project_id:'project'};
  const email='care-recipient@example.test';
  for(const [kind,state] of [
    ['care_catalog_paid_month_receipt','paid'],
    ['care_catalog_payment_problem','unpaid'],
    ['care_catalog_cancellation_updated','requested'],
    ['care_catalog_request_acknowledgment','requested'],
    ['care_catalog_request_updated','completed']
  ]){
    const calls=[];
    const db={async query(sql,args){
      calls.push(sql);
      if(sql.includes('as eligible'))return {rows:[{eligible:true}]};
      if(sql.startsWith('select * from ss.care_catalog_notification_events'))return {rows:[]};
      if(sql.startsWith('select email from auth.users'))return {rows:[{email}]};
      if(sql.includes('ss.hosted_mail_recipient_suppressions')){
        assert.deepEqual(args,[digest(email)]);return {rows:[{exists:1}]};
      }
      assert.fail(`Unexpected write or query for ${kind}: ${sql}`);
    }};
    assert.equal(await reserveCareCatalogNotification(db,agreement,kind,state),null);
    assert.equal(calls.length,4);
  }
});

test('a suppression lookup failure remains a failure',async()=>{
  const agreement={id:'c2ad4f61-06ee-4e20-8108-dd0497700440',customer_user_id:'customer',organization_id:'organization',project_id:'project'};
  const db={async query(sql){
    if(sql.includes('as eligible'))return {rows:[{eligible:true}]};
    if(sql.startsWith('select * from ss.care_catalog_notification_events'))return {rows:[]};
    if(sql.startsWith('select email from auth.users'))return {rows:[{email:'care-recipient@example.test'}]};
    if(sql.includes('ss.hosted_mail_recipient_suppressions'))throw new Error('suppression storage unavailable');
    assert.fail(`Unexpected query: ${sql}`);
  }};
  await assert.rejects(reserveCareCatalogNotification(db,agreement,'care_catalog_payment_problem','unpaid'),/suppression storage unavailable/);
});

test('known unavailable recipient skips mail; infrastructure failures remain failures',async()=>{
  let calls=0;
  const agreement={id:'agreement',customer_user_id:'customer',organization_id:'organization',project_id:'project'};
  assert.equal(await reserveCareCatalogNotification({async query(){calls++;return {rows:[{eligible:false}]};}},agreement,'care_catalog_payment_problem','unpaid'),null);
  assert.equal(calls,1);
  await assert.rejects(reserveCareCatalogNotification({async query(){throw new Error('database unavailable');}},agreement,'care_catalog_payment_problem','unpaid'),/database unavailable/);
});
