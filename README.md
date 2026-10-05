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

## CCV-pinautomaat

Vul per moskee onder **Koppelingen** het IP-adres van de CCV-terminal in. De standaard OPI-poort is `4100`. MoskeeApp gebruikt via `tools/ccv-bridge` dezelfde `Ccv.OpiCom`-controller als OrangePOS. Stel eventueel `CCV_CONTROLLER_DIR` in wanneer de CCV-modules niet in de standaard OrangePOS-locatie staan.

De knop **Annuleren en terug** stuurt `AbortTransaction` naar de CCV-terminal. Het donatiescherm volgt de OPI-status totdat de betaling voltooid, geannuleerd of mislukt is.

Nieuwe CCV-betalingen worden per moskee opgeslagen en zijn onder **Donaties** terug te zien met bedrag, datum, status en betaalreferentie.

## Legacy-import donateurs

Onder **Donateurs CRM → CSV importeren** kunnen bestaande donateurs uit een legacy systeem worden overgezet. CSV-bestanden met komma, puntkomma of tab worden ondersteund. De import herkent Nederlandse en Engelse kolomnamen voor naam, e-mail, telefoon, IBAN, adres, postcode, plaats, beroep en notities. Voor de definitieve import verschijnt eerst een controleoverzicht; ongeldige of dubbele regels worden overgeslagen.

## Moskeewebsite

Elke moskee krijgt automatisch een publieke website op `/website/<moskee-slug>`. Onder **Website** in de console worden de homepage, contactgegevens, activiteiten, nieuws, veelgestelde vragen, rondleidingsmomenten, vrijdagpreken en ANBI-gegevens beheerd. Rondleidingsaanvragen worden per moskee opgeslagen en in hetzelfde beheerscherm getoond.

De openbare website toont daarnaast de actuele gebedstijden en bevat directe links naar het donatiescherm en de aanmelding als vaste donateur.

### Eigen domeinnaam

Onder **Website → Domeinnamen** kunnen één of meerdere eigen domeinen per moskee worden vastgelegd. MoskeeApp koppelt het inkomende `Host`-adres vervolgens automatisch aan de juiste website. Laat bij de DNS-provider een A/AAAA-record naar de webserver of een CNAME naar de centrale host wijzen en configureer de reverse proxy met HTTPS voor hetzelfde domein.
