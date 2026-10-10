import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { openReviewedBrowser } from "../../server/hosted/test/reviewed-browser-support.mjs";
const require=createRequire(import.meta.url);
const {createHostedControl}=require("../../abracadabra/app/abracadabra-hosted-control.js");
const desk=require("../../operator/operator.js");
const ORG="10000000-0000-4000-8000-000000000001", PROJECT="20000000-0000-4000-8000-000000000001", TICKET="30000000-0000-4000-8000-000000000001";
function conversation(id=TICKET){return {schema:"sitesourcery.support-conversation/v1",ticket:{id,organizationId:ORG,projectId:PROJECT,subject:"Please help",state:"waiting_customer",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
  nextBeforeId:null,messages:[{id:"40000000-0000-4000-8000-000000000001",authorKind:"support",body:"Owner reply <img src=x onerror=alert(1)>\nSecond line",createdAt:new Date().toISOString()}]};}
async function controlFixture(overrides={}){
  const project={id:PROJECT,organizationId:ORG,versions:[],draft:{revision:1,rawFacts:{}}};
  const api={me:async()=>({user:{id:"user"}}),listOrganizations:async()=>({organizations:[{id:ORG}]}),
    listProjects:async()=>({projects:[project]}),getProject:async id=>({project:{...project,id}}),subscription:async()=>({subscription:null}),
    getSupportTicket:async()=>conversation(),...overrides};
  let sequence=0;const control=createHostedControl({api,idempotencyFactory:()=>`support-ui-command-${++sequence}`});
  await control.boot();await control.selectProject(PROJECT);return control;
}
test("customer retries retain the original reply key and switching projects discards a late thread",async()=>{
  const keys=[];let attempts=0;
  const control=await controlFixture({replySupportTicket:async(id,input,options)=>{
    keys.push(options.idempotencyKey);if(++attempts===1)throw Object.assign(new Error("ambiguous transport"),{status:503,retryable:true});return conversation(id);
  }});
  await control.getSupportTicket(TICKET);
  await assert.rejects(control.replySupportTicket("Exact reply"));
  await control.replySupportTicket(" Exact reply ");assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  let deliver;
  const delayed=await controlFixture({getSupportTicket:()=>new Promise(resolve=>{deliver=resolve;})});
  const pending=delayed.getSupportTicket(TICKET);await Promise.resolve();
  await delayed.selectProject("20000000-0000-4000-8000-000000000002");deliver(conversation());
  assert.equal(await pending,null);assert.equal(delayed.getState().supportConversation,null);
});
test("session refresh discards late lists and a project switch retires old reply retries",async()=>{
  let deliver;
  const control=await controlFixture({listSupportTickets:()=>new Promise(resolve=>{deliver=resolve;})});
  const pending=control.listSupportTickets();await Promise.resolve();await control.boot();
  deliver({schema:"sitesourcery.support-ticket-list/v1",tickets:[conversation().ticket],nextBeforeId:null});
  assert.equal(await pending,null);assert.equal(control.getState().supportTickets,null);
  let calls=0;
  const retry=await controlFixture({replySupportTicket:async()=>{calls++;throw Object.assign(new Error("ambiguous"),{status:503,retryable:true});}});
  await retry.getSupportTicket(TICKET);await assert.rejects(retry.replySupportTicket("Keep one identity"));
  await retry.selectProject("20000000-0000-4000-8000-000000000002");
  try { assert.equal(await retry.retry("replySupportTicket"),null); }
  catch(error){assert.equal(error.code,"RETRY_UNAVAILABLE");}
  assert.equal(calls,1);
});
test("operator thread validation rejects wrong ticket identity and expanded message authority",()=>{
  assert.equal(desk.validateSupportConversation(conversation(),TICKET).ticket.id,TICKET);
  assert.throws(()=>desk.validateSupportConversation(conversation(),"30000000-0000-4000-8000-000000000002"));
  const expanded=conversation();expanded.messages[0].authorUserId=ORG;
  assert.throws(()=>desk.validateSupportConversation(expanded,TICKET));
});

test("customer browser reads owner text safely, replies and clears the draft",async()=>{
  const script=await readFile(new URL("../../abracadabra/app/abracadabra-customer-control-dom.js",import.meta.url));
  const css=await readFile(new URL("../../vnext.css",import.meta.url));
  const server=createServer((request,response)=>{
    if(request.url==="/customer.js"){response.setHeader("content-type","text/javascript");response.end(script);return;}
    if(request.url==="/vnext.css"){response.setHeader("content-type","text/css");response.end(css);return;}
    response.setHeader("content-type","text/html");response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vnext.css"><main id="fixture"></main><script src="/customer.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));let browser;
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await openReviewedBrowser({origin,viewport:{width:390,height:844,mobile:true}});
    await browser.navigate(origin+"/");
    await browser.evaluate(`(()=>{
      window.replyCalls=[];
      window.fixtureState={account:{id:"customer"},project:{id:"${PROJECT}"},online:true,operations:{},supportTickets:{tickets:[${JSON.stringify(conversation().ticket)}],nextBeforeId:null},supportConversation:${JSON.stringify(conversation())}};
      window.panel=SiteSourceryAbracadabraCustomerControl.createCustomerAccountRoutesPanel(document,{
        supportList:async()=>({}),supportRead:async()=>({}),supportReply:async message=>{
          replyCalls.push(message);fixtureState.supportConversation.messages.push({id:"reply",authorKind:"customer",body:message,createdAt:new Date().toISOString()});panel.render(fixtureState);return {saved:true};
        }
      });document.querySelector("#fixture").append(panel.element);panel.render(fixtureState);
    })()`);
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-customer-support-thread] img, [data-customer-support-thread] script").length'),0);
    await browser.evaluate('(()=>{const reply=document.querySelector("[name=customerSupportReply]");reply.value="Customer browser reply";reply.dispatchEvent(new Event("input"));document.querySelector("[data-customer-support-send-reply]").click();})()');
    await browser.waitFor('replyCalls.length===1 && document.querySelector("[name=customerSupportReply]").value===""');
    assert.deepEqual(await browser.evaluate('replyCalls'),["Customer browser reply"]);
    assert.equal(await browser.evaluate('document.querySelector("[data-customer-support-thread]").textContent.includes("Customer browser reply")'),true);
    await browser.evaluate('fixtureState.project=null;fixtureState.supportConversation=null;fixtureState.supportTickets=null;panel.render(fixtureState)');
    assert.equal(await browser.evaluate('document.querySelector("[data-customer-support-thread]")===null'),true);
    assert.deepEqual(browser.browserErrors,[]);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
