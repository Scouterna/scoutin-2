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
- [Kryssruta för "skickad till infotältet"](#kryssruta-för-skickad-till-infotältet) (uppskjuten – se punkten)
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

`[x]` Implementerad 2026-07-08. Källa: Kår "Vi har löst reconnection för
crashen. Borde undersöka varför den crashar." + Funk "Websocket closed ibland
i admin."

`todo.md:14` listade detta som olöst. Reconnect-logik med backoff fanns
(`packages/frontend/src/socket/SocketLoader.tsx`), men bara för riktiga
`close`-events – en tyst frånkoppling (t.ex. wifi som dör utan close-frame)
upptäcktes inte. Ingen ping/pong-heartbeat fanns för att detektera detta.
Korrigering mot tidigare anteckning: `heartbeat`-meddelandetypen ligger i
backend-kärnan (`core/websocket/messageTypes.ts` +
`domains/sessions/session.socket.ts`), inte i `plugins/base` – men det
stämde att den bara skickades manuellt från test-/admin-verktyg, aldrig
periodiskt.

**Plan:**
- Lägg till periodisk ping/pong (client → server heartbeat) i kioskens
  websocket-klient för att upptäcka tysta frånkopplingar, inte bara
  `close`-events.
- Undersök om samma sak gäller adminpanelens live-socket
  (`AdminSessionOverview.tsx`).
- Städa bort kvarglömda debug-loggar i samma kodväg (se nästa punkt).

**Genomfört:**
- Ny delad hjälpare `packages/frontend/src/socket/heartbeat.ts`
  (`startHeartbeat`): skickar `{ name: "heartbeat" }` var 5:e sekund och
  räknar missade ekon; efter 2 missade (~15 sekunder totalt) anses
  anslutningen död.
- Backendens befintliga `heartbeat`-eko (`session.socket.ts`) återanvänds
  oförändrat i övrigt, men `requireAuth`-kravet togs bort – heartbeat är nu
  en ren transportkontroll, oberoende av sessionens auth-status.
- Viktig upptäckt under implementation: att bara anropa `socket.close()` vid
  timeout räcker inte – ett `close()`-anrop kan inte slutföra sin handskakning
  på en redan död anslutning heller, så det väntar tyst tills nätverket
  kommer tillbaka (samma problem heartbeaten skulle lösa). Lösningen
  triggar därför reconnect-/felhanteringslogiken direkt från
  heartbeat-timeouten, med en idempotens-spärr ifall ett riktigt
  `close`-event ändå kommer senare.
- **Kiosk** (`SocketLoader.tsx`): heartbeat-timeout triggar samma
  reconnect-backoff som ett riktigt `close`-event. Backoff-konstanterna
  (`MAX_RECONNECT_ATTEMPTS`, `reconnectDelay`) flyttades till en delad
  `packages/frontend/src/socket/reconnect.ts`.
- **Admin** (`AdminSessionOverview.tsx`): samma heartbeat-detektion, men
  medvetet begränsad till detektion + befintlig "connection closed"-toast
  (ingen auto-reconnect) – operatören klickar "Connect" igen manuellt, som
  idag. Auto-reconnect för adminpanelen prövades men backades ut igen för
  att hålla ändringen fokuserad; kan tas upp som en egen punkt senare om det
  behövs.
- Städade bort kvarglömda `console.log`-brus i samma kodväg:
  `"Message from server:"` (loggade varje inkommande frame),
  `"WebSocket connection established"`, `"WebSocket connection closed"`
  (`api/session.ts`) samt en död kommentar i `api/typedSocket.ts`.
- Nya enhetstester i `packages/frontend/src/socket/heartbeat.test.ts`
  (skick-kadens, eko-reset, dödsdetektion, `stop()`, no-op på stängd socket).

### Automatisk stängning av session efter timeout

`[x]` Implementerad 2026-07-09. Källa: Kår "Stäng sessionen automatiskt
efter x sekunder... På sista skärmen, kortare tid."

Fanns inte alls tidigare. `CheckinSession`-modellen hade en kommentar
(`schema.prisma:53`) om att en expiry-tid vore bra, men inget var
implementerat.

**Beslut:** ett timeout-avbrott är en riktig backend-åtgärd – sessionen
markeras aktivt som avbruten i databasen (`abortedAt`), inte bara en tyst
frontend-reset. Ger spårbarhet i historik/rapporter.

Uppföljande fråga under implementationen: bör användaren kunna avbryta
timeouten, och bör backend i så fall pusha ett "kommer snart avbrytas"-
meddelande med tidsstämpel innan den faktiska avbrytningen? Beslut: nej –
timern och nedräkningen är helt klientsidan; backend involveras först när
avbrottet faktiskt utlöses. Slipper en ny websocket-meddelandetyp, en extra
tur-och-retur och klocksynk-problem mellan klient och server.

**Genomfört:**
- Nytt fält `abortedAt DateTime?` på `CheckinSession`
  (`packages/backend/prisma/schema.prisma`), bredvid `completedAt`.
- Ny `abortSession(sessionId)` i `session.service.ts` – idempotent, no-op om
  sessionen redan är `completed`/`aborted`.
- Ny inkommande websocket-rutt `session:abort` i `session.socket.ts`
  (samma `requireAuth`-mönster som `step:goBack`): anropar `abortSession`
  och broadcastar sedan det redan existerande `session:terminated`-
  meddelandet – ingen ny meddelandetyp behövdes, klienten återgår redan
  till startskärmen på det meddelandet. `auth.socket.ts` kollar numera även
  `abortedAt` vid reconnect (samma mönster som `completedAt`), så en
  avbruten session inte återupptas om klienten återansluter.
- Frontend: rent klientside-timerlogik i
  `packages/frontend/src/components/kiosk/idleTimer.ts` (ramverksoberoende,
  samma stil som `heartbeat.ts`) – 45 sekunders inaktivitet startar en
  10 sekunders nedräkning; all DOM-aktivitet (pointer/tangent/touch) på
  `window` återställer den. `IdleTimeout.tsx` kopplar ihop detta med
  sessionens `currentScreenAtom` (bara aktiv medan en skärm faktiskt visas)
  och visar en nedräkningsoverlay (`Är du fortfarande där?`). Ingen egen
  "jag stannar kvar"-knapp – vilken DOM-interaktion som helst avbryter
  redan nedräkningen, en separat knapp vore redundant. Overlayns bakgrund
  (`bg-black/40 backdrop-blur-xs`) återanvänder samma scrim-stil som
  `BottomSheet` (numpad-overlayn); kortet har en konstant bredd (`w-lg`)
  så att det inte ändrar storlek när nedräkningstexten byter längd, och
  rubrik/text återanvänder samma storleksklasser som förstasidans
  hero-rubrik/text (`StartContent.tsx`).
- Manuell återställningsknapp "Börja om" i `HeroLayout.tsx`/`_kiosk/index.tsx`
  provades bredvid "Gå tillbaka" (skickade samma `session:abort`, för när en
  ny person kommer fram innan timeouten hunnit slå till), men togs bort igen
  (`39ed97b`, 2026-07-09): risk för att operatören klickar den av misstag och
  avslutar en session i onödan. Den automatiska idle-timeouten (45s/10s ovan)
  täcker samma scenario utan den risken.
- `sessions.admin.routes.ts` exponerar nu `completedAt`/`abortedAt` i
  admin-API:t, så avbrutna sessioner syns skilt från slutförda.
- Enhetstester i `idleTimer.test.ts` (8 st, fake timers) samt manuellt
  end-till-ände-testad hela vägen: nedräkning visas, aktivitet avbryter
  nedräkningen, fullbordad timeout skriver `abortedAt` och återgår till
  startskärmen utan auto-restart, "Börja om" gör samma sak omedelbart.
- **Avgränsat till kioskflödet** (`_kiosk/index.tsx`) för v1 – mobilflödet
  (`link.$linkId.tsx`) och `kiosk-frame.tsx` har ingen idle-timeout ännu.
- **Medvetet avgränsat/uppskjutet:** ingen kortare timeout på sista skärmen
  än – uniform 45s/10s överallt i v1. Den skiljda sista-skärm-tiden från
  originalanteckningen är kvar som en framtida finjustering, inte blockerad
  av något.

### Felhantering vid tappad anslutning under inmatning

`[x]` Implementerad 2026-07-09. Källa: Kår "Bättre felhantering... T.ex. man
skriver personnummer, men inget händer."

Bekräftat: alla sändningar (`ScreenRenderer.tsx` och ~9 andra ställen) gick
via den delade `createTypedSocket`-wrappern utan att kolla `readyState` – om
anslutningen är död men inget `close`-event hunnit köra syns inget alls för
användaren. Enda feedbacken var en fullskärms "Återansluter..."-overlay som
bara triggades av faktiska close-events (och, sedan
[heartbeat-punkten](#websocket-krascher-och-tyst-frånkoppling), av
heartbeat-timeout).

**Plan:**
- Kolla `readyState` innan send, visa omedelbar felindikation om socket inte
  är öppen.
- Koppla ihop med heartbeat-arbetet ovan så tysta frånkopplingar upptäcks
  snabbare och overlayn triggas proaktivt istället för reaktivt.

**Genomfört:**
- Fixat en gång vid den delade väggenomgången istället för vid varje enskilt
  sändningsställe: `createTypedSocket` (`api/typedSocket.ts`) tar nu en
  valfri `onSendFailure`-callback; `send()` kollar `readyState !== OPEN` och
  anropar den istället för att skicka in i tomma intet. Alla ~10
  sändningsställen (bl.a. `ScreenRenderer.tsx`) täcks automatiskt utan
  ändringar i respektive fil, eftersom de redan går via samma wrapper.
- `SocketLoader.tsx`: `handleDisconnect` flyttades till att definieras innan
  socketen skapas och kopplas in som `onSendFailure`, så den konvergerar med
  samma reconnect-/overlay-flöde som heartbeat-timeout och `close`-events
  redan använder (samma idempotens-spärr täcker nu alla tre triggers).
- Nya enhetstester i `packages/frontend/src/api/typedSocket.test.ts`
  (öppen/stängd/utan-callback-fallen).
- **Viktig avgränsning, verifierad under manuell test:** detta täcker bara
  sändningar när `readyState` redan är `CONNECTING`/`CLOSING`/`CLOSED` (t.ex.
  ett klick under reconnect-fönstret efter ett riktigt close-event). En
  genuint tyst frånkoppling (t.ex. wifi som dör) gör inte att `readyState`
  ändras – webbläsaren har ingen signal om att anslutningen är död förrän
  något faktiskt misslyckas, så `send()` "lyckas" fortfarande lokalt. Det
  fallet fångas även fortsatt bara av heartbeaten (~10–15 sekunder), inte av
  denna ändring – de två mekanismerna är komplementära, inte överlappande.

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

`[x]` Implementerad 2026-07-09. Beslut 2026-07-08: kräv bekräftelse. Källa:
Kår "Man kan checka in flera gånger."

Bekräftat: `markConfirmedCheckedIn`/`markPreliminaryCheckedIn` skriver bara
över tidsstämpeln, ingen spärr. Dedupe av sessioner
(`base:deduplicateSession`) gäller bara *pågående* sessioner för samma
aktör – en redan avslutad session hindrar inte en ny session från att checka
in samma deltagare igen.

**Beslut:** ett andra incheckningsförsök ska inte blockeras helt och inte
vara helt tyst tillåtet – operatören ska få en bekräftelsedialog ("redan
incheckad kl X, checka in igen?") och själv välja om det ska genomföras.

**Omprövning under design:** "operatören" är inte samma person i alla flöden.
För `staff`/`stormote6_ordinary` (on-site-egenincheckning) sätter
`base:setActorAsSubject` aktören som sin egen enda subject – personen som
svarar på bekräftelsedialogen är alltså den incheckade själv, inte en
tredje part med överblick. För `groups` (kårledare) är aktör och subjects
olika personer, men där finns inget "klart"-tillstånd att skydda – en
ledare förväntas slutföra flera sessioner under dagen (en session per
omgång scouter), så att flagga "du har redan en avslutad session" hade gett
falska positiva varje gång efter första omgången.

**Slutgiltigt beslut:** bekräftelsen gäller enbart on-site-
egenincheckningen (`staff`/`stormote6_ordinary`). Kårledarflödet lämnas helt
orört. Byggd som en ny egen kontroll på deltagarens riktiga
incheckningsstatus (`Participant.confirmedCheckedInAt`) – inte som en
utbyggnad av `base:deduplicateSession`, vars nyckel (aktör +
`configFile` + `completedAt: null`) är fel granularitet för detta: den ser
bara sessioner, inte deltagarens faktiska status, och skulle behöva en
separat undantagsgren för kårledarflödet ändå.

**Genomfört:**
- Ny egen steg-typ `base:confirmReCheckin`
  (`plugins/base/src/confirmReCheckin/backend/confirmReCheckin.ts`), samma
  mönster som `base:deduplicateSession` (villkorad skärm + publicMethod för
  att gå vidare).
- `onStepStart` läser aktörens `Participant.confirmedCheckedInAt` direkt.
  `null` → `setCompleted()` utan att visa något (vanliga, förstagångsfallet,
  ingen friktion). Satt → visar `base:confirmReCheckin:confirm` med namn och
  tidigare incheckningstid.
- Skärmen (`ConfirmReCheckinScreen.tsx`, `@scouterna/ui-react`) har två
  knappar: "Ja, checka in igen" anropar stegets `confirm`-metod och flödet
  fortsätter till `base:markConfirmedCheckedIn` som vanligt (skriver bara
  över tidsstämpeln, ingen ny rad); "Avbryt" skickar samma `session:abort`
  som redan används av idle-timeout-flödet – inget nytt backend-meddelande
  behövdes.
- Villkorad i `packages/backend/config/stepConfig.yml` på samma
  `staff`/`stormote6_ordinary`-gren som `base:setActorAsSubject`, placerad
  direkt efter den och före `base:selectSubjects`/`base:markConfirmedCheckedIn`.
  `stepConfig.pre-checkin.yml` (mobilflödet, alltid `groups`,
  `markPreliminaryCheckedIn`) är oförändrad.

### Bekräftelse-checkbox på sista skärmen

`[x]` Implementerad 2026-07-09. Beslut 2026-07-08: generell flagga på
`base:message`. Källa: Kår "Ingen läser texten på sista skärmen...
checkbox för att intyga att man läst."

Verifierat: inget checkbox-/samtyckesmönster finns någonstans i kodbasen
idag (`plugins/base/src/selectSubjects` har en checkbox, men den är för att
välja deltagare, inte för samtycke).

**Beslut:** ingen ny stegtyp – lägg till en valfri `requireAcknowledgement`-
flagga direkt på `base:message`, återanvändbar av alla message-steg (t.ex.
även [dubbel-incheckning](#förhindra-dubbel-incheckning) ovan).

**Genomfört:**
- Ny valfri `requireAcknowledgement`/`acknowledgementText`-input på
  `base:message` (`plugins/base/src/message/backend/message.ts`),
  vidareskickad till skärmen oförändrad.
- `MessageScreen.tsx` visar en `ScoutCheckbox` när flaggan är satt och
  håller bekräfta-knappen inaktiverad tills den är ikryssad; utan flaggan
  är beteendet identiskt med tidigare (ingen checkbox, knappen alltid
  aktiv).
- Enbart aktiverad på sista steget i on-site-flödet
  (`packages/backend/config/stepConfig.yml`, "Incheckning lyckades"-
  steget efter `base:markConfirmedCheckedIn`). Mobilflödets
  `base:message` (`stepConfig.pre-checkin.yml`) lämnat oförändrat utan
  flaggan.
- Kryssningen kontrolleras bara i klienten (knappens `disabled`-state) –
  backendens `confirm`-metod litar på det och sätter alltid `completed`
  när den anropas, samma mönster som andra publicMethods i denna app.

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

`[?]` Källa: Funk "Lägg till en kryssruta för de som skickats till
infotältet. Specialkost, belastningsregister etc."

Finns inte. Ingen sådan flagga i datamodellen eller stegkonfigen.

**Plan:**
- Lägg till ett fält (t.ex. `sentToInfoTent: Boolean` eller liknande) på
  check-in-statusen per deltagare, eller som en generell steg-output som
  sparas i `CheckinSessionStepData`.
- Bygg en kryssruta i relevant steg-skärm.
- Detta är en av datapunkterna som ["Rapporter"](#rapporter-incheckade-saknade-ofullständiga)
  ska kunna lista.

**Omprövning 2026-07-10 – uppskjuten, osäker om den hör hemma här:** vid
genomgång ifrågasattes om en manuell "skickad till infotältet"-markering
överhuvudtaget hör hemma i ett incheckningssystem. Ursprungsönskemålet
blandar två olika saker:

1. *Synliggöra vilka som behöver extra hjälp* (specialkost,
   belastningsregister, Trygga Möten) – detta är riktig incheckningsdata som
   ändå kommer via enrichers (se
   [specialbehov](#specialbehov-för-funk-kost-medicin-period) och
   [Trygga Möten](#trygga-möten--belastningsregister--riktig-implementation)
   i Fas 5) och hör hemma *automatiskt* i
   [rapportvyn](#rapporter-incheckade-saknade-ofullständiga), inte som en
   manuell kryssruta.
2. *Spåra det manuella överlämnandet/åtgärdsstatusen* ("vi skickade dit dem /
   det är hanterat") – detta är operativ ärendestatus, inte närvaro eller
   importerad data, och är dessutom sammanflätat med den ännu obeslutade
   policyfrågan
   [infotältets process](#infotältets-process-för-att-ändra-anmälningsdata).

**Beslut:** avvaktar. Den värdefulla halvan (synlighet) hamnar naturligt i
rapportvyn och beror på Fas 5-enrichers; den manuella markeringshalvan kanske
inte behöver byggas alls om infotältet har en egen process. Tas upp igen när
enrichers finns och infotältsprocessen är beslutad.

---

## Data: import, validering och berikning

### Generisk import-berikning (enrichers)

`[x]` Implementerad 2026-07-10. Design klar via diskussion 2026-07-08. Källa:
Kår "Personer och grupper måste kunna ha metadata."

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

**Genomfört:**
- `metadata Json?` och `hasImportError Boolean @default(false)` tillagt på
  både `Participant` och `ParticipantGroup` (`schema.prisma`), plus
  `deletedAt DateTime?` på `Participant` (se
  [avanmälda-punkten](#avanmälda--kommer-nej-hantering) nedan).
- `registerImportEnricher(enricher)` tillagt i `BackendPluginContext`
  (`packages/plugin-api/src/backend/index.ts`) – varje enricher deklarerar
  `name`, `target: "participant" | "group"` och en `enrich(entity, ctx)`.
  Ny `EnricherRegistry` (mirror av `StepRegistry`,
  `core/workflow/enricherRegistry.ts`), instansierad och kopplad in i
  `domains/workflows/steps.ts` – populeras av samma `loadPlugins()`-loop som
  redan finns, inget nytt vid pluginladdning.
- `enrichWith?: Record<string, string>` (metadatanyckel → enricher-namn)
  tillagt på `BaseDataSource` (`config/baseDataSource.ts`), tillgängligt för
  alla providers. Ingen ändring behövdes i `dataSourceConfigLoader.ts` – den
  validerar/substituerar env-variabler generiskt via arktype.
- Enrichers körs i en ny delad `reconcileDataSource(dataSourceName,
  processedIds, enrichWith)` i `data.service.ts`, anropad från
  `loadDataSourceIntoDatabase` efter att providerns import lyckats (samma
  pass som avanmälda-hanteringen nedan). Resultat skrivs read-modify-write
  till `metadata[nyckel]` – aldrig platt sammanslaget.
- Demo-enricher `test:staticGroupTag` (`plugins/malcolm-test`) verifierar
  hela vägen (registrering → config → körning → skriven metadata) utan
  beroende av riktig extern data; kopplad in i `config_dev/dataSourceConfig.yml`.
  Ingen riktig by/specialbehov-enricher byggd än (kräver extern datakälla,
  se [kårinfo](#kårinfo-by-stadsdel-via-berikning) och
  [specialbehov](#specialbehov-för-funk-kost-medicin-period)).
- Verifierat end-to-end mot både mockad Prisma (7 enhetstester,
  `data.service.test.ts`) och riktig dev-databas + riktig plugin-registry
  (engångsskript mot en isolerad testdatakälla, 13 kontroller): registrering,
  berikning + metadata-isolering per nyckel, självläkning, felflagga vid
  kastning (bara den entiteten), grupputeslutning.
- Backend hade inget testverktyg alls sedan tidigare – Vitest introducerat
  (`vitest.config.ts`, `pnpm test`) som en del av detta arbete.

### Filtrera bort deltagare/grupper med importfel

`[x]` Implementerad 2026-07-10. Källa: uppföljning på ovan – vad händer när
import eller en enricher faktiskt misslyckas.

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

**Genomfört:**
- Båda filtren implementerade i `data.service.ts`:
  `findParticipantsByLookupValue` exkluderar `hasImportError`/`deletedAt`;
  `getSubjectCandidates` exkluderar felmarkerade/borttagna deltagare i
  gruppen, och returnerar tomt om själva gruppen har `hasImportError`.
  `markConfirmedCheckedIn`s egna inline-fråga (i `plugins/base`) fick samma
  filter på sin nästlade `participants`-relation, så `unselectedGroupIds`
  inte räknar med felmarkerade/borttagna medlemmar.
- Providers (`scoutnet.ts`, `googlesheets.ts`) sätter `hasImportError: false`
  på varje lyckad upsert (self-heal) och `hasImportError: true` på en
  redan importerad rad vars data misslyckas denna cykel (ny post: hoppas
  över tyst, som idag) – omräknat helt varje cykel, inte ackumulerande.

**Uppföljning 2026-07-10 – `importErrors`:** genomgång av "hur ser vi
felen?" avslöjade att `hasImportError` som ren boolean inte höll: flera
samtidiga felkällor på samma entitet (t.ex. en enricher som kastar samtidigt
som en annan lyckas, eller ett providerfel som sammanfaller med ett
enricher-fel) kollapsade till en enda boolean utan att gå att skilja åt –
och en senare lyckad enricher kunde tyst dölja att en *annan* källa
fortfarande var trasig. Det ursprungliga beslutet ("logga med
`console.warn`, ingen separat felloggtabell") hade inte resonerat kring
flerkälle-fallet.

Löst med ett nytt `importErrors: Json?`-fält (samma modeller), en platt
karta nyckel → anledning: `"provider"` för råa import-/valideringsfel,
annars enricherns eget registernamn. Varje skrivare rör bara sin egen nyckel
(read-modify-write, samma mönster som `metadata`), så flera samtidiga fel
skrivs och läks oberoende av varandra. Providernas blinda `updateMany`-
flaggning (utan föregående läsning) gör ett platt `{ provider: anledning }`-
överskrivning medvetet, snarare än att slå ihop – motiverat i koden, eftersom
`reconcileDataSource`s enrichpass körs direkt efter i samma cykel och ändå
skriver om varje enrichers egen nyckel.

**Omtag samma dag – kollapsade bort `hasImportError`:** en första version
behöll `hasImportError`-booleanen som en materialiserad spegling av "kartan
är icke-tom", men det innebar två fält som hölls i synk enbart via konvention
över sju skrivställen – exakt den sortens invariant som ruttnar när ett
åttonde skrivställe glömmer att sätta båda. Booleanen togs därför bort helt;
`importErrors` är nu enda sanningskällan (icke-tomt objekt = fel; SQL `NULL`
eller `{}` = rent). De tre uppslagsställena filtrerar på ett delat
`NO_IMPORT_ERROR_WHERE`-fragment (`data.service.ts`, återexporterat via
`plugin-services.ts` för `markConfirmedCheckedIn`), och gruppkontrollen i
`getSubjectCandidates` använder en delad `hasImportErrors()`-hjälpare – båda
kodar predikatet på exakt ett ställe. Exakt Prisma-filtersyntax för "tomt
eller null jsonb" bekräftades empiriskt mot dev-databasen först (JSON-null-
filtrering är Prismas största fotskott). Notera: en okänd kolumn i en
Prisma-`data`/`update` typcheckar *inte* som fel med denna generator – att
alla `hasImportError`-skrivningar togs bort verifierades med grep + körning,
inte av `tsc`. Verifierat med 11 enhetstester (inkl. regressionsfallet: två
enrichers på samma entitet, en kastar och en lyckas, den lyckade får inte
rensa den andras nyckel) samt engångsskript mot riktig databas.

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

`[x]` Implementerad 2026-07-10. Beslut 2026-07-08: samma signal som
`cancelled`. Källa: Kår "Avanmälda och 'Kommer du: Nej' kan checka in."

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

**Genomfört:** (löser båda TODO:erna i `scoutnet.ts:99-105`)
- **Beslut under implementation:** soft-delete (ny `deletedAt DateTime?` på
  `Participant`) istället för hård borttagning – bevarar
  `CheckinSubject`/`CheckinActor`-historik. Ingen anonymisering av
  personuppgifter ännu (kvarstår som framtida hårdning).
- `reconcileDataSource` (`data.service.ts`) sätter `deletedAt` på alla
  deltagare för datakällan vars `idInDataSource` inte fanns med i cykelns
  bearbetade mängd (dit `cancelled`-filtrerade deltagare aldrig når, se
  `getParticipants` i `scoutnet.ts`) – omräknat helt varje cykel. En
  deltagare som återkommer i ett senare import självläker automatiskt via
  providerns vanliga upsert (`deletedAt: null`).
- `findParticipantsByLookupValue`/`getSubjectCandidates` exkluderar
  `deletedAt`-satta rader (samma filter som `hasImportError`, se ovan).
- Google Sheets-providerns tidigare tysta no-op vid tomt ark
  (`rows.length < 2`) kastar nu istället ett fel – annars hade en
  övergående tom hämtning tolkats som "alla deltagare borta" och
  soft-deletat samtliga för den datakällan.

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

`[x]` Implementerad 2026-07-10. Källa: Allmänt "Adminvyn: Gör den enklare att
använda. Avskalat interface utan 'New' → 'Connect'-grejset."

Bekräftat vid genomgång: `SessionTable.tsx` har en "New session"-knapp, och
`AdminSessionOverview.tsx` har en separat "Connect"-knapp som öppnar en
live-speglande websocket + rå meddelandelogg + debugpanel. De tre tidigare
kända layoutändringarna (ta bort call-method-UI, flytta loggen längre ner,
deduplicera steg-vyn) visade sig redan vara åtgärdade i huvudgrenens kod –
ingen "Call method"-sektion finns längre (bara "Go back"), meddelandeloggen
ligger redan under skärmvyn, och `SessionDetail` renderar inte längre en
duplicerad stegtidslinje.

**Omprövning under design:** att skala bort "New"/"Connect" från den
befintliga live-/debug-vyn hade gjort den mindre användbar för utveckling
utan att lösa det faktiska behovet bakom önskemålet. Det som efterfrågades
var egentligen en möjlighet att checka in utan fysisk kiosk – på vissa event
checkar personal in deltagare manuellt, och det borde fungera som
kioskflödet men med lätt extra info. **Beslut:** bygg en ny, avskalad vy
istället för att skala ner den gamla – den befintliga debug-/live-panelen
(`AdminSessionOverview`) lämnas orörd som utvecklarverktyg, oförändrad.

**Genomfört:**
- Ny sida **Incheckning** (`/admin/checkin`, `routes/admin/checkin.tsx` +
  `components/admin/StaffCheckin.tsx`), ny post i adminmenyn
  (`AdminLayout.tsx`). Kräver ingen kiosk-nyckel/`/setup`-aktivering – bara
  admininloggning.
- Kör on-site-flödet (`stepConfig.yml`) helt oförändrat via en ny
  `POST /admin/sessions` → `POST /admin/sessions/:id/token`-helper
  (`createAdminSession`, `api/session.ts`), och återanvänder `SocketLoader`
  + `ScreenRenderer` rakt av – samma skärmar som fysiska kiosken, ingen ny
  stegkonfig.
- Ingen idle-timeout (personal är närvarande); en "Nästa person"-knapp visas
  när flödet är klart istället för kioskens auto-restart, eftersom denna vy
  inte monterar `StartContent` (som annars konsumerar
  `pendingAutoRestartAtom`).
- Ny sidopanel **Extra info** (`StaffInfoPanel.tsx`) som pollar en ny
  staff-only backend-rutt `GET /admin/sessions/:id/context`
  (`getSessionContext`, `session.service.ts`) – visar
  incheckningsstatus/-historik, importvarningar och metadata för
  aktör/subjects/kår. Frågan kringgår medvetet samma
  importfel-/borttagnings-filter som kiosk-uppslagen använder
  (`NO_IMPORT_ERROR_WHERE` m.fl.) – personal ska se datafel som kiosken
  gömmer, inte ha dem tyst bortfiltrerade.
- Statuskolumn (Pågår/Slutförd/Avbruten) tillagd i `SessionTable.tsx`,
  härledd från `completedAt`/`abortedAt`.
- Tre buggar hittade och fixade under manuell verifiering, alla i delad
  socket-infrastruktur (`socket/SocketLoader.tsx`):
  - Lämnade man vyn mitt i ett flöde stängdes websocketen aldrig –
    `SocketLoader` städade bara bort heartbeat-/reconnect-timern vid
    unmount, inte själva anslutningen, vilket lämnade `socketAtom` populerad
    och fick nästa montering att tyst hoppa över anslutning (samma "koppla
    inte om det redan finns en socket"-spärr som orsakade en liknande bugg
    vid själva förstamonteringen). Löst med en ny `onBeforeClose`-hook plus
    en unmount-only cleanup som stänger och nollar atomen, samt en
    `isMountedRef`-spärr så att den stängningen inte själv triggar en
    återanslutning.
  - Lämnade man vyn mitt i en incheckning markeras sessionen numera som
    avbruten (`session:abort` skickas via `onBeforeClose`, no-op om redan
    klar/avbruten) – annars låg den kvar som "Pågår" för alltid.
  - StrictMode:s dubbelanrop av effects i dev skapade två sessioner per
    montering; fixat med samma "endast en gång"-ref-mönster som
    `SocketLoader` redan använder.
- Incheckningsytans höjd är medvetet begränsad (skärmrelativ, inte
  innehållsstyrd) så att ett kiosksteg med godtyckligt högt innehåll (t.ex.
  en lång deltagarlista) aldrig trycker ner hela adminsidan.
- Ny backend-testfil `session.service.test.ts` (6 tester) för
  `getSessionContext`.

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
