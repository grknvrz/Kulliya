const nav=document.querySelector(".side nav");
if(nav){
  const links=[
    ["/console.html","Instellingen"],["/website-beheer.html","Website"],["/rondleidingen.html","Rondleidingen"],["/kiosk","Kiosk"],["/vrijwilligers.html","Vrijwilligers"],["/bestuur.html","Bestuur"],["/taken.html","Taken & verantwoordelijkheden"],["/vergaderingen.html","Vergaderingen"],["/weekendrooster.html","Weekendrooster"],["/camera.html","Camera's"],["/kantine.html","Kantine"],["/koppelingen.html","Koppelingen"],["/donatie-instellingen.html","Donaties"],["/rapportages.html","Rapportages"],["/ledenbeheer.html","Donateurs CRM"],["/kennisbank.html","Knowledge base"],["/wachtwoorden.html","Wachtwoorden"]
  ];
  nav.innerHTML=links.map(([href,label])=>`<a href="${href}" class="${location.pathname===href?"active":""}">${label}</a>`).join("");
}
