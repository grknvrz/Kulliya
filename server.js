import http from "node:http";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { generateWeekendSchedule, swapWeekendAssignments, weekendDates } from "./lib/weekend-schedule.js";
import { inspectDonorCsv } from "./lib/donor-import.js";

const root = new URL(".", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const publicDir = join(root, "public");
const configFile = join(root, "config", "donations.json");
const tenantsFile = join(root, "config", "tenants.json");
const port = Number(process.env.PORT || 3000);
const prayerCache = new Map();
const ccvPayments = new Map();

async function updateDonationRecord(tenantId,orderId,changes){const db=await tenantDb(),tenant=db.tenants.find(item=>item.id===tenantId);if(!tenant)return;tenant.donations||=[];const donation=tenant.donations.find(item=>item.orderId===orderId);if(!donation)return;Object.assign(donation,changes,{updatedAt:new Date().toISOString()});await saveTenantDb(db);}

async function logError(label, details) {
  const safe = details instanceof Error
    ? { name: details.name, message: details.message, cause: details.cause?.message || details.cause?.code }
    : details;
  await appendFile(join(root, "server-error.log"), `${new Date().toISOString()} ${label} ${JSON.stringify(safe)}\n`).catch(() => {});
}

const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm"
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function config() {
  const parsed = JSON.parse(await readFile(configFile, "utf8"));
  if (!Array.isArray(parsed.amounts) || parsed.amounts.some(v => !Number.isInteger(v) || v < 1)) {
    throw new Error("config/donations.json bevat ongeldige bedragen");
  }
  return parsed;
}

async function tenantDb() {
  try { return JSON.parse(await readFile(tenantsFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { tenants: [] }; throw error; }
}

async function saveTenantDb(db) {
  const temp = `${tenantsFile}.tmp`;
  await writeFile(temp, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await rename(temp, tenantsFile);
}

function slugify(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "moskee";
}

function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, stored) {
  const [salt, expected] = String(stored).split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function sessionSecret() { return process.env.SESSION_SECRET || process.env.ADMIN_PIN || "vervang-deze-session-secret"; }
function secretKey(){return createHash("sha256").update(sessionSecret()).digest();}
function encryptSecret(value){if(!value)return"";const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",secretKey(),iv),encrypted=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]),tag=cipher.getAuthTag();return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;}
function decryptSecret(value){if(!value)return"";try{const[,iv,tag,data]=String(value).split(":"),decipher=createDecipheriv("aes-256-gcm",secretKey(),Buffer.from(iv,"base64url"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8");}catch{return"";}}
function sessionToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${createHmac("sha256", sessionSecret()).update(data).digest("base64url")}`;
}
function sessionFrom(req) {
  const raw = String(req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith("orange_session="))?.split("=")[1];
  if (!raw) return null;
  const [data, signature] = raw.split(".");
  const expected = createHmac("sha256", sessionSecret()).update(data || "").digest("base64url");
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const payload = JSON.parse(Buffer.from(data, "base64url")); return payload.exp > Date.now() ? payload : null; } catch { return null; }
}
function setSession(res, payload) {
  res.setHeader("set-cookie", `orange_session=${sessionToken({ ...payload, exp: Date.now() + 7 * 864e5 })}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}
function publicTenant(tenant) { return { id:tenant.id, slug:tenant.slug, organization:tenant.organization, city:tenant.city, email:tenant.email, settings:tenant.settings }; }

async function register(req, res) {
  const input = await body(req); const organization=String(input.organization||"").trim(), city=String(input.city||"").trim(), email=String(input.email||"").trim().toLowerCase(), password=String(input.password||"");
  if (!organization || !city || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return json(res, 400, { error:"Vul alle velden correct in; gebruik minimaal 8 tekens voor het wachtwoord." });
  const db=await tenantDb(); if(db.tenants.some(t=>t.email===email)) return json(res,409,{error:"Dit e-mailadres is al geregistreerd."});
  let slug=slugify(organization), suffix=2; while(db.tenants.some(t=>t.slug===slug)) slug=`${slugify(organization)}-${suffix++}`;
  const defaults=await config(); const tenant={id:randomUUID(),slug,organization,city,email,passwordHash:passwordHash(password),createdAt:new Date().toISOString(),settings:{...defaults,organization,prayerCity:city,prayerCountry:"NL",logo:"",video:"/media/welcome.mp4"},members:[],products:[],receipts:[],memberPayments:[]};
  db.tenants.push(tenant); await saveTenantDb(db); setSession(res,{role:"tenant",tenantId:tenant.id}); json(res,201,{user:{role:"tenant",tenant:publicTenant(tenant)},redirect:"/console.html"});
}

async function loginAccount(req,res){const {email,password}=await body(req);const normalized=String(email||"").trim().toLowerCase();const masterEmail=String(process.env.MASTER_ADMIN_EMAIL||"master@orangepos.nl").toLowerCase(),masterPassword=String(process.env.MASTER_ADMIN_PASSWORD||process.env.ADMIN_PIN||"");
  if(masterPassword&&normalized===masterEmail&&String(password||"")===masterPassword){setSession(res,{role:"master"});return json(res,200,{user:{role:"master"},redirect:"/console.html"});}
  const db=await tenantDb(),tenant=db.tenants.find(t=>t.email===normalized);if(!tenant||!passwordMatches(String(password||""),tenant.passwordHash))return json(res,401,{error:"E-mailadres of wachtwoord is onjuist."});setSession(res,{role:"tenant",tenantId:tenant.id});json(res,200,{user:{role:"tenant",tenant:publicTenant(tenant)},redirect:"/console.html"});}

async function portalContext(req){const session=sessionFrom(req);if(!session)return null;const db=await tenantDb();if(session.role==="master")return{session,db,tenant:null};const tenant=db.tenants.find(t=>t.id===session.tenantId);return tenant?{session,db,tenant}:null;}
async function selectedTenant(req){const ctx=await portalContext(req);if(!ctx||!["master","tenant"].includes(ctx.session.role))return null;if(ctx.session.role!=="master")return{ctx,tenant:ctx.tenant};const id=req.headers["x-tenant-id"];return{ctx,tenant:ctx.db.tenants.find(t=>t.id===id)||ctx.db.tenants[0]||null};}

async function portalSettings(req,res,write=false){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Nog geen moskeeën aangemeld."});if(!write)return json(res,200,publicTenant(selected.tenant));
  const input=await body(req),amounts=[...new Set(input.amounts||[])].map(Number).sort((a,b)=>a-b);if(!amounts.length||amounts.some(v=>!Number.isInteger(v)||v<1||v>5000))return json(res,400,{error:"Controleer de donatiebedragen."});
  selected.tenant.organization=String(input.organization||"").trim();selected.tenant.city=String(input.prayerCity||"").trim();Object.assign(selected.tenant.settings,{organization:selected.tenant.organization,amounts,prayerCity:selected.tenant.city,prayerCountry:String(input.prayerCountry||"NL").toUpperCase()});await saveTenantDb(selected.ctx.db);json(res,200,publicTenant(selected.tenant));}

async function portalUpload(req,res){
  const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});
  const{kind,mimeType,data,assetId}=await body(req,140_000_000),isImage=["logo","header","news"].includes(kind),allowed=isImage?{"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}:{"video/mp4":"mp4","video/webm":"webm"},extension=allowed[mimeType];if(!extension)return json(res,400,{error:"Bestandstype niet ondersteund."});if(kind==="news"&&!/^[a-zA-Z0-9-]{8,80}$/.test(String(assetId||"")))return json(res,400,{error:"Ongeldige nieuwsafbeelding."});
  const buffer=Buffer.from(String(data||""),"base64"),max=isImage?5e6:1e8;if(!buffer.length||buffer.length>max)return json(res,400,{error:"Bestand is te groot."});const folder=join(publicDir,"media",selected.tenant.slug),filename=kind==="news"?`news-${assetId}.${extension}`:`${kind}.${extension}`,url=`/media/${selected.tenant.slug}/${filename}?v=${Date.now()}`;await mkdir(folder,{recursive:true});await writeFile(join(folder,filename),buffer);if(kind!=="news"){selected.tenant.settings[kind]=url;await saveTenantDb(selected.ctx.db);}json(res,200,{url});
}

function integrationView(tenant){const value=tenant.integrations||{},smart=value.raboSmartPay||{},sepa=value.sepaDirectDebit||{},terminal=value.paymentTerminal||{},eboek=value.eboekhouden||{};return{raboSmartPay:{configured:Boolean(smart.refreshToken&&smart.signingKey),environment:smart.environment||"sandbox",idealEnabled:smart.idealEnabled!==false,refreshTokenHint:smart.refreshToken?`••••${decryptSecret(smart.refreshToken).slice(-4)}`:"",signingKeyHint:smart.signingKey?"Opgeslagen":""},sepaDirectDebit:{configured:Boolean(sepa.creditorId&&sepa.creditorIban),enabled:Boolean(sepa.enabled),creditorId:sepa.creditorId||"",creditorIban:sepa.creditorIban||"",mandatePrefix:sepa.mandatePrefix||"DON"},paymentTerminal:{provider:"CCV",configured:Boolean(terminal.ipAddress),ipAddress:terminal.ipAddress||"",port:terminal.port||4100},eboekhouden:{configured:Boolean(eboek.apiToken&&eboek.bankLedgerId&&eboek.looseLedgerId&&eboek.recurringLedgerId),enabled:Boolean(eboek.enabled),apiTokenHint:eboek.apiToken?`••••${decryptSecret(eboek.apiToken).slice(-4)}`:"",bankLedgerId:eboek.bankLedgerId||"",looseLedgerId:eboek.looseLedgerId||"",recurringLedgerId:eboek.recurringLedgerId||"",lastSync:eboek.lastSync||null,syncedMonths:eboek.syncedMonths||[]}};}
async function portalIntegrations(req,res){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});if(req.method==="GET")return json(res,200,integrationView(selected.tenant));const input=await body(req),tenant=selected.tenant;tenant.integrations||={};if(input.section==="smartpay"){const current=tenant.integrations.raboSmartPay||{},environment=["sandbox","production"].includes(input.environment)?input.environment:"sandbox",refreshToken=String(input.refreshToken||"").trim(),signingKey=String(input.signingKey||"").trim();tenant.integrations.raboSmartPay={...current,environment,idealEnabled:Boolean(input.idealEnabled),refreshToken:refreshToken?encryptSecret(refreshToken):current.refreshToken||"",signingKey:signingKey?encryptSecret(signingKey):current.signingKey||"",updatedAt:new Date().toISOString()};}else if(input.section==="sepa"){const creditorIban=cleanIban(input.creditorIban),creditorId=String(input.creditorId||"").replace(/\s+/g,"").toUpperCase(),mandatePrefix=String(input.mandatePrefix||"DON").replace(/[^A-Za-z0-9-]/g,"").toUpperCase().slice(0,12);if(creditorIban&&!validIban(creditorIban))return json(res,400,{error:"Controleer het incassant-IBAN."});tenant.integrations.sepaDirectDebit={enabled:Boolean(input.enabled),creditorId,creditorIban,mandatePrefix:mandatePrefix||"DON",updatedAt:new Date().toISOString()};}else if(input.section==="terminal"){const ipAddress=String(input.ipAddress||"").trim(),port=String(input.port||"4100").trim();if(ipAddress&&!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ipAddress))return json(res,400,{error:"Vul een geldig IPv4-adres van de CCV-pinautomaat in."});if(!/^\d{1,5}$/.test(port)||Number(port)>65535)return json(res,400,{error:"Vul een geldige CCV-poort in."});tenant.integrations.paymentTerminal={provider:"CCV",ipAddress,port:Number(port),updatedAt:new Date().toISOString()};}else if(input.section==="eboekhouden"){const current=tenant.integrations.eboekhouden||{},apiToken=String(input.apiToken||"").trim(),ids=["bankLedgerId","looseLedgerId","recurringLedgerId"],values=Object.fromEntries(ids.map(key=>[key,String(input[key]||"").trim()]));if(Object.values(values).some(value=>value&&!/^\d+$/.test(value)))return json(res,400,{error:"Grootboek-ID's mogen alleen cijfers bevatten."});tenant.integrations.eboekhouden={...current,...values,enabled:Boolean(input.enabled),apiToken:apiToken?encryptSecret(apiToken):current.apiToken||"",updatedAt:new Date().toISOString()};}else{return json(res,400,{error:"Onbekende instellingensectie."});}await saveTenantDb(selected.ctx.db);json(res,200,integrationView(tenant));}

function ensureBoard(tenant){tenant.boardMembers||=[];tenant.weekendSchedules||={};return tenant;}
function boardMemberView(member){return{id:member.id,firstName:member.firstName,lastName:member.lastName,name:`${member.firstName} ${member.lastName}`.trim(),role:member.role||"",email:member.email||"",phone:member.phone||"",weekendRoster:member.weekendRoster===true,active:member.active!==false,createdAt:member.createdAt};}
function boardInput(input){return{firstName:String(input.firstName||"").trim(),lastName:String(input.lastName||"").trim(),role:String(input.role||"").trim(),email:String(input.email||"").trim().toLowerCase(),phone:String(input.phone||"").trim(),weekendRoster:Boolean(input.weekendRoster)};}
async function boardAdmin(req,res,memberId){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const tenant=ensureBoard(selected.tenant);if(req.method==="GET")return json(res,200,{members:tenant.boardMembers.filter(member=>member.active!==false).map(boardMemberView)});if(req.method==="DELETE"){const member=tenant.boardMembers.find(item=>item.id===memberId);if(!member)return json(res,404,{error:"Bestuurder niet gevonden."});member.active=false;member.weekendRoster=false;member.archivedAt=new Date().toISOString();await saveTenantDb(selected.ctx.db);return json(res,200,{ok:true});}const input=boardInput(await body(req));if(!input.firstName||!input.lastName)return json(res,400,{error:"Voornaam en achternaam zijn verplicht."});if(input.email&&!/^\S+@\S+\.\S+$/.test(input.email))return json(res,400,{error:"Controleer het e-mailadres."});if(req.method==="POST"){tenant.boardMembers.push({id:randomUUID(),...input,active:true,createdAt:new Date().toISOString()});}else{const member=tenant.boardMembers.find(item=>item.id===memberId&&item.active!==false);if(!member)return json(res,404,{error:"Bestuurder niet gevonden."});Object.assign(member,input,{updatedAt:new Date().toISOString()});}await saveTenantDb(selected.ctx.db);json(res,req.method==="POST"?201:200,{members:tenant.boardMembers.filter(member=>member.active!==false).map(boardMemberView)});}
async function weekendSchedule(req,res,url,action){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const tenant=ensureBoard(selected.tenant),input=req.method==="GET"?{}:await body(req),year=Number(url.searchParams.get("year")||input.year||new Date().getFullYear());if(!Number.isInteger(year)||year<2020||year>2100)return json(res,400,{error:"Ongeldig roosterjaar."});if(req.method==="GET"){const required=weekendDates(year);if(!Array.isArray(tenant.weekendSchedules[year])||tenant.weekendSchedules[year].length!==required.length){tenant.weekendSchedules[year]=generateWeekendSchedule(year,tenant.boardMembers);await saveTenantDb(selected.ctx.db);}return json(res,200,{year,members:tenant.boardMembers.filter(member=>member.active!==false).map(boardMemberView),assignments:tenant.weekendSchedules[year]});}if(action==="regenerate")tenant.weekendSchedules[year]=generateWeekendSchedule(year,tenant.boardMembers);else if(action==="swap"){if(!Array.isArray(tenant.weekendSchedules[year]))tenant.weekendSchedules[year]=generateWeekendSchedule(year,tenant.boardMembers);try{swapWeekendAssignments(tenant.weekendSchedules[year],String(input.firstDate||""),String(input.secondDate||""));}catch(error){return json(res,400,{error:error.message});}}else return json(res,400,{error:"Onbekende roosteractie."});await saveTenantDb(selected.ctx.db);json(res,200,{year,members:tenant.boardMembers.filter(member=>member.active!==false).map(boardMemberView),assignments:tenant.weekendSchedules[year]});}

async function tenantBySlug(slug){if(!slug)return null;return (await tenantDb()).tenants.find(t=>t.slug===slug)||null;}
function normalizeDomain(value){return String(value||"").trim().toLowerCase().replace(/^https?:\/\//,"").split("/")[0].replace(/:\d+$/,"").replace(/\.$/,"");}
function requestDomain(req){return normalizeDomain(String(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0]);}
async function tenantByDomain(domain){if(!domain||domain==="localhost"||domain==="127.0.0.1")return null;const db=await tenantDb();return db.tenants.find(tenant=>(ensureWebsite(tenant).customDomains||[]).includes(domain))||null;}

function ensureWebsite(tenant){tenant.website||={};tenant.website.activities||=[];tenant.website.news||=[];tenant.website.faqs||=[];tenant.website.tourSlots||=[];tenant.website.tourRequests||=[];tenant.website.volunteers||=[];tenant.website.volunteerAvailability||=[];tenant.website.emailOutbox||=[];return tenant.website;}
function eligibleHosts(site,slotId){const assigned=new Set(site.tourRequests.filter(request=>request.slotId===slotId&&request.status!=="cancelled"&&request.hostId).map(request=>request.hostId));return site.volunteers.filter(volunteer=>volunteer.active!==false&&!assigned.has(volunteer.id)&&site.volunteerAvailability.some(item=>item.volunteerId===volunteer.id&&item.slotId===slotId));}
function websiteView(tenant){const site=ensureWebsite(tenant),settings=tenant.settings||{};return{slug:tenant.slug,customDomains:site.customDomains||[],organization:tenant.organization,city:tenant.city,logo:settings.logo||"",headerImage:settings.header||"",prayerCity:settings.prayerCity||tenant.city,prayerCountry:settings.prayerCountry||"NL",intro:site.intro||`Welkom bij ${tenant.organization}. Een plek voor gebed, ontmoeting en verbinding.`,tourInfo:site.tourInfo||"Maak kennis met onze moskee, de gebedsruimte en de rol van de moskee in de buurt. Rondleidingen zijn geschikt voor scholen, organisaties en andere belangstellenden.",contact:{email:site.contact?.email||tenant.email||"",phone:site.contact?.phone||"",address:site.contact?.address||"",postalCode:site.contact?.postalCode||"",city:site.contact?.city||tenant.city||""},anbi:{rsin:site.anbi?.rsin||"",legalName:site.anbi?.legalName||tenant.organization,policyUrl:site.anbi?.policyUrl||"",annualReportUrl:site.anbi?.annualReportUrl||"",remuneration:site.anbi?.remuneration||"Bestuurders ontvangen geen beloning voor hun werkzaamheden."},sermonUrl:site.sermonUrl||"",activities:site.activities.filter(item=>item.active!==false),news:site.news.filter(item=>item.active!==false),faqs:site.faqs.filter(item=>item.active!==false),tourSlots:site.tourSlots.filter(item=>item.active!==false&&new Date(item.start)>new Date()&&eligibleHosts(site,item.id).length).sort((a,b)=>String(a.start).localeCompare(String(b.start)))}};
async function publicWebsite(req,res,slug){const tenant=await tenantBySlug(slug);if(!tenant)return json(res,404,{error:"Moskee niet gevonden."});json(res,200,websiteView(tenant));}
async function portalWebsite(req,res){
  const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});
  if(req.method==="GET"){const site=ensureWebsite(selected.tenant);return json(res,200,{...websiteView(selected.tenant),tourSlots:site.tourSlots,tourRequests:site.tourRequests});}
  const input=await body(req,2_000_000),site=ensureWebsite(selected.tenant),text=value=>String(value||"").trim(),domains=[...new Set(String(input.customDomains||"").split(/[\s,;]+/).map(normalizeDomain).filter(Boolean))];
  if(domains.some(domain=>!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)))return json(res,400,{error:"Controleer de gekoppelde domeinnamen."});
  const duplicate=selected.ctx.db.tenants.find(tenant=>tenant.id!==selected.tenant.id&&domains.some(domain=>(ensureWebsite(tenant).customDomains||[]).includes(domain)));if(duplicate)return json(res,409,{error:`Een domeinnaam is al gekoppeld aan ${duplicate.organization}.`});
  site.customDomains=domains;site.intro=text(input.intro);site.tourInfo=text(input.tourInfo);site.sermonUrl=text(input.sermonUrl);site.contact={email:text(input.contact?.email),phone:text(input.contact?.phone),address:text(input.contact?.address),postalCode:text(input.contact?.postalCode),city:text(input.contact?.city)};site.anbi={rsin:text(input.anbi?.rsin),legalName:text(input.anbi?.legalName),policyUrl:text(input.anbi?.policyUrl),annualReportUrl:text(input.anbi?.annualReportUrl),remuneration:text(input.anbi?.remuneration)};
  const cleanList=(list,fields)=>(Array.isArray(list)?list:[]).slice(0,100).map(item=>({id:text(item.id)||randomUUID(),...Object.fromEntries(fields.map(field=>[field,text(item[field])])),active:item.active!==false}));site.activities=cleanList(input.activities,["title","date","time","location","description"]);site.news=cleanList(input.news,["title","date","summary","content","image"]);site.faqs=cleanList(input.faqs,["question","answer"]);site.tourSlots=cleanList(input.tourSlots,["start","end","capacity"]);site.updatedAt=new Date().toISOString();await saveTenantDb(selected.ctx.db);json(res,200,{...websiteView(selected.tenant),tourSlots:site.tourSlots,tourRequests:site.tourRequests});
}
async function requestTour(req,res,slug){const db=await tenantDb(),tenant=db.tenants.find(item=>item.slug===slug);if(!tenant)return json(res,404,{error:"Moskee niet gevonden."});const input=await body(req),site=ensureWebsite(tenant),slot=site.tourSlots.find(item=>item.id===String(input.slotId||"")&&item.active!==false),name=String(input.name||"").trim(),email=String(input.email||"").trim().toLowerCase(),groupSize=Number(input.groupSize||1);if(!slot)return json(res,400,{error:"Kies een beschikbaar rondleidingsmoment."});if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!Number.isInteger(groupSize)||groupSize<1||groupSize>100)return json(res,400,{error:"Vul naam, e-mailadres en groepsgrootte correct in."});const reserved=site.tourRequests.filter(item=>item.slotId===slot.id&&item.status!=="cancelled").reduce((sum,item)=>sum+item.groupSize,0),capacity=Number(slot.capacity||30);if(reserved+groupSize>capacity)return json(res,409,{error:"Dit moment heeft onvoldoende vrije plaatsen."});site.tourRequests.push({id:randomUUID(),slotId:slot.id,name,email,phone:String(input.phone||"").trim(),organization:String(input.organization||"").trim(),groupSize,message:String(input.message||"").trim(),status:"new",createdAt:new Date().toISOString()});await saveTenantDb(db);json(res,201,{ok:true,message:"De rondleidingsaanvraag is ontvangen."});}

function volunteerView(volunteer,site){return{id:volunteer.id,firstName:volunteer.firstName,lastName:volunteer.lastName,name:`${volunteer.firstName} ${volunteer.lastName}`.trim(),email:volunteer.email,phone:volunteer.phone||"",active:volunteer.active!==false,availabilityCount:site.volunteerAvailability.filter(item=>item.volunteerId===volunteer.id).length,assignmentCount:site.tourRequests.filter(item=>item.hostId===volunteer.id&&item.status!=="cancelled").length,createdAt:volunteer.createdAt};}
async function queueTourEmail(site,to,subject,text,meta={}){if(!to)return null;const email={id:randomUUID(),to,subject,text,status:"queued",createdAt:new Date().toISOString(),...meta};site.emailOutbox.push(email);const webhook=String(process.env.EMAIL_WEBHOOK_URL||"").trim();if(webhook){try{const response=await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json",...(process.env.EMAIL_WEBHOOK_TOKEN?{Authorization:`Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}`}:{})},body:JSON.stringify({to,subject,text,meta}),signal:AbortSignal.timeout(10_000)});email.status=response.ok?"sent":"failed";email.deliveredAt=response.ok?new Date().toISOString():undefined;email.error=response.ok?undefined:`HTTP ${response.status}`;}catch(error){email.status="failed";email.error=error.message;}}return email;}
async function volunteerAdmin(req,res,volunteerId){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const site=ensureWebsite(selected.tenant);if(req.method==="GET")return json(res,200,{volunteers:site.volunteers.map(item=>volunteerView(item,site)),emailDeliveryConfigured:Boolean(process.env.EMAIL_WEBHOOK_URL)});if(req.method==="DELETE"){const volunteer=site.volunteers.find(item=>item.id===volunteerId);if(!volunteer)return json(res,404,{error:"Vrijwilliger niet gevonden."});volunteer.active=false;site.volunteerAvailability=site.volunteerAvailability.filter(item=>item.volunteerId!==volunteer.id);await saveTenantDb(selected.ctx.db);return json(res,200,{ok:true});}const input=await body(req),firstName=String(input.firstName||"").trim(),lastName=String(input.lastName||"").trim(),email=String(input.email||"").trim().toLowerCase(),phone=String(input.phone||"").trim(),password=String(input.password||"");if(!firstName||!lastName||!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return json(res,400,{error:"Vul naam, geldig e-mailadres en een wachtwoord van minimaal 8 tekens in."});if(site.volunteers.some(item=>item.active!==false&&item.email===email))return json(res,409,{error:"Dit e-mailadres is al als vrijwilliger geregistreerd."});site.volunteers.push({id:randomUUID(),firstName,lastName,email,phone,passwordHash:passwordHash(password),active:true,createdAt:new Date().toISOString()});await saveTenantDb(selected.ctx.db);json(res,201,{volunteers:site.volunteers.map(item=>volunteerView(item,site))});}
async function volunteerLogin(req,res){const input=await body(req),email=String(input.email||"").trim().toLowerCase(),db=await tenantDb();for(const tenant of db.tenants){const site=ensureWebsite(tenant),volunteer=site.volunteers.find(item=>item.active!==false&&item.email===email);if(volunteer&&passwordMatches(String(input.password||""),volunteer.passwordHash)){setSession(res,{role:"volunteer",tenantId:tenant.id,volunteerId:volunteer.id});return json(res,200,{redirect:"/vrijwilligersportaal.html"});}}json(res,401,{error:"E-mailadres of wachtwoord is onjuist."});}
async function volunteerPortal(req,res){const session=sessionFrom(req);if(!session||session.role!=="volunteer")return json(res,401,{error:"Log opnieuw in als vrijwilliger."});const db=await tenantDb(),tenant=db.tenants.find(item=>item.id===session.tenantId);if(!tenant)return json(res,401,{error:"Moskee niet gevonden."});const site=ensureWebsite(tenant),volunteer=site.volunteers.find(item=>item.id===session.volunteerId&&item.active!==false);if(!volunteer)return json(res,401,{error:"Vrijwilliger niet gevonden."});if(req.method==="PUT"){const input=await body(req),allowed=new Set(site.tourSlots.filter(slot=>slot.active!==false&&new Date(slot.start)>new Date()).map(slot=>slot.id)),slotIds=[...new Set(Array.isArray(input.slotIds)?input.slotIds.map(String):[])].filter(id=>allowed.has(id));site.volunteerAvailability=site.volunteerAvailability.filter(item=>item.volunteerId!==volunteer.id);site.volunteerAvailability.push(...slotIds.map(slotId=>({volunteerId:volunteer.id,slotId,updatedAt:new Date().toISOString()})));await saveTenantDb(db);}const available=new Set(site.volunteerAvailability.filter(item=>item.volunteerId===volunteer.id).map(item=>item.slotId)),slots=site.tourSlots.filter(slot=>slot.active!==false&&new Date(slot.start)>new Date()).sort((a,b)=>String(a.start).localeCompare(String(b.start))).map(slot=>({...slot,available:available.has(slot.id),assigned:site.tourRequests.some(request=>request.slotId===slot.id&&request.hostId===volunteer.id&&request.status!=="cancelled")}));json(res,200,{organization:tenant.organization,volunteer:volunteerView(volunteer,site),slots});}
async function requestTourWithHost(req,res,slug){const db=await tenantDb(),tenant=db.tenants.find(item=>item.slug===slug);if(!tenant)return json(res,404,{error:"Moskee niet gevonden."});const input=await body(req),site=ensureWebsite(tenant),slot=site.tourSlots.find(item=>item.id===String(input.slotId||"")&&item.active!==false),name=String(input.name||"").trim(),email=String(input.email||"").trim().toLowerCase(),groupSize=Number(input.groupSize||1);if(!slot)return json(res,400,{error:"Kies een beschikbaar rondleidingsmoment."});if(!name||!/^\S+@\S+\.\S+$/.test(email)||!Number.isInteger(groupSize)||groupSize<1||groupSize>100)return json(res,400,{error:"Vul naam, e-mailadres en groepsgrootte correct in."});const hosts=eligibleHosts(site,slot.id).sort((a,b)=>site.tourRequests.filter(item=>item.hostId===a.id).length-site.tourRequests.filter(item=>item.hostId===b.id).length),host=hosts[0];if(!host)return json(res,409,{error:"Dit moment is zojuist niet meer beschikbaar. Kies een ander moment."});const reserved=site.tourRequests.filter(item=>item.slotId===slot.id&&item.status!=="cancelled").reduce((sum,item)=>sum+item.groupSize,0),capacity=Number(slot.capacity||30);if(reserved+groupSize>capacity)return json(res,409,{error:"Dit moment heeft onvoldoende vrije plaatsen."});const request={id:randomUUID(),slotId:slot.id,name,email,phone:String(input.phone||"").trim(),organization:String(input.organization||"").trim(),groupSize,message:String(input.message||"").trim(),hostId:host.id,hostName:`${host.firstName} ${host.lastName}`.trim(),status:"assigned",createdAt:new Date().toISOString()};site.tourRequests.push(request);const when=new Intl.DateTimeFormat("nl-NL",{dateStyle:"full",timeStyle:"short",timeZone:"Europe/Amsterdam"}).format(new Date(slot.start));await queueTourEmail(site,email,`Bevestiging rondleiding bij ${tenant.organization}`,`Beste ${name},\n\nUw rondleiding op ${when} is aangevraagd. Uw gastheer is ${request.hostName}.\n\nMet vriendelijke groet,\n${tenant.organization}`,{type:"tour_guest",requestId:request.id});await queueTourEmail(site,host.email,`Nieuwe rondleiding toegewezen op ${when}`,`Hallo ${host.firstName},\n\nEr is een rondleiding aan u toegewezen op ${when}.\nBezoeker: ${name}\nOrganisatie: ${request.organization||"Niet opgegeven"}\nGroepsgrootte: ${groupSize}\n\nLog in op het vrijwilligersportaal voor het overzicht.`,{type:"tour_host",requestId:request.id});await saveTenantDb(db);json(res,201,{ok:true,hostName:request.hostName,message:`De rondleidingsaanvraag is ontvangen. Uw gastheer is ${request.hostName}.`});}

function ensureMembership(tenant){tenant.members||=[];tenant.products||=[];tenant.receipts||=[];tenant.memberPayments||=[];tenant.donorVerifications||=[];return tenant;}
function splitLegacyName(member){const parts=String(member.name||"").trim().split(/\s+/);return{firstName:member.firstName||parts.shift()||"",lastName:member.lastName||parts.join(" ")||""};}
function memberView(member){const names=splitLegacyName(member);return{id:member.id,memberNumber:member.memberNumber,firstName:names.firstName,lastName:names.lastName,name:`${names.firstName} ${names.lastName}`.trim(),email:member.email||"",phone:member.phone||"",iban:member.iban||"",ibanStatus:member.ibanStatus||((member.iban||"")?"manual":"missing"),address:member.address||"",postalCode:member.postalCode||"",city:member.city||"",profession:member.profession||"",notes:member.notes||"",portalActive:Boolean(member.passwordHash),createdAt:member.createdAt,subscriptions:member.subscriptions||[]};}
function productView(product){return{id:product.id,name:product.name,description:product.description||"",amountCents:product.amountCents,billingMonths:product.billingMonths,active:product.active!==false};}
function nextMemberNumber(db){const used=new Set(db.tenants.flatMap(t=>(t.members||[]).map(m=>m.memberNumber)));let value;do{value=`OM-${randomBytes(4).toString("hex").toUpperCase()}`}while(used.has(value));return value;}
function cleanIban(value){return String(value||"").replace(/\s+/g,"").toUpperCase();}
function validIban(value){return !value||/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value);}
function donorFields(input){const iban=cleanIban(input.iban);return{firstName:String(input.firstName||"").trim(),lastName:String(input.lastName||"").trim(),email:String(input.email||"").trim().toLowerCase(),phone:String(input.phone||"").trim(),iban,address:String(input.address||"").trim(),postalCode:String(input.postalCode||"").trim(),city:String(input.city||"").trim(),profession:String(input.profession||"").trim(),notes:String(input.notes||"").trim()};}
function monthKey(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-01`;}
function addMonths(key,count){const [year,month]=key.split("-").map(Number),date=new Date(Date.UTC(year,month-1+count,1));return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-01`;}

async function memberRegister(req,res,slug){const db=await tenantDb(),found=db.tenants.find(t=>t.slug===slug);if(!found)return json(res,404,{error:"Moskee niet gevonden."});const tenant=ensureMembership(found);const input=await body(req),fields=donorFields(input),password=String(input.password||""),productIds=[...new Set(Array.isArray(input.productIds)?input.productIds:[])],selectedProducts=tenant.products.filter(p=>productIds.includes(p.id)&&p.active!==false);if(!fields.firstName||!fields.lastName||!/^\S+@\S+\.\S+$/.test(fields.email)||password.length<8||!validIban(fields.iban))return json(res,400,{error:"Vul voornaam, achternaam en een geldig e-mailadres in; gebruik minimaal 8 tekens als wachtwoord."});if(productIds.length!==selectedProducts.length)return json(res,400,{error:"Een geselecteerd donatieproduct is niet beschikbaar."});if(tenant.members.some(m=>m.email===fields.email))return json(res,409,{error:"Dit e-mailadres is al als donateur geregistreerd."});const now=new Date().toISOString(),member={id:randomUUID(),memberNumber:nextMemberNumber(db),...fields,name:`${fields.firstName} ${fields.lastName}`,ibanStatus:fields.iban?"manual":"missing",passwordHash:passwordHash(password),createdAt:now,subscriptions:selectedProducts.map(product=>({id:randomUUID(),productId:product.id,active:true,nextBilling:monthKey(),startedAt:now}))};tenant.members.push(member);await saveTenantDb(db);setSession(res,{role:"member",tenantId:tenant.id,memberId:member.id});json(res,201,{member:memberView(member),redirect:`/ledenportaal.html`});}

async function memberLogin(req,res){const{memberNumber,password}=await body(req),db=await tenantDb();for(const tenant of db.tenants){const member=(tenant.members||[]).find(m=>m.memberNumber===String(memberNumber||"").trim().toUpperCase());if(member&&passwordMatches(String(password||""),member.passwordHash)){setSession(res,{role:"member",tenantId:tenant.id,memberId:member.id});return json(res,200,{redirect:"/ledenportaal.html"});}}json(res,401,{error:"Donateursnummer of wachtwoord is onjuist."});}

async function membershipAdmin(req,res,resource){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const tenant=ensureMembership(selected.tenant);
  if(req.method==="GET")return json(res,200,resource==="members"?{members:tenant.members.map(memberView),products:tenant.products.filter(p=>p.active!==false).map(productView)}:resource==="products"?{products:tenant.products.map(productView)}:{receipts:tenant.receipts,members:tenant.members.map(memberView)});
  const input=await body(req);
  if(resource==="members"){const fields=donorFields(input);if(!fields.firstName||!fields.lastName||!validIban(fields.iban)||fields.email&&!/^\S+@\S+\.\S+$/.test(fields.email))return json(res,400,{error:"Voornaam en achternaam zijn verplicht. Controleer e-mail en IBAN."});if(fields.email&&tenant.members.some(m=>m.email===fields.email))return json(res,409,{error:"Dit e-mailadres bestaat al."});const member={id:randomUUID(),memberNumber:nextMemberNumber(selected.ctx.db),...fields,name:`${fields.firstName} ${fields.lastName}`,ibanStatus:fields.iban?"manual":"missing",createdAt:new Date().toISOString(),subscriptions:[]};tenant.members.push(member);await saveTenantDb(selected.ctx.db);return json(res,201,{member:memberView(member)});}
  if(resource==="products"){const amountCents=Math.round(Number(input.amount)*100),billingMonths=Number(input.billingMonths);if(!String(input.name||"").trim()||amountCents<1||![1,3,6,12].includes(billingMonths))return json(res,400,{error:"Controleer naam, bedrag en periode."});tenant.products.push({id:randomUUID(),name:String(input.name).trim(),description:String(input.description||"").trim(),amountCents,billingMonths,active:true});}
  if(resource==="subscriptions"){const member=tenant.members.find(m=>m.id===input.memberId),product=tenant.products.find(p=>p.id===input.productId);if(!member||!product)return json(res,404,{error:"Donateur of toezegging niet gevonden."});member.subscriptions||=[];if(member.subscriptions.some(s=>s.productId===product.id&&s.active))return json(res,409,{error:"Deze toezegging staat al op naam van de donateur."});member.subscriptions.push({id:randomUUID(),productId:product.id,active:true,nextBilling:monthKey(),startedAt:new Date().toISOString()});}
  await saveTenantDb(selected.ctx.db);json(res,201,{ok:true});}

async function updateDonor(req,res,donorId){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const tenant=ensureMembership(selected.tenant),member=tenant.members.find(m=>m.id===donorId);if(!member)return json(res,404,{error:"Donateur niet gevonden."});const input=await body(req),fields=donorFields(input);if(!fields.firstName||!fields.lastName||!validIban(fields.iban)||fields.email&&!/^\S+@\S+\.\S+$/.test(fields.email))return json(res,400,{error:"Voornaam en achternaam zijn verplicht. Controleer e-mail en IBAN."});if(fields.email&&tenant.members.some(m=>m.id!==member.id&&m.email===fields.email))return json(res,409,{error:"Dit e-mailadres bestaat al."});Object.assign(member,fields,{name:`${fields.firstName} ${fields.lastName}`,ibanStatus:fields.iban?(member.ibanStatus==="verified"?"verified":"manual"):member.ibanStatus==="verified"?"verified":"missing",updatedAt:new Date().toISOString()});await saveTenantDb(selected.ctx.db);json(res,200,{member:memberView(member)});}

async function importDonors(req,res){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const tenant=ensureMembership(selected.tenant),input=await body(req,8_000_000),csv=String(input.csv||"");if(!csv||Buffer.byteLength(csv,"utf8")>5_000_000)return json(res,400,{error:"Kies een CSV-bestand van maximaal 5 MB."});const inspected=inspectDonorCsv(csv,tenant.members);if(inspected.error)return json(res,400,inspected);if(input.mode!=="commit")return json(res,200,inspected);const batchId=randomUUID(),now=new Date().toISOString(),validRows=inspected.rows.filter(row=>row.status==="valid");for(const row of validRows){const fields=donorFields(row.data);tenant.members.push({id:randomUUID(),memberNumber:nextMemberNumber(selected.ctx.db),...fields,name:`${fields.firstName} ${fields.lastName}`,ibanStatus:fields.iban?"manual":"missing",createdAt:now,subscriptions:[],import:{source:"legacy-csv",batchId,row:row.row,importedAt:now}});}await saveTenantDb(selected.ctx.db);json(res,201,{imported:validRows.length,skipped:inspected.summary.errors,batchId,summary:inspected.summary});}

async function donorVerificationLink(req,res,donorId){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const tenant=ensureMembership(selected.tenant),member=tenant.members.find(m=>m.id===donorId);if(!member)return json(res,404,{error:"Donateur niet gevonden."});const apiKey=process.env.MULTISAFEPAY_API_KEY;if(!apiKey)return json(res,503,{error:"MultiSafepay is niet geconfigureerd."});const names=splitLegacyName(member),orderId=`iban-${Date.now()}-${randomUUID().slice(0,8)}`,baseUrl=(process.env.MULTISAFEPAY_API_URL||"https://api.multisafepay.com/v1/json").replace(/\/$/,""),publicUrl=(process.env.PUBLIC_BASE_URL||"").replace(/\/$/,"");const paymentOptions={};if(publicUrl){paymentOptions.notification_url=`${publicUrl}/api/payments/webhook`;paymentOptions.notification_method="POST";paymentOptions.redirect_url=`${publicUrl}/ledenportaal.html`;}const payload={type:"paymentlink",gateway:"IDEAL",order_id:orderId,currency:"EUR",amount:100,description:`Bankrekening verificatie ${tenant.organization}`,days_active:7,payment_options:paymentOptions,customer:{first_name:names.firstName,last_name:names.lastName,email:member.email||undefined,country:"NL",locale:"nl_NL",disable_send_email:!member.email}};const upstream=await fetch(`${baseUrl}/orders?api_key=${encodeURIComponent(apiKey)}`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}),result=await upstream.json().catch(()=>({}));const paymentUrl=result.data?.payment_url;if(!upstream.ok||!result.success||!paymentUrl){await logError("Donateurverificatie mislukt",{httpStatus:upstream.status,result});return json(res,502,{error:result.error_info||"De betaallink kon niet worden aangemaakt."});}tenant.donorVerifications.push({orderId,memberId:member.id,amountCents:100,status:"pending",paymentUrl,createdAt:new Date().toISOString(),emailSent:Boolean(member.email)});await saveTenantDb(selected.ctx.db);json(res,201,{orderId,paymentUrl,emailSent:Boolean(member.email)});}

async function removeProduct(req,res,productId){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const tenant=ensureMembership(selected.tenant),product=tenant.products.find(p=>p.id===productId);if(!product)return json(res,404,{error:"Product niet gevonden."});product.active=false;product.archivedAt=new Date().toISOString();for(const member of tenant.members){for(const subscription of member.subscriptions||[]){if(subscription.productId===productId)subscription.active=false;}}await saveTenantDb(selected.ctx.db);json(res,200,{ok:true,message:"Product gearchiveerd."});}

async function generateReceiptsForTenant(tenant,through=monthKey()){ensureMembership(tenant);let created=0;for(const member of tenant.members){for(const subscription of member.subscriptions||[]){if(!subscription.active)continue;const product=tenant.products.find(p=>p.id===subscription.productId&&p.active!==false);if(!product)continue;while(subscription.nextBilling<=through){const periodKey=subscription.nextBilling;if(!tenant.receipts.some(r=>r.subscriptionId===subscription.id&&r.periodKey===periodKey)){tenant.receipts.push({id:randomUUID(),number:`KW-${new Date().getFullYear()}-${String(tenant.receipts.length+1).padStart(5,"0")}`,memberId:member.id,productId:product.id,subscriptionId:subscription.id,periodKey,description:product.name,amountCents:product.amountCents,status:"draft",createdAt:new Date().toISOString()});created++;}subscription.nextBilling=addMonths(subscription.nextBilling,product.billingMonths);}}}return created;}

async function runReceiptCycle(){const db=await tenantDb();let created=0;for(const tenant of db.tenants)created+=await generateReceiptsForTenant(tenant);if(created)await saveTenantDb(db);return created;}

async function receiptAction(req,res){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});ensureMembership(selected.tenant);if(req.url.includes("/generate")){const created=await generateReceiptsForTenant(selected.tenant);await saveTenantDb(selected.ctx.db);return json(res,200,{created});}const drafts=selected.tenant.receipts.filter(r=>r.status==="draft");for(const receipt of drafts){receipt.status="sent";receipt.sentAt=new Date().toISOString();}await saveTenantDb(selected.ctx.db);json(res,200,{sent:drafts.length,emailDelivery:"pending_provider"});}

async function memberPortal(req,res){const ctx=await portalContext(req);if(!ctx||ctx.session.role!=="member")return json(res,401,{error:"Log opnieuw in als donateur."});const tenant=ensureMembership(ctx.tenant),member=tenant.members.find(m=>m.id===ctx.session.memberId);if(!member)return json(res,401,{error:"Donateur niet gevonden."});const receipts=tenant.receipts.filter(r=>r.memberId===member.id&&["sent","pending","paid","cancelled"].includes(r.status)).sort((a,b)=>String(b.periodKey).localeCompare(String(a.periodKey)));json(res,200,{member:memberView(member),organization:tenant.organization,receipts,periodicGift:member.periodicGift||null});}
async function periodicGift(req,res){const ctx=await portalContext(req);if(!ctx||ctx.session.role!=="member")return json(res,401,{error:"Log opnieuw in als donateur."});const tenant=ensureMembership(ctx.tenant),member=tenant.members.find(m=>m.id===ctx.session.memberId);if(!member)return json(res,404,{error:"Donateur niet gevonden."});const site=ensureWebsite(tenant),institution={name:site.anbi?.legalName||tenant.organization,rsin:site.anbi?.rsin||"",address:site.contact?.address||"",postalCode:site.contact?.postalCode||"",city:site.contact?.city||tenant.city||""};if(req.method==="GET")return json(res,200,{member:memberView(member),organization:tenant.organization,institution,agreement:member.periodicGift||null});const input=await body(req),annualAmountCents=Math.round(Number(input.annualAmount||0)*100),durationYears=Number(input.durationYears),startDate=String(input.startDate||""),signatureName=String(input.signatureName||"").trim();if(!Number.isInteger(annualAmountCents)||annualAmountCents<100||annualAmountCents>100_000_000)return json(res,400,{error:"Vul een geldig jaarlijks giftbedrag in."});if(!Number.isInteger(durationYears)||durationYears<5||durationYears>99)return json(res,400,{error:"De looptijd moet minimaal 5 jaar zijn."});if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||Date.parse(startDate)<Date.now()-86400000)return json(res,400,{error:"Kies een geldige datum voor de eerste gift."});if(!input.accepted||signatureName.toLowerCase()!==memberView(member).name.toLowerCase())return json(res,400,{error:"Onderteken met uw volledige naam en accepteer de verklaring."});const transactionNumber=`${Date.now()}${String(Math.floor(Math.random()*100)).padStart(2,"0")}`.slice(-15);member.periodicGift={transactionNumber,annualAmountCents,durationYears,startDate,signatureName,signedAt:new Date().toISOString(),status:"signed"};await saveTenantDb(ctx.db);json(res,201,{agreement:member.periodicGift,institution});}

async function updateMemberProfile(req,res){const ctx=await portalContext(req);if(!ctx||ctx.session.role!=="member")return json(res,401,{error:"Log opnieuw in als donateur."});const tenant=ensureMembership(ctx.tenant),member=tenant.members.find(m=>m.id===ctx.session.memberId);if(!member)return json(res,404,{error:"Donateur niet gevonden."});const input=await body(req),fields=donorFields({...member,...input});if(!fields.firstName||!fields.lastName||!validIban(fields.iban)||fields.email&&!/^\S+@\S+\.\S+$/.test(fields.email))return json(res,400,{error:"Controleer uw naam, e-mailadres en IBAN."});if(fields.email&&tenant.members.some(m=>m.id!==member.id&&m.email===fields.email))return json(res,409,{error:"Dit e-mailadres wordt al gebruikt."});Object.assign(member,fields,{name:`${fields.firstName} ${fields.lastName}`,ibanStatus:fields.iban?(member.ibanStatus==="verified"?"verified":"manual"):member.ibanStatus==="verified"?"verified":"missing",updatedAt:new Date().toISOString()});await saveTenantDb(ctx.db);json(res,200,{member:memberView(member)});}

async function createMemberPayment(req,res){const ctx=await portalContext(req);if(!ctx||ctx.session.role!=="member")return json(res,401,{error:"Log opnieuw in als lid."});const tenant=ensureMembership(ctx.tenant),input=await body(req),ids=[...new Set(input.receiptIds||[])],receipts=tenant.receipts.filter(r=>ids.includes(r.id)&&r.memberId===ctx.session.memberId&&r.status==="sent");if(!receipts.length||receipts.length!==ids.length)return json(res,400,{error:"Selecteer geldige openstaande kwitanties."});const amount=receipts.reduce((sum,r)=>sum+r.amountCents,0),apiKey=process.env.MULTISAFEPAY_API_KEY,terminalId=process.env.MULTISAFEPAY_TERMINAL_ID;if(!apiKey||!terminalId)return json(res,503,{error:"De betaalterminal is niet geconfigureerd."});const orderId=`lid-${Date.now()}-${randomUUID().slice(0,8)}`,baseUrl=(process.env.MULTISAFEPAY_API_URL||"https://api.multisafepay.com/v1/json").replace(/\/$/,""),publicUrl=(process.env.PUBLIC_BASE_URL||"").replace(/\/$/,""),expiresAt=new Date(Date.now()+50_000).toISOString();const payload={type:"redirect",order_id:orderId,currency:"EUR",amount,description:`Kwitantiebetaling ${tenant.organization}`,payment_options:publicUrl?{notification_url:`${publicUrl}/api/payments/webhook`,notification_method:"POST"}:undefined,gateway_info:{terminal_id:terminalId}};const upstream=await fetch(`${baseUrl}/orders?api_key=${encodeURIComponent(apiKey)}`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}),result=await upstream.json().catch(()=>({}));if(!upstream.ok||!result.success)return json(res,502,{error:"De pinautomaat kon niet worden gestart."});for(const receipt of receipts)receipt.status="pending";tenant.memberPayments.push({orderId,memberId:ctx.session.memberId,receiptIds:ids,amountCents:amount,status:"pending",createdAt:new Date().toISOString(),expiresAt});await saveTenantDb(ctx.db);json(res,201,{orderId,amountCents:amount,expiresAt});}

async function _expireMemberPayments(){const db=await tenantDb(),apiKey=process.env.MULTISAFEPAY_API_KEY,baseUrl=(process.env.MULTISAFEPAY_API_URL||"https://api.multisafepay.com/v1/json").replace(/\/$/,""),now=Date.now();let changed=false;for(const tenant of db.tenants){ensureMembership(tenant);for(const payment of tenant.memberPayments){if(payment.status!=="pending"||Date.parse(payment.expiresAt||payment.createdAt)+(!payment.expiresAt?50_000:0)>now)continue;let orderStatus="";try{if(apiKey){const lookup=await fetch(`${baseUrl}/orders/${encodeURIComponent(payment.orderId)}?api_key=${encodeURIComponent(apiKey)}`,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)}),order=await lookup.json().catch(()=>({}));orderStatus=order.data?.status||"";if(orderStatus!=="completed"){const cancelId=order.data?.transaction_id||payment.orderId;await fetch(`${baseUrl}/orders/${encodeURIComponent(cancelId)}/cancel?api_key=${encodeURIComponent(apiKey)}`,{method:"POST",headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)}).catch(()=>{});}}}catch(error){await logError("Timeoutcontrole ledenbetaling",{orderId:payment.orderId,message:error.message});}if(orderStatus==="completed"){payment.status="paid";payment.paidAt=new Date().toISOString();for(const receipt of tenant.receipts.filter(r=>payment.receiptIds.includes(r.id))){receipt.status="paid";receipt.paidAt=payment.paidAt;}}else{payment.status="expired";payment.expiredAt=new Date().toISOString();for(const receipt of tenant.receipts.filter(r=>payment.receiptIds.includes(r.id)&&r.status==="pending"))receipt.status="sent";}changed=true;}}if(changed)await saveTenantDb(db);return changed;}
let expiryCheckRunning=false;
async function expireMemberPayments(){if(expiryCheckRunning)return false;expiryCheckRunning=true;try{return await _expireMemberPayments();}finally{expiryCheckRunning=false;}}

async function paymentWebhook(req,res,url){const orderId=url.searchParams.get("transactionid");if(!orderId)return json(res,200,{ok:true});const apiKey=process.env.MULTISAFEPAY_API_KEY,baseUrl=(process.env.MULTISAFEPAY_API_URL||"https://api.multisafepay.com/v1/json").replace(/\/$/,"");if(!apiKey)return json(res,200,{ok:true});const upstream=await fetch(`${baseUrl}/orders/${encodeURIComponent(orderId)}?api_key=${encodeURIComponent(apiKey)}`,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)}),result=await upstream.json().catch(()=>({})),status=result.data?.status;if(status==="completed"){const db=await tenantDb();for(const tenant of db.tenants){ensureMembership(tenant);const payment=tenant.memberPayments.find(p=>p.orderId===orderId);if(payment){payment.status="paid";payment.paidAt=new Date().toISOString();for(const receipt of tenant.receipts.filter(r=>payment.receiptIds.includes(r.id))){receipt.status="paid";receipt.paidAt=payment.paidAt;}await saveTenantDb(db);break;}const verification=tenant.donorVerifications.find(p=>p.orderId===orderId);if(verification){verification.status="paid";verification.paidAt=new Date().toISOString();const member=tenant.members.find(m=>m.id===verification.memberId);if(member){member.ibanStatus="verified";member.bankVerifiedAt=verification.paidAt;}await saveTenantDb(db);break;}}}return json(res,200,{ok:true});}

async function body(req, limit = 10_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Request te groot");
  }
  return JSON.parse(raw || "{}");
}

function isAdmin(req) {
  return Boolean(process.env.ADMIN_PIN && req.headers["x-admin-pin"] === process.env.ADMIN_PIN);
}

async function saveConfig(next) {
  const temp = `${configFile}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temp, configFile);
}

async function updateSettings(req, res) {
  if (!isAdmin(req)) return json(res, 401, { error: "Onjuiste beheer-PIN." });
  const incoming = await body(req);
  const current = await config();
  const amounts = [...new Set(incoming.amounts || [])].map(Number).sort((a, b) => a - b);
  const organization = String(incoming.organization || "").trim();
  const prayerCity = String(incoming.prayerCity || "").trim();
  const prayerCountry = String(incoming.prayerCountry || "").trim();
  if (!organization || organization.length > 80 || !prayerCity || !prayerCountry) return json(res, 400, { error: "Vul alle organisatie- en locatiegegevens in." });
  if (!amounts.length || amounts.length > 12 || amounts.some(v => !Number.isInteger(v) || v < 1 || v > 5000)) return json(res, 400, { error: "Gebruik 1–12 hele bedragen tussen €1 en €5.000." });
  const next = { ...current, organization, amounts, prayerCity, prayerCountry };
  await saveConfig(next); json(res, 200, next);
}

async function uploadAsset(req, res) {
  if (!isAdmin(req)) return json(res, 401, { error: "Onjuiste beheer-PIN." });
  const { kind, mimeType, data } = await body(req, 140_000_000);
  const allowed = kind === "logo" ? { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } : { "video/mp4": "mp4", "video/webm": "webm" };
  const extension = allowed[mimeType];
  if (!extension || !["logo", "video"].includes(kind)) return json(res, 400, { error: "Dit bestandstype wordt niet ondersteund." });
  const buffer = Buffer.from(String(data || ""), "base64");
  const max = kind === "logo" ? 3_000_000 : 100_000_000;
  if (!buffer.length || buffer.length > max) return json(res, 400, { error: `${kind === "logo" ? "Logo" : "Video"} is te groot.` });
  const relative = `/media/${kind}.${extension}`;
  await mkdir(join(publicDir, "media"), { recursive: true });
  await writeFile(join(publicDir, relative.slice(1)), buffer);
  const current = await config(); current[kind] = `${relative}?v=${Date.now()}`; await saveConfig(current);
  json(res, 200, { url: current[kind] });
}

async function prayerTimes(res, tenantSlug) {
  const tenant = await tenantBySlug(tenantSlug);
  const settings = tenant?.settings || await config();
  const city = settings.prayerCity || "Amsterdam", country = settings.prayerCountry || "NL";
  const cacheKey = `${city.toLowerCase()}|${country.toUpperCase()}|${new Date().toISOString().slice(0,10)}`;
  const shape = (result, source) => { const t=result.data.timings; return { location:city, date:result.data.date.readable, hijri:result.data.date.hijri.date, source, timings:{Fajr:t.Fajr,Sunrise:t.Sunrise,Dhuhr:t.Dhuhr,Asr:t.Asr,Maghrib:t.Maghrib,Isha:t.Isha} }; };
  try {
    const byCity = new URL("https://api.aladhan.com/v1/timingsByCity");
    byCity.searchParams.set("city", city); byCity.searchParams.set("country", country);
    const response = await fetch(byCity, { signal: AbortSignal.timeout(8_000) }), result = await response.json();
    if (response.ok && result.code === 200) { const value=shape(result,"city");prayerCache.set(cacheKey,value);return json(res,200,value); }
    throw new Error(`AlAdhan city lookup: ${response.status}`);
  } catch (cityError) {
    try {
      const geocode = new URL("https://geocoding-api.open-meteo.com/v1/search");
      geocode.searchParams.set("name",city);geocode.searchParams.set("countryCode",country);geocode.searchParams.set("count","1");geocode.searchParams.set("language","nl");geocode.searchParams.set("format","json");
      const geoResponse=await fetch(geocode,{signal:AbortSignal.timeout(8_000)}),geo=await geoResponse.json(),place=geo.results?.[0];
      if(!geoResponse.ok||!place)throw new Error(`Geocoding: ${geoResponse.status}`);
      const byCoordinates=new URL("https://api.aladhan.com/v1/timings");byCoordinates.searchParams.set("latitude",place.latitude);byCoordinates.searchParams.set("longitude",place.longitude);byCoordinates.searchParams.set("method","3");
      const response=await fetch(byCoordinates,{signal:AbortSignal.timeout(8_000)}),result=await response.json();
      if(!response.ok||result.code!==200)throw new Error(`AlAdhan coordinates: ${response.status}`);
      const value=shape(result,"coordinates");prayerCache.set(cacheKey,value);return json(res,200,value);
    } catch (fallbackError) {
      const cached=prayerCache.get(cacheKey);if(cached)return json(res,200,{...cached,cached:true});
      await logError("Gebedstijden ophalen mislukt",{city,country,primary:cityError.message,fallback:fallbackError.message});
      return json(res,502,{error:"Gebedstijden zijn tijdelijk niet beschikbaar.",detail:"Zowel de plaatsnaam- als coördinatenservice is onbereikbaar."});
    }
  }
}

function startCcvPayment(tenant, amount) {
  const terminal=tenant?.integrations?.paymentTerminal,ip=String(terminal?.ipAddress||"").trim(),port=Number(terminal?.port||4100);
  if(!ip)return{error:"Vul eerst het IP-adres van de CCV-pinautomaat in bij Koppelingen."};
  const orderId=`donatie-${Date.now()}-${randomUUID().slice(0,8)}`,helper=join(root,"tools","ccv-bridge","CcvBridge.exe"),controllerDir=process.env.CCV_CONTROLLER_DIR||"C:\\Codex\\OrangePOS\\PaymentController";
  const child=spawn(helper,["pay",ip,String(port),Number(amount).toFixed(2)],{cwd:join(root,"tools","ccv-bridge"),env:{...process.env,CCV_CONTROLLER_DIR:controllerDir},windowsHide:true,stdio:["pipe","pipe","pipe"]});
  const payment={orderId,tenantId:tenant.id,status:"pending",message:"Betaling wordt gestart…",createdAt:new Date().toISOString(),child,output:""};ccvPayments.set(orderId,payment);
  child.stderr.on("data",chunk=>{const line=String(chunk).trim().split(/\r?\n/).filter(Boolean).pop();if(line)payment.message=line.replace(/^[A-Z_]+\s*/,"")||line;});
  child.stdout.on("data",chunk=>payment.output+=String(chunk));
  child.on("error",error=>{payment.status="failed";payment.message=error.message;payment.completedAt=new Date().toISOString();updateDonationRecord(payment.tenantId,orderId,{status:"failed",message:payment.message,completedAt:payment.completedAt}).catch(saveError=>logError("Donatiestatus opslaan",saveError));});
  child.on("close",code=>{let result={};try{result=JSON.parse(payment.output.trim().split(/\r?\n/).filter(Boolean).pop()||"{}");}catch{}payment.status=code===0&&result.success?"completed":payment.status==="cancel_requested"?"cancelled":"failed";payment.message=payment.status==="completed"?"Betaling voltooid.":payment.status==="cancelled"?"Betaling geannuleerd.":result.error||payment.message||"CCV-betaling mislukt.";payment.completedAt=new Date().toISOString();payment.child=null;updateDonationRecord(payment.tenantId,orderId,{status:payment.status,message:payment.message,completedAt:payment.completedAt}).catch(error=>logError("Donatiestatus opslaan",error));setTimeout(()=>ccvPayments.delete(orderId),10*60*1000);});
  return{orderId};
}

async function createPayment(req, res) {
  const { amount, tenant: tenantSlug } = await body(req);
  const tenant = await tenantBySlug(tenantSlug);
  const settings = tenant?.settings || await config();
  if (!settings.amounts.includes(amount)) return json(res, 400, { error: "Kies een toegestaan bedrag." });

  if(!tenant)return json(res,400,{error:"Open het unieke donatiescherm van de moskee om de CCV-terminal te gebruiken."});
  const started=startCcvPayment(tenant,amount);if(started.error)return json(res,503,{error:started.error,code:"NOT_CONFIGURED"});const donation={id:randomUUID(),orderId:started.orderId,amountCents:amount*100,currency:settings.currency||"EUR",provider:"CCV",source:"kiosk",status:"pending",createdAt:new Date().toISOString()},db=await tenantDb(),stored=db.tenants.find(item=>item.id===tenant.id);if(stored){stored.donations||=[];stored.donations.push(donation);await saveTenantDb(db);}json(res,202,started);
}

async function cancelPayment(orderId, res) {
  if (!/^donatie-\d{13}-[a-f0-9]{8}$/.test(orderId)) {
    return json(res, 400, { error: "Ongeldige betaalopdracht." });
  }
  const payment=ccvPayments.get(orderId);if(!payment)return json(res,404,{error:"Deze CCV-betaalopdracht is niet meer actief."});if(payment.status!=="pending")return json(res,409,{error:"Deze betaling is al afgerond.",status:payment.status});payment.status="cancel_requested";payment.message="Annulering wordt naar de CCV-terminal gestuurd…";payment.child?.stdin.write("cancel\n");return json(res,200,{orderId,status:"cancel_requested"});
}

function paymentStatus(orderId,res){const payment=ccvPayments.get(orderId);if(!payment)return json(res,404,{error:"Betaalstatus niet gevonden."});json(res,200,{orderId,status:payment.status,message:payment.message});}

async function portalDonations(req,res){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const donations=(selected.tenant.donations||[]).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));const completed=donations.filter(item=>item.status==="completed"),totalCents=completed.reduce((sum,item)=>sum+Number(item.amountCents||0),0),today=new Date().toISOString().slice(0,10),todayCents=completed.filter(item=>String(item.completedAt||item.createdAt).slice(0,10)===today).reduce((sum,item)=>sum+Number(item.amountCents||0),0);json(res,200,{donations,summary:{count:completed.length,totalCents,todayCents,pending:donations.filter(item=>item.status==="pending"||item.status==="cancel_requested").length}});}
function monthlyDonationReport(tenant,month){ensureMembership(tenant);const inMonth=value=>String(value||"").slice(0,7)===month,loose=(tenant.donations||[]).filter(item=>item.status==="completed"&&inMonth(item.completedAt||item.createdAt)),recurring=(tenant.receipts||[]).filter(item=>item.status==="paid"&&inMonth(item.paidAt||item.createdAt));return{month,loose:{count:loose.length,amountCents:loose.reduce((sum,item)=>sum+Number(item.amountCents||0),0)},recurring:{count:recurring.length,amountCents:recurring.reduce((sum,item)=>sum+Number(item.amountCents||0),0)}};}
async function eboekRequest(path,options,apiToken){const sessionResponse=await fetch("https://api.e-boekhouden.nl/v1/session",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({accessToken:apiToken,source:"MoskeeApp"}),signal:AbortSignal.timeout(15000)}),session=await sessionResponse.json().catch(()=>({}));if(!sessionResponse.ok||!session.token)throw Error(session.message||session.title||"e-Boekhouden heeft het API-token geweigerd.");try{const response=await fetch(`https://api.e-boekhouden.nl/v1${path}`,{...options,headers:{Authorization:session.token,"Content-Type":"application/json",Accept:"application/json",...(options.headers||{})},signal:AbortSignal.timeout(20000)}),result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.message||result.title||result.error||`e-Boekhouden antwoordde met HTTP ${response.status}.`);return result;}finally{fetch("https://api.e-boekhouden.nl/v1/session",{method:"DELETE",headers:{Authorization:session.token},signal:AbortSignal.timeout(5000)}).catch(()=>{});}}
async function pushEboekMonth(tenant,month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error("Ongeldige rapportmaand.");tenant.integrations||={};const settings=tenant.integrations.eboekhouden||{};if(!settings.apiToken||!settings.bankLedgerId||!settings.looseLedgerId||!settings.recurringLedgerId)throw Error("Vul eerst het API-token en de drie grootboek-ID's in.");settings.syncedMonths||=[];if(settings.syncedMonths.some(item=>item.month===month))return{alreadySynced:true,report:monthlyDonationReport(tenant,month)};const report=monthlyDonationReport(tenant,month);if(!report.loose.count&&!report.recurring.count)return{empty:true,report};const [year,monthNumber]=month.split("-").map(Number),date=new Date(Date.UTC(year,monthNumber,0)).toISOString().slice(0,10),rows=[];if(report.loose.amountCents)rows.push({ledgerId:Number(settings.looseLedgerId),vatCode:"GEEN",amount:report.loose.amountCents/100,description:`${report.loose.count} losse donaties`});if(report.recurring.amountCents)rows.push({ledgerId:Number(settings.recurringLedgerId),vatCode:"GEEN",amount:report.recurring.amountCents/100,description:`${report.recurring.count} vaste donaties`});const result=await eboekRequest("/mutation",{method:"POST",body:JSON.stringify({type:"5",date,ledgerId:Number(settings.bankLedgerId),inExVat:"EX",description:`Donaties ${month}`,rows})},decryptSecret(settings.apiToken));const sync={month,mutationId:result.id||result.mutationId||null,report,syncedAt:new Date().toISOString()};settings.syncedMonths.push(sync);settings.lastSync=sync;return{sync,report};}
async function eboekPortal(req,res){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const input=await body(req),month=String(input.month||"");try{const result=await pushEboekMonth(selected.tenant,month);await saveTenantDb(selected.ctx.db);json(res,200,result);}catch(error){await logError("e-Boekhouden synchronisatie",{tenantId:selected.tenant.id,month,message:error.message});json(res,502,{error:error.message});}}
async function runEboekMonthlySync(){const db=await tenantDb(),date=new Date();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-1);const month=date.toISOString().slice(0,7);let changed=false;for(const tenant of db.tenants){const settings=tenant.integrations?.eboekhouden;if(!settings?.enabled||!settings.apiToken||settings.syncedMonths?.some(item=>item.month===month))continue;try{const result=await pushEboekMonth(tenant,month);if(result.sync)changed=true;}catch(error){await logError("Automatische e-Boekhouden synchronisatie",{tenantId:tenant.id,month,message:error.message});}}if(changed)await saveTenantDb(db);}
async function passwordVault(req,res){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const current=selected.tenant.passwordVault||null;if(req.method==="GET")return json(res,200,{configured:Boolean(current),vault:current});const input=await body(req,2_000_000),valid=value=>typeof value==="string"&&/^[A-Za-z0-9_-]+$/.test(value);if(input.version!==1||!valid(input.salt)||!valid(input.iv)||!valid(input.ciphertext)||input.salt.length>100||input.iv.length>100||input.ciphertext.length>1_500_000)return json(res,400,{error:"Ongeldige versleutelde kluisgegevens."});if(current&&String(input.expectedUpdatedAt||"")!==String(current.updatedAt||""))return json(res,409,{error:"De kluis is intussen ergens anders gewijzigd. Ontgrendel de pagina opnieuw."});selected.tenant.passwordVault={version:1,salt:input.salt,iv:input.iv,ciphertext:input.ciphertext,updatedAt:new Date().toISOString()};await saveTenantDb(selected.ctx.db);json(res,200,{configured:true,vault:selected.tenant.passwordVault});}
async function knowledgeBaseAdmin(req,res,pageId){const selected=await selectedTenant(req);if(!selected)return json(res,401,{error:"Log opnieuw in."});if(!selected.tenant)return json(res,404,{error:"Geen moskee geselecteerd."});const tenant=selected.tenant;tenant.knowledgeBase||={pages:[]};const pages=tenant.knowledgeBase.pages;if(req.method==="GET")return json(res,200,{organization:tenant.organization,pages});if(req.method==="DELETE"){const index=pages.findIndex(page=>page.id===pageId);if(index<0)return json(res,404,{error:"Pagina niet gevonden."});pages.splice(index,1);for(const page of pages)if(page.parentId===pageId)page.parentId="";await saveTenantDb(selected.ctx.db);return json(res,200,{ok:true});}const input=await body(req,1_000_000),title=String(input.title||"Naamloze pagina").trim().slice(0,160)||"Naamloze pagina",content=String(input.content||"").slice(0,750_000),icon=String(input.icon||"📄").slice(0,8),parentId=String(input.parentId||"");if(parentId&&!pages.some(page=>page.id===parentId&&page.id!==pageId))return json(res,400,{error:"Bovenliggende pagina bestaat niet."});const now=new Date().toISOString();if(req.method==="POST"){const page={id:randomUUID(),title,content,icon,parentId,createdAt:now,updatedAt:now};pages.push(page);await saveTenantDb(selected.ctx.db);return json(res,201,{page});}const page=pages.find(item=>item.id===pageId);if(!page)return json(res,404,{error:"Pagina niet gevonden."});Object.assign(page,{title,content,icon,parentId,updatedAt:now});await saveTenantDb(selected.ctx.db);json(res,200,{page});}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const domainTenant=await tenantByDomain(requestDomain(req));
    if(req.method==="GET"&&url.pathname==="/api/site"){if(!domainTenant)return json(res,404,{error:"Geen website aan deze domeinnaam gekoppeld."});return json(res,200,websiteView(domainTenant));}
    if (req.method === "POST" && url.pathname === "/api/auth/register") return await register(req,res);
    if (req.method === "GET" && url.pathname === "/api/mosques") { const db=await tenantDb();return json(res,200,{mosques:db.tenants.map(t=>({organization:t.organization,city:t.city,slug:t.slug}))}); }
    if (req.method === "POST" && url.pathname === "/api/auth/login") return await loginAccount(req,res);
    if (req.method === "POST" && url.pathname === "/api/members/login") return await memberLogin(req,res);
    if (req.method === "POST" && url.pathname === "/api/volunteers/login") return await volunteerLogin(req,res);
    const memberRegisterMatch=url.pathname.match(/^\/api\/mosques\/([^/]+)\/members\/register$/);
    if(req.method==="POST"&&memberRegisterMatch)return await memberRegister(req,res,decodeURIComponent(memberRegisterMatch[1]));
    const publicProductsMatch=url.pathname.match(/^\/api\/mosques\/([^/]+)\/products$/);
    if(req.method==="GET"&&publicProductsMatch){const tenant=await tenantBySlug(decodeURIComponent(publicProductsMatch[1]));if(!tenant)return json(res,404,{error:"Moskee niet gevonden."});ensureMembership(tenant);return json(res,200,{organization:tenant.organization,products:tenant.products.filter(p=>p.active!==false).map(productView)});}
    const publicWebsiteMatch=url.pathname.match(/^\/api\/mosques\/([^/]+)\/website$/);
    if(req.method==="GET"&&publicWebsiteMatch)return await publicWebsite(req,res,decodeURIComponent(publicWebsiteMatch[1]));
    const tourRequestMatch=url.pathname.match(/^\/api\/mosques\/([^/]+)\/tour-requests$/);
    if(req.method==="POST"&&tourRequestMatch)return await requestTourWithHost(req,res,decodeURIComponent(tourRequestMatch[1]));
    if (req.method === "POST" && url.pathname === "/api/auth/logout") { res.setHeader("set-cookie","orange_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); return json(res,200,{ok:true}); }
    if (req.method === "GET" && url.pathname === "/api/auth/me") { const ctx=await portalContext(req); if(!ctx)return json(res,401,{error:"Niet ingelogd."}); return json(res,200,{role:ctx.session.role,tenant:ctx.tenant?publicTenant(ctx.tenant):null}); }
    if (req.method === "GET" && url.pathname === "/api/portal/tenants") { const ctx=await portalContext(req);if(!ctx)return json(res,401,{error:"Niet ingelogd."});if(ctx.session.role!=="master")return json(res,403,{error:"Alleen voor het masteraccount."});return json(res,200,{tenants:ctx.db.tenants.map(publicTenant)}); }
    if (req.method === "GET" && url.pathname === "/api/portal/settings") return await portalSettings(req,res,false);
    if (req.method === "PUT" && url.pathname === "/api/portal/settings") return await portalSettings(req,res,true);
    if (req.method === "POST" && url.pathname === "/api/portal/assets") return await portalUpload(req,res);
    if (["GET","PUT"].includes(req.method) && url.pathname === "/api/portal/integrations") return await portalIntegrations(req,res);
    if (req.method === "POST" && url.pathname === "/api/portal/integrations/eboekhouden/push") return await eboekPortal(req,res);
    if (req.method === "GET" && url.pathname === "/api/portal/donations") return await portalDonations(req,res);
    if (["GET","PUT"].includes(req.method) && url.pathname === "/api/portal/password-vault") return await passwordVault(req,res);
    if (["GET","POST"].includes(req.method) && url.pathname === "/api/portal/knowledge-base") return await knowledgeBaseAdmin(req,res);
    const knowledgePageMatch=url.pathname.match(/^\/api\/portal\/knowledge-base\/([^/]+)$/);
    if(["PUT","DELETE"].includes(req.method)&&knowledgePageMatch)return await knowledgeBaseAdmin(req,res,decodeURIComponent(knowledgePageMatch[1]));
    if (["GET","PUT"].includes(req.method) && url.pathname === "/api/portal/website") return await portalWebsite(req,res);
    if (["GET","POST"].includes(req.method) && url.pathname === "/api/portal/volunteers") return await volunteerAdmin(req,res);
    const volunteerAdminMatch=url.pathname.match(/^\/api\/portal\/volunteers\/([^/]+)$/);
    if(req.method==="DELETE"&&volunteerAdminMatch)return await volunteerAdmin(req,res,decodeURIComponent(volunteerAdminMatch[1]));
    if (["GET","PUT"].includes(req.method) && url.pathname === "/api/volunteer/portal") return await volunteerPortal(req,res);
    if (["GET","POST"].includes(req.method) && url.pathname === "/api/portal/board") return await boardAdmin(req,res);
    const boardMatch=url.pathname.match(/^\/api\/portal\/board\/([^/]+)$/);
    if(["PUT","DELETE"].includes(req.method)&&boardMatch)return await boardAdmin(req,res,decodeURIComponent(boardMatch[1]));
    if(req.method==="GET"&&url.pathname==="/api/portal/weekend-schedule")return await weekendSchedule(req,res,url);
    if(req.method==="POST"&&url.pathname==="/api/portal/weekend-schedule/regenerate")return await weekendSchedule(req,res,url,"regenerate");
    if(req.method==="POST"&&url.pathname==="/api/portal/weekend-schedule/swap")return await weekendSchedule(req,res,url,"swap");
    if (["GET","POST"].includes(req.method) && url.pathname === "/api/portal/members") return await membershipAdmin(req,res,"members");
    const donorMatch=url.pathname.match(/^\/api\/portal\/donors\/([^/]+)$/);
    if(req.method==="PUT"&&donorMatch)return await updateDonor(req,res,decodeURIComponent(donorMatch[1]));
    if(req.method==="POST"&&url.pathname==="/api/portal/donors/import")return await importDonors(req,res);
    const donorVerificationMatch=url.pathname.match(/^\/api\/portal\/donors\/([^/]+)\/verification-link$/);
    if(req.method==="POST"&&donorVerificationMatch)return await donorVerificationLink(req,res,decodeURIComponent(donorVerificationMatch[1]));
    if (["GET","POST"].includes(req.method) && url.pathname === "/api/portal/products") return await membershipAdmin(req,res,"products");
    const removeProductMatch=url.pathname.match(/^\/api\/portal\/products\/([^/]+)$/);
    if(req.method==="DELETE"&&removeProductMatch)return await removeProduct(req,res,decodeURIComponent(removeProductMatch[1]));
    if (req.method === "POST" && url.pathname === "/api/portal/subscriptions") return await membershipAdmin(req,res,"subscriptions");
    if (req.method === "GET" && url.pathname === "/api/portal/receipts") return await membershipAdmin(req,res,"receipts");
    if (req.method === "POST" && url.pathname === "/api/portal/receipts/generate") return await receiptAction(req,res);
    if (req.method === "POST" && url.pathname === "/api/portal/receipts/send-all") return await receiptAction(req,res);
    if (req.method === "GET" && url.pathname === "/api/member/portal") return await memberPortal(req,res);
    if (["GET","POST"].includes(req.method) && url.pathname === "/api/member/periodic-gift") return await periodicGift(req,res);
    if (req.method === "PUT" && url.pathname === "/api/member/profile") return await updateMemberProfile(req,res);
    if (req.method === "POST" && url.pathname === "/api/member/payments") return await createMemberPayment(req,res);
    if (req.method === "GET" && url.pathname === "/api/config") {
      const tenant = await tenantBySlug(url.searchParams.get("tenant"));
      const { amounts, currency, organization, logo, video } = tenant?.settings || await config();
      return json(res, 200, { amounts, currency, organization, logo, video });
    }
    if (req.method === "GET" && url.pathname === "/api/prayer-times") return await prayerTimes(res,url.searchParams.get("tenant"));
    if (req.method === "GET" && url.pathname === "/api/admin/config") {
      if (!isAdmin(req)) return json(res, 401, { error: "Onjuiste beheer-PIN." });
      return json(res, 200, await config());
    }
    if (req.method === "PUT" && url.pathname === "/api/admin/config") return await updateSettings(req, res);
    if (req.method === "POST" && url.pathname === "/api/admin/assets") return await uploadAsset(req, res);
    if (req.method === "POST" && url.pathname === "/api/payments") return await createPayment(req, res);
    const cancelMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) return await cancelPayment(decodeURIComponent(cancelMatch[1]), res);
    const paymentStatusMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/status$/);
    if (req.method === "GET" && paymentStatusMatch) return paymentStatus(decodeURIComponent(paymentStatusMatch[1]),res);
    if (req.method === "POST" && url.pathname === "/api/payments/webhook") {
      return await paymentWebhook(req,res,url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Methode niet toegestaan" });

    const requested = domainTenant&&url.pathname === "/" ? "website.html" : url.pathname === "/" || url.pathname.startsWith("/scherm/") ? "index.html" : url.pathname.startsWith("/website/") ? "website.html" : url.pathname.startsWith("/lid-worden/") ? "lid-worden.html" : url.pathname === "/moskee-kiezen" ? "moskee-kiezen.html" : url.pathname === "/ledenlogin" ? "ledenlogin.html" : url.pathname === "/vrijwilligers-login" ? "vrijwilligers-login.html" : url.pathname === "/aanmelden" ? "aanmelden.html" : url.pathname === "/inloggen" ? "inloggen.html" : decodeURIComponent(url.pathname.slice(1));
    const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const file = join(publicDir, safe);
    if (!file.startsWith(publicDir)) return json(res, 403, { error: "Geen toegang" });
    let data = await readFile(file);
    if (extname(file) === ".html") {
      const html = data.toString("utf8");
      data = Buffer.from(html.replace("</body>", '<script type="module" src="/i18n.js"></script></body>'), "utf8");
    }
    res.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
      "cache-control": [".html", ".js", ".css", ".json"].includes(extname(file)) ? "no-store" : "public, max-age=3600"
    });
    if (req.method === "HEAD") return res.end();
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "Niet gevonden" });
    console.error(error);
    await logError("Serverfout", error);
    json(res, 500, { error: "Er ging iets mis." });
  }
});

server.listen(port, () => console.log(`Donatiescherm draait op http://localhost:${port}`));
setTimeout(()=>runReceiptCycle().catch(error=>logError("Automatische kwitantiecyclus",error)),5_000);
setInterval(()=>runReceiptCycle().catch(error=>logError("Automatische kwitantiecyclus",error)),24*60*60*1000);
setTimeout(()=>expireMemberPayments().catch(error=>logError("Timeoutcontrole ledenbetaling",error)),2_000);
setInterval(()=>expireMemberPayments().catch(error=>logError("Timeoutcontrole ledenbetaling",error)),5_000);
setTimeout(()=>runEboekMonthlySync().catch(error=>logError("Maandelijkse e-Boekhouden taak",error)),15_000);
setInterval(()=>runEboekMonthlySync().catch(error=>logError("Maandelijkse e-Boekhouden taak",error)),6*60*60*1000);
