# Donatiescherm voor moskeeën en verenigingen

Een tweetalig full-screen donatiescherm met configureerbare bedragen en een lokale CCV OPI-pinautomaatkoppeling.

## Starten

1. Installeer Node.js 20 of hoger.
2. Kopieer `.env.example` naar `.env` en vul de terminal-group API-key en het terminal-ID in.
3. Node laadt `.env` niet automatisch; zet de variabelen via je hostingplatform of start met `node --env-file=.env server.js`.
4. Start lokaal met `npm start` en open `http://localhost:3000`.

Plaats de eigen welkomstvideo als `public/media/welcome.mp4`. Zonder video toont het scherm automatisch een nette groene achtergrond.

## Beheerconsole

Voeg `ADMIN_PIN=een-sterke-pin` toe aan `.env`, herstart de server en open `http://localhost:3000/admin.html`. Hier beheer je de naam, bedragen, het logo, de video en de locatie voor de gebedstijden. De tijden worden dagelijks via de AlAdhan API opgehaald.

## Bedragen beheren

Pas `config/donations.json` aan. Bedragen zijn hele euro's, bijvoorbeeld:

```json
{ "amounts": [5, 10, 20, 50, 100] }
```

De backend valideert iedere keuze opnieuw; de browser kan dus geen afwijkend bedrag naar de terminal sturen.

## Accounts

Moskeeën maken via `/aanmelden` een eigen account en worden direct naar `/console.html` gestuurd. Iedere moskee krijgt een publieke URL op `/scherm/{slug}`. Het masteraccount logt in via `/inloggen` en kan alle moskeeën selecteren in de dropdown. Configureer voor productie `SESSION_SECRET`, `MASTER_ADMIN_EMAIL` en `MASTER_ADMIN_PASSWORD` in `.env`. Zonder aparte mastergegevens is lokaal `master@orangepos.nl` met de bestaande `ADMIN_PIN` beschikbaar.

## Donateurs CRM

Iedere moskee heeft via `/ledenbeheer.html` een eigen CRM voor doorlopende donateurs. Een donateur bevat minimaal een voor- en achternaam; e-mail, IBAN, adres, telefoon en beroep kunnen later worden aangevuld. Vanuit het CRM kan een MultiSafepay-betaallink van € 1 worden gemaakt om de bankrekening te verifiëren. Donateurs die zichzelf aanmelden krijgen een persoonlijk portaal voor hun gegevens en kwitanties.

## Bestuur en weekendrooster

Onder `/bestuur.html` beheert iedere moskee haar eigen bestuurders. Alleen bestuurders met **Neemt deel aan weekendrooster** worden automatisch ingedeeld. `/weekendrooster.html` verdeelt alle zaterdagen en zondagen van een jaar gelijkmatig. Klik twee diensten na elkaar aan om de toegewezen personen om te wisselen.

## Taken en verantwoordelijkheden

Onder `/taken.html` beheert iedere moskee haar eigen takenoverzicht. Een taak krijgt een omschrijving, deadline, prioriteit, status en één of meerdere verantwoordelijke personen uit de actieve bestuurslijst. Het overzicht is verdeeld in **Open**, **Bezig** en **Afgerond**, met filters op bestuurder en prioriteit en een waarschuwing voor verlopen deadlines.

## Vergaderingen, notulen en afspraken

Onder `/vergaderingen.html` maakt iedere moskee bestuursvergaderingen en uitgebreide notulen per agendapunt. Een notulenpunt kan als formele afspraak worden gemarkeerd, met een afzonderlijke tekst die ter ondertekening wordt aangeboden. Actieve bestuurders kunnen rechtstreeks op een tekenvlak digitaal ondertekenen; de handtekening wordt als schaalbare lijntekening bij de afspraak bewaard.

Van iedere afspraak kan een zelfstandige A4-PDF worden gedownload. Daarin staat de afspraak centraal, gevolgd door de namen, functies, ondertekenmomenten en handtekeningvakken van alle actieve bestuursleden.

## Camera's

Onder `/camera.html` opent iedere moskee rechtstreeks het officiële VIGI Cloud VMS-portaal voor online camerabeheer. De pagina verwijst daarnaast naar de actuele Nederlandse downloadpagina's voor VIGI Local VMS, de configuratietool en handleidingen. MoskeeApp ontvangt of bewaart geen camerabeelden en geen VIGI-inloggegevens. Voor advies, levering en installatie staat een OrangePOS-contactblok met logo, telefoonnummer, e-mailadres en adres op de pagina.

## CCV-pinautomaat

Vul per moskee onder **Koppelingen** het IP-adres van de CCV-terminal in. De standaard OPI-poort is `4100`. MoskeeApp gebruikt via `tools/ccv-bridge` dezelfde `Ccv.OpiCom`-controller als OrangePOS. Stel eventueel `CCV_CONTROLLER_DIR` in wanneer de CCV-modules niet in de standaard OrangePOS-locatie staan.

De knop **Annuleren en terug** stuurt `AbortTransaction` naar de CCV-terminal. Het donatiescherm volgt de OPI-status totdat de betaling voltooid, geannuleerd of mislukt is.

Nieuwe CCV-betalingen worden per moskee opgeslagen en zijn onder **Donaties** terug te zien met bedrag, datum, status en betaalreferentie.

## e-Boekhouden.nl

Onder **Koppelingen → e-Boekhouden.nl** kan iedere moskee een eigen REST API-token en drie grootboek-ID's instellen: bank/kas, losse donaties en vaste donaties. MoskeeApp maakt per kalendermaand een verzamelmutatie met afzonderlijke regels voor het aantal en totaalbedrag van losse en vaste donaties. Een maand kan handmatig worden gepusht; bij automatische synchronisatie wordt de afgesloten vorige maand eenmaal geboekt. API-tokens worden versleuteld opgeslagen en een reeds geboekte maand wordt niet dubbel verstuurd.

## Paxton Net2

Onder **Koppelingen → Paxton slagboombeheer** staat de basisconfiguratie voor de lokale Net2 Web API. Per moskee worden de lokale API-URL, application ID en het versleutelde API-geheim opgeslagen. Voor Net2 v7 moet de Web API-toegang bij Paxton worden aangevraagd en moet de integratie rekening houden met MFA; de oude SDK wordt niet meer ondersteund. Zodra de locatiespecifieke API-documentatie en gegevens beschikbaar zijn, kan deze basis worden uitgebreid met het ophalen van tokens, koppelen aan donateurs en blokkeren of deblokkeren vanuit het donateursportaal. Paxton10 wordt niet als ondersteunde API-variant aangeboden.

## Overeenkomst periodieke gift

In het donateursportaal kan een donateur een vaste jaarlijkse gift voor minimaal vijf jaar schriftelijk vastleggen. De overeenkomst bevat een uniek numeriek transactienummer, schenker, instelling, RSIN, bedrag, looptijd, startdatum en digitale ondertekening. Daarna kan de overeenkomst worden afgedrukt of via de browser als PDF worden bewaard. De instelling vult haar vertegenwoordiger en handtekening aan; BSN en eventuele partnergegevens worden bewust niet online opgeslagen en kunnen op het document worden ingevuld.

## Legacy-import donateurs

Onder **Donateurs CRM → CSV importeren** kunnen bestaande donateurs uit een legacy systeem worden overgezet. CSV-bestanden met komma, puntkomma of tab worden ondersteund. De import herkent Nederlandse en Engelse kolomnamen voor naam, e-mail, telefoon, IBAN, adres, postcode, plaats, beroep en notities. Voor de definitieve import verschijnt eerst een controleoverzicht; ongeldige of dubbele regels worden overgeslagen.

## Moskeewebsite

Elke moskee krijgt automatisch een publieke website op `/website/<moskee-slug>`. Onder **Website** in de console worden de homepage, contactgegevens, activiteiten, nieuws, veelgestelde vragen, rondleidingsmomenten, vrijdagpreken en ANBI-gegevens beheerd. Nieuwsartikelen ondersteunen een eigen PNG-, JPG- of WebP-afbeelding en worden in drie beeldgedreven kaarten per rij getoond. Rondleidingsaanvragen worden per moskee opgeslagen en in hetzelfde beheerscherm getoond.

De openbare website toont daarnaast de actuele gebedstijden en bevat directe links naar het donatiescherm en de aanmelding als vaste donateur.

## Vrijwilligers voor rondleidingen

Onder **Vrijwilligers** maakt de moskee afzonderlijke vrijwilligersaccounts aan. Vrijwilligers loggen in via `/vrijwilligers-login` en kunnen uitsluitend hun beschikbaarheid voor toekomstige rondleidingsmomenten beheren. Een moment verschijnt pas op de publieke website wanneer minimaal één actieve vrijwilliger beschikbaar is. Bij een boeking wijst MoskeeApp automatisch een beschikbare gastheer toe en zet een bevestiging voor zowel bezoeker als gastheer in de e-mailoutbox.

Configureer `EMAIL_WEBHOOK_URL` en optioneel `EMAIL_WEBHOOK_TOKEN` om outboxberichten direct naar een e-mailprovider of automatiseringsplatform te sturen. De webhook ontvangt JSON met `to`, `subject`, `text` en `meta`. Zonder webhook blijven berichten als `queued` bewaard.

## Versleutelde wachtwoordkluis

Onder **Wachtwoorden** heeft iedere moskee een eigen kluis voor partij, website, gebruikersnaam, wachtwoord en opmerkingen. De browser leidt met PBKDF2 een sleutel af van het masterwachtwoord en versleutelt de volledige kluis met AES-256-GCM voordat deze naar de server wordt gestuurd. Het masterwachtwoord en de leesbare inhoud worden niet op de server opgeslagen. De kluis vergrendelt na tien minuten inactiviteit en ieder wachtwoord blijft verborgen totdat het oogje bij die regel wordt aangeklikt. Een verloren masterwachtwoord kan niet worden hersteld.

## Knowledge base

Onder **Knowledge base** bouwt iedere moskee een eigen interne kennisbank. Pagina's kunnen als hoofdpagina of onderliggende pagina worden aangemaakt, doorzocht en automatisch opgeslagen. De Notion-achtige editor ondersteunt koppen, vet, cursief, onderstrepen, lijsten, checklists, citaten, links, afbeeldingen, tabellen, infoblokken en scheidingslijnen. Een pagina kan rechtstreeks worden afgedrukt of als PDF worden bewaard via de afdrukfunctie van de browser.

### Eigen domeinnaam

Onder **Website → Domeinnamen** kunnen één of meerdere eigen domeinen per moskee worden vastgelegd. MoskeeApp koppelt het inkomende `Host`-adres vervolgens automatisch aan de juiste website. Laat bij de DNS-provider een A/AAAA-record naar de webserver of een CNAME naar de centrale host wijzen en configureer de reverse proxy met HTTPS voor hetzelfde domein.
