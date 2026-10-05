const nav=document.querySelector(".side nav");
if(nav){
  const links=[
    ["/console.html","Instellingen"],["/inbox.html","Inbox"],["/website-beheer.html","Website"],["/rondleidingen.html","Rondleidingen"],["/narrowcasting.html","Narrowcasting"],["/kiosk","Kiosk"],["/vrijwilligers.html","Vrijwilligers"],["/bestuur.html","Bestuur"],["#work","Taken & verantwoordelijkheden"],["/vergaderingen.html","Vergaderingen"],["/weekendrooster.html","Weekendrooster"],["/camera.html","Camera's"],["/kantine.html","Kantine"],["/koppelingen.html","Koppelingen"],["/donatie-instellingen.html","Donaties"],["/rapportages.html","Rapportages"],["/ledenbeheer.html","Donateurs CRM"],["/kennisbank.html","Knowledge base"],["/wachtwoorden.html","Wachtwoorden"],["/algemene-voorwaarden.html","Algemene voorwaarden"]
  ];
  nav.innerHTML=links.map(([href,label])=>href==="#work"?`<details class="nav-group" ${["/taken.html","/verantwoordelijkheden.html"].includes(location.pathname)?"open":""}><summary>${label}</summary><div class="nav-children"><a href="/taken.html" class="${location.pathname==="/taken.html"?"active":""}">Taken</a><a href="/verantwoordelijkheden.html" class="${location.pathname==="/verantwoordelijkheden.html"?"active":""}">Verantwoordelijkheden</a></div></details>`:`<a href="${href}" class="${location.pathname===href?"active":""}">${label}</a>`).join("");
  const side=nav.closest(".side"),brand=side?.querySelector(".side-brand");
  if(side&&brand){
    const toggle=document.createElement("button");
    toggle.className="mobile-nav-toggle";toggle.type="button";toggle.setAttribute("aria-label","Menu openen");toggle.setAttribute("aria-expanded","false");toggle.innerHTML="<span></span><span></span><span></span>";brand.append(toggle);
    toggle.onclick=()=>{const open=side.classList.toggle("menu-open");toggle.setAttribute("aria-expanded",String(open));toggle.setAttribute("aria-label",open?"Menu sluiten":"Menu openen")};
    nav.addEventListener("click",event=>{if(event.target.closest("a")&&matchMedia("(max-width: 800px)").matches){side.classList.remove("menu-open");toggle.setAttribute("aria-expanded","false")}});
  }
}
