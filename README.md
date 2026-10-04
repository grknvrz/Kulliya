# Donatiescherm voor moskeeën en verenigingen

Een tweetalig full-screen donatiescherm met configureerbare bedragen en een server-side MultiSafepay SmartPOS Cloud-integratie.

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

## SmartPOS

De backend maakt een Cloud POS-order aan met het gekozen bedrag in eurocenten en met `gateway_info.terminal_id`. De API-key blijft altijd server-side. POS-transacties kunnen volgens MultiSafepay alleen live met een geactiveerde terminal en een LIVE terminal-group API-key worden getest.

De knop **Annuleren en terug** gebruikt server-side het speciale SmartPOS-endpoint `POST /orders/{order_id}/cancel`. Een reeds voltooide betaling kan niet worden geannuleerd; daarvoor is een afzonderlijke refund-flow nodig.

Voor productie moet de webhook worden uitgebreid: haal na een melding de order opnieuw op bij MultiSafepay, controleer de status server-side en koppel die status via SSE/WebSocket terug aan het scherm. De order-response bevat al de gegevens voor MultiSafepay event notifications.
