import { randomUUID } from "node:crypto";
import { invariant } from "./errors.mjs";
import { digest } from "./security.mjs";
import { getCareCatalogPlans } from "./care-commerce-catalog.mjs";
import { publicProjectLegalAuthority, validateProjectLegalAcceptance } from "./project-legal-authority.mjs";

export const CARE_CATALOG_SCHEMA = "sitesourcery.care-catalog/v1";
export const CARE_WRITTEN_PLAN_SCHEMA = "sitesourcery.care-written-plan/v1";
export const CARE_ACCEPTANCE_STATEMENT = "I accept this exact written Care plan and its monthly renewal and paid-month-end cancellation terms.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const SECRET = /(?:password|passcode|private[ _-]?key|api[ _-]?key|access[ _-]?token|recovery[ _-]?code|seed[ _-]?phrase)/iu;
const PLANS = getCareCatalogPlans();

export function careExact(value, fields, label = "Care input") {
  invariant(value && Object.getPrototypeOf(value) === Object.prototype &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort()),
  "CARE_INVALID", `${label} has unexpected or missing fields.`, { status: 400 });
  return value;
}
export function careUuid(value, label = "Care identifier") {
  invariant(typeof value === "string" && UUID.test(value), "CARE_INVALID", `${label} is invalid.`, { status: 400 });
  return value;
}
export function careDigest(value) {
  invariant(typeof value === "string" && SHA.test(value), "CARE_INVALID", "The reviewed Care digest is invalid.", { status: 400 });
  return value;
}
export function careText(value, minimum = 10, maximum = 2000) {
  invariant(typeof value === "string" && value === value.trim() && value.length >= minimum && value.length <= maximum &&
    !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value) && !SECRET.test(value),
  "CARE_INVALID", "Use a complete customer-safe description without credentials.", { status: 400 });
  return value;
}
export function careInstant(value) {
  invariant(typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    "CARE_INVALID", "The Care timestamp is invalid.", { status: 400 });
  return value;
}
export function carePlan(planId) {
  const plan = PLANS.find(plan => plan.planId === planId);
  invariant(plan, "CARE_PLAN_UNAVAILABLE", "Choose one of the five current monthly Care plans.", { status: 400 });
  return structuredClone(plan);
}
export function careWrittenPlan(input) {
  careExact(input, ["siteUrl", "hosting", "monitoring", "backups", "includedWork", "responseTarget", "outsideCosts"], "Written Care plan");
  let site; try { site = new URL(input.siteUrl); } catch { /* validation below */ }
  invariant(site && site.protocol === "https:" && !site.username && !site.password && !site.hash && input.siteUrl.length <= 2000,
    "CARE_INVALID", "The written plan needs the customer's exact HTTPS website URL.", { status: 400 });
  return {
    schema: CARE_WRITTEN_PLAN_SCHEMA,
    siteUrl: site.href,
    ...Object.fromEntries(["hosting", "monitoring", "backups", "includedWork", "responseTarget", "outsideCosts"].map(key => [key, careText(input[key])])),
    renewal: "monthly_until_cancelled",
    cancellation: "no_fee_at_end_of_paid_month",
    partialMonthRefund: "only_if_required_by_law_or_accepted_plan",
    additionalWork: "separate_customer_approval_before_any_extra_charge",
    separateFromOtherProducts: true
  };
}
export function careActor(actor, organizationId = actor?.organizationId, operator = false) {
  return { actorId: careUuid(actor?.userId, "Authenticated user"), organizationId: careUuid(organizationId, "Organization"), actorKind: operator ? "operator" : "customer" };
}
export function careCommand(actor, commandId, operation, input) {
  invariant(typeof commandId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(commandId),
    "IDEMPOTENCY_KEY_REQUIRED", "A stable Care command identity is required.", { status: 400 });
  return { ...actor, commandId, operation, requestDigest: digest({ operation, input }) };
}

export function createCarePaymentsService({ repository, provider, release = { approved: false }, legalAuthority, reconciliationOnly = false, clock = () => new Date().toISOString(), ids = randomUUID } = {}) {
  invariant(repository && typeof repository.readiness === "function" && provider && (reconciliationOnly === true || legalAuthority?.schema === "sitesourcery.project-legal-authority/v7"),
    "CARE_CONFIGURATION_REQUIRED", "Care requires canonical storage, a provider port and current V7 legal authority.", { status: 500 });
  const at = () => careInstant(typeof clock === "function" ? clock() : clock.now());
  const nextId = () => careUuid(typeof ids === "function" ? ids() : ids.next("care"));
  const authority = legalAuthority ? publicProjectLegalAuthority(legalAuthority) : null;
  async function requireProvider(newCheckout=false) {
    const ready=await provider.readinessForPurpose('care');
    invariant(ready?.ready===true&&(!newCheckout||(release.approved===true&&!reconciliationOnly)),'CARE_PAYMENT_HELD','Care payment is not available. Existing billing remains pending until verified.',{status:503});
  }
  function checkoutResponse(value) {
    careExact(value,['state','checkoutSessionId','checkoutUrl','expiresAt','providerCustomerId','subscriptionId','invoice']);
    invariant(['ready','pending','expired','paid'].includes(value.state)&&/^cs_[A-Za-z0-9_]+$/u.test(value.checkoutSessionId),'CARE_PROVIDER_INVALID','Care checkout readback is invalid.',{status:502});
    careInstant(value.expiresAt);
    if(value.checkoutUrl!==null){let u;try{u=new URL(value.checkoutUrl);}catch{} invariant(u?.protocol==='https:'&&u.hostname==='checkout.stripe.com'&&!u.username&&!u.password&&!u.hash,'CARE_PROVIDER_INVALID','Care checkout URL is invalid.',{status:502});}
    invariant(value.subscriptionId===null||(/^sub_[A-Za-z0-9_]+$/u.test(value.subscriptionId)&&/^cus_[A-Za-z0-9_]+$/u.test(value.providerCustomerId)),'CARE_PROVIDER_INVALID','Care subscription readback is invalid.',{status:502});
    invariant(value.state!=='paid'||value.subscriptionId!==null,'CARE_PROVIDER_INVALID','Paid checkout needs a bound subscription.',{status:502});
    return value;
  }
  function subscriptionResponse(value,binding) {
    careExact(value,['subscriptionId','providerCustomerId','status','cancelAtPeriodEnd','canceledAt','currentPeriodStart','currentPeriodEnd','invoice']);
    invariant(/^sub_[A-Za-z0-9_]+$/u.test(value.subscriptionId)&&/^cus_[A-Za-z0-9_]+$/u.test(value.providerCustomerId)&&typeof value.cancelAtPeriodEnd==='boolean'&&['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'].includes(value.status),'CARE_PROVIDER_INVALID','Care subscription readback is invalid.',{status:502});
    careInstant(value.currentPeriodStart);careInstant(value.currentPeriodEnd);if(value.canceledAt!==null)careInstant(value.canceledAt);invariant(value.status!=='canceled'||value.canceledAt!==null,'CARE_PROVIDER_INVALID','Care cancellation lacks provider confirmation.',{status:502});
    if(value.invoice){const v=value.invoice;careExact(v,['invoiceId','paymentIntentId','chargeId','periodStart','periodEnd','amountMinor','currency','settledAt','paid','refunded','disputed']);
      invariant(/^in_[A-Za-z0-9_]+$/u.test(v.invoiceId)&&Number.isSafeInteger(v.amountMinor)&&v.amountMinor===binding.amountMinor&&v.currency==='USD'&&[v.paid,v.refunded,v.disputed].every(x=>typeof x==='boolean'),'CARE_PROVIDER_INVALID','Care invoice readback is invalid.',{status:502});
      invariant((v.paymentIntentId===null||/^pi_[A-Za-z0-9_]+$/u.test(v.paymentIntentId))&&(v.chargeId===null||/^ch_[A-Za-z0-9_]+$/u.test(v.chargeId)),'CARE_PROVIDER_INVALID','Care payment binding is invalid.',{status:502});careInstant(v.periodStart);careInstant(v.periodEnd);invariant(Date.parse(v.periodEnd)>Date.parse(v.periodStart),'CARE_PROVIDER_INVALID','Care invoice interval is invalid.',{status:502});
      if(v.settledAt!==null)careInstant(v.settledAt);invariant(!v.paid||v.settledAt!==null,'CARE_PROVIDER_INVALID','Care invoice lacks settlement evidence.',{status:502});
    }return value;
  }
  async function reconcile(scope,id,invoiceId=null,recovery=null) {
    let selected=await repository.inspect(scope,id);await requireProvider();
    let subscriptionId=selected.subscriptionId;
    if(!subscriptionId){const attempt=selected.attempts.find(a=>a.state!=='expired');invariant(attempt,'CARE_PAYMENT_PENDING','No Care checkout is available to reconcile.',{status:409});
      let result;
      if(recovery?.checkoutSessionId){invariant(recovery.attemptId===attempt.attemptId,'CARE_EVENT_UNBOUND','Care checkout event does not identify the persisted attempt.',{status:409});result=await provider.readCareCheckout({binding:selected.binding,attemptId:attempt.attemptId,checkoutSessionId:recovery.checkoutSessionId});}
      else if(attempt.checkoutSessionId)result=await provider.readCareCheckout({binding:selected.binding,attemptId:attempt.attemptId,checkoutSessionId:attempt.checkoutSessionId});
      else {invariant(Date.parse(at())<Date.parse(attempt.expiresAt),'CARE_RECONCILIATION_REQUIRED','The original checkout is uncertain. Owner provider reconciliation is required; do not create another charge.',{status:409});
        result=await provider.createCareCheckout({binding:selected.binding,attemptId:attempt.attemptId,commandId:attempt.commandId,expiresAt:attempt.expiresAt});}
      checkoutResponse(result);await repository.saveCheckout(id,attempt.attemptId,result,at());subscriptionId=result.subscriptionId;
      if(!subscriptionId)return {agreementId:id,state:result.state,attemptId:attempt.attemptId,checkoutUrl:result.checkoutUrl};
      selected=await repository.inspect(scope,id);
    }
    if(selected.cancelRequestedAt&&!selected.cancelAtPeriodEnd&&!selected.cancelledAt)await provider.cancelCareSubscriptionAtPeriodEnd({binding:selected.binding,subscriptionId,commandId:selected.cancelCommandId});
    const observed=subscriptionResponse(await provider.readCareSubscription({binding:selected.binding,subscriptionId,...(invoiceId?{invoiceId}:{})}),selected.binding);
    return repository.saveSubscription(id,observed,at(),selected.revision,scope.lease??null);
  }
  return Object.freeze({
    kind: "care-catalog",
    mode: release.approved === true ? "approved" : "held",
    async readiness() {
      const storage = await repository.readiness();
      const payment = await provider.readinessForPurpose("care");
      return { schema: "sitesourcery.care-catalog-readiness/v1", ready: storage.ready === true, verified: storage.verified === true,
        commercialReady: !reconciliationOnly && release.approved === true && storage.ready === true && payment.ready === true,
        mode: release.approved === true ? "approved" : "held", paidPeriodsRequireProviderReadback: true,
        newCheckoutApproved: release.approved === true && !reconciliationOnly, reconciliationReady:storage.ready===true&&payment.ready===true, automaticOverage: false, mailDeliveryEffects: false };
    },
    async readOwner(actor, organizationId) { return {...await repository.read(careActor(actor, organizationId, true),at()),catalog:this.catalog(),readiness:await this.readiness()}; },
    async readCustomer(actor) { return {...await repository.read(careActor(actor),at()),catalog:this.catalog(),readiness:await this.readiness()}; },
    async reconcileSystem(id,lease){
      careUuid(id);const scope={actorKind:'system',lease};
      const result=await reconcile(scope,id);const history=await repository.nextHistoricalInvoice(id);
      if(history)await reconcile(scope,id,history);
      return {agreementId:id,state:result.state};
    },
    catalog() { invariant(authority,'CARE_CONFIGURATION_REQUIRED','The customer Care legal authority is unavailable.',{status:503});return { schema: CARE_CATALOG_SCHEMA, plans: PLANS, legalAuthority: authority, acceptanceStatement: CARE_ACCEPTANCE_STATEMENT }; },
    createOffer(actor, organizationId, input, commandId) {
      invariant(!reconciliationOnly&&authority,'CARE_CONFIGURATION_REQUIRED','Care offers require current legal authority.',{status:503});
      careExact(input, ["projectId", "planId", "writtenPlan", "expiresAt"]);
      const recordedAt = at(), expiresAt = careInstant(input.expiresAt);
      invariant(Date.parse(expiresAt) > Date.parse(recordedAt) && Date.parse(expiresAt) <= Date.parse(recordedAt) + 30 * 86400000,
        "CARE_INVALID", "Care offers must expire within thirty days.", { status: 400 });
      const scope = careActor(actor, organizationId, true);
      const offer = { schema: "sitesourcery.care-offer/v1", offerId: nextId(), organizationId: scope.organizationId,
        projectId: careUuid(input.projectId), plan: carePlan(input.planId), writtenPlan: careWrittenPlan(input.writtenPlan),
        legalAuthority: authority, acceptanceStatement: CARE_ACCEPTANCE_STATEMENT, issuedAt: recordedAt, expiresAt };
      return repository.createOffer(careCommand(scope, commandId, "offer", input), { ...offer, offerDigest: digest(offer) });
    },
    voidOffer(actor,organizationId,offerId,input,commandId) {
      careExact(input,['reason']);return repository.voidOffer(careCommand(careActor(actor,organizationId,true),commandId,'void',{offerId,...input}),careUuid(offerId),careText(input.reason),at());
    },
    async startCheckout(actor,agreementId,input,commandId) {
      careExact(input,[]);careUuid(agreementId);await requireProvider(true);
      const now=at(),expiresAt=new Date(Math.floor(Date.parse(now)/1000)*1000+3600000).toISOString();
      const selected=await repository.reserveAttempt(careCommand(careActor(actor),commandId,'checkout',{agreementId}),agreementId,nextId(),now,expiresAt);
      if(!selected.created)return selected.attempt;
      try {const result=checkoutResponse(await provider.createCareCheckout({binding:selected.binding,attemptId:selected.attempt.attemptId,commandId,expiresAt:selected.attempt.expiresAt}));
        const stored=await repository.saveCheckout(agreementId,selected.attempt.attemptId,result,at());
        if(result.subscriptionId)await reconcile(careActor(actor),agreementId);
        return stored;
      }catch(error){await repository.markAmbiguous(agreementId,selected.attempt.attemptId,at());throw error;}
    },
    reconcileCustomer(actor,id,input){careExact(input,[]);return reconcile(careActor(actor),careUuid(id));},
    reconcileOwner(actor,org,id,input){careExact(input,[]);return reconcile({...careActor(actor,org,true),operation:'reconcile'},careUuid(id));},
    async cancel(actor,id,input,commandId){
      careExact(input,[]);careUuid(id);const scope=careActor(actor);
      const pending=await repository.requestCancellation(careCommand(scope,commandId,'cancel',{agreementId:id}),id,at());
      if(pending.state==='cancelled')return pending;await requireProvider();return reconcile(scope,id);
    },
    requestWork(actor,id,input,commandId){careExact(input,['summary']);careUuid(id);
      return repository.requestWork(careCommand(careActor(actor),commandId,'request',{agreementId:id,...input}),id,{requestId:nextId(),summary:careText(input.summary)},at());
    },
    recordWork(actor,org,id,requestId,input,commandId){
      careExact(input,['expectedRevision','state','minutes','note']);careUuid(id);careUuid(requestId);
      invariant(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>0&&['in_progress','completed','declined'].includes(input.state)&&Number.isSafeInteger(input.minutes)&&input.minutes>=0&&input.minutes<=240,'CARE_INVALID','Care work status or minutes are invalid.',{status:400});careText(input.note);
      return repository.recordWork(careCommand(careActor(actor,org,true),commandId,'work',{agreementId:id,requestId,...input}),id,requestId,input,at());
    },
    async ingestStripeEvent(event){
      const obj=event?.data?.object,meta=obj?.metadata??{},subMeta=obj?.parent?.subscription_details?.metadata??{};
      const direct=meta.purpose==='care'||subMeta.purpose==='care';
      const selectedMeta=meta.purpose==='care'?meta:subMeta;
      const id=v=>typeof v==='string'?v:v?.id??null;
      const hints={agreementId:UUID.test(selectedMeta.agreementId??'')?selectedMeta.agreementId:null,
        subscriptionId:obj?.object==='subscription'?obj.id:id(obj?.subscription??obj?.parent?.subscription_details?.subscription),
        invoiceId:obj?.object==='invoice'?obj.id:id(obj?.invoice),chargeId:obj?.object==='charge'?obj.id:id(obj?.charge),paymentIntentId:obj?.object==='payment_intent'?obj.id:id(obj?.payment_intent),checkoutSessionId:obj?.object==='checkout.session'?obj.id:null};
      if(!direct&&!Object.values(hints).some(Boolean))return {status:'not_care'};
      invariant(typeof event?.id==='string'&&/^evt_[A-Za-z0-9_]+$/u.test(event.id),'CARE_PROVIDER_INVALID','Care event identity is invalid.',{status:400});
      const selected=await repository.findEvent(event.id,hints),eventDigest=digest(event);
      if(!selected.agreement){invariant(!direct,'CARE_EVENT_UNBOUND','Care event has no persisted agreement.',{status:409});return {status:'not_care'};}
      if(selected.priorDigest){invariant(selected.priorDigest===eventDigest,'CARE_EVENT_CONFLICT','Care event identity changed.',{status:409});return {status:'duplicate'};}
      await reconcile({actorKind:'system'},selected.agreement.id,selected.invoiceId??hints.invoiceId,hints.checkoutSessionId?{checkoutSessionId:hints.checkoutSessionId,attemptId:selectedMeta.attemptId}:null);
      return repository.recordEvent(selected.agreement.id,event.id,eventDigest);
    },
    acceptOffer(actor, offerId, input, commandId) {
      invariant(!reconciliationOnly&&authority,'CARE_CONFIGURATION_REQUIRED','Care acceptance requires current legal authority.',{status:503});
      careExact(input, ["expectedOfferDigest", "acceptanceStatement", "legalAcceptance"]);
      invariant(input.acceptanceStatement === CARE_ACCEPTANCE_STATEMENT, "CARE_ACCEPTANCE_REQUIRED", "Accept the exact written Care plan before payment.", { status: 400 });
      const acceptance = { acceptanceId: nextId(), agreementId: nextId(), offerId: careUuid(offerId),
        expectedOfferDigest: careDigest(input.expectedOfferDigest), legalAcceptance: validateProjectLegalAcceptance(input.legalAcceptance, legalAuthority),
        acceptanceStatement: input.acceptanceStatement, acceptedAt: at() };
      return repository.acceptOffer(careCommand(careActor(actor), commandId, "accept", { offerId, ...input }),
        { ...acceptance, acceptanceDigest: digest(acceptance) });
    }
  });
}
