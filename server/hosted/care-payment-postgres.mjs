import { randomUUID } from 'node:crypto';
import { HostedError, invariant } from './errors.mjs';
import { digest } from './security.mjs';

const unavailable = () => invariant(false,'CARE_UNAVAILABLE','The Care resource is unavailable.',{status:404});
const iso = value => value == null ? null : new Date(value).toISOString();
const one = result => { if(result.rowCount!==1) unavailable(); return result.rows[0]; };
const check = (ok,message='Care state changed. Refresh before continuing.') => invariant(ok,'CARE_CONFLICT',message,{status:409});
async function authorize(db,s) {
 if(s.actorKind==='system') return;
 const row=one(await db.query(s.actorKind==='operator'
  ? `select ss.service_operator_has_capability($1,'service_management_manage',clock_timestamp()) as allowed`
  : `select exists(select 1 from ss.organization_memberships m join ss.organizations o on o.id=m.organization_id join auth.users u on u.id=m.user_id join ss.hosted_account_profiles p on p.user_id=m.user_id where m.user_id=$1 and m.organization_id=$2 and m.state='active' and m.role in ('owner','admin') and o.state='active' and u.disabled_at is null and p.state='active') as allowed`,
 s.actorKind==='operator'?[s.actorId]:[s.actorId,s.organizationId]));
 if(!row.allowed) unavailable();
 if(s.actorKind==='operator'&&['offer','void','reconcile'].includes(s.operation)){
  const capability=s.operation==='reconcile'?'service_payment_reconcile':'service_quote_author';
  if(!one(await db.query('select ss.service_operator_has_capability($1,$2,clock_timestamp()) as allowed',[s.actorId,capability])).allowed)unavailable();
 }
}
async function agreement(db,s,id,lock=false) {
 const row=one(await db.query(`select a.*,o.document as offer,o.included_minutes,o.edit_cap from ss.care_catalog_agreements a join ss.care_catalog_offers o on o.id=a.offer_id
 where a.id=$1 and ($2::uuid is null or a.organization_id=$2) and ($3::uuid is null or a.customer_user_id=$3) ${lock?'for update of a':''}`,
 [id,s.organizationId??null,s.actorKind==='customer'?s.actorId:null]));
 return row;
}
async function currentProject(db,row) {
 one(await db.query(`select id from ss.projects where id=$1 and organization_id=$2 and lifecycle='active'`,[row.project_id,row.organization_id]));
}
function attemptView(row) {
 return {attemptId:row.id,agreementId:row.agreement_id,state:row.state,checkoutSessionId:row.checkout_session_id,
 checkoutUrl:row.checkout_url,expiresAt:iso(row.expires_at),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};
}
function periodView(p) { return {periodId:p.id,invoiceId:p.invoice_id,startsAt:iso(p.starts_at),endsAt:iso(p.ends_at),amountMinor:p.amount_minor,currency:p.currency,settledAt:iso(p.settled_at),invalidatedAt:iso(p.invalidated_at),invalidationReason:p.invalidation_reason}; }
function requestView(r) {return {requestId:r.id,agreementId:r.agreement_id,periodId:r.period_id,summary:r.summary,state:r.state,minutes:r.minutes,ownerNote:r.owner_note,revision:r.revision,createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)};}
async function view(db,row,now) {
 const periods=(await db.query(`select * from ss.care_catalog_paid_periods where agreement_id=$1 order by starts_at desc limit 120`,[row.id])).rows;
 const requests=(await db.query(`select * from ss.care_catalog_requests where agreement_id=$1 order by created_at desc limit 500`,[row.id])).rows;
 const attempts=(await db.query(`select * from ss.care_catalog_payment_attempts where agreement_id=$1 order by created_at desc limit 20`,[row.id])).rows;
 const active=periods.find(p=>!p.invalidated_at&&Date.parse(p.starts_at)<=Date.parse(now)&&Date.parse(p.ends_at)>Date.parse(now));
 const current=periods.find(p=>Date.parse(p.starts_at)<=Date.parse(now)&&Date.parse(p.ends_at)>Date.parse(now));
 const state=current?.invalidated_at?'suspended':active?(row.cancel_at_period_end||row.cancelled_at?'cancellation_pending':'active'):row.cancelled_at?'cancelled':row.subscription_id?'past_due':'awaiting_payment';
 return {agreementId:row.id,organizationId:row.organization_id,projectId:row.project_id,customerId:row.customer_user_id,
 offerId:row.offer_id,acceptanceId:row.acceptance_id,plan:row.offer.plan,writtenPlan:row.offer.writtenPlan,state,revision:Number(row.revision),
 cancelRequestedAt:iso(row.cancel_requested_at),cancelAtPeriodEnd:row.cancel_at_period_end,cancelledAt:iso(row.cancelled_at),
 reconciliation:{lastCheckedAt:iso(row.reconciled_at),nextCheckAt:iso(row.reconcile_after),error:row.reconcile_error},currentPeriodId:active?.id??null,paidThrough:active?iso(active.ends_at):null,
 capacity:active?{minutes:row.included_minutes,usedMinutes:requests.filter(r=>r.period_id===active.id).reduce((n,r)=>n+r.minutes,0),edits:row.edit_cap,usedEdits:requests.filter(r=>r.period_id===active.id&&r.state!=='declined').length}:null,
 periods:periods.map(periodView),requests:requests.map(requestView),attempts:attempts.map(attemptView),automaticOverage:false};
}
export function createPostgresCarePaymentRepository({authority}={}) {
 invariant(authority&&typeof authority.service==='function','CARE_CONFIGURATION_REQUIRED','Canonical Care storage is required.',{status:500});
 async function tx(s,work,readOnly=false) {
  try{return await authority.service({actorKind:s.actorKind,userId:s.actorId??null,organizationId:s.organizationId??null,isolation:'serializable',readOnly},async db=>{await authorize(db,s);return work(db);});}
  catch(e){if(e instanceof HostedError)throw e;if(['40001','40P01','23505','23514','55000','23503'].includes(e.code))throw new HostedError('CARE_CONFLICT','Care state changed. Retry the same command safely.',{status:409});if(e.code==='42501')unavailable();throw e;}
 }
 async function command(s,work) {return tx(s,async db=>{
  await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`${s.actorId}:${s.commandId}`]);
  const prior=await db.query('select * from ss.care_catalog_commands where actor_user_id=$1 and command_id=$2',[s.actorId,s.commandId]);
  if(prior.rowCount){const p=prior.rows[0];check(p.organization_id===s.organizationId&&p.operation===s.operation&&p.request_digest===s.requestDigest,'This Care command was reused for different content.');return p.result;}
  const result=await work(db);
  await db.query('insert into ss.care_catalog_commands(actor_user_id,organization_id,command_id,operation,request_digest,result) values($1,$2,$3,$4,$5,$6)',[s.actorId,s.organizationId,s.commandId,s.operation,s.requestDigest,result]);return result;
 });}
 const system={actorKind:'system'};
 return Object.freeze({
  async readiness(){return tx(system,async db=>{const r=one(await db.query("select to_regclass('ss.care_catalog_offers') is not null and to_regclass('ss.care_catalog_provider_events') is not null as ready"));return {ready:r.ready,verified:r.ready,durable:true};},true);},
  read(s,now=new Date().toISOString()){return tx(s,async db=>{
   const offers=(await db.query(`select o.document,o.offer_digest,v.recorded_at as voided_at,v.reason as void_reason,a.id as acceptance_id from ss.care_catalog_offers o
    left join ss.care_catalog_offer_voids v on v.offer_id=o.id left join ss.care_catalog_acceptances a on a.offer_id=o.id
    where o.organization_id=$1 and ($2::uuid is null or o.customer_user_id=$2) order by o.issued_at desc limit 100`,[s.organizationId,s.actorKind==='customer'?s.actorId:null])).rows;
   const agreements=(await db.query(`select a.*,o.document as offer,o.included_minutes,o.edit_cap from ss.care_catalog_agreements a join ss.care_catalog_offers o on o.id=a.offer_id where a.organization_id=$1 and ($2::uuid is null or a.customer_user_id=$2) order by a.created_at desc limit 100`,[s.organizationId,s.actorKind==='customer'?s.actorId:null])).rows;
   const projects=(await db.query(`select distinct p.id as "projectId",p.name,h.customer_user_id as "customerId" from ss.projects p join ss.service_custom_build_handoff_receipts h on h.organization_id=p.organization_id and h.project_id=p.id join ss.organization_memberships m on m.organization_id=p.organization_id and m.user_id=h.customer_user_id where p.organization_id=$1 and p.lifecycle='active' and m.state='active' and m.role in ('owner','admin') and ($2::uuid is null or h.customer_user_id=$2) order by p.name,p.id limit 100`,[s.organizationId,s.actorKind==='customer'?s.actorId:null])).rows;
   return {schema:'sitesourcery.care-agreements/v1',organizationId:s.organizationId,observedAt:now,eligibleProjects:projects,offers:offers.map(o=>({...o.document,offerDigest:o.offer_digest,voidedAt:iso(o.voided_at),voidReason:o.void_reason,acceptanceId:o.acceptance_id})),agreements:await Promise.all(agreements.map(a=>view(db,a,now)))};
  },true);},
  createOffer(s,offer){return command(s,async db=>{
   check(s.actorKind==='operator');
   const scope=one(await db.query(`select h.id,h.customer_user_id from ss.service_custom_build_handoff_receipts h join ss.projects p on p.id=h.project_id and p.organization_id=h.organization_id join ss.organization_memberships m on m.organization_id=h.organization_id and m.user_id=h.customer_user_id where h.organization_id=$1 and h.project_id=$2 and p.lifecycle='active' and m.state='active' and m.role in ('owner','admin') order by h.handed_off_at desc limit 1`,[s.organizationId,offer.projectId]));
   const document={...offer,customerId:scope.customer_user_id,handoffId:scope.id};delete document.offerDigest;
   const offerDigest=digest(document),p=offer.plan;
   await db.query(`insert into ss.care_catalog_offers(id,organization_id,project_id,customer_user_id,handoff_id,plan_id,amount_minor,included_minutes,edit_cap,document,offer_digest,issued_at,expires_at,issued_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[offer.offerId,s.organizationId,offer.projectId,scope.customer_user_id,scope.id,p.planId,p.monthlyAmountMinor,p.includedMinutes,p.editCap,document,offerDigest,offer.issuedAt,offer.expiresAt,s.actorId]);
   return {...document,offerDigest};
  });},
  voidOffer(s,id,reason,now){return command(s,async db=>{
   check(s.actorKind==='operator');await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`care-offer:${id}`]);one(await db.query('select id from ss.care_catalog_offers where id=$1 and organization_id=$2',[id,s.organizationId]));
   check((await db.query('select id from ss.care_catalog_acceptances where offer_id=$1',[id])).rowCount===0,'An accepted Care plan cannot be voided.');
   await db.query('insert into ss.care_catalog_offer_voids values($1,$2,$3,$4,$5)',[id,s.organizationId,reason,now,s.actorId]);return {offerId:id,voidedAt:now};
  });},
  acceptOffer(s,a){return command(s,async db=>{
   check(s.actorKind==='customer');await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`care-offer:${a.offerId}`]);const o=one(await db.query(`select * from ss.care_catalog_offers where id=$1 and organization_id=$2 and customer_user_id=$3`,[a.offerId,s.organizationId,s.actorId]));
   await currentProject(db,o);check(o.offer_digest===a.expectedOfferDigest&&Date.parse(o.expires_at)>Date.parse(a.acceptedAt),'This exact Care offer is no longer available.');
   check((await db.query('select offer_id from ss.care_catalog_offer_voids where offer_id=$1',[o.id])).rowCount===0);
   const document={...a,organizationId:s.organizationId,customerId:s.actorId,projectId:o.project_id};delete document.acceptanceDigest;
   const acceptanceDigest=digest(document),binding={organizationId:s.organizationId,projectId:o.project_id,customerId:s.actorId,offerId:o.id,acceptanceId:a.acceptanceId,agreementId:a.agreementId,planId:o.plan_id,amountMinor:o.amount_minor,currency:'USD',offerDigest:o.offer_digest,acceptanceDigest,legalAuthorityDigest:o.document.legalAuthority.authorityDigest,taxMode:'disabled_by_owner'};
   check(a.legalAcceptance.authorityDigest===binding.legalAuthorityDigest,'The Care offer uses superseded legal terms.');
   check((await db.query('select id from ss.care_catalog_agreements old where old.project_id=$1 and (old.cancelled_at is null or exists(select 1 from ss.care_catalog_paid_periods p where p.agreement_id=old.id and p.invalidated_at is null and p.ends_at>$2))',[o.project_id,a.acceptedAt])).rowCount===0,'Existing Care billing or a paid month must finish before accepting another plan.');
   await db.query('insert into ss.care_catalog_acceptances values($1,$2,$3,$4,$5,$6,$7)',[a.acceptanceId,o.id,s.organizationId,s.actorId,document,acceptanceDigest,a.acceptedAt]);
   await db.query('insert into ss.care_catalog_agreements(id,organization_id,project_id,offer_id,acceptance_id,customer_user_id,binding,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[a.agreementId,s.organizationId,o.project_id,o.id,a.acceptanceId,s.actorId,binding,a.acceptedAt]);
   return {agreementId:a.agreementId,acceptanceId:a.acceptanceId,acceptanceDigest,state:'awaiting_payment'};
  });},
  inspect(s,id){return tx(s,async db=>{const a=await agreement(db,s,id);return {binding:a.binding,revision:Number(a.revision),subscriptionId:a.subscription_id,cancelRequestedAt:iso(a.cancel_requested_at),cancelCommandId:a.cancel_command_id,cancelAtPeriodEnd:a.cancel_at_period_end,cancelledAt:iso(a.cancelled_at),attempts:(await db.query('select * from ss.care_catalog_payment_attempts where agreement_id=$1 order by created_at desc limit 20',[id])).rows.map(r=>({...attemptView(r),commandId:r.command_id}))};},true);},
  reserveAttempt(s,id,attemptId,now,expiresAt){return tx(s,async db=>{
   const a=await agreement(db,s,id,true);check(s.actorKind==='customer');await currentProject(db,a);check(!a.subscription_id&&!a.cancel_requested_at,'This Care agreement already has billing or cancellation in progress.');
   const prior=(await db.query('select * from ss.care_catalog_payment_attempts where agreement_id=$1 and command_id=$2',[id,s.commandId])).rows[0];
   if(prior){check(prior.request_digest===s.requestDigest);return {created:false,binding:a.binding,attempt:attemptView(prior)};}
   check((await db.query("select id from ss.care_catalog_payment_attempts where agreement_id=$1 and state<>'expired'",[id])).rowCount===0,'Reconcile the existing Care checkout before starting another.');
   const row=one(await db.query(`insert into ss.care_catalog_payment_attempts(id,agreement_id,organization_id,command_id,request_digest,state,created_at,updated_at,expires_at) values($1,$2,$3,$4,$5,'pending',$6,$6,$7) returning *`,[attemptId,id,s.organizationId,s.commandId,s.requestDigest,now,expiresAt]));return {created:true,binding:a.binding,attempt:attemptView(row)};
  });},
  saveCheckout(id,attemptId,response,now){return tx(system,async db=>{
   const a=await agreement(db,system,id,true),p=one(await db.query('select * from ss.care_catalog_payment_attempts where id=$1 and agreement_id=$2 for update',[attemptId,id]));
   check(!p.checkout_session_id||p.checkout_session_id===response.checkoutSessionId);check(!a.subscription_id||!response.subscriptionId||a.subscription_id===response.subscriptionId);
   if(!['paid','expired'].includes(p.state)||response.state==='paid')await db.query(`update ss.care_catalog_payment_attempts set state=$2,checkout_session_id=$3,checkout_url=$4,expires_at=$5,updated_at=$6 where id=$1`,[attemptId,response.state,response.checkoutSessionId,response.checkoutUrl,response.expiresAt,now]);
   if(response.subscriptionId)await db.query(`update ss.care_catalog_agreements set subscription_id=$2,provider_customer_id=$3,revision=revision+1 where id=$1`,[id,response.subscriptionId,response.providerCustomerId]);
   return attemptView(one(await db.query('select * from ss.care_catalog_payment_attempts where id=$1',[attemptId])));
  });},
  markAmbiguous(id,attemptId,now){return tx(system,async db=>{await agreement(db,system,id,true);await db.query("update ss.care_catalog_payment_attempts set state='ambiguous',updated_at=$3 where id=$1 and agreement_id=$2 and state='pending'",[attemptId,id,now]);return {attemptId,agreementId:id,state:'ambiguous',checkoutUrl:null};});},
  requestCancellation(s,id,now){return tx(s,async db=>{
   const a=await agreement(db,s,id,true);check(s.actorKind==='customer');
   if(!a.subscription_id){check((await db.query("select id from ss.care_catalog_payment_attempts where agreement_id=$1 and state<>'expired'",[id])).rowCount===0,'Reconcile the existing checkout before cancellation.');
    await db.query('update ss.care_catalog_agreements set cancel_requested_at=coalesce(cancel_requested_at,$2),cancel_command_id=coalesce(cancel_command_id,$3),cancelled_at=coalesce(cancelled_at,$2),revision=revision+1 where id=$1',[id,now,s.commandId]);return {agreementId:id,state:'cancelled'};}

   if(!a.cancel_requested_at)await db.query('update ss.care_catalog_agreements set cancel_requested_at=$2,cancel_command_id=$3,revision=revision+1 where id=$1',[id,now,s.commandId]);
   return {binding:a.binding,subscriptionId:a.subscription_id,commandId:a.cancel_command_id??s.commandId};
  });},
  saveSubscription(id,response,now,expectedRevision,lease=null){return tx(system,async db=>{
   const a=await agreement(db,system,id,true);if(lease)check(a.reconcile_lease_owner===lease.workerId&&Number(a.reconcile_fence)===lease.fence&&Date.parse(a.reconcile_lease_until)>Date.parse(now),'Care reconciliation lease expired.');check(Number(a.revision)===expectedRevision,'Care changed while provider readback was in flight. Reconcile again.');check(a.subscription_id===response.subscriptionId&&a.provider_customer_id===response.providerCustomerId,'Care subscription identity changed.');
   await db.query(`update ss.care_catalog_agreements set provider_status=$2,cancel_at_period_end=$3,cancelled_at=$4,current_period_start=$5,current_period_end=$6,reconciled_at=$7,revision=revision+1 where id=$1`,[id,response.status,response.cancelAtPeriodEnd,response.status==='canceled'?response.canceledAt:null,response.currentPeriodStart,response.currentPeriodEnd,now]);
   const v=response.invoice;
   if(v){
    const old=(await db.query('select * from ss.care_catalog_paid_periods where invoice_id=$1',[v.invoiceId])).rows[0];
    if(old){await db.query('update ss.care_catalog_paid_periods set provider_checked_at=$2 where id=$1',[old.id,now]);check(old.agreement_id===id&&iso(old.starts_at)===v.periodStart&&iso(old.ends_at)===v.periodEnd&&old.amount_minor===v.amountMinor&&old.currency===v.currency&&old.payment_intent_id===v.paymentIntentId&&old.charge_id===v.chargeId&&iso(old.settled_at)===v.settledAt,'Care invoice authority changed.');
     if(v.refunded||v.disputed||!v.paid)await db.query('update ss.care_catalog_paid_periods set invalidated_at=coalesce(invalidated_at,$2),invalidation_reason=coalesce(invalidation_reason,$3),readback_digest=$4 where id=$1',[old.id,now,v.refunded?'refunded':v.disputed?'disputed':'unpaid',digest(v)]);
     else if(old.invalidation_reason==='disputed')await db.query('update ss.care_catalog_paid_periods set invalidated_at=null,invalidation_reason=null,readback_digest=$2 where id=$1',[old.id,digest(v)]);
    }else if(v.paid&&!v.refunded&&!v.disputed){
     check(v.amountMinor===a.binding.amountMinor&&v.currency==='USD'&&v.settledAt&&Date.parse(v.periodEnd)>Date.parse(v.periodStart),'Care invoice does not pay for the accepted month.');
     check((await db.query('select id from ss.care_catalog_paid_periods where agreement_id=$1 and starts_at<$3 and ends_at>$2',[id,v.periodStart,v.periodEnd])).rowCount===0,'Care paid months must not overlap.');
     await db.query('insert into ss.care_catalog_paid_periods(id,agreement_id,organization_id,invoice_id,payment_intent_id,charge_id,starts_at,ends_at,amount_minor,currency,settled_at,readback_digest,recorded_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[randomUUID(),id,a.organization_id,v.invoiceId,v.paymentIntentId,v.chargeId,v.periodStart,v.periodEnd,v.amountMinor,v.currency,v.settledAt,digest(v),now]);
    }
   }
   return view(db,await agreement(db,system,id),now);
  });},
  findEvent(eventId,hints){return tx(system,async db=>{
   const prior=(await db.query('select event_digest from ss.care_catalog_provider_events where event_id=$1',[eventId])).rows[0];
   const result=await db.query(`select distinct a.id,a.binding,a.subscription_id from ss.care_catalog_agreements a left join ss.care_catalog_paid_periods p on p.agreement_id=a.id left join ss.care_catalog_payment_attempts c on c.agreement_id=a.id where a.id=$1 or a.subscription_id=$2 or p.invoice_id=$3 or p.charge_id=$4 or p.payment_intent_id=$5 or c.checkout_session_id=$6 limit 2`,[hints.agreementId??null,hints.subscriptionId??null,hints.invoiceId??null,hints.chargeId??null,hints.paymentIntentId??null,hints.checkoutSessionId??null]);
   check(result.rowCount<=1,'Care event identifies multiple agreements.');const matched=await db.query('select invoice_id from ss.care_catalog_paid_periods where invoice_id=$1 or charge_id=$2 or payment_intent_id=$3 limit 2',[hints.invoiceId??null,hints.chargeId??null,hints.paymentIntentId??null]);check(matched.rowCount<=1);return {priorDigest:prior?.event_digest??null,agreement:result.rows[0]??null,invoiceId:matched.rows[0]?.invoice_id??null};
  },true);},
  recordEvent(id,eventId,eventDigest){return tx(system,async db=>{await agreement(db,system,id,true);await db.query('insert into ss.care_catalog_provider_events(event_id,agreement_id,event_digest) values($1,$2,$3) on conflict(event_id) do nothing',[eventId,id,eventDigest]);const row=one(await db.query('select event_digest from ss.care_catalog_provider_events where event_id=$1',[eventId]));check(row.event_digest===eventDigest);return {status:'processed'};});},
  nextHistoricalInvoice(id){return tx(system,async db=>{
   const row=(await db.query('select invoice_id from ss.care_catalog_paid_periods where agreement_id=$1 and invoice_id<>(select invoice_id from ss.care_catalog_paid_periods where agreement_id=$1 order by starts_at desc limit 1) order by provider_checked_at,starts_at limit 1',[id])).rows[0];return row?.invoice_id??null;
  },true);},
  claimReconciliation({workerId,observedAt,leaseSeconds}){return tx(system,async db=>{
   const result=await db.query(`with candidate as (
    select a.id from ss.care_catalog_agreements a where a.reconcile_after<=$1 and (a.reconcile_lease_until is null or a.reconcile_lease_until<=$1)
     and (a.subscription_id is not null or exists(select 1 from ss.care_catalog_payment_attempts p where p.agreement_id=a.id and p.state<>'expired'))
    order by a.reconcile_after,a.id for update skip locked limit 1)
    update ss.care_catalog_agreements a set reconcile_lease_owner=$2,reconcile_lease_until=$1::timestamptz+make_interval(secs=>$3),reconcile_fence=reconcile_fence+1,reconcile_attempts=reconcile_attempts+1
    from candidate where a.id=candidate.id returning a.*`,[observedAt,workerId,leaseSeconds]);
   if(!result.rowCount)return null;const a=result.rows[0];return {jobId:a.id,agreementId:a.id,action:'reconcile_catalog',organizationId:a.organization_id,projectId:a.project_id,fence:Number(a.reconcile_fence),attemptCount:a.reconcile_attempts,leaseExpiresAt:iso(a.reconcile_lease_until)};
  });},
  finishReconciliation({jobId,fence,workerId,observedAt,failureCode=null,retryAt=null}){return tx(system,async db=>{
   const row=await db.query(`update ss.care_catalog_agreements set reconcile_after=case when $5::text is not null then greatest($6::timestamptz,$4::timestamptz+interval '5 minutes') when cancelled_at is not null then $4::timestamptz+interval '1 day' else $4::timestamptz+interval '15 minutes' end,reconcile_lease_owner=null,reconcile_lease_until=null,reconcile_error=$5,reconcile_attempts=case when $5::text is null then 0 else reconcile_attempts end where id=$1 and reconcile_fence=$2 and reconcile_lease_owner=$3 and reconcile_lease_until>$4 returning id`,[jobId,fence,workerId,observedAt,failureCode,retryAt]);
   check(row.rowCount===1,'Care reconciliation lease expired.');return {status:failureCode?'released':'completed',jobId};
  });},
  requestWork(s,id,request,now){return command(s,async db=>{
   check(s.actorKind==='customer');const a=await agreement(db,s,id,true);await currentProject(db,a);check((await db.query('select id from ss.care_catalog_paid_periods where agreement_id=$1 and invalidated_at is not null and starts_at<=$2 and ends_at>$2',[id,now])).rowCount===0,'Care work is held pending payment reconciliation.');
   const p=one(await db.query('select * from ss.care_catalog_paid_periods where agreement_id=$1 and invalidated_at is null and starts_at<=$2 and ends_at>$2',[id,now]));
   const usage=one(await db.query("select count(*)::int as n,coalesce(sum(minutes),0)::int as minutes from ss.care_catalog_requests where period_id=$1 and state<>'declined'",[p.id]));
   check(usage.n<a.edit_cap&&usage.minutes<a.included_minutes,'The accepted Care plan has no remaining included requests this month.');
   const row=one(await db.query("insert into ss.care_catalog_requests(id,organization_id,agreement_id,period_id,summary,state,created_at,updated_at) values($1,$2,$3,$4,$5,'requested',$6,$6) returning *",[request.requestId,s.organizationId,id,p.id,request.summary,now]));return requestView(row);
  });},
  recordWork(s,id,requestId,input,now){return command(s,async db=>{
   check(s.actorKind==='operator');const a=await agreement(db,s,id,true);await currentProject(db,a);check((await db.query('select id from ss.care_catalog_paid_periods where agreement_id=$1 and invalidated_at is not null and starts_at<=$2 and ends_at>$2',[id,now])).rowCount===0,'Care work is held pending payment reconciliation.');
   const r=one(await db.query('select * from ss.care_catalog_requests where id=$1 and agreement_id=$2 for update',[requestId,id]));check(r.revision===input.expectedRevision&&!['completed','declined'].includes(r.state));
   const p=one(await db.query('select * from ss.care_catalog_paid_periods where id=$1 and agreement_id=$2 and invalidated_at is null and starts_at<=$3 and ends_at>$3',[r.period_id,id,now]));
   const used=one(await db.query('select coalesce(sum(minutes),0)::int as n from ss.care_catalog_requests where period_id=$1 and id<>$2',[p.id,requestId])).n;
   check(used+input.minutes<=a.included_minutes&&input.minutes>=r.minutes,'Work exceeds the accepted included Care minutes. Extra work needs separate approval.');
   check(input.state!=='declined'||input.minutes===0,'Completed work cannot be removed from usage.');
   const row=one(await db.query('update ss.care_catalog_requests set state=$2,minutes=$3,owner_note=$4,revision=revision+1,updated_at=$5 where id=$1 returning *',[requestId,input.state,input.minutes,input.note,now]));return requestView(row);
  });}
 });
}
