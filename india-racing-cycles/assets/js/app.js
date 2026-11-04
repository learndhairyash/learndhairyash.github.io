(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const today = new Date(); today.setHours(0,0,0,0);
  const fmt = (value) => { if (!value) return "Date to be confirmed"; const d = new Date(value + "T12:00:00"); return d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); };
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl = (value) => { try { const u = new URL(String(value || ""), window.location.href); return ["https:","http:","mailto:"].includes(u.protocol) ? safe(u.href) : "#"; } catch { return "#"; } };
  const base = (window.IRC_CONFIG && window.IRC_CONFIG.apiBase || "").replace(/\/$/,"");
  async function load(kind) {
    if (base) { try { const r=await fetch(base+"/api/"+kind,{headers:{Accept:"application/json"}}); if(r.ok) { const value=await r.json(); if (!Array.isArray(value[kind]) || value[kind].length) return value; } } catch(e) { console.warn("API unavailable; using published snapshot.",e); } }
    const r=await fetch("data/"+kind+".json",{cache:"no-store"}); if(!r.ok) throw new Error("Could not load "+kind); return await r.json();
  }
  function dateRange(e){ if(!e.end_date) return "Starts "+fmt(e.start_date); return e.start_date===e.end_date ? fmt(e.start_date) : fmt(e.start_date)+" – "+fmt(e.end_date); }
  function links(e){
    const items=[];
    if(e.source_url) items.push({label:e.source_name||"Official event website",url:e.source_url,image_url:e.source_preview_url||e.image_url||"",kind:"Official source"});
    (e.source_links||[]).forEach(l=>{if(l.url)items.push({label:l.label||"Original announcement",url:l.url,image_url:l.image_url||e.image_url||"",kind:l.kind||"Source link"});});
    if(!items.length)return "";
    return '<div class="source-previews" aria-label="Original event sources">'+items.map(item=>{
      const thumb=item.image_url
        ? '<img src="'+safeUrl(item.image_url)+'" alt="" loading="lazy" referrerpolicy="no-referrer">'
        : '<span class="material-symbols-rounded" aria-hidden="true">article</span>';
      return '<a class="source-preview-card" href="'+safeUrl(item.url)+'" target="_blank" rel="noopener"><span class="source-preview-thumb">'+thumb+'</span><span class="source-preview-body"><small>'+safe(item.kind)+'</small><b>'+safe(item.label)+'</b><span>Open original ↗</span></span></a>';
    }).join("")+'</div>';
  }
  function eventCard(e){
    const poster=e.poster_url?'<img src="'+safeUrl(e.poster_url)+'" alt="'+safe(e.title)+' official event poster" loading="lazy" referrerpolicy="no-referrer">':(e.image_url?'<img src="'+safeUrl(e.image_url)+'" alt="'+safe(e.image_note||e.title+" official event visual")+'" loading="lazy" referrerpolicy="no-referrer"><span class="poster-caption">Official event visual · not a poster</span>':'<span class="material-symbols-rounded">pedal_bike</span><span class="poster-caption">Poster not supplied by source</span>');
    const register=e.registration_url?'<a class="button button-filled" href="'+safeUrl(e.registration_url)+'" target="_blank" rel="noopener">Register <span class="material-symbols-rounded">open_in_new</span></a>':(e.contact_email?'<a class="button button-filled" href="'+safeUrl("mailto:"+e.contact_email)+'">Contact organiser <span class="material-symbols-rounded">mail</span></a>':"");
    const phone=e.contact_phone?'<div class="detail-row"><span class="material-symbols-rounded">call</span><span>'+safe(e.contact_phone)+'</span></div>':"";
    const sourceLabel = e.status === "postponed" ? '<span class="chip">Postponed — check organiser</span>' : (e.status === "cancelled" ? '<span class="chip">Cancelled</span>' : (e.confidence === "community-screenshot" ? '<span class="chip">Community archive</span>' : '<span class="chip confirmed">Source checked</span>'));
    const categoryList = Array.isArray(e.categories) ? e.categories : [e.discipline || "Cycling"];
    const categories=categoryList.map(c=>'<span class="chip">'+safe(c)+'</span>').join("");
    return '<article class="event-card"><div class="event-poster">'+poster+'</div><div class="event-body"><div class="event-meta"><span class="event-date">'+safe(dateRange(e))+'</span>'+sourceLabel+'</div><div class="event-meta">'+categories+'</div><h3>'+safe(e.title)+'</h3><p class="event-description">'+safe(e.description||"Open the official source for event information.")+'</p><div class="event-details"><div class="detail-row"><span class="material-symbols-rounded">location_on</span><span>'+safe(e.location||"Location to be confirmed")+'</span></div><div class="detail-row"><span class="material-symbols-rounded">groups</span><span>'+safe(e.organiser||"Organiser details on official source")+'</span></div>'+phone+'<div class="detail-row"><span class="material-symbols-rounded">fact_check</span><span>Last verified: '+safe(fmt(e.verified_at))+'</span></div></div><div class="event-actions">'+register+(e.source_url?'<a class="button button-tonal" href="'+safeUrl(e.source_url)+'" target="_blank" rel="noopener">Event details <span class="material-symbols-rounded">open_in_new</span></a>':"")+'</div>'+links(e)+'</div></article>';
  }
  function empty(title,desc,icon){return '<div class="empty-state"><span class="material-symbols-rounded">'+icon+'</span><h3>'+title+'</h3><p>'+desc+'</p></div>';}
  function setTheme(){const saved=localStorage.getItem("irc-theme");if(saved==="dark")document.documentElement.dataset.theme="dark";const btn=$("theme-toggle");if(btn)btn.addEventListener("click",()=>{const dark=document.documentElement.dataset.theme!=="dark";if(dark)document.documentElement.dataset.theme="dark";else delete document.documentElement.dataset.theme;localStorage.setItem("irc-theme",dark?"dark":"light");btn.querySelector("span").textContent=dark?"light_mode":"dark_mode";});if(btn&&document.documentElement.dataset.theme==="dark")btn.querySelector("span").textContent="light_mode";}
  async function initUpcoming(){
    const grid=$("event-grid");let events=[];
    try{const d=await load("events");events=d.events||d;const meta=d.meta||{};const upcoming=events.filter(e=>(e.status==="postponed" || (e.end_date ? new Date(e.end_date+"T23:59:59")>=today : e.status!=="completed"))&&e.status!=="cancelled");$("upcoming-count").textContent=upcoming.length;$("updated-date").textContent=meta.last_updated?fmt(meta.last_updated):"—";const states=[...new Set(upcoming.map(e=>e.state).filter(Boolean))];$("state-count").textContent=states.length?states.length+" states":"All India";const state=$("state-filter");states.sort().forEach(s=>state.add(new Option(s,s)));render();}
    catch(err){grid.innerHTML=empty("Calendar could not load","Please refresh the page. The event data file may be temporarily unavailable.","cloud_offline");$("event-error").hidden=false;$("event-error").textContent=err.message;}
    function render(){const q=$("event-search").value.trim().toLowerCase(),cat=$("category-filter").value,state=$("state-filter").value;const list=events.filter(e=>(e.end_date ? new Date(e.end_date+"T23:59:59")>=today : e.status!=="completed")&&e.status!=="cancelled").filter(e=>(!q||[e.title,e.location,e.organiser,e.description].join(" ").toLowerCase().includes(q))&&(!cat||(e.discipline||"").toLowerCase().includes(cat.toLowerCase())||(e.categories||[]).some(c=>c.toLowerCase().includes(cat.toLowerCase())))&&(!state||e.state===state)).sort((a,b)=>a.start_date.localeCompare(b.start_date));grid.innerHTML=list.length?list.map(eventCard).join(""):empty("No matching events","Try a different search or filter. New listings appear after a source has been checked.","event_busy");}
    ["event-search","category-filter","state-filter"].forEach(id=>$(id).addEventListener(id==="event-search"?"input":"change",render));
  }
  async function initPast(){
    const grid=$("past-grid");let events=[];
    try{const d=await load("events");events=d.events||d;events=events.filter(e=>e.status==="completed"||e.status==="cancelled"||(e.status!=="postponed"&&e.end_date&&new Date(e.end_date+"T23:59:59")<today));const years=[...new Set(events.map(e=>e.start_date?.slice(0,4)).filter(Boolean))].sort().reverse();years.forEach(y=>$("year-filter").add(new Option(y,y)));render();}
    catch(err){grid.innerHTML=empty("Archive could not load","Please refresh the page.","cloud_offline");$("past-error").hidden=false;$("past-error").textContent=err.message;}
    function render(){const q=$("past-search").value.trim().toLowerCase(),year=$("year-filter").value;const list=events.filter(e=>(!q||[e.title,e.location,e.organiser].join(" ").toLowerCase().includes(q))&&(!year||e.start_date.startsWith(year))).sort((a,b)=>b.start_date.localeCompare(a.start_date));grid.innerHTML=list.length?list.map(eventCard).join(""):empty("The archive is ready for its first finish line","Completed events will move here automatically on the day after they finish. Historical entries can also be added with their original source links.","inventory_2");}
    $("past-search").addEventListener("input",render);$("year-filter").addEventListener("change",render);
  }
  async function initNews(){
    const grid=$("news-grid");let items=[];
    try{const d=await load("news");items=d.news||d;render();}
    catch(err){grid.innerHTML=empty("News could not load","Please refresh the page.","cloud_offline");$("news-error").hidden=false;$("news-error").textContent=err.message;}
    function render(){const q=$("news-search").value.trim().toLowerCase(),type=$("news-type-filter").value;const list=items.filter(n=>(!q||[n.title,n.publisher,n.summary].join(" ").toLowerCase().includes(q))&&(!type||n.type===type)).sort((a,b)=>(b.published_at||"").localeCompare(a.published_at||""));grid.innerHTML=list.length?list.map(n=>'<article class="news-card"><div class="news-card-top"><span class="news-category">'+safe(n.category||"Cycling update")+'</span><time datetime="'+safe(n.published_at||"")+'">'+safe(fmt(n.published_at))+'</time></div><h3>'+safe(n.title)+'</h3><p class="news-source">Published by '+safe(n.publisher||"Original source")+'</p><p class="news-description">'+safe(n.summary||"Open the original article for the full update.")+'</p><a class="news-link" href="'+safeUrl(n.source_url)+'" target="_blank" rel="noopener">Read original report <span class="material-symbols-rounded">arrow_outward</span></a></article>').join(""):empty("No matching stories","New race news and announcements will appear here as sources are reviewed.","newspaper");}
    ["news-search","news-type-filter"].forEach(id=>$(id).addEventListener(id==="news-search"?"input":"change",render));
  }

  function suggestionForm(){
    const form=$("event-suggestion-form");
    if(!form)return;
    form.addEventListener("submit",async ev=>{
      ev.preventDefault();
      const msg=$("suggestion-message");
      const submit=form.querySelector('button[type="submit"]');
      const data=Object.fromEntries(new FormData(form).entries());
      const useful=["event_name","source_url","event_date","location","category","organiser","poster_url","details"];
      if(!useful.some(key=>String(data[key]||"").trim())){
        msg.textContent="Please share at least one event detail or source link so we know what to review.";
        msg.className="form-message form-message-dark error";
        return;
      }
      for(const key of ["source_url","poster_url"]){
        if(String(data[key]||"").trim()){
          try{const u=new URL(data[key]);if(!["https:","http:"].includes(u.protocol))throw new Error();}
          catch{msg.textContent="Please enter a valid public web link for the event or poster.";msg.className="form-message form-message-dark error";return;}
        }
      }
      if(!base){
        msg.textContent="The suggestion page is ready, but its secure submission service has not been connected yet. Your details have not been sent. The site administrator must finish the Cloudflare setup first.";
        msg.className="form-message form-message-dark error";
        return;
      }
      msg.textContent="Sending your suggestion…";
      msg.className="form-message form-message-dark";
      submit.disabled=true;
      try{
        const r=await fetch(base+"/api/event-suggestions",{
          method:"POST",
          headers:{"Content-Type":"application/json",Accept:"application/json"},
          body:JSON.stringify(data)
        });
        const result=await r.json();
        if(!r.ok)throw new Error(result.error||"Your suggestion could not be sent. Please try again.");
        msg.textContent="Thank you! Your event suggestion has been received and is waiting for manual review. It will not appear on the calendar until it has been checked.";
        msg.className="form-message form-message-dark success";
        form.reset();
      }catch(error){
        msg.textContent=error.message||"Your suggestion could not be sent. Please try again later.";
        msg.className="form-message form-message-dark error";
      }finally{submit.disabled=false;}
    });
  }
  function newsletter(){
    const form=$("newsletter-form");if(!form)return;form.addEventListener("submit",async ev=>{ev.preventDefault();const msg=$("newsletter-message"),email=$("newsletter-email").value.trim();if(!base){msg.textContent="Newsletter sign-up is not connected yet. The email service needs to be configured before subscriptions can be accepted.";msg.className="form-message error";return;}msg.textContent="Sending confirmation…";msg.className="form-message";try{const r=await fetch(base+"/api/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});const data=await r.json();if(!r.ok)throw new Error(data.error||"Could not subscribe");msg.textContent="Check your inbox for a confirmation link. Your subscription is not active until you confirm.";msg.className="form-message success";form.reset();}catch(err){msg.textContent=err.message;msg.className="form-message error";}});}
  setTheme();newsletter();const page=document.body.dataset.page;if(page==="upcoming")initUpcoming();if(page==="past")initPast();if(page==="news")initNews();if(page==="suggestion")suggestionForm();
})();