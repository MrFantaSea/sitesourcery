/* Midnight Atelier utility interactions. Everything remains usable without JS. */
(function(){
  'use strict';
  var query=document.getElementById('faq-query');
  var result=document.getElementById('faq-query-result');
  if(!query||!result)return;
  var records=Array.prototype.slice.call(document.querySelectorAll('.page-faq .faq-item'));
  function filterArchive(){
    var term=query.value.trim().toLowerCase();
    var count=0;
    records.forEach(function(record){
      var haystack=(record.textContent+' '+(record.dataset.keywords||'')).toLowerCase();
      var match=!term||haystack.indexOf(term)>-1;
      record.hidden=!match;
      if(match)count++;
    });
    result.textContent=count+' '+(count===1?'answer':'answers')+(term?' found':' indexed');
  }
  query.addEventListener('input',filterArchive);
  query.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&query.value){query.value='';filterArchive();}
  });
})();
