const copy = {
  nl: { chooseEyebrow:"KIES UW BIJDRAGE", chooseTitle:"Hoeveel wilt u doneren?", chooseSubtitle:"Elk bedrag, groot of klein, draagt bij.", terminalHint:"Na uw keuze verschijnt het bedrag direct op de pinautomaat.", almost:"BIJNA KLAAR", followTerminal:"Volg de instructies op de pinautomaat", cancel:"Annuleren en terug", waiting:"wordt klaargezet…" },
  tr: { chooseEyebrow:"BAĞIŞINIZI SEÇİN", chooseTitle:"Ne kadar bağış yapmak istersiniz?", chooseSubtitle:"Büyük ya da küçük, her bağış değerlidir.", terminalHint:"Seçiminizden sonra tutar ödeme terminalinde görünecektir.", almost:"NEREDEYSE HAZIR", followTerminal:"Ödeme terminalindeki talimatları izleyin", cancel:"İptal et ve geri dön", waiting:"hazırlanıyor…" },
  en: { chooseEyebrow:"CHOOSE YOUR CONTRIBUTION", chooseTitle:"How much would you like to donate?", chooseSubtitle:"Every contribution, large or small, makes a difference.", terminalHint:"After choosing, the amount will appear on the payment terminal.", almost:"ALMOST READY", followTerminal:"Follow the instructions on the payment terminal", cancel:"Cancel and go back", waiting:"is being prepared…" }
};
let language = ["tr","nl","en"].includes(localStorage.getItem("orangeLanguage")) ? localStorage.getItem("orangeLanguage") : "tr";
let settings;
let activeOrderId = null;
let paymentPollTimer = null;
const kioskMatch=location.pathname.match(/^\/kiosk\/([^/]+)\/([^/]+)/),tenantSlug=kioskMatch?decodeURIComponent(kioskMatch[1]):location.pathname.startsWith("/scherm/")?location.pathname.split("/")[2]:new URLSearchParams(location.search).get("tenant"),kioskId=kioskMatch?decodeURIComponent(kioskMatch[2]):null;
const $ = selector => document.querySelector(selector);

function show(name) {
  document.querySelectorAll(".screen").forEach(el => el.classList.toggle("active", el.dataset.screen === name));
}
function setLanguage(next) {
  language = next;
  document.documentElement.lang = next;
  document.querySelectorAll("[data-copy]").forEach(el => el.textContent = copy[next][el.dataset.copy]);
  $("#lang-toggle").textContent = next.toUpperCase();
}
function money(amount) { return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "nl-NL", { style:"currency", currency:settings.currency, maximumFractionDigits:0 }).format(amount); }
function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),4500); }

async function loadPrayerTimes() {
  try {
    const response = await fetch(`/api/prayer-times${tenantSlug?`?tenant=${encodeURIComponent(tenantSlug)}`:""}`); const data = await response.json();
    if (!response.ok) throw new Error();
    $("#prayer-location").textContent = data.location;
    const names = { Fajr:"Fajr", Sunrise:"Zonsopgang", Dhuhr:"Dhuhr", Asr:"Asr", Maghrib:"Maghrib", Isha:"Isha" };
    $("#prayer-list").innerHTML = Object.entries(data.timings).map(([key,value]) => `<div><small>${names[key]}</small><strong>${value.replace(/\s*\(.+\)/,"")}</strong></div>`).join("");
  } catch { $("#prayer-list").innerHTML = "<p>Gebedstijden tijdelijk niet beschikbaar.</p>"; }
}

async function startPayment(amount, button) {
  button.disabled = true;
  try {
    const response = await fetch("/api/payments", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ amount, tenant:tenantSlug, kioskId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    activeOrderId = result.orderId;
    $("#selected-amount").textContent = `${money(amount)} ${copy[language].waiting}`;
    show("status");
    clearInterval(paymentPollTimer);
    paymentPollTimer=setInterval(checkPaymentStatus,1000);
  } catch (error) { toast(error.message || "Betaling starten mislukt."); }
  finally { button.disabled = false; }
}

async function checkPaymentStatus(){if(!activeOrderId)return;try{const response=await fetch(`/api/payments/${encodeURIComponent(activeOrderId)}/status`),result=await response.json();if(!response.ok)throw new Error(result.error);if(result.message)$("#selected-amount").textContent=result.message;if(result.status==="completed"){clearInterval(paymentPollTimer);paymentPollTimer=null;activeOrderId=null;toast(language==="tr"?"Bağışınız için teşekkürler!":"Bedankt voor uw donatie!");setTimeout(()=>show("welcome"),1800);}else if(["failed","cancelled"].includes(result.status)){clearInterval(paymentPollTimer);paymentPollTimer=null;activeOrderId=null;toast(result.message||"Betaling niet voltooid.");show("amounts");}}catch(error){clearInterval(paymentPollTimer);paymentPollTimer=null;toast(error.message||"Betaalstatus kon niet worden gelezen.");}}

async function init() {
  const response = await fetch(`/api/config${tenantSlug?`?tenant=${encodeURIComponent(tenantSlug)}`:""}`);
  settings = await response.json();
  $("#organization").textContent = settings.organization;
  $("#organization-small").textContent = settings.organization;
  if (settings.logo) document.querySelectorAll(".brand-mark").forEach(mark => { mark.classList.add("has-logo"); mark.querySelector("img").src=settings.logo; });
  if (settings.video) $("#hero-video").src = settings.video;
  const grid = $("#amount-grid");
  settings.amounts.forEach(amount => {
    const button = document.createElement("button");
    button.className = "amount-btn"; button.textContent = money(amount);
    button.addEventListener("click", () => startPayment(amount, button));
    grid.append(button);
  });
  loadPrayerTimes();
}

document.querySelectorAll("[data-language]").forEach(btn => btn.addEventListener("click", () => { setLanguage(btn.dataset.language); show("amounts"); }));
$("#back").addEventListener("click", () => show("welcome"));
$("#cancel").addEventListener("click", async event => {
  if (!activeOrderId || event.currentTarget.disabled) return;
  const button = event.currentTarget;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = language === "tr" ? "İptal ediliyor…" : "Annuleren…";
  try {
    const response = await fetch(`/api/payments/${encodeURIComponent(activeOrderId)}/cancel`, { method:"POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    clearInterval(paymentPollTimer); paymentPollTimer=null;
    activeOrderId = null;
    show("amounts");
  } catch (error) { toast(error.message || "Annuleren is niet gelukt."); }
  finally { button.disabled = false; button.textContent = original; }
});
$("#lang-toggle").addEventListener("click", () => setLanguage(language === "nl" ? "tr" : "nl"));
window.addEventListener("orange-language-change", event => setLanguage(event.detail));
$("#member-login").addEventListener("click", () => { location.href = `/ledenlogin${tenantSlug?`?tenant=${encodeURIComponent(tenantSlug)}`:""}`; });
setLanguage(language);
init().catch(() => toast("De instellingen konden niet worden geladen."));
