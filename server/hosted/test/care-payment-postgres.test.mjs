import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCanonicalPostgresAuthority} from '../repository-postgres.mjs';
import {createPostgresCarePaymentRepository} from '../care-payment-postgres.mjs';
import {createPostgresCareLifecycleWorkerRepository} from '../care-lifecycle-worker-postgres.mjs';
import {createLifecycleWorkerFactories} from '../worker-lifecycle-composition.mjs';
import {createCarePaymentsService,CARE_ACCEPTANCE_STATEMENT} from '../care-payments.mjs';
const url=process.env.SITESOURCERY_PG_CARE_CATALOG_TEST_URL;
const legalAuthority={schema:'sitesourcery.project-legal-authority/v7',acceptanceSchema:'sitesourcery.project-legal-acceptance/v7',acceptanceStatement:'accepted_exact_project_terms_and_acknowledged_privacy',authorityDigest:'a'.repeat(64),documents:['privacy','product','website'].map(kind=>({kind,version:`CARE-TEST-${kind}-V7`,contentDigest:'b'.repeat(64),contentUri:`https://example.test/${kind}`,effectiveAt:'2026-10-01T00:00:00.000Z'}))};
const writtenPlan={siteUrl:'https://care-fixture.example.test/',hosting:'Customer maintains their existing hosting account.',monitoring:'Owner checks the website each business day.',backups:'Owner retains a weekly website backup.',includedWork:'Small text and image edits within the chosen limits.',responseTarget:'Owner responds within two business days.',outsideCosts:'Outside costs require separate customer approval.'};
async function insert(db,table,value){const keys=Object.keys(value);await db.query(`insert into ss.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(value));}
test('canonical Care: immutable agreement, scoped checkout, verified periods, renewal/cancellation/reversal, capacity and lifecycle fence',{skip:!url},async()=>{
 const parsed=new URL(url);assert.ok(['localhost','127.0.0.1',''].includes(parsed.hostname));assert.ok([null,'/tmp','localhost','127.0.0.1'].includes(parsed.searchParams.get('host')));assert.match(parsed.pathname,/^\/ss_care_catalog_(?:20261016|ci_[0-9]+_[0-9]+)$/u);
 const pool=new pg.Pool({connectionString:url,max:2});const suffix=randomUUID().replaceAll('-',''),subscriptionId=`sub_${suffix}`,providerCustomerId=`cus_${suffix}`;
 try{
  const identity=(await pool.query('select current_database() as name,inet_server_addr()::text as address')).rows[0];assert.equal(identity.name,parsed.pathname.slice(1));assert.ok([null,'127.0.0.1','::1'].includes(identity.address));
  const db=await pool.connect();const customer={userId:randomUUID(),organizationId:randomUUID()},operator={userId:randomUUID()},stranger={userId:randomUUID(),organizationId:customer.organizationId};const projectId=randomUUID(),unhandedProjectId=randomUUID(),handoffId=randomUUID(),policyId=randomUUID();
  const seedAt='2026-10-01T00:00:00.000Z';
  // Earlier failed attempts in this disposable database are isolated from this
  // worker proof; this modifies only synthetic Care fixtures in the named DB.
  await db.query("update ss.care_catalog_agreements set reconcile_after='infinity' where customer_user_id in(select user_id from ss.hosted_account_profiles where display_name='Synthetic Care acceptance')");
  try{
   await db.query('begin');
   for(const a of [customer,operator,stranger]){await db.query('insert into auth.users(id,email) values($1,$2)',[a.userId,`${a.userId}@example.test`]);await insert(db,'hosted_account_profiles',{user_id:a.userId,display_name:'Synthetic Care acceptance',state:'active'});}
   await insert(db,'organizations',{id:customer.organizationId,created_by_user_id:customer.userId,name:'Synthetic Care organization'});
   for(const a of [customer,stranger])await insert(db,'organization_memberships',{organization_id:customer.organizationId,user_id:a.userId,role:'owner',state:'active'});
   await insert(db,'billing_policies',{id:policyId,policy_key:`care-${policyId}`,grace_period:'14 days',retention_period:'90 days',effective_at:seedAt});
   for(const id of [projectId,unhandedProjectId])await insert(db,'projects',{id,organization_id:customer.organizationId,created_by_user_id:customer.userId,billing_policy_id:policyId,name:'Synthetic Care website'});
   await insert(db,'operator_profiles',{user_id:operator.userId,display_label:'Synthetic owner',authorized_by_user_id:operator.userId,authorized_at:seedAt});
   for(const capability of ['service_management_manage','service_quote_author','service_payment_reconcile']){
    await insert(db,'operator_permissions',{operator_user_id:operator.userId,capability,granted_by_user_id:operator.userId,granted_at:seedAt});
    await insert(db,'service_operator_authority_events',{operator_user_id:operator.userId,capability,event_sequence:1,event_kind:'grant',effective_at:seedAt,expires_at:new Date(Date.now()+86400000).toISOString(),created_at:seedAt});
   }
   // Only seed the already-qualified Custom handoff as a synthetic input. Its
   // old upstream invoice/document FKs and trigger are not re-proved here.
   // All CHECKs remain active; replication mode is transaction-local and reset
   // before any new Care statement. Production migrations never disable guards.
   await db.query("set local session_replication_role='replica'");
   await insert(db,'service_custom_build_handoff_receipts',{id:handoffId,organization_id:customer.organizationId,project_id:projectId,case_id:randomUUID(),customer_user_id:customer.userId,job_id:randomUUID(),completion_package_id:randomUUID(),final_obligation_id:randomUUID(),zero_balance_clearance_id:randomUUID(),document_id:randomUUID(),command_id:'synthetic-care-handoff',request_digest:'1'.repeat(64),completion_package_digest:'2'.repeat(64),final_obligation_digest:'3'.repeat(64),final_due_minor:0,currency:'USD',financial_clearance_kind:'zero_balance_clearance',financial_clearance_digest:'4'.repeat(64),financial_cleared_at:seedAt,customer_summary:'Synthetic completed Custom site for isolated Care tests.',delivery_manifest:{items:[{label:'Synthetic site',description:'Isolated acceptance fixture only.'}]},document_content_digest:'5'.repeat(64),document_byte_count:100,document_media_type:'application/json',handed_off_by_operator_user_id:operator.userId,handed_off_at:seedAt,workmanship_starts_at:seedAt,workmanship_ends_at:'2026-10-31T00:00:00.000Z',workmanship_interval_bounds:'[)',created_at:seedAt});
   await db.query("set local session_replication_role='origin'");assert.equal((await db.query('show session_replication_role')).rows[0].session_replication_role,'origin');await db.query('commit');
  }catch(e){await db.query('rollback');throw e;}finally{db.release();}
  let now='2026-10-16T12:00:00.000Z',calls=0,cancelCalls=0,paid=false,refunded=false,disputed=false,cancelled=false,invoiceId=`in_${suffix}_first`,periodStart='2026-10-16T12:00:00.000Z',periodEnd='2026-11-16T12:00:00.000Z',ambiguous=false,cancelConfirmed=false,cancelFailure=false,blockRead=null;const invoiceHistory=new Map();
  const authority=createCanonicalPostgresAuthority({pool});const repository=createPostgresCarePaymentRepository({authority});
  const provider={readinessForPurpose:async()=>({ready:true}),async createCareCheckout({binding,attemptId,expiresAt}){
   calls++;const stored=await pool.query('select state from ss.care_catalog_payment_attempts where id=$1',[attemptId]);assert.equal(stored.rows[0].state,'pending');assert.equal(binding.customerId,customer.userId);if(ambiguous)throw new Error('provider timeout');
   return {state:'ready',checkoutSessionId:`cs_${attemptId.replaceAll('-','')}`,checkoutUrl:'https://checkout.stripe.com/c/pay/care',expiresAt,providerCustomerId:null,subscriptionId:null,invoice:null};},
   async readCareCheckout({checkoutSessionId}){return {state:paid?'paid':'ready',checkoutSessionId,checkoutUrl:paid?null:'https://checkout.stripe.com/c/pay/care',expiresAt:'2026-10-16T13:00:00.000Z',providerCustomerId:paid?providerCustomerId:null,subscriptionId:paid?subscriptionId:null,invoice:null};},
   async readCareSubscription({binding,subscriptionId:selectedId,invoiceId:requested}){assert.equal(binding.amountMinor,6900);assert.equal(selectedId,subscriptionId);
    const currentInvoice={invoiceId,paymentIntentId:`pi_${suffix}_${invoiceId}`,chargeId:`ch_${suffix}_${invoiceId}`,periodStart,periodEnd,amountMinor:6900,currency:'USD',settledAt:periodStart,paid,refunded,disputed};invoiceHistory.set(invoiceId,currentInvoice);
    const response={subscriptionId,providerCustomerId,status:cancelled?'canceled':'active',cancelAtPeriodEnd:cancelConfirmed,canceledAt:cancelled?now:null,currentPeriodStart:periodStart,currentPeriodEnd:periodEnd,invoice:structuredClone(requested&&requested!==invoiceId?invoiceHistory.get(requested):currentInvoice)};
    if(blockRead){const block=blockRead;blockRead=null;block.entered();await block.promise;}return response;},
   async cancelCareSubscriptionAtPeriodEnd(){cancelCalls++;if(cancelFailure){cancelFailure=false;throw new Error('cancel connection interrupted');}cancelConfirmed=true;return {pending:true};}};
  const service=createCarePaymentsService({repository,provider,release:{approved:true},legalAuthority,clock:()=>now});
  const factories=createLifecycleWorkerFactories({authority,purposes:['care-lifecycle'],environment:{SITESOURCERY_CARE_MODE:'approved_live',SITESOURCERY_CARE_LIFECYCLE_WORKER_MODE:'approved_live',SITESOURCERY_CARE_LIFECYCLE_WORKER_LEASE_SECONDS:'300'},stripeFactory:()=>({adapter:provider}),careRepositoryFactory:({authority})=>({...createPostgresCareLifecycleWorkerRepository({authority}),claimNext:async()=>null}),clock:{now:()=>now}});
  const composition=await factories['care-lifecycle']({loop:{intervalMs:60000,errorBackoffMs:5000,maximumBackoffMs:300000}});
  async function cycle(){await pool.query('update ss.care_catalog_agreements set reconcile_after=$2 where id=$1',[agreementId,now]);return composition.worker.runOnce();}
  assert.equal((await composition.readiness()).ready,true);assert.equal((await service.readiness()).commercialReady,true);
  const offerInput={projectId,planId:'plan_care_lite',writtenPlan,expiresAt:'2026-10-17T12:00:00.000Z'};
  await assert.rejects(service.createOffer(stranger,customer.organizationId,offerInput,'offer-unauthorized'),{code:'CARE_UNAVAILABLE'});
  await assert.rejects(service.createOffer(operator,customer.organizationId,{...offerInput,projectId:unhandedProjectId},'offer-unhanded'),{code:'CARE_UNAVAILABLE'});
  const offer=await service.createOffer(operator,customer.organizationId,offerInput,'offer-current');assert.deepEqual(await service.createOffer(operator,customer.organizationId,offerInput,'offer-current'),offer);
  await assert.rejects(service.createOffer(operator,customer.organizationId,{...offerInput,planId:'plan_care'},'offer-current'),{code:'CARE_CONFLICT'});
  await assert.rejects(pool.query('update ss.care_catalog_offers set offer_digest=$2 where id=$1',[offer.offerId,'c'.repeat(64)]),e=>e.code==='55000');
  const legalAcceptance={schema:legalAuthority.acceptanceSchema,acceptanceStatement:legalAuthority.acceptanceStatement,authorityDigest:legalAuthority.authorityDigest,documents:legalAuthority.documents};
  const acceptance={expectedOfferDigest:offer.offerDigest,acceptanceStatement:CARE_ACCEPTANCE_STATEMENT,legalAcceptance};
  await assert.rejects(service.acceptOffer(stranger,offer.offerId,acceptance,'accept-stranger'),{code:'CARE_UNAVAILABLE'});
  const accepted=await service.acceptOffer(customer,offer.offerId,acceptance,'accept-current');assert.deepEqual(await service.acceptOffer(customer,offer.offerId,acceptance,'accept-current'),accepted);
  assert.equal((await service.readCustomer(stranger)).agreements.length,0);
  await assert.rejects(service.voidOffer(operator,customer.organizationId,offer.offerId,{reason:'The customer has already accepted.'},'void-current'),{code:'CARE_CONFLICT'});
  const agreementId=accepted.agreementId;
  await assert.rejects(service.requestWork(customer,agreementId,{summary:'Change the public contact number.'},'work-before-paid'),{code:'CARE_UNAVAILABLE'});
  ambiguous=true;await assert.rejects(service.startCheckout(customer,agreementId,{},'checkout-current'),/provider timeout/);ambiguous=false;
  const checkout=await service.startCheckout(customer,agreementId,{},'checkout-current');assert.equal(checkout.state,'ambiguous');assert.equal(calls,1);
  await assert.rejects(service.startCheckout(customer,agreementId,{},'checkout-second'),{code:'CARE_CONFLICT'});
  await assert.rejects(pool.query("update ss.projects set lifecycle='cancelled',cancelled_at=now() where id=$1",[projectId]),e=>e.code==='55000');
  paid=true;now='2026-10-16T14:00:00.000Z';
  const stored=(await repository.inspect({actorKind:'customer',actorId:customer.userId,organizationId:customer.organizationId},agreementId)).attempts[0];
  const paidEvent={id:`evt_${suffix}_paid`,data:{object:{object:'checkout.session',id:`cs_${stored.attemptId.replaceAll('-','')}`,metadata:{purpose:'care',agreementId,attemptId:stored.attemptId}}}};
  assert.equal((await service.ingestStripeEvent(paidEvent)).status,'processed');assert.equal(calls,1,'Expired unknown-session recovery never creates a second checkout');
  const active=(await service.readCustomer(customer)).agreements[0];assert.equal(active.state,'active');assert.equal(active.capacity.minutes,30);assert.equal(active.periods.length,1);
  assert.equal((await service.reconcileCustomer(customer,agreementId,{})).periods.length,1);
  const originalRead=provider.readCareSubscription;provider.readCareSubscription=async input=>{const result=await originalRead(input);return {...result,invoice:{...result.invoice,paymentIntentId:'pi_changed'}};};
  await assert.rejects(service.reconcileCustomer(customer,agreementId,{}),{code:'CARE_CONFLICT'});provider.readCareSubscription=originalRead;
  await assert.rejects(pool.query("update ss.care_catalog_paid_periods set payment_intent_id='pi_changed' where agreement_id=$1",[agreementId]),e=>e.code==='55000');

  const request=await service.requestWork(customer,agreementId,{summary:'Change the public contact number.'},'request-current');assert.deepEqual(await service.requestWork(customer,agreementId,{summary:'Change the public contact number.'},'request-current'),request);
  await assert.rejects(service.recordWork(operator,customer.organizationId,agreementId,request.requestId,{expectedRevision:1,state:'completed',minutes:31,note:'Updated the contact number and verified it.'},'work-too-much'),{code:'CARE_CONFLICT'});
  const work=await service.recordWork(operator,customer.organizationId,agreementId,request.requestId,{expectedRevision:1,state:'completed',minutes:20,note:'Updated the contact number and verified it.'},'work-current');assert.equal(work.minutes,20);
  await assert.rejects(service.recordWork(operator,customer.organizationId,agreementId,request.requestId,{expectedRevision:1,state:'completed',minutes:20,note:'Updated the contact number and verified it.'},'work-stale'),{code:'CARE_CONFLICT'});
  for(let i=0;i<2;i++)await service.requestWork(customer,agreementId,{summary:`Another requested text update number ${i}.`},`request-other-${i}`);
  await assert.rejects(service.requestWork(customer,agreementId,{summary:'A fourth requested update exceeds the plan.'},'request-limit'),{code:'CARE_CONFLICT'});
  disputed=true;assert.equal((await service.reconcileCustomer(customer,agreementId,{})).state,'suspended');
  disputed=false;assert.equal((await service.reconcileCustomer(customer,agreementId,{})).state,'active');
  now='2026-11-16T12:00:01.000Z';assert.equal((await service.readCustomer(customer)).agreements[0].state,'past_due');assert.equal((await service.readCustomer(customer)).agreements[0].capacity,null,'No clock-only capacity renewal');
  invoiceId=`in_${suffix}_second`;periodStart='2026-11-16T12:00:00.000Z';periodEnd='2026-12-16T12:00:00.000Z';assert.equal((await cycle()).completed,1);const renewal=(await service.readCustomer(customer)).agreements[0];assert.equal(renewal.state,'active');assert.equal(renewal.periods.length,2);assert.equal(renewal.capacity.usedMinutes,0);
  // A delayed earlier provider read cannot reopen a newer cancellation.
  let unblock,entered;const started=new Promise(r=>entered=r);blockRead={entered,promise:new Promise(r=>unblock=r)};
  const stale=service.reconcileCustomer(customer,agreementId,{});const staleResult=stale.then(()=>null,e=>e);await started;
  cancelFailure=true;await assert.rejects(service.cancel(customer,agreementId,{},'cancel-current'),/cancel connection interrupted/);unblock();assert.equal((await staleResult).code,'CARE_CONFLICT');assert.equal((await cycle()).completed,1);const cancellation=(await service.readCustomer(customer)).agreements[0];assert.equal(cancelCalls,2);assert.equal(cancellation.state,'cancellation_pending');assert.equal(cancellation.paidThrough,periodEnd);
  refunded=true;const event={id:`evt_${suffix}_refund`,type:'charge.refunded',data:{object:{object:'charge',id:`ch_${suffix}_${invoiceId}`}}};assert.equal((await service.ingestStripeEvent(event)).status,'processed');assert.equal((await service.ingestStripeEvent(event)).status,'duplicate');assert.equal((await service.readCustomer(customer)).agreements[0].state,'suspended');
  await assert.rejects(service.requestWork(customer,agreementId,{summary:'Cannot spend refunded capacity.'},'request-refunded'),{code:'CARE_CONFLICT'});
  assert.deepEqual(await service.ingestStripeEvent({id:'evt_unrelated',data:{object:{object:'charge',id:'ch_unknown'}}}),{status:'not_care'});
  // A reversed previous month does not orphan a separately paid next month.
  refunded=false;invoiceId=`in_${suffix}_third`;periodStart='2026-12-16T12:00:00.000Z';periodEnd='2027-01-16T12:00:00.000Z';now='2026-12-16T12:00:01.000Z';
  assert.equal((await cycle()).completed,1);assert.equal((await service.readCustomer(customer)).agreements[0].state,'cancellation_pending');
  // A missed historical reversal is found by the same worker's bounded scan.
  invoiceHistory.get(`in_${suffix}_first`).refunded=true;assert.equal((await cycle()).completed,1);assert.equal((await cycle()).completed,1); // two retained historical invoices, one per bounded cycle
  assert.ok((await service.readCustomer(customer)).agreements[0].periods.find(p=>p.invoiceId===`in_${suffix}_first`).invalidatedAt);
  cancelled=true;now='2027-01-16T12:00:01.000Z';await service.reconcileCustomer(customer,agreementId,{});
  const final=await service.readOwner(operator,customer.organizationId);assert.equal(final.agreements[0].cancelledAt,now);assert.equal(final.agreements[0].periods.length,3);assert.equal(final.agreements[0].capacity,null);
  const client=await pool.connect();try{await client.query('begin');await client.query('set local role authenticated');await assert.rejects(client.query('select * from ss.care_catalog_offers'),e=>e.code==='42501');await client.query('rollback');}finally{client.release();}
  console.log(JSON.stringify({proof:'care-catalog-postgres',syntheticHandoffInput:true,fixtureReplicationModeRestored:true,providerEffects:false,agreements:1,paidPeriods:3,checkouts:calls,guards:['tenant','operator','unhanded-project','immutable','idempotency','pending-before-provider','no-clock-renewal','usage','revision','refund','dispute','cancellation','project-lifecycle','rls']}));
 }finally{await pool.end();}
});
