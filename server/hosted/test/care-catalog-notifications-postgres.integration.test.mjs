import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCanonicalPostgresAuthority} from '../repository-postgres.mjs';
import {createPostgresCarePaymentRepository} from '../care-payment-postgres.mjs';
import {createCarePaymentsService,CARE_ACCEPTANCE_STATEMENT} from '../care-payments.mjs';
import {createMailLifecycle} from '../mail-lifecycle.mjs';
import {createPostgresMailLifecycleRepository} from '../mail-lifecycle-postgres.mjs';
import {digest} from '../security.mjs';

const url=process.env.SITESOURCERY_PG_CARE_NOTIFICATION_TEST_URL;
const legalAuthority={schema:'sitesourcery.project-legal-authority/v7',acceptanceSchema:'sitesourcery.project-legal-acceptance/v7',acceptanceStatement:'accepted_exact_project_terms_and_acknowledged_privacy',authorityDigest:'a'.repeat(64),documents:['privacy','product','website'].map(kind=>({kind,version:`CARE-TEST-${kind}-V7`,contentDigest:'b'.repeat(64),contentUri:`https://example.test/${kind}`,effectiveAt:'2026-10-01T00:00:00.000Z'}))};
const writtenPlan={siteUrl:'https://care-fixture.example.test/',hosting:'Customer maintains their existing hosting account.',monitoring:'Owner checks the website each business day.',backups:'Owner retains a weekly website backup.',includedWork:'Small text and image edits within the chosen limits.',responseTarget:'Owner responds within two business days.',outsideCosts:'Outside costs require separate customer approval.'};
async function insert(db,table,value){const keys=Object.keys(value);await db.query(`insert into ss.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(value));}

test('Care suppression preserves normal business updates while storage failures roll back',{skip:!url,timeout:60000},async t=>{
  const parsed=new URL(url);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));
  assert.ok([null,'/tmp','localhost','127.0.0.1'].includes(parsed.searchParams.get('host')));
  assert.match(parsed.pathname,/^\/ss_care_mail_[a-z0-9_]+$/u);
  const pool=new pg.Pool({connectionString:url,max:3});
  try{
    const identity=(await pool.query('select current_database() as name,host(inet_server_addr()) as address')).rows[0];
    assert.equal(identity.name,parsed.pathname.slice(1));assert.ok([null,'127.0.0.1','::1'].includes(identity.address));
    const customer={userId:randomUUID(),organizationId:randomUUID()},operator={userId:randomUUID()};
    const projectId=randomUUID(),handoffId=randomUUID(),policyId=randomUUID();
    const seedAt='2026-10-01T00:00:00.000Z',now=new Date().toISOString();
    const db=await pool.connect();
    try{
      await db.query('begin');
      for(const actor of [customer,operator]){
        await db.query('insert into auth.users(id,email) values($1,$2)',[actor.userId,`${actor.userId}@example.test`]);
        await insert(db,'hosted_account_profiles',{user_id:actor.userId,display_name:'Synthetic Care mail',state:'active'});
      }
      await insert(db,'organizations',{id:customer.organizationId,created_by_user_id:customer.userId,name:'Synthetic Care mail'});
      await insert(db,'organization_memberships',{organization_id:customer.organizationId,user_id:customer.userId,role:'owner',state:'active'});
      await insert(db,'billing_policies',{id:policyId,policy_key:`care-${policyId}`,grace_period:'14 days',retention_period:'90 days',effective_at:seedAt});
      await insert(db,'projects',{id:projectId,organization_id:customer.organizationId,created_by_user_id:customer.userId,billing_policy_id:policyId,name:'Synthetic Care mail website'});
      await insert(db,'operator_profiles',{user_id:operator.userId,display_label:'Synthetic owner',authorized_by_user_id:operator.userId,authorized_at:seedAt});
      for(const capability of ['service_management_manage','service_quote_author','service_payment_reconcile']){
        await insert(db,'operator_permissions',{operator_user_id:operator.userId,capability,granted_by_user_id:operator.userId,granted_at:seedAt});
        await insert(db,'service_operator_authority_events',{operator_user_id:operator.userId,capability,event_sequence:1,event_kind:'grant',effective_at:seedAt,expires_at:new Date(Date.now()+86400000).toISOString(),created_at:seedAt});
      }
      // As in the existing Care acceptance fixture, the previously qualified
      // Custom handoff is only a synthetic prerequisite. Its upstream FKs are
      // outside this proof; all new Care/mail statements use normal guards.
      await db.query("set local session_replication_role='replica'");
      await insert(db,'service_custom_build_handoff_receipts',{id:handoffId,organization_id:customer.organizationId,project_id:projectId,case_id:randomUUID(),customer_user_id:customer.userId,job_id:randomUUID(),completion_package_id:randomUUID(),final_obligation_id:randomUUID(),zero_balance_clearance_id:randomUUID(),document_id:randomUUID(),command_id:'synthetic-care-mail-handoff',request_digest:'1'.repeat(64),completion_package_digest:'2'.repeat(64),final_obligation_digest:'3'.repeat(64),final_due_minor:0,currency:'USD',financial_clearance_kind:'zero_balance_clearance',financial_clearance_digest:'4'.repeat(64),financial_cleared_at:seedAt,customer_summary:'Synthetic completed Custom site for isolated Care tests.',delivery_manifest:{items:[{label:'Synthetic site',description:'Isolated acceptance fixture only.'}]},document_content_digest:'5'.repeat(64),document_byte_count:100,document_media_type:'application/json',handed_off_by_operator_user_id:operator.userId,handed_off_at:seedAt,workmanship_starts_at:seedAt,workmanship_ends_at:'2026-10-31T00:00:00.000Z',workmanship_interval_bounds:'[)',created_at:seedAt});
      await db.query("set local session_replication_role='origin'");
      assert.equal((await db.query('show session_replication_role')).rows[0].session_replication_role,'origin');
      await db.query('commit');
    }catch(error){await db.query('rollback');throw error;}finally{db.release();}

    const authority=createCanonicalPostgresAuthority({pool});
    const repository=createPostgresCarePaymentRepository({authority});
    // No provider adapter/network is constructed. The normal repository writes
    // receive synthetic verified provider observations, as the existing fixture.
    const provider={readinessForPurpose:async()=>({ready:true})};
    const makeService=repository=>createCarePaymentsService({repository,provider,release:{approved:true},legalAuthority,clock:()=>now});
    const service=makeService(repository),suffix=randomUUID().replaceAll('-','');
    const offer=await service.createOffer(operator,customer.organizationId,{projectId,planId:'plan_care_lite',writtenPlan,expiresAt:new Date(Date.parse(now)+86400000).toISOString()},randomUUID());
    const accepted=await service.acceptOffer(customer,offer.offerId,{expectedOfferDigest:offer.offerDigest,acceptanceStatement:CARE_ACCEPTANCE_STATEMENT,legalAcceptance:{schema:legalAuthority.acceptanceSchema,acceptanceStatement:legalAuthority.acceptanceStatement,authorityDigest:legalAuthority.authorityDigest,documents:legalAuthority.documents}},randomUUID());
    const agreementId=accepted.agreementId,scope={actorKind:'customer',actorId:customer.userId,organizationId:customer.organizationId};
    const attemptId=randomUUID(),expiresAt=new Date(Date.parse(now)+3600000).toISOString();
    await repository.reserveAttempt({...scope,commandId:randomUUID(),requestDigest:digest(randomUUID())},agreementId,attemptId,now,expiresAt);
    const subscriptionId=`sub_${suffix}`,providerCustomerId=`cus_${suffix}`;
    await repository.saveCheckout(agreementId,attemptId,{state:'paid',subscriptionId,providerCustomerId,checkoutSessionId:`cs_${suffix}`,checkoutUrl:null,expiresAt},now);
    const periodStart=new Date(Date.parse(now)-86400000).toISOString(),periodEnd=new Date(Date.parse(now)+29*86400000).toISOString();
    const response={subscriptionId,providerCustomerId,status:'active',cancelAtPeriodEnd:false,canceledAt:null,currentPeriodStart:periodStart,currentPeriodEnd:periodEnd,invoice:{invoiceId:`in_${suffix}`,paymentIntentId:`pi_${suffix}`,chargeId:`ch_${suffix}`,periodStart,periodEnd,amountMinor:6900,currency:'USD',settledAt:periodStart,paid:true,refunded:false,disputed:false}};
    const save=async value=>repository.saveSubscription(agreementId,value,now,(await repository.inspect(scope,agreementId)).revision);
    const counts=async()=> (await pool.query(`select
      (select count(*)::int from ss.care_catalog_notification_events where agreement_id=$1::uuid) as events,
      (select count(*)::int from ss.mail_purpose_notification_outbox where reference_id=$1::text) as outbox,
      (select count(*)::int from ss.hosted_mail_deliveries where customer_user_id=$2) as mail`,[agreementId,customer.userId])).rows[0];
    await t.test('an unsuppressed paid month still records its canonical event and pending mail',async()=>{
      await save(response);assert.deepEqual(await counts(),{events:1,outbox:1,mail:1});
      const mail=(await pool.query('select state,template_version,provider from ss.hosted_mail_deliveries where customer_user_id=$1',[customer.userId])).rows[0];
      assert.deepEqual(mail,{state:'pending',template_version:'care-catalog-paid-month-receipt.v1',provider:null});
      await save(response);assert.deepEqual(await counts(),{events:1,outbox:1,mail:1});
    });
    await t.test('unexpected suppression lookup errors roll back the request and idempotency command',async()=>{
      const broken=createPostgresCarePaymentRepository({authority:{service:(context,work)=>authority.service(context,db=>work({query:(sql,args)=>{
        if(sql.includes('ss.hosted_mail_recipient_suppressions'))throw new Error('injected suppression lookup failure');
        return db.query(sql,args);
      }}))}});
      const commandId=randomUUID();
      await assert.rejects(makeService(broken).requestWork(customer,agreementId,{summary:'This request must roll back with the lookup failure.'},commandId),/injected suppression lookup failure/);
      assert.equal((await pool.query('select count(*)::int as n from ss.care_catalog_requests where agreement_id=$1',[agreementId])).rows[0].n,0);
      assert.equal((await pool.query('select count(*)::int as n from ss.care_catalog_commands where command_id=$1',[commandId])).rows[0].n,0);
      assert.deepEqual(await counts(),{events:1,outbox:1,mail:1});
    });
    await t.test('durable suppression permits request, owner update, cancellation and payment reconciliation without new mail',async()=>{
      const message=(await pool.query('select id,recipient_digest from ss.hosted_mail_deliveries where customer_user_id=$1',[customer.userId])).rows[0];
      const lifecycle=createMailLifecycle({repository:createPostgresMailLifecycleRepository({authority}),clock:{now:()=>new Date().toISOString()}});
      const providerMessageIdDigest=digest(randomUUID()),evidenceDigest=digest('synthetic-local-mail-evidence');
      await lifecycle.recordProviderAcceptance({commandId:randomUUID(),messageId:message.id,provider:'resend',providerMessageIdDigest,evidenceDigest,acceptedAt:new Date().toISOString()});
      await lifecycle.ingestProviderEvent({provider:'resend',providerEventIdDigest:digest(randomUUID()),providerMessageIdDigest,eventKind:'suppressed',signatureVerificationDigest:evidenceDigest,evidenceDigest,occurredAt:new Date().toISOString()});
      assert.equal((await pool.query('select count(*)::int as n from ss.hosted_mail_recipient_suppressions where recipient_digest=$1',[message.recipient_digest])).rows[0].n,1);
      const input={summary:'Change the contact heading for this synthetic site.'},commandId=randomUUID();
      const request=await service.requestWork(customer,agreementId,input,commandId);
      assert.equal(request.state,'requested');assert.deepEqual(await service.requestWork(customer,agreementId,input,commandId),request);
      const completed=await service.recordWork(operator,customer.organizationId,agreementId,request.requestId,{expectedRevision:1,state:'completed',minutes:5,note:'Updated the synthetic heading and checked it.'},randomUUID());
      assert.equal(completed.state,'completed');assert.equal(completed.revision,2);
      await repository.requestCancellation({...scope,commandId:randomUUID()},agreementId,now);
      assert.ok((await repository.inspect(scope,agreementId)).cancelRequestedAt);
      const refunded=await save({...response,invoice:{...response.invoice,refunded:true}});
      assert.equal(refunded.periods[0].invalidationReason,'refunded');assert.equal(refunded.state,'suspended');
      // A different, nonoverlapping paid month also commits without a receipt.
      const nextEnd=new Date(Date.parse(periodEnd)+30*86400000).toISOString();
      const renewed=await save({...response,currentPeriodStart:periodEnd,currentPeriodEnd:nextEnd,invoice:{...response.invoice,invoiceId:`in_${suffix}_next`,paymentIntentId:`pi_${suffix}_next`,chargeId:`ch_${suffix}_next`,periodStart:periodEnd,periodEnd:nextEnd,settledAt:periodEnd}});
      assert.equal(renewed.periods.length,2);
      assert.deepEqual(await counts(),{events:1,outbox:1,mail:1},'all five notice kinds skip before event/outbox creation');
      const persisted=(await pool.query('select state,revision,minutes from ss.care_catalog_requests where id=$1',[request.requestId])).rows[0];
      assert.deepEqual(persisted,{state:'completed',revision:2,minutes:5});
    });
  }finally{await pool.end();}
});
