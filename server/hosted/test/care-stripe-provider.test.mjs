import assert from "node:assert/strict";
import test from "node:test";
import { createStripeProviderAdapter, STRIPE_API_VERSION, STRIPE_REQUIRED_WEBHOOK_EVENTS } from "../../commerce/adapters/stripe.mjs";
import { CARE_STRIPE_PLAN_AMOUNTS, careStripeMetadata } from "../care-payment-config.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = Object.freeze({ organizationId:id(1), projectId:id(2), customerId:id(3), offerId:id(4),
  acceptanceId:id(5), agreementId:id(6), planId:'plan_care', amountMinor:11900, currency:'USD',
  offerDigest:'a'.repeat(64), acceptanceDigest:'b'.repeat(64), legalAuthorityDigest:'c'.repeat(64), taxMode:'disabled_by_owner' });
const attemptId=id(7), commandId=id(8), expiresAt='2026-10-16T13:00:00.000Z';
const start=Date.parse('2026-10-16T12:00:00.000Z')/1000, end=Date.parse('2026-11-16T12:00:00.000Z')/1000;
function fixture({ heldCare=false, mutate=()=>{} }={}) {
  const taxCodes=Object.fromEntries(['alakazam','care','customBuildChange','customBuildFinal','customBuildStart','domainRegistration','download','serviceAssessment','siteService'].map(p=>[p,'txcd_10701100']));
  const planPriceIds=Object.fromEntries(Object.keys(CARE_STRIPE_PLAN_AMOUNTS).map(p=>[p,`price_${p}`]));
  const priceExpectations=Object.entries(CARE_STRIPE_PLAN_AMOUNTS).map(([p,amount])=>({id:planPriceIds[p],currency:'usd',unitAmount:amount,livemode:false,taxBehavior:'exclusive',productId:'prod_care',recurring:{interval:'month',intervalCount:1}}));
  if(heldCare) delete taxCodes.care;
  const config={livemode:false, successUrl:'https://account.test/success?session_id={CHECKOUT_SESSION_ID}',cancelUrl:'https://account.test/cancel',
    portalReturnUrl:'https://account.test/account',portalPrivacyPolicyUrl:'https://account.test/privacy',portalTermsOfServiceUrl:'https://account.test/terms',approvedReturnOrigins:['https://account.test'],
    taxCodes,taxAuthority:{schema:'sitesourcery.stripe-tax-purpose-authority/v1',provider:'stripe',approved:true,authorityId:'care-contract-authority',approvedAt:'2026-10-16T11:00:00.000Z',livemode:false,defaultTaxBehavior:'exclusive',purposes:Object.fromEntries(Object.keys(taxCodes).map(p=>[p,'disabled_by_owner'])),automaticActivation:null},
    webhookSecret:'whsec_care_contract_only',webhookEndpointId:'we_care',webhookEndpointUrl:'https://account.test/api/webhooks',checkoutTtlSeconds:1800,
    domainAuthorization:{successUrlTemplate:'https://account.test/domain/{ORDER_ID}?session_id={CHECKOUT_SESSION_ID}',cancelUrlTemplate:'https://account.test/domain/{ORDER_ID}',authorizationDisclosure:'Contract test only'},priceExpectations,
    ...(heldCare?{}:{care:{planPriceIds}})};
  const price=p=>({id:p.id,active:true,livemode:false,currency:'usd',unit_amount:p.unitAmount,tax_behavior:'exclusive',product:'prod_care',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}});
  const metadata=careStripeMetadata(binding,attemptId);
  const state={calls:[], refunds:[], disputes:[], checkout:{id:'cs_care',livemode:false,mode:'subscription',client_reference_id:binding.agreementId,currency:'usd',amount_subtotal:11900,amount_total:11900,automatic_tax:{enabled:false},total_details:{amount_discount:0,amount_tax:0,amount_shipping:0},metadata,status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/cs_care',expires_at:start+3600,customer:null,subscription:null,invoice:null},
    subscription:{id:'sub_care',livemode:false,customer:'cus_care',status:'active',collection_method:'charge_automatically',automatic_tax:{enabled:false},discounts:[],default_tax_rates:[],pending_update:null,pause_collection:null,schedule:null,trial_end:null,cancel_at_period_end:false,canceled_at:null,metadata,latest_invoice:'in_care',items:{has_more:false,data:[{id:'si_care',quantity:1,current_period_start:start,current_period_end:end,price:price(priceExpectations[2])}]}},
    invoice:{id:'in_care',livemode:false,currency:'usd',customer:'cus_care',parent:{type:'subscription_details',subscription_details:{subscription:'sub_care',metadata}},collection_method:'charge_automatically',automatic_tax:{enabled:false},billing_reason:'subscription_create',status:'paid',subtotal:11900,total_excluding_tax:11900,total:11900,amount_due:11900,amount_paid:11900,amount_remaining:0,amount_paid_off_stripe:0,total_discount_amounts:[],total_taxes:[],pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,status_transitions:{paid_at:start+30},
      lines:{has_more:false,data:[{livemode:false,currency:'usd',quantity:1,parent:{type:'subscription_item_details',subscription_item_details:{proration:false,subscription:'sub_care',subscription_item:'si_care'}},pricing:{type:'price_details',price_details:{price:'price_plan_care'}},amount:11900,subtotal:11900,period:{start,end}}]},
      payments:{has_more:false,data:[{status:'paid',livemode:false,currency:'usd',amount_paid:11900,amount_requested:11900,invoice:'in_care',payment:{type:'payment_intent',payment_intent:{id:'pi_care',status:'succeeded',livemode:false,currency:'usd',amount:11900,amount_received:11900,customer:'cus_care',latest_charge:'ch_care'}}}]}},
    charge:{id:'ch_care',livemode:false,currency:'usd',paid:true,captured:true,status:'succeeded',amount:11900,amount_captured:11900,customer:'cus_care',payment_intent:'pi_care',amount_refunded:0,refunded:false,disputed:false}};
  const client={prices:{retrieve:async id=>price(priceExpectations.find(p=>p.id===id))},
    checkout:{sessions:{create:async(params,options)=>{state.calls.push({op:'create',params,options});if(state.createError) throw Error('network');return structuredClone(state.checkout);},retrieve:async()=>structuredClone(state.checkout)}},
    subscriptions:{retrieve:async()=>structuredClone(state.subscription),update:async(id,params,options)=>{state.calls.push({op:'cancel',id,params,options});state.subscription.cancel_at_period_end=true;state.subscription.canceled_at=start+60;return structuredClone(state.subscription);}},
    invoices:{retrieve:async(id,options)=>{state.calls.push({op:'invoiceRead',id,options});assert.ok(options.expand.every(value=>value.split('.').length<=4),'Stripe expansions cannot exceed four levels');return structuredClone(state.invoice);}},charges:{retrieve:async()=>structuredClone(state.charge)},
    refunds:{list:async()=>({has_more:false,data:structuredClone(state.refunds)})},disputes:{list:async()=>({has_more:false,data:structuredClone(state.disputes)})},
    billingPortal:{sessions:{create:async()=>{throw Error('not Care');}}},webhooks:{constructEvent:()=>{}},
    webhookEndpoints:{retrieve:async()=>({id:config.webhookEndpointId,application:null,api_version:STRIPE_API_VERSION,enabled_events:STRIPE_REQUIRED_WEBHOOK_EVENTS,livemode:false,status:'enabled',url:config.webhookEndpointUrl})}};
  mutate({state,config,client});
  return {state,config,adapter:createStripeProviderAdapter({mode:'contract_test',testOnly:true,client,config,clock:{now:()=>new Date(start*1000).toISOString()}})};
}
test('Care remains held without distinct configuration and tax authority',async()=>{
  const {adapter,state}=fixture({heldCare:true});
  assert.equal((await adapter.readinessForPurpose('care')).ready,false);
  await assert.rejects(adapter.createCareCheckout({binding,attemptId,commandId,expiresAt}),{code:'stripe_care_held'});
  assert.equal(state.calls.length,0);
  assert.throws(()=>fixture({mutate:({config})=>delete config.taxAuthority.purposes.care}),{code:'stripe_tax_purpose_authority_required'});
});
test('Care checkout binds the accepted agreement, exact monthly Price and stable idempotency key',async()=>{
  const {adapter,state}=fixture();
  assert.equal((await adapter.readinessForPurpose('care')).ready,true);
  const first=await adapter.createCareCheckout({binding,attemptId,commandId,expiresAt});
  const replay=await adapter.createCareCheckout({binding,attemptId,commandId,expiresAt});
  assert.deepEqual(first,replay); assert.equal(first.state,'ready');
  assert.deepEqual(state.calls[0].params.line_items,[{price:'price_plan_care',quantity:1}]);
  assert.equal(state.calls[0].params.mode,'subscription');
  assert.deepEqual(state.calls[0].params.metadata,state.calls[0].params.subscription_data.metadata);
  assert.equal(state.calls[0].options.idempotencyKey,state.calls[1].options.idempotencyKey);
  assert.equal(state.calls[0].params.metadata.schema,'sitesourcery_care_subscription_v1');
});
test('Care paid state requires actual Invoice, PaymentIntent and Charge readback; refunds/disputes remain visible',async()=>{
  const {adapter,state}=fixture();Object.assign(state.checkout,{status:'complete',payment_status:'paid',customer:'cus_care',subscription:'sub_care',invoice:'in_care'});
  const paid=await adapter.readCareCheckout({binding,attemptId,checkoutSessionId:'cs_care'});
  assert.equal(paid.state,'paid');assert.equal(paid.invoice.chargeId,'ch_care');assert.equal(paid.invoice.periodEnd,'2026-11-16T12:00:00.000Z');
  state.charge.amount_refunded=100;state.refunds=[{id:'re_care',currency:'usd',charge:'ch_care',payment_intent:'pi_care',amount:100,status:'succeeded'}];
  assert.equal((await adapter.readCareSubscription({binding,subscriptionId:'sub_care'})).invoice.refunded,true);
  state.charge.disputed=true;state.disputes=[{id:'du_care',livemode:false,currency:'usd',charge:'ch_care',payment_intent:'pi_care',amount:11900,status:'under_review',balance_transactions:[{amount:-11900}]}];
  assert.equal((await adapter.readCareSubscription({binding,subscriptionId:'sub_care'})).invoice.disputed,true);
  assert.equal(state.calls.find(c=>c.op==='invoiceRead').options.expand.includes('amount_paid_off_stripe'),true);
});
test('Care rejects cross-tenant metadata, wrong invoice customer, proration and underpaid charge',async()=>{
  for(const mutate of [({state})=>{state.subscription.metadata={...state.subscription.metadata,projectId:id(99)};},
    ({state})=>{state.invoice.customer='cus_other';},({state})=>{state.invoice.payments.data[0].invoice='in_other';},({state})=>{state.invoice.lines.data[0].parent.subscription_item_details.proration=true;},
    ({state})=>{state.charge.amount_captured=11899;},({state})=>{state.subscription.schedule='sub_sched_unapproved';},({state})=>{state.subscription.items.data[0].price.recurring.usage_type='metered';}]) {
    const {adapter}=fixture({mutate}); await assert.rejects(adapter.readCareSubscription({binding,subscriptionId:'sub_care'}),{code:'stripe_care_mismatch'});
  }
});
test('Care unpaid invoices never become a paid period',async()=>{
  const {adapter,state}=fixture(); Object.assign(state.invoice,{status:'open',amount_paid:0,amount_remaining:11900});state.invoice.payments.data=[];
  const result=await adapter.readCareSubscription({binding,subscriptionId:'sub_care'});assert.equal(result.invoice.paid,false);assert.equal(result.invoice.chargeId,null);
});
test('Care cancel preserves the current paid period and replays without another write',async()=>{
  const {adapter,state}=fixture();const request={binding,subscriptionId:'sub_care',commandId};
  const first=await adapter.cancelCareSubscriptionAtPeriodEnd(request);const again=await adapter.cancelCareSubscriptionAtPeriodEnd(request);
  assert.deepEqual(first,again);assert.equal(first.cancelAtPeriodEnd,true);assert.equal(first.canceledAt,null);assert.equal(first.currentPeriodEnd,'2026-11-16T12:00:00.000Z');
  const calls=state.calls.filter(c=>c.op==='cancel');assert.equal(calls.length,1);assert.deepEqual(calls[0].params,{cancel_at_period_end:true,proration_behavior:'none'});
});
test('Care creation network uncertainty is ambiguous and replay uses its original key',async()=>{
  const {adapter,state}=fixture();state.createError=true;let key;
  await assert.rejects(adapter.createCareCheckout({binding,attemptId,commandId,expiresAt}),error=>{key=error.details.idempotencyKey;return error.certainty==='ambiguous';});
  state.createError=false;await adapter.createCareCheckout({binding,attemptId,commandId,expiresAt});assert.equal(state.calls[1].options.idempotencyKey,key);assert.deepEqual(state.calls[0].params,state.calls[1].params);
});
test('Care held adapter exposes the same methods without provider effects',async()=>{
  const adapter=createStripeProviderAdapter();
  for(const method of ['createCareCheckout','readCareCheckout','readCareSubscription','cancelCareSubscriptionAtPeriodEnd']) await assert.rejects(adapter[method](),{code:'stripe_not_configured'});
});


test('Care restored dispute funds and failed refunds cannot be mistaken for an active reversal',async()=>{
  const {adapter,state}=fixture();
  state.refunds=[{id:'re_failed',currency:'usd',charge:'ch_care',payment_intent:'pi_care',amount:11900,status:'failed'}];
  state.charge.disputed=true;
  state.disputes=[{id:'du_won',livemode:false,currency:'usd',charge:'ch_care',payment_intent:'pi_care',amount:11900,status:'won',balance_transactions:[{amount:-11900}]}];
  assert.equal((await adapter.readCareSubscription({binding,subscriptionId:'sub_care'})).invoice.disputed,true);
  state.disputes[0].balance_transactions.push({amount:11900});
  const restored=await adapter.readCareSubscription({binding,subscriptionId:'sub_care'});
  assert.equal(restored.invoice.disputed,false);assert.equal(restored.invoice.refunded,false);
  state.refunds[0].charge='ch_other';
  await assert.rejects(adapter.readCareSubscription({binding,subscriptionId:'sub_care'}),{code:'stripe_care_mismatch'});
});


test('Care accepts stable API idempotency keys without requiring UUID syntax',async()=>{
  const {adapter,state}=fixture();
  const checkout={binding,attemptId,commandId:'care:checkout:contract-01',expiresAt};
  await adapter.createCareCheckout(checkout);await adapter.createCareCheckout(checkout);
  const creates=state.calls.filter(c=>c.op==='create');
  assert.equal(creates.length,2);assert.equal(creates[0].options.idempotencyKey,creates[1].options.idempotencyKey);
  const cancel={binding,subscriptionId:'sub_care',commandId:'care:cancel:contract-01'};
  await adapter.cancelCareSubscriptionAtPeriodEnd(cancel);await adapter.cancelCareSubscriptionAtPeriodEnd(cancel);
  assert.equal(state.calls.filter(c=>c.op==='cancel').length,1);
  for(const invalid of ['short','contains a space','-not-start-alphanumeric','x'.repeat(201),12345678]) {
    await assert.rejects(adapter.createCareCheckout({...checkout,commandId:invalid}),{code:'stripe_care_mismatch'});
    await assert.rejects(adapter.cancelCareSubscriptionAtPeriodEnd({...cancel,commandId:invalid}),{code:'stripe_care_mismatch'});
  }
});
