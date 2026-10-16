import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createCarePaymentsService,careWrittenPlan,carePlan,CARE_ACCEPTANCE_STATEMENT} from '../care-payments.mjs';
const actor={userId:randomUUID(),organizationId:randomUUID()},agreementId=randomUUID();
const legalAuthority={schema:'sitesourcery.project-legal-authority/v7',acceptanceSchema:'sitesourcery.project-legal-acceptance/v7',acceptanceStatement:'accepted_exact_project_terms_and_acknowledged_privacy',authorityDigest:'a'.repeat(64),documents:['privacy','product','website'].map(kind=>({kind,version:`TEST-${kind}-V7`,contentDigest:'b'.repeat(64),contentUri:`https://example.test/${kind}`,effectiveAt:'2026-10-01T00:00:00.000Z'}))};
const written={siteUrl:'https://example.test/',hosting:'Customer retains their existing hosting.',monitoring:'Owner checks availability each business day.',backups:'Owner records weekly website backups.',includedWork:'Small text and image updates within plan limits.',responseTarget:'Owner responds within two business days.',outsideCosts:'Customer approves any outside costs separately.'};
function harness({approved=true}={}){
 let now='2026-10-16T12:00:00.789Z',attempt=null,providerCalls=0,observed=null;
 const binding={agreementId,amountMinor:6900};
 const repository={readiness:async()=>({ready:true,verified:true}),read:async()=>({agreements:[]}),
 async reserveAttempt(s,id,aid,at,expiresAt){if(attempt)return {created:false,attempt,binding};attempt={attemptId:aid,state:'pending',createdAt:at,expiresAt,commandId:s.commandId};return {created:true,attempt,binding};},
 async saveCheckout(id,aid,value){Object.assign(attempt,value);return {...attempt};},async markAmbiguous(){attempt.state='ambiguous';},
 async inspect(){return {binding,subscriptionId:attempt?.subscriptionId??null,attempts:attempt?[attempt]:[]};},
 async saveSubscription(id,response){observed=response;return {state:response.invoice?.paid?'active':'awaiting_payment'};},
 async createOffer(s,value){return value;},async acceptOffer(s,value){return value;}};
 const provider={readinessForPurpose:async p=>{assert.equal(p,'care');return {ready:true};},async createCareCheckout(input){providerCalls++;assert.ok(attempt,'Attempt committed before provider call');assert.equal(input.expiresAt,'2026-10-16T13:00:00.000Z');return {state:'ready',checkoutSessionId:'cs_exact',checkoutUrl:'https://checkout.stripe.com/c/pay/exact',expiresAt:input.expiresAt,providerCustomerId:null,subscriptionId:null,invoice:null};},
 async readCareCheckout(){return {...attempt,state:'paid',checkoutSessionId:'cs_exact',checkoutUrl:null,providerCustomerId:'cus_exact',subscriptionId:'sub_exact',invoice:null};}};
 const service=createCarePaymentsService({repository,provider,release:{approved},legalAuthority,clock:()=>now});
 return {service,repository,provider,get calls(){return providerCalls;},get attempt(){return attempt;},setNow:v=>now=v,get observed(){return observed;}};
}
test('five fixed plans and complete written limits cannot become automatic overages',()=>{
 assert.equal(carePlan('plan_partner').monthlyAmountMinor,34900);assert.equal(carePlan('plan_partner').automaticOverage,false);
 assert.throws(()=>carePlan('custom_care'),{code:'CARE_PLAN_UNAVAILABLE'});
 assert.equal(careWrittenPlan(written).cancellation,'no_fee_at_end_of_paid_month');
 assert.throws(()=>careWrittenPlan({...written,siteUrl:'http://example.test'}),{code:'CARE_INVALID'});
 assert.throws(()=>careWrittenPlan({...written,hosting:'password is example'}),{code:'CARE_INVALID'});
 assert.throws(()=>careWrittenPlan({...written,price:1}),{code:'CARE_INVALID'});
});
test('held default never persists or calls a new checkout',async()=>{const h=harness({approved:false});assert.equal((await h.service.readiness()).commercialReady,false);await assert.rejects(h.service.startCheckout(actor,agreementId,{},'checkout-0001'),{code:'CARE_PAYMENT_HELD'});assert.equal(h.calls,0);assert.equal(h.attempt,null);});
test('checkout reserves first, retries reuse the stored session and exact expiry',async()=>{const h=harness();const first=await h.service.startCheckout(actor,agreementId,{},'checkout-0001');h.setNow('2026-10-16T12:10:00.000Z');assert.deepEqual(await h.service.startCheckout(actor,agreementId,{},'checkout-0001'),first);assert.equal(h.calls,1);});
test('ambiguous provider failure remains pending and cannot mint a replacement',async()=>{const h=harness();h.provider.createCareCheckout=async()=>{assert.equal(h.attempt.state,'pending');throw new Error('connection interrupted');};await assert.rejects(h.service.startCheckout(actor,agreementId,{},'checkout-0001'),/interrupted/);assert.equal(h.attempt.state,'ambiguous');h.setNow('2026-10-16T14:00:00.000Z');await assert.rejects(h.service.reconcileCustomer(actor,agreementId,{}),{code:'CARE_RECONCILIATION_REQUIRED'});});
test('unsafe checkout URL cannot escape through a provider response',async()=>{const h=harness();const create=h.provider.createCareCheckout;h.provider.createCareCheckout=async args=>({...await create(args),checkoutUrl:'https://evil.test/'});await assert.rejects(h.service.startCheckout(actor,agreementId,{},'checkout-0001'),{code:'CARE_PROVIDER_INVALID'});assert.equal(h.attempt.state,'ambiguous');});
test('offer acceptance requires exact current three-document authority',async()=>{const h=harness();const offer=await h.service.createOffer(actor,actor.organizationId,{projectId:randomUUID(),planId:'plan_care_lite',writtenPlan:written,expiresAt:'2026-10-17T12:00:00.000Z'},'offer-0001');assert.equal(offer.plan.monthlyAmountMinor,6900);
 const legalAcceptance={schema:legalAuthority.acceptanceSchema,acceptanceStatement:legalAuthority.acceptanceStatement,authorityDigest:legalAuthority.authorityDigest,documents:legalAuthority.documents};
 const input={expectedOfferDigest:'a'.repeat(64),acceptanceStatement:CARE_ACCEPTANCE_STATEMENT,legalAcceptance};
 assert.ok((await h.service.acceptOffer(actor,offer.offerId,input,'accept-0001')).acceptanceId);
 assert.throws(()=>h.service.acceptOffer(actor,offer.offerId,{...input,legalAcceptance:{...legalAcceptance,authorityDigest:'c'.repeat(64)}},'accept-0002'),{code:'LEGAL_AUTHORITY_CHANGED'});assert.equal(h.calls,0);
});
test('work input cannot carry payment or invented capacity',()=>{const h=harness();assert.throws(()=>h.service.recordWork(actor,actor.organizationId,agreementId,randomUUID(),{expectedRevision:1,state:'completed',minutes:241,note:'Work completed within the agreed plan.'},'work-0001'),{code:'CARE_INVALID'});assert.throws(()=>h.service.requestWork(actor,agreementId,{summary:'Update the contact details.',amountMinor:1},'request-0001'),{code:'CARE_INVALID'});});
