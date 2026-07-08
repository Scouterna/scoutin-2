# Stormöte 6 – uppföljningsplan

Formaliserade planer utifrån testet på Stormöte 6 (2026-05-13–15, Excel/Google
Sheets-baserad config) och genomgången 2026-07-08 mot huvudgrenens kod, inför
att appen ska köras mot riktig Scoutnet-data med ytterligare validering.

Varje rubrik nedan är en avgränsad ändring. Status anges per punkt:
`[ ]` inte påbörjad, `[~]` design klar, redo att implementeras, `[?]` öppen
fråga som måste avgöras innan design/implementation.

## Index

**Session & anslutning**
- [Session avslutas otydligt / auto-restart-flödet](#session-avslutas-otydligt--auto-restart-flödet)
- [WebSocket-krascher och tyst frånkoppling](#websocket-krascher-och-tyst-frånkoppling)
- [Automatisk stängning av session efter timeout](#automatisk-stängning-av-session-efter-timeout)
- [Felhantering vid tappad anslutning under inmatning](#felhantering-vid-tappad-anslutning-under-inmatning)
- [Strukturerad loggning med korrelations-ID](#strukturerad-loggning-med-korrelations-id)

**Incheckningsflöde**
- [Förhindra dubbel-incheckning](#förhindra-dubbel-incheckning)
- [Bekräftelse-checkbox på sista skärmen](#bekräftelse-checkbox-på-sista-skärmen)
- [Sista stegets titel och knapptext](#sista-stegets-titel-och-knapptext)
- [QR-kod-överlämning till mobilflöde](#qr-kod-överlämning-till-mobilflöde)
- [Kryssruta för "skickad till infotältet"](#kryssruta-för-skickad-till-infotältet)

**Data: import, validering och berikning**
- [Generisk import-berikning (enrichers)](#generisk-import-berikning-enrichers)
- [Filtrera bort deltagare/grupper med importfel](#filtrera-bort-deltagaregrupper-med-importfel)
- [Kårinfo (by, stadsdel) via berikning](#kårinfo-by-stadsdel-via-berikning)
- [Avanmälda / "Kommer: Nej"-hantering](#avanmälda--kommer-nej-hantering)
- [Trygga Möten / belastningsregister – riktig implementation](#trygga-möten--belastningsregister--riktig-implementation)
- [Specialbehov för funk (kost, medicin, period)](#specialbehov-för-funk-kost-medicin-period)
- [Mobil: alla scouter förvalda som default](#mobil-alla-scouter-förvalda-som-default)

**Admin & rapporter**
- [Förenkla adminvyn](#förenkla-adminvyn)
- [Rapporter: incheckade, saknade, ofullständiga](#rapporter-incheckade-saknade-ofullständiga)

**Öppna policyfrågor (ej kod)**
- [Internationell safe from harm](#internationell-safe-from-harm)
- [Infotältets process för att ändra anmälningsdata](#infotältets-process-för-att-ändra-anmälningsdata)

**Ej app-arbete**
- [Byar/stadsdel måste finnas i Scoutnet](#byarstadsdel-måste-finnas-i-scoutnet)
- [Belastningsregister-beställning hos Carl](#belastningsregister-beställning-hos-carl)
- [Papperslista med medlemsnummer (internationell funk)](#papperslista-med-medlemsnummer-internationell-funk)

---

## Implementeringsordning

Beslutad 2026-07-08. Faserna körs i tur och ordning; kvicka-vinster-punkterna
sparas medvetet till sist trots låg kostnad.

**Fas 1 — Anslutningsrobusthet**
- [Strukturerad loggning med korrelations-ID](#strukturerad-loggning-med-korrelations-id)
- [WebSocket-krascher och tyst frånkoppling](#websocket-krascher-och-tyst-frånkoppling)
- [Felhantering vid tappad anslutning under inmatning](#felhantering-vid-tappad-anslutning-under-inmatning)
- [Automatisk stängning av session efter timeout](#automatisk-stängning-av-session-efter-timeout)

**Fas 2 — Gemensam bekräftelsemekanism**
- [Bekräftelse-checkbox på sista skärmen](#bekräftelse-checkbox-på-sista-skärmen)
- [Förhindra dubbel-incheckning](#förhindra-dubbel-incheckning)

**Fas 3 — Import-grund**
- [Generisk import-berikning (enrichers)](#generisk-import-berikning-enrichers)
- [Filtrera bort deltagare/grupper med importfel](#filtrera-bort-deltagaregrupper-med-importfel)
- [Avanmälda / "Kommer: Nej"-hantering](#avanmälda--kommer-nej-hantering)

**Fas 4 — Admin & rapporter**
- [Kryssruta för "skickad till infotältet"](#kryssruta-för-skickad-till-infotältet)
- [Förenkla adminvyn](#förenkla-adminvyn)
- [Rapporter: incheckade, saknade, ofullständiga](#rapporter-incheckade-saknade-ofullständiga)

**Fas 5 — Händelsespecifikt / externt blockerat**
- [Kårinfo (by, stadsdel) via berikning](#kårinfo-by-stadsdel-via-berikning)
- [Specialbehov för funk (kost, medicin, period)](#specialbehov-för-funk-kost-medicin-period)
- [Trygga Möten / belastningsregister – riktig implementation](#trygga-möten--belastningsregister--riktig-implementation)

**Fas 6 — Kvicka vinster (sparas till sist)**
- [Mobil: alla scouter förvalda som default](#mobil-alla-scouter-förvalda-som-default)
- [Sista stegets titel och knapptext](#sista-stegets-titel-och-knapptext)
- Städa bort kvarglömda debug-loggar (ingår även i loggnings-punkten i Fas 1)
- [QR-kod-överlämning till mobilflöde](#qr-kod-överlämning-till-mobilflöde) (ren driftsuppgift, ingen kod)

**Parallellt, blockerar ingen fas**
- [Internationell safe from harm](#internationell-safe-from-harm)
- [Infotältets process för att ändra anmälningsdata](#infotältets-process-för-att-ändra-anmälningsdata)

---

## Session & anslutning

### Session avslutas otydligt / auto-restart-flödet

`[ ]` Källa: Kår-anteckning "När man är klar kommer man till steg 1 och inte
startskärmen."

Verifierat i kod: när sista steget slutförs sätts `completedAt` korrekt
(`packages/backend/src/core/workflow/stepContext.ts:84-89`), och frontend går
till startskärmen och auto-skapar en ny session
(`packages/frontend/src/components/kiosk/StartContent.tsx`,
`pendingAutoRestartAtom`). Sessionen avslutas alltså redan korrekt – det som
troligen upplevs som "steg 1" är att övergången till nästa identifiering sker
utan att operatören behöver interagera med startskärmen, vilket är önskat för
köhastighet.

**Plan:**
- Bekräfta med faktisk användning att beteendet känns bra i praktiken (svårt
  att verifiera enbart i kod).
- Snygga till övergångsanimationen mellan avslutad session och nästa
  identifiering.

### WebSocket-krascher och tyst frånkoppling

`[ ]` Källa: Kår "Vi har löst reconnection för crashen. Borde undersöka varför
den crashar." + Funk "Websocket closed ibland i admin."

`todo.md:14` listar detta som olöst. Reconnect-logik med backoff finns
(`packages/frontend/src/socket/SocketLoader.tsx`), men bara för riktiga
`close`-events – en tyst frånkoppling (t.ex. wifi som dör utan close-frame)
upptäcks inte. Ingen ping/pong-heartbeat finns för att detektera detta.
`plugins/base` har en `heartbeat`-message-typ men den skickas bara manuellt
från test-/admin-verktyg, aldrig periodiskt från kiosken.

**Plan:**
- Lägg till periodisk ping/pong (client → server heartbeat) i kioskens
  websocket-klient för att upptäcka tysta frånkopplingar, inte bara
  `close`-events.
- Undersök om samma sak gäller adminpanelens live-socket
  (`AdminSessionOverview.tsx`).
- Städa bort kvarglömda debug-loggar i samma kodväg (se nästa punkt).

### Automatisk stängning av session efter timeout

`[~]` Beslut 2026-07-08: riktig backend-åtgärd. Källa: Kår "Stäng sessionen
automatiskt efter x sekunder... På sista skärmen, kortare tid."

Finns inte alls idag. `CheckinSession`-modellen har en kommentar
(`schema.prisma:53`) om att en expiry-tid vore bra, men inget är
implementerat.

**Beslut:** ett timeout-avbrott ska vara en riktig backend-åtgärd –
sessionen markeras aktivt som avbruten i databasen, inte bara en tyst
frontend-reset. Ger spårbarhet i historik/rapporter.

**Plan:**
- Lägg till stöd i backend för att markera en session som avbruten (troligen
  ett nytt fält bredvid `completedAt` på `CheckinSession`, t.ex.
  `abortedAt`).
- Inaktivitetstimer per skärm i frontend som anropar denna backend-åtgärd
  vid timeout.
- Kortare timeout specifikt på sista skärmen.

### Felhantering vid tappad anslutning under inmatning

`[ ]` Källa: Kår "Bättre felhantering... T.ex. man skriver personnummer, men
inget händer."

Bekräftat: `ScreenRenderer.tsx` skickar via socket utan att kolla
`readyState` – om anslutningen är död men inget `close`-event hunnit köra syns
inget alls för användaren. Enda feedbacken idag är en fullskärms
"Återansluter..."-overlay som bara triggas av faktiska close-events.

**Plan:**
- Kolla `readyState` innan send, visa omedelbar felindikation om socket inte
  är öppen.
- Koppla ihop med heartbeat-arbetet ovan så tysta frånkopplingar upptäcks
  snabbare och overlayn triggas proaktivt istället för reaktivt.

### Strukturerad loggning med korrelations-ID

`[x]` Implementerad 2026-07-08. Källa: Kår "Bättre loggning i backend...
Korrelations-ID eller likn."

Backend använde uteslutande bara `console.log`/`warn`/`error`, ingen
loggbibliotek, inget request-/session-ID kopplat till loggrader. Gick inte
att i efterhand koppla ihop ett fel en operatör såg i kiosk-UI:t med rätt
backend-loggrad.

**Plan:**
- Inför ett riktigt loggbibliotek (t.ex. pino) i backend.
- Lägg till ett session-/anslutnings-ID som följer med i varje relevant
  loggrad för en given websocket-anslutning/session.
- Städa bort kvarglömda debug-loggar samtidigt, bl.a.
  `console.log("WebSocket authenticated successfully")` i
  `auth.socket.ts:128` (körs vid *varje* autentisering, inte bara första
  gången) och `console.log("Hi!", ...)` i `session.socket.ts:21`.

**Genomfört:**
- `pino` (+ `pino-pretty` i dev) infört som loggbibliotek, ny
  `core/logging/logger.ts` med bas-`logger` och `getLogger(c)`-hjälpare.
- Både HTTP-anrop och websocket-anslutningar korreleras: varje `/api/*`-
  request får ett `reqId`, varje websocket-anslutning ett `connId`
  (bundet på `TypedContext` via `AppEnv`, nytt i `core/websocket/types.ts`).
  Vid lyckad autentisering binds även `sessionId` in, så alla loggrader
  för anslutningen efter det innehåller båda ID:na.
- Alla `console.*`-anrop i backend ersatta med den kontextbundna loggern,
  inklusive `scoutnet.ts`, `googlesheets.ts`, `kiosk.service.ts` och
  admin-routes (inte bara websocket-kodvägen). `console.log("Hi!", ...)`
  togs bort helt (ren brus); den upprepade auth-loggen döptes om till
  `"WebSocket authenticated"` på info-nivå.
- Lade till `noConsole: "error"` som biome-regel för `packages/backend/**`
  så att `console.*` inte smyger sig tillbaka.
- Ny konfig `LOG_LEVEL` i `config.ts` styr loggnivå; `pino-pretty` används
  bara i development, JSON i production.

---

## Incheckningsflöde

### Förhindra dubbel-incheckning

`[~]` Beslut 2026-07-08: kräv bekräftelse. Källa: Kår "Man kan checka in
flera gånger."

Bekräftat: `markConfirmedCheckedIn`/`markPreliminaryCheckedIn` skriver bara
över tidsstämpeln, ingen spärr. Dedupe av sessioner
(`base:deduplicateSession`) gäller bara *pågående* sessioner för samma
aktör – en redan avslutad session hindrar inte en ny session från att checka
in samma deltagare igen.

**Beslut:** ett andra incheckningsförsök ska inte blockeras helt och inte
vara helt tyst tillåtet – operatören ska få en bekräftelsedialog ("redan
incheckad kl X, checka in igen?") och själv välja om det ska genomföras.

**Plan:**
- Implementera bekräftelsesteget i/kring `markConfirmedCheckedIn`/
  `markPreliminaryCheckedIn` (eller tidigare i flödet, t.ex. i
  `selectSubjects` där redan incheckade deltagare kan flaggas visuellt innan
  bekräftelsen visas).
- Avgör UI-mönster: troligen samma `requireAcknowledgement`-mekanism som
  [bekräftelse-checkboxen](#bekräftelse-checkbox-på-sista-skärmen) nedan,
  eller en enklare modal/varningsskärm.

### Bekräftelse-checkbox på sista skärmen

`[~]` Beslut 2026-07-08: generell flagga på `base:message`. Källa: Kår
"Ingen läser texten på sista skärmen... checkbox för att intyga att man
läst."

Verifierat: inget checkbox-/samtyckesmönster finns någonstans i kodbasen
idag (`plugins/base/src/selectSubjects` har en checkbox, men den är för att
välja deltagare, inte för samtycke).

**Beslut:** ingen ny stegtyp – lägg till en valfri `requireAcknowledgement`-
flagga direkt på `base:message`, återanvändbar av alla message-steg (t.ex.
även [dubbel-incheckning](#förhindra-dubbel-incheckning) ovan).

**Plan:**
- Implementera i `plugins/base/src/message`: när `requireAcknowledgement` är
  satt, visa en checkbox och håll "Slutför"/knappen inaktiverad tills den är
  ikryssad.

### Sista stegets titel och knapptext

`[ ]` Källa: Kår "Sista stegets rubrik är 'Du är klar'... klickar inte på
'Slutför'." + Funk "På sista steget bör det stå 'Nästa' istället för
'Slutför'."

Verifierat mot Stormöte 6-configen: sista steget hette "Incheckning lyckades"
med knapptext "Slutför" – inte "Du är klar" som i anteckningen. Samma
`successMessage`-steg används oavsett om det är en kårledare, ordinarie
deltagare eller funktionär som checkats in. Eftersom flödet i praktiken går
rakt vidare till nästa persons identifiering (se
["Session avslutas otydligt"](#session-avslutas-otydligt--auto-restart-flödet))
är "Slutför" en missvisande knapptext – det känns inte klart, det fortsätter.

**Plan:**
- Byt knapptext till något i stil med "Nästa" eller "Klar, checka in nästa"
  som speglar att flödet fortsätter.
- Verifiera vilken titel som faktiskt ska visas – inget i nuvarande config
  matchar "Du är klar" exakt.

### QR-kod-överlämning till mobilflöde

`[~]` Beslut 2026-07-08: ingen ny funktion krävs. Källa: Kår, on-site-flöde
steg 3: "Stämmer inte? QR-kod → mobilflöde."

**Beslut:** ingen QR-kod ska genereras dynamiskt av appen. En fysiskt
utskriven, statisk QR-kod (skapas en gång, utanför appen) ska peka mot en
`CheckinLink`-URL för mobilflödet (`/link/:linkId`, se
`routes/admin/links.tsx` + `routes/link.$linkId.tsx`, som redan låter en
admin skapa en länk mot valfri config/params). Personen skannar den skyltade
koden själv och identifierar sig sedan som vanligt via det befintliga
`identify`-steget (som redan har inbyggt QR-/kortskanning via
`useBarcodeScanner`, se `StartScreen.tsx`) – ingen personlig/dynamisk länk
per deltagare.

**Plan:**
- Inget applikationsarbete kvarstår. Ren driftsuppgift: skapa en
  `CheckinLink` mot `stepConfig.pre-checkin.yml` via `/admin/links`, generera
  en QR-kod av URL:en med valfritt externt verktyg, skriv ut och sätt upp
  vid on-site-stationen.

### Kryssruta för "skickad till infotältet"

`[ ]` Källa: Funk "Lägg till en kryssruta för de som skickats till
infotältet. Specialkost, belastningsregister etc."

Finns inte. Ingen sådan flagga i datamodellen eller stegkonfigen.

**Plan:**
- Lägg till ett fält (t.ex. `sentToInfoTent: Boolean` eller liknande) på
  check-in-statusen per deltagare, eller som en generell steg-output som
  sparas i `CheckinSessionStepData`.
- Bygg en kryssruta i relevant steg-skärm.
- Detta är en av datapunkterna som ["Rapporter"](#rapporter-incheckade-saknade-ofullständiga)
  ska kunna lista.

---

## Data: import, validering och berikning

### Generisk import-berikning (enrichers)

`[~]` Design klar via diskussion 2026-07-08. Källa: Kår "Personer och grupper
måste kunna ha metadata."

Bakgrund: appens kärna (schema, importkod) ska vara händelseagnostisk.
Händelsespecifik data (t.ex. bynummer) ska aldrig kräva ändringar i delad
kod – bara i plugins och config för det aktuella eventet.

**Design:**
- Nytt plugin-hook `registerImportEnricher(name, fn)` bredvid befintliga
  `registerStep` i `BackendPluginContext`
  (`packages/backend/src/domains/workflows/steps.ts`).
- Datakällor refererar enrichers via en ny `enrichWith`-map i
  `dataSourceConfig.yml`, samma mönster som redan finns för
  `subGroupConditions`:
  ```yaml
  groups:
    provider: googlesheets
    enrichWith:
      village: stormote6:villageLookup
    providerOptions: ...
  ```
- Varje enrichers resultat skrivs till en egen nyckel i en generisk
  `metadata: Json?`-kolumn (ny) på `Participant` och `ParticipantGroup` –
  aldrig platt sammanslaget, för att undvika att två enrichers krockar.
- Enrichers kan returnera `null` (giltigt – ingen data för denna entitet,
  ingen nyckel skrivs) eller kasta (fel, se
  [nästa punkt](#filtrera-bort-deltagaregrupper-med-importfel)).
- Var enrichers faktiskt hämtar sin data ifrån (Scoutnet-fråga, ark, API) är
  irrelevant för denna design – det är precis vad plugin-gränssnittet är till
  för.

**Plan:**
- Prisma-migrering: lägg till `metadata Json?` och `hasImportError Boolean
  @default(false)` på `Participant` och `ParticipantGroup`.
- Implementera `registerImportEnricher` i plugin-API:t och kör registrerade
  enrichers efter ordinarie upsert i `data.service.ts`.
- Lägg till `enrichWith`-parsing i `dataSourceConfigLoader.ts`.

### Filtrera bort deltagare/grupper med importfel

`[~]` Design klar. Källa: uppföljning på ovan – vad händer när import eller en
enricher faktiskt misslyckas.

**Design:**
- `hasImportError` räknas om helt varje importcykel (ej ackumulerande) – ett
  övergående fel som senare lyckas självläker automatiskt.
- Om en redan importerad entitet får ett fel (identitetsuppdatering eller en
  enricher kastar): behåll raden och dess tidigare giltiga fält, sätt
  `hasImportError = true`. Logga med `console.warn` som idag – ingen separat
  felloggtabell.
- Om en helt ny entitet misslyckas vid första importen: skapa ingen rad alls,
  logga med `console.warn`. Exakt dagens beteende, oförändrat.
- Filtrering sker enbart i två redan existerande centrala uppslagsfunktioner
  – inga ändringar behövs i `identify`, `selectSubjects` eller
  `markConfirmedCheckedIn`:
  - `findParticipantsByLookupValue` (`data.service.ts`) – exkludera där
    `hasImportError`.
  - `getSubjectCandidates` (`data.service.ts`) – exkludera deltagare där
    `hasImportError`, och exkludera samtliga deltagare i en grupp där
    gruppens `hasImportError` är satt.

**Plan:**
- Implementera de två filtren.
- Bygg importlogiken (se enricher-punkten) så den sätter/nollställer
  `hasImportError` korrekt varje cykel.

### Kårinfo (by, stadsdel) via berikning

`[ ]` Beror på: [generisk import-berikning](#generisk-import-berikning-enrichers).
Källa: Kår on-site-flöde steg 5.

Verifierat: Stormöte 6-configen visade **statisk** text ("Kåren bor i by 5,
stadsdel Östersjön") för alla kårer oavsett vilken kår som faktiskt
checkades in – detta var aldrig riktig per-kår-data.

**Plan:**
- Bygg en konkret enricher-plugin för nästa event som hämtar verklig
  by/stadsdel-data per grupp (källa TBD av den som äger eventets data, se
  ["Byar/stadsdel måste finnas i Scoutnet"](#byarstadsdel-måste-finnas-i-scoutnet)
  – men irrelevant för själva appdesignen).
- Uppdatera `groupInfo`-steget att läsa `${{ steps.identify.outputs.participant.participantGroup.metadata.village }}`
  istället för hårdkodad text.

### Avanmälda / "Kommer: Nej"-hantering

`[~]` Beslut 2026-07-08: samma signal som `cancelled`. Källa: Kår
"Avanmälda och 'Kommer du: Nej' kan checka in."

Delvis löst: Scoutnets `cancelled`-fält filtreras redan bort vid import
(`scoutnet.ts:289-291`). Notera: `keys.questions`-nyckeln i
`ScoutnetDataSource.providerOptions.keys` (`scoutnet.ts:26`) är bara en
API-nyckel för en annan endpoint, inte faktiska frågesvar – ingen
`/questions`-kod finns eller anropas idag.

**Beslut:** "Kommer du: Nej" räknas som samma signal som `cancelled` – ingen
separat frågehantering behöver byggas.

**Kvarstående:** befintlig kod har redan en TODO (`scoutnet.ts:99-105`) om
att participants som blir `cancelled` *efter* att de importerats en gång
varken soft-deletas eller på annat sätt markeras – de filtreras bara bort ur
den nya importlistan, men den gamla raden i databasen rörs inte. Det måste
säkerställas att en person som avbryter sin anmälan efter första importen
faktiskt inte längre går att checka in.

**Plan:**
- Bygg färdigt soft-delete/borttagning av tidigare importerade deltagare som
  blivit `cancelled` (den TODO:n i `scoutnet.ts` behöver alltså faktiskt
  lösas som en del av detta, inte bara filtreringen vid första importen).
- Naturlig plats: samma cykel som sätter/nollställer `hasImportError` (se
  [import-felhantering](#filtrera-bort-deltagaregrupper-med-importfel)) –
  en försvunnen/cancelled deltagare bör hanteras i samma
  omkörningslogik.

### Trygga Möten / belastningsregister – riktig implementation

`[?]` Blockerad av extern beställning. Källa: Kår "Skärmen för Trygga Möten
och belastningsregister bör göras bra... olika ut för funk och kår."

Viktigt: dagens `scoutnet:checkLeaderRequirements`-plugin är en **fejk** –
den slumpar en varning (50/50 baserat på en hash av *aktörens* UUID, inte
per vald deltagare) och visar hårdkodade påhittade namn ("Annette Hittepå",
"Frans Finnsinte", `LeaderRequirementsWarningScreen.tsx:20-23`). Ingen
riktig Trygga Möten-/belastningsregister-data finns någonstans i
datamodellen.

Korrigering mot tidigare anteckning: pluginet är tvärtom bara inkopplat i
**on-site-flödet** (`stepConfig.yml:48-49`, gäller `dataSource == 'groups'`,
dvs. kårledare) – det finns inte alls i `stepConfig.pre-checkin.yml`
(mobilflödet). Tillagt i commit `326044c` ("feat: fake scoutnet check"),
15 maj 2026. "Olika ut för funk och kår" är ändå delvis sant rent tekniskt
eftersom steget villkoras på `groups` och aldrig körs för `staff`, men
innehållet är overksamt oavsett flöde.

**Öppen fråga:** datakälla saknas – blockerad av
[belastningsregister-beställningen hos Carl](#belastningsregister-beställning-hos-carl)
(ren logistik, inte löst än). Trygga Möten-status kommer troligen från
Scoutnet på samma sätt, men behöver bekräftas separat.

**Plan (när datakälla finns):**
- Bygg som en enricher enligt samma mönster som kårinfo.
- Ersätt slumplogiken i `checkLeaderRequirements.ts` med riktig
  statuskontroll.
- Bygg separata skärmvarianter/texter för funk vs. kår om det fortfarande
  behövs när datan är riktig.

### Specialbehov för funk (kost, medicin, period)

`[~]` Beslut 2026-07-08: Scoutnet-källa. Källa: Funk-flöde: "Medicinsk el",
"Period", "Specialkost".

Inget av detta finns i datamodellen idag (`Participant` har bara namn, grupp,
`subGroup`, incheckningstider).

**Beslut:** datan kommer från Scoutnet (anmälningsfrågor), inte manuell
inmatning vid incheckning.

**Plan:** bygg som en eller flera enrichers, samma mönster som
[kårinfo](#kårinfo-by-stadsdel-via-berikning) – beror alltså på
[generisk import-berikning](#generisk-import-berikning-enrichers). Eftersom
detta sannolikt kräver Scoutnets `/questions`-endpoint (se
[Avanmälda-punkten](#avanmälda--kommer-nej-hantering) ovan, där samma
endpoint diskuterades men bedömdes onödig där) kan denna punkt bli den
faktiska anledningen att implementera frågehämtning i `scoutnet.ts` – avgör
om `/questions`-integrationen ska byggas gemensamt för båda.

### Mobil: alla scouter förvalda som default

`[~]` Design klar via kodläsning 2026-07-08. Källa: Kår "På mobil bör alla
scouter vara markerade som default."

Verifierat: default-checkbox-läget sätts i
`SelectSubjectScreen.tsx:38-46` från ett `preCheckedIn`-fält per deltagare,
som backend (`selectSubjects.ts:51`) beräknar som
`p.preliminaryCheckedInAt !== null`. Det är alltså inte hårdkodat
allt-eller-inget – det speglar om deltagaren redan är preliminärt incheckad.

Det som faktiskt orsakar buggen: i `stepConfig.pre-checkin.yml` (mobilflödet)
körs `base:selectSubjects` **före** `base:markPreliminaryCheckedIn` i
stegordningen. Vid det tillfälle skärmen visas är alltså
`preliminaryCheckedInAt` fortfarande `null` för samtliga deltagare (ingen har
hunnit bli preliminärt incheckad än), så *ingen* är förvald – motsatsen till
vad kåren vill ha. I on-site-configen (`stepConfig.yml`) fungerar samma
skärm som tänkt: den kör efter ett ev. tidigare mobil-pre-checkin-pass, så
de som redan preliminärt checkats in visas som förvalda.

**Plan:**
- Lägg till en `with`-flagga på steget, t.ex. `defaultSelected: true`, som
  `selectSubjects.ts` läser för att sätta `preCheckedIn: true` för samtliga
  kandidater oavsett `preliminaryCheckedInAt`.
- Sätt denna flagga på `base:selectSubjects`-steget i
  `stepConfig.pre-checkin.yml` (mobilflödet). Lämna on-site-configen
  oförändrad – där är dagens beteende (förvalt = redan preliminärt
  incheckad) korrekt.

---

## Admin & rapporter

### Förenkla adminvyn

`[ ]` Källa: Allmänt "Adminvyn: Gör den enklare att använda. Avskalat
interface utan 'New' → 'Connect'-grejset."

Bekräftat: `SessionTable.tsx` har en "New session"-knapp, och
`AdminSessionOverview.tsx` har en separat "Connect"-knapp som öppnar en
live-speglande websocket + rå meddelandelogg + debugpanel. Detta täcker sedan
tidigare även tre kända layoutändringar (ta bort call-method-UI, flytta
loggen längre ner, deduplicera steg-vyn) som redan finns dokumenterade från
ett tidigare samtal.

**Plan:**
- Slå ihop denna insats med de tre redan kända layoutändringarna till en
  gemensam admin-UX-uppstädning.

### Rapporter: incheckade, saknade, ofullständiga

`[ ]` Källa: Allmänt "Rapporter: vem är incheckad, vilka saknas, vilka är
inkompletta... de som skickats till infotältet."

Finns inte alls – ingen rapportfunktion, ingen roster-vy i admin.

**Plan:**
- Bygg en admin-roster-vy som kan lista deltagare/grupper med filter på:
  incheckningsstatus, `hasImportError` (se
  [import-felhantering](#filtrera-bort-deltagaregrupper-med-importfel)),
  ["skickad till infotältet"](#kryssruta-för-skickad-till-infotältet)-flaggan.
- Separata vyer/filter för kår respektive funk, enligt anteckningen.
- Denna vy blir även den naturliga platsen att göra importfel synliga för
  personal, eftersom de annars är helt osynliga i kiosk-flödet by design.

---

## Öppna policyfrågor (ej kod)

### Internationell safe from harm

`[?]` Källa: Funk "Internationell safe from harm. Hur löser vi det?"

En utkommenterad platshållare `scoutnet:verifySafeFromHarm` finns i
`stepConfig.yml` men är oimplementerad. Kräver ett beslut om hur
internationella deltagare (som inte nödvändigtvis finns i svenska Scoutnet på
samma sätt) ska verifieras innan någon design kan göras.

### Infotältets process för att ändra anmälningsdata

`[?]` Källa: Allmänt "För processen i infotältet där vi fixar felaktig
info... Kan vi ge infotältet den makten? ... Kanske behöver vara en cutoff
för ändringar."

Ren processfråga – source-of-truth och eventuell cutoff för ändringar måste
beslutas innan det påverkar teknisk design (t.ex. om ändringar ska gå direkt
mot Scoutnet, eller bara lokalt i appen).

---

## Ej app-arbete

### Byar/stadsdel måste finnas i Scoutnet

`[ ]` Källa: Allmänt "Fixa så att byar och stadsdel finns i Scoutnet."

Detta är en begäran om att lägga in data i det externa Scoutnet-systemet
(eller annan extern källa), inte en kodändring i den här repon. Blir relevant
som datakälla för [kårinfo-enrichern](#kårinfo-by-stadsdel-via-berikning) när
den finns på plats.

### Belastningsregister-beställning hos Carl

`[ ]` Källa: Allmänt "Gällande belastningsregister så kan Carl på kansliet
fixa så att vi har den möjligheten... Bör lägga beställning."

Ren logistik/beställning, ingen kod.

### Papperslista med medlemsnummer (internationell funk)

`[ ]` Källa: Funk "Internationell → Incheckningsfunken får ha en
papperslista med medlemsnummer."

Ren processlösning för incheckningsdagen, ingen kod.
