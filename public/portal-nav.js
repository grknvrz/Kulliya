const nav=document.querySelector(".side nav");
if(nav){
  const links=[
    ["/console.html","Instellingen"],["/inbox.html","Inbox"],["/website-beheer.html","Website"],["/rondleidingen.html","Rondleidingen"],["/narrowcasting.html","Narrowcasting"],["/kiosk","Kiosk"],["/vrijwilligers.html","Vrijwilligers"],["/bestuur.html","Bestuur"],["#work","Taken & verantwoordelijkheden"],["/vergaderingen.html","Vergaderingen"],["/weekendrooster.html","Weekendrooster"],["/camera.html","Camera's"],["/kantine.html","Kantine"],["/koppelingen.html","Koppelingen"],["/donatie-instellingen.html","Donaties"],["/rapportages.html","Rapportages"],["/ledenbeheer.html","Donateurs CRM"],["/kennisbank.html","Knowledge base"],["/wachtwoorden.html","Wachtwoorden"]
  ];
  nav.innerHTML=links.map(([href,label])=>href==="#work"?`<details class="nav-group" ${["/taken.html","/verantwoordelijkheden.html"].includes(location.pathname)?"open":""}><summary>${label}</summary><div class="nav-children"><a href="/taken.html" class="${location.pathname==="/taken.html"?"active":""}">Taken</a><a href="/verantwoordelijkheden.html" class="${location.pathname==="/verantwoordelijkheden.html"?"active":""}">Verantwoordelijkheden</a></div></details>`:`<a href="${href}" class="${location.pathname===href?"active":""}">${label}</a>`).join("");
}
