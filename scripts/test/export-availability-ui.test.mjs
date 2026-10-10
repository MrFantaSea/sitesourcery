import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {openReviewedBrowser} from "../../server/hosted/test/reviewed-browser-support.mjs";

test("customer export controls follow fresh availability and keep existing status/download actions usable",async()=>{
  const script=await readFile(new URL("../../abracadabra/app/abracadabra-customer-control-dom.js",import.meta.url));
  const server=createServer((request,response)=>{
    if(request.url==="/customer.js"){response.setHeader("Content-Type","text/javascript");response.end(script);return;}
    response.setHeader("Content-Type","text/html");response.end('<!doctype html><main id="fixture"></main><script src="/customer.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));let browser;
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await openReviewedBrowser({origin,viewport:{width:390,height:844,mobile:true}});
    await browser.navigate(origin+"/");
    await browser.evaluate(`(()=>{
      window.calls=[];
      window.fixtureState={account:{id:"customer"},project:{id:"project"},online:true,operations:{}};
      window.availability=ready=>{const now=Date.now();return {ready,checkedAt:new Date(now).toISOString(),refreshAfter:new Date(now+30000).toISOString()};};
      window.panel=SiteSourceryAbracadabraCustomerControl.createCustomerAccountRoutesPanel(document,{
        requestExport:()=>calls.push("request"),refreshExport:()=>calls.push("refresh"),downloadExport:()=>calls.push("download"),retryExport:()=>calls.push("retry")
      });document.querySelector("#fixture").append(panel.element);panel.render(fixtureState);
      window.control=kind=>document.querySelector("[data-customer-"+kind+"-export]");
    })()`);
    assert.equal(await browser.evaluate('control("request").disabled'),true);
    assert.equal(await browser.evaluate('control("refresh").hidden || control("refresh").disabled'),false);
    assert.match(await browser.evaluate('document.querySelector("[data-customer-export-status]").textContent'),/temporarily unavailable/);
    await browser.evaluate('control("request").click();control("refresh").click()');
    assert.deepEqual(await browser.evaluate('calls'),["refresh"]);
    await browser.evaluate('fixtureState.project.exportAvailability=availability(true);panel.render(fixtureState);control("request").click()');
    assert.deepEqual(await browser.evaluate('calls'),["refresh","request"]);
    await browser.evaluate('fixtureState.project.exportAvailability.checkedAt=new Date(Date.now()-60000).toISOString();fixtureState.project.exportAvailability.refreshAfter=new Date(Date.now()-1).toISOString();control("request").click()');
    assert.deepEqual(await browser.evaluate('calls'),["refresh","request"]);
    assert.equal(await browser.evaluate('control("request").disabled'),true);
    await browser.evaluate('fixtureState.exportJob={status:"queued",createdAt:new Date(Date.now()-360000).toISOString(),availability:availability(false),delayed:true};panel.render(fixtureState)');
    assert.match(await browser.evaluate('document.querySelector("[data-customer-export-status]").textContent'),/more than five minutes/);
    assert.equal(await browser.evaluate('control("refresh").disabled'),false);
    await browser.evaluate('fixtureState.exportJob={status:"ready",createdAt:new Date().toISOString(),filename:"fixture.zip",availability:availability(false)};panel.render(fixtureState);control("download").click()');
    assert.deepEqual(await browser.evaluate('calls'),["refresh","request","download"]);
    await browser.evaluate('fixtureState.exportJob.status="expired";panel.render(fixtureState);control("retry").click()');
    assert.equal(await browser.evaluate('control("retry").disabled'),true);
    assert.deepEqual(await browser.evaluate('calls'),["refresh","request","download"]);
    await browser.evaluate('fixtureState.exportJob.availability=availability(true);panel.render(fixtureState);control("retry").click()');
    assert.deepEqual(await browser.evaluate('calls'),["refresh","request","download","retry"]);
    await browser.evaluate('fixtureState.online=false;panel.render(fixtureState)');
    assert.equal(await browser.evaluate('control("refresh").disabled'),true);
    assert.deepEqual(browser.browserErrors,[]);
  } finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
