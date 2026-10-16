import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import test from 'node:test';
import {openReviewedBrowser} from '../../server/hosted/test/reviewed-browser-support.mjs';
const require=createRequire(import.meta.url), ui=require('../../abracadabra/app/abracadabra-care-catalog.js');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),org=id(1),project=id(2),agreement=id(3),offerId=id(4),requestId=id(5),periodId=id(6);
const legal={schema:'sitesourcery.project-legal-authority/v7',authorityDigest:'a'.repeat(64),acceptanceStatement:'accepted_exact_project_terms_and_acknowledged_privacy',documents:[
 {kind:'privacy',version:'SS-HOSTED-PRIVACY-2026-01-01-V7',contentDigest:'b'.repeat(64),contentUri:'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-01-01-V7/',effectiveAt:'2026-01-01T00:00:00.000Z'},
 ...['product','website'].map(kind=>({kind,version:'SS-HOSTED-WEBSITE-TERMS-2026-01-01-V7',contentDigest:'c'.repeat(64),contentUri:'https://sitesourcery.com/legal/website-terms/'+(kind==='product'?'#self-service':''),effectiveAt:'2026-01-01T00:00:00.000Z'}))]};
const plan={planId:'plan_care',catalogIdentityId:id(10),catalogVersion:'SS-CARE-COMMERCE-2026.2',priceVersion:'SS-COMMERCIAL-2026.6',monthlyAmountMinor:11900,includedMinutes:60,editCap:6,currency:'USD',billingCadence:'month',automaticOverage:false};
const written={schema:'sitesourcery.care-written-plan/v1',siteUrl:'https://example.test/',hosting:'Local fixture hosting responsibilities.',monitoring:'Local fixture monitoring responsibilities.',backups:'Local fixture backup responsibilities.',includedWork:'Local fixture approved text updates.',responseTarget:'Local fixture agreed response target.',outsideCosts:'Customer retains their domain costs.'};
const statement='I accept this exact written Care plan and its monthly renewal and paid-month-end cancellation terms.';
function fixture(){return {schema:'sitesourcery.care-agreements/v1',organizationId:org,observedAt:new Date().toISOString(),eligibleProjects:[{projectId:project,name:'Local completed Custom website',customerId:id(8)}],catalog:{schema:'sitesourcery.care-catalog/v1',plans:[plan],legalAuthority:legal,acceptanceStatement:statement},readiness:{ready:true,verified:true,commercialReady:false,mode:'held',newCheckoutApproved:false},offers:[{schema:'sitesourcery.care-offer/v1',offerId,organizationId:org,projectId:project,plan,writtenPlan:written,legalAuthority:legal,acceptanceStatement:statement,offerDigest:'d'.repeat(64),issuedAt:'2026-01-01T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z',voidedAt:null,voidReason:null,acceptanceId:null}],agreements:[]};}
function agreementView(){return {agreementId:agreement,organizationId:org,projectId:project,plan,writtenPlan:written,state:'awaiting_payment',revision:1,cancelRequestedAt:null,cancelAtPeriodEnd:false,cancelledAt:null,currentPeriodId:null,paidThrough:null,capacity:null,periods:[],requests:[],attempts:[]};}
test('Care projection is tenant scoped and checkout links cannot escape Stripe',()=>{
 assert.equal(ui.validate(fixture(),org).organizationId,org);assert.throws(()=>ui.validate(fixture(),id(9)));
 const wrong=fixture();wrong.offers[0].offerId='../checkout';assert.throws(()=>ui.validate(wrong,org));
 for(const url of ['javascript:alert(1)','https://checkout.stripe.com.evil.test/','https://evil@checkout.stripe.com/','https://checkout.stripe.com/#secret','http://checkout.stripe.com/'])assert.equal(ui.checkoutUrl(url),null);
 assert.equal(ui.checkoutUrl('https://checkout.stripe.com/c/pay/test'),'https://checkout.stripe.com/c/pay/test');
});
test('real Care browser requires explicit acceptance, preserves uncertain command, separates payment and binds paid work',async t=>{
 let state=fixture(), failNext=false;const calls=[];
 const sources=Object.fromEntries(await Promise.all(['abracadabra-api.js','abracadabra-care-catalog.js','abracadabra-care-catalog.css'].map(async name=>['/'+name,await readFile(new URL('../../abracadabra/app/'+name,import.meta.url))])));
 const server=createServer(async(req,res)=>{
  const json=(v,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(v));};
  if(sources[req.url]){res.writeHead(200,{'content-type':req.url.endsWith('.css')?'text/css':'text/javascript'});return res.end(sources[req.url]);}
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});return res.end('<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif}</style><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/abracadabra-care-catalog.css"><div id="care"></div><script src="/abracadabra-api.js"></script><script src="/abracadabra-care-catalog.js"></script>');}
  if(req.url==='/api/v1/csrf')return json({csrfToken:'fixture-csrf'});
  if(req.method==='GET'&&['/api/v1/care/agreements','/api/v1/operator/care/organizations/'+org+'/catalog'].includes(req.url))return json(state);
  if(req.method==='POST'){
   const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));
   assert.equal(req.headers['x-csrf-token'],'fixture-csrf');assert.equal(req.headers['x-sitesourcery-organization-id'],org);assert.match(req.headers['idempotency-key'],/^care-[0-9a-f-]{36}$/);
   calls.push({path:req.url,body,key:req.headers['idempotency-key']});
   if(failNext){failNext=false;return json({error:{code:'UNCONFIRMED',message:'Local uncertain fixture response.'}},502);}
   if(req.url.endsWith('/acceptance')){state.offers[0].acceptanceId=id(20);state.agreements=[agreementView()];}
   if(req.url.endsWith('/checkout'))state.agreements[0].attempts=[{attemptId:id(21),state:'ready',checkoutUrl:'https://checkout.stripe.com/c/pay/local-fixture',expiresAt:'2099-01-01T00:00:00.000Z'}];
   if(req.url.endsWith('/requests'))state.agreements[0].requests=[{requestId,periodId,agreementId:agreement,state:'requested',summary:body.summary,minutes:0,ownerNote:null,revision:1}];
   if(req.url.endsWith('/work'))Object.assign(state.agreements[0].requests[0],{state:body.state,minutes:body.minutes,ownerNote:body.note,revision:2});
   if(req.url.endsWith('/cancellation')){state.agreements[0].cancelAtPeriodEnd=true;state.agreements[0].state='cancellation_pending';}
   return json({saved:true});
  }return json({error:{message:'Unexpected local fixture request'}},404);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port,browser=await openReviewedBrowser({origin,viewport:{width:1280,height:1000,mobile:false}});t.after(()=>browser.close());
 await browser.navigate(origin+'/');
 async function mount(owner=false){await browser.evaluate(`(()=>{window.workspace?.destroy();window.workspace=SiteSourceryCareCatalog.createWorkspace({documentRef:document,container:document.querySelector('#care'),client:SiteSourceryAbracadabraAPI.createClient({baseUrl:'/api/v1'}),api:SiteSourceryAbracadabraAPI,audience:${JSON.stringify(owner?'operator':'customer')},organizationId:${JSON.stringify(org)}});workspace.load()})()`);await ready();}
 async function ready(){await browser.waitFor(`document.querySelector('.care-catalog-status').textContent.includes('Care details are current.')`);}
 async function click(label){await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable '+${JSON.stringify(label)});b.click()})()`);}
 async function submit(label,values){await browser.evaluate(`(()=>{const f=[...document.forms].find(x=>x.querySelector('button').textContent===${JSON.stringify(label)});if(!f)throw Error('Missing form');for(const[k,v]of Object.entries(${JSON.stringify(values)})){const c=f.elements.namedItem(k);if(c.type==='checkbox')c.checked=v;else c.value=v;}f.requestSubmit()})()`);}
 await mount();assert.equal(calls.length,0);
 await submit('Accept this written plan',{accept:false});assert.equal(calls.length,0);
 failNext=true;await submit('Accept this written plan',{accept:true});await browser.waitFor(`!!document.querySelector('.care-catalog-retry button')`);
 assert.equal(calls.length,1);const first=calls[0];assert.equal(first.body.expectedOfferDigest,'d'.repeat(64));assert.equal(first.body.legalAcceptance.documents.length,3);assert.equal(first.body.acceptanceStatement,statement);
 assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-care-write]')].every(b=>b.disabled)`),true);
 await click('Retry the same action');await ready();assert.deepEqual(calls[1],first);assert.equal(calls.length,2);
 assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Continue to monthly payment').disabled`),true);
 state.readiness.commercialReady=true;await click('Refresh Care');await ready();await click('Continue to monthly payment');await ready();assert.equal(calls.at(-1).path,'/api/v1/care/agreements/'+agreement+'/checkout');
 assert.equal(await browser.evaluate(`document.querySelector('.care-catalog-checkout').getAttribute('href')`),'https://checkout.stripe.com/c/pay/local-fixture');
 assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Continue to monthly payment')`),false);
 state.agreements[0]={...state.agreements[0],state:'active',currentPeriodId:periodId,paidThrough:'2099-01-01T00:00:00.000Z',capacity:{minutes:60,usedMinutes:0,edits:6,usedEdits:0},periods:[{periodId,startsAt:'2026-01-01T00:00:00.000Z',endsAt:'2099-01-01T00:00:00.000Z',amountMinor:11900,invalidatedAt:null}],attempts:[{state:'paid'}]};
 await click('Refresh Care');await ready();await submit('Send Care request',{summary:'Update the local fixture opening hours.'});await ready();assert.deepEqual(calls.at(-1).body,{summary:'Update the local fixture opening hours.'});
 state.agreements[0].capacity.usedMinutes=60;await click('Refresh Care');await ready();assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Send Care request')`),false);state.agreements[0].capacity.usedMinutes=0;
 await mount(true);await submit('Issue written offer',{projectId:project,planId:'plan_care',siteUrl:'https://example.test/',hosting:written.hosting,monitoring:written.monitoring,backups:written.backups,includedWork:written.includedWork,responseTarget:written.responseTarget,outsideCosts:written.outsideCosts,expiresAt:'2099-01-01T12:00'});await ready();assert.equal(calls.at(-1).path,'/api/v1/operator/care/organizations/'+org+'/offers');assert.equal(Object.keys(calls.at(-1).body.writtenPlan).length,7);
 await submit('Save work update',{state:'completed',minutes:15,note:'Completed the agreed local fixture edit.'});await ready();assert.deepEqual(calls.at(-1).body,{expectedRevision:1,state:'completed',minutes:15,note:'Completed the agreed local fixture edit.'});
 await mount();state.readiness.commercialReady=false;await click('Refresh Care');await ready();await submit('Cancel at paid-month end',{confirm:true});await ready();assert.equal(calls.at(-1).path,'/api/v1/care/agreements/'+agreement+'/cancellation');assert.equal(state.agreements[0].state,'cancellation_pending');
 for(const width of [320,390,1280]){await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'No horizontal overflow at '+width);if(process.env.SITESOURCERY_CARE_UI_EVIDENCE){await mkdir(process.env.SITESOURCERY_CARE_UI_EVIDENCE,{recursive:true});const shot=await browser.cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(process.env.SITESOURCERY_CARE_UI_EVIDENCE+'/customer-'+width+'.png',Buffer.from(shot.data,'base64'));}}
 // An organization/session replacement invalidates pending read completion.
 await browser.evaluate('workspace.destroy()');assert.equal(await browser.evaluate(`document.querySelector('#care').childElementCount`),0);
 assert.deepEqual(browser.browserErrors,['Failed to load resource: the server responded with a status of 502 (Bad Gateway)']);
});
