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

`[x]` Implementerad 2026-07-11. Källa: Kår "Skärmen för Trygga Möten
och belastningsregister bör göras bra... olika ut för funk och kår."

Historik: dagens `scoutnet:checkLeaderRequirements`-plugin var en **fejk** –
den slumpade en varning (50/50 baserat på en hash av *aktörens* UUID, inte
per vald deltagare) och visade hårdkodade påhittade namn ("Annette Hittepå",
"Frans Finnsinte"). Den var dessutom bara inkopplad i **on-site-flödet**
villkorat på `dataSource == 'groups'` (kårledare) – aldrig för `staff`
(funktionärer), som är den faktiska målgruppen för denna kontroll.

**Blockeraren löstes:** `@scouterna/scoutnet`-klienten (uppdaterad till
0.3.26) exponerar nu `pc_details` (registerutdrag) och `pc_courses`
(kurs-id → klardatum per medlem; Trygga Möten = kurs-id `"89"`) via
`/project/get/participants` – samma endpoint importen redan anropar, ingen
ny endpoint eller separat beställning behövdes för själva API-åtkomsten.
Korrigering under implementationen: registerutdrag rapporteras av Scoutnet
enbart som giltigt/tomt, aldrig en tredje "flaggad"-status.

**Design (beslutad under implementation):**
- Byggt som **enrichers** (import-tidsögonblicksbild), inte hårdkodat i
  providern eller som en per-sessions live-koll – samma data ska senare
  kunna backa pre-camp-rapporten ("funktionärer som saknar TM/registerutdrag",
  se ["Rapporter"](#rapporter-incheckade-saknade-ofullständiga)).
- **Capture-at-import:** den råa Scoutnet-posten (med `pc_details`/
  `pc_courses`, som annars försvinner vid arktype-valideringen till appens
  egen `Participant`-modell) trådas genom en ny `sourceRecord`-nyckel på
  `ImportEnricherContext` (`packages/plugin-api/src/backend/index.ts`), via
  en ny `sourceRecords`-karta i `DataSourceImportResult`
  (`data.service.ts`/`scoutnet.ts`) – ingen extra API-anrop, inga
  Scoutnet-nycklar i pluginet.
- **Registerutdrag = union av två källor:** Scoutnets `pc_details.valid`
  (primär) ELLER en backfill-lista nyckling på medlemsnummer (för
  IST/internationell personal som inte finns i det svenska registret).
- **Trygga Möten = samma mönster:** Scoutnets `pc_courses["89"]` (primär)
  ELLER en egen backfill-lista, för funktionärer vars avklarande inte fångas
  i Scoutnets egna kursdata.
- Båda backfill-listorna är i dagsläget **mockade** (tomma, säddbara i kod)
  – avsedda att bli en SharePoint-lista senare; enrichern som anropar dem
  behöver inte ändras när den riktiga källan kopplas in.
- **Blockeringsregel:** fortsätt bara om båda kontrollerna är OK; annars
  `session:abort` (samma mekanism som idle-timeout/confirmReCheckin's
  avbryt), med text som anger *vilken* kontroll som brustit. Inget
  operatörs-override, ingen riktad enskild re-enrichment – fixen vid ett
  fel är att åtgärda status och köra om importen.
- Namngivning: "Trygga Möten" → `safeFromHarm` i kod, "registerutdrag" →
  `criminalRecordExtract` i kod (engelska identifierare). Den svenska
  kioskskärmstexten ("Trygga Möten saknas" / "Registerutdrag saknas") är
  oförändrad – funktionärerna som checkar in är svensktalande.

**Genomfört:**
- Ny plugin `plugins/scoutnet/` (den gamla fejken borttagen helt, inklusive
  `checkLeaderRequirements.ts` och dess skärm) med två enrichers
  (`scoutnet:safeFromHarm`, `scoutnet:criminalRecordExtract`) och ett
  gate-steg (`scoutnet:complianceGate`).
- `scoutnet:complianceGate` villkorat enbart på `dataSource == 'staff'` i
  `packages/backend/config/stepConfig.yml`, placerat direkt efter
  `base:confirmReCheckin` och före `base:markConfirmedCheckedIn` – kontrollen
  ska stoppa flödet innan någon annan data visas.
- `dataSourceConfig.yml`: ny `enrichWith`-mapp på `staff`-källan
  (`safeFromHarm`/`criminalRecordExtract` → respektive enricher-namn).
- 22 enhetstester i `plugins/scoutnet` (enrichers + gate-steget, inklusive
  fail-safe-fallen: trasig eller saknad metadata blockerar, tolkas aldrig
  tyst som godkänt) plus 2 nya tester i `data.service.test.ts` för
  `sourceRecord`-trådningen genom `reconcileDataSource`.
- Verifierat end-till-ände mot ett riktigt Scoutnet-projekt (id 52716, 1501
  funktionärer) via `run-scoutin`-skillen: en fullt godkänd person checkar
  in tyst hela vägen till "Incheckning lyckades"; ett Trygga Möten-enda-fel
  respektive ett registerutdrag-enda-fel visar varsin korrekt avgränsad
  varningsruta (bara den brustna kontrollen nämns); backfill-vägen
  verifierades genom att tillfälligt sädda ett riktigt medlemsnummer i
  listan, bekräfta att metadatan växlade till `source: "backfill"` och att
  personen checkades in, därefter återställt (ingen testdata kvar i
  committad backfill-lista).
- Under granskningen hittades och fixades en separat, obesläktad bugg:
  `identify.ts` kraschade ("Data source with name X not found in config")
  när en tidigare importerad rad tillhörde en datakälla som sedan tagits
  bort ur `dataSourceConfig.yml` – filtreras nu bort tyst i stället för att
  krascha (se `todo.md` för önskemål om loggning/varning av detta i
  framtiden, så det inte går obemärkt förbi).

**Kvarstår (separata framtida punkter, ej blockerande):**
- Riktig SharePoint-backad backfill-källa för båda kontrollerna (mockad
  och tom just nu, se ovan).
- Giltighetsdatum kontra eventets längd – om Trygga Möten/registerutdrag
  löper ut mitt under ett flerdagarsevent räcker inte en enkel
  giltig/ogiltig-koll vid importtillfället.
- Rapportering av compliance-status för *alla* deltagare, inte bara via
  funktionärsgaten (t.ex. för kårledarflödet, där det inte finns någon gate
  men överblick ändå kan vara värdefull).
- Copy på varningsskärmen kan komma att omarbetas.
- Bör enrichers kunna deklarera vilken/vilka datakällor de förutsätter
  (t.ex. Scoutnet-formad `pc_courses`), så en enricher inte råkar kopplas in
  på en datakälla den inte är byggd för?
- Är det säkert att ändra `stepConfig.yml`/`dataSourceConfig.yml` medan ett
  event pågår (sessioner mitt i flödet)? Inte undersökt.

### Specialbehov för funk (kost, medicin, period)

`[x]` Implementerad 2026-07-11. Beslut 2026-07-08: Scoutnet-källa. Källa:
Funk-flöde: "Medicinsk el", "Period", "Specialkost".

Inget av detta fanns i datamodellen tidigare (`Participant` hade bara namn,
grupp, `subGroup`, incheckningstider).

**Beslut:** datan kommer från Scoutnet (anmälningsfrågor), inte manuell
inmatning vid incheckning.

**Blockeraren löstes utan ny endpoint:** till skillnad från vad som antogs
här och i [Avanmälda-punkten](#avanmälda--kommer-nej-hantering) krävdes inget
`/questions`-anrop. Scoutnets `/project/get/participants` (som importen redan
anropar) returnerar varje deltagares svar **inline** som
`questions: { [frågeId]: svar | null }` – samma `sourceRecord`-kanal som
[Trygga Möten](#trygga-möten--belastningsregister--riktig-implementation)
redan läser. `keys.questions` (fråge-*definitioner*/etiketter, inte svar)
förblir därför oanvänd, precis som innan.

**Omtag samma dag – "tre fält" var fel modell:** en första version antog tre
enkla nyckel-fält (`diet`/`medical`/`period`, var sitt fråge-ID). Kår gav
sedan den faktiska frågelistan (`question-ids.md`) – **21 frågor**, inte tre,
och "period" visade sig inte alls betyda mensperiod utan **lägerets
närvaroperioder** ("Jag kan inte delta alla dagar under förlägret/
lägerperioden/efterlägret", var och en en checkbox + en multiselect för vilka
dagar). Specialkost är dessutom 13 enskilda allergen-checkboxar plus ett
fritextfält, inte ett fritt textfält. Hela designen byggdes om:

**Design (beslutad under omtaget):**
- **Enrichern är fullt generisk**, utan domänkunskap om kost/medicin/frånvaro:
  `options.questions` i `enrichWith` är en platt karta
  `fältnamn -> fråge-ID`, godtyckligt stor. Enrichern kopierar bara varje
  konfigurerat fälts råa svar in under sitt fältnamn
  (`metadata.specialNeeds[fältnamn] = ctx.sourceRecord.questions[fråge-ID]`).
  Det krävde att `enrichWith` utökades generiskt: en post kan nu vara antingen
  en bar sträng (`namn: enrichernamn`, som innan) eller ett objekt
  (`namn: { name: enrichernamn, options: {...} }`), där `options` trådas
  igenom till enrichern som en ny `ctx.options`
  (`packages/plugin-api/src/backend/index.ts`,
  `packages/backend/src/config/baseDataSource.ts`). Bakåtkompatibelt – alla
  befintliga sträng-enrichWith-poster (`safeFromHarm`, `criminalRecordExtract`)
  är oförändrade. `reconcileDataSource` och rapportvyns
  `splitMetadataColumns` (`reports.service.ts`) normaliserar via en delad
  `resolveEnrichEntry`-hjälpare (`data.service.ts`).
- **Grupperingen/tolkningen ligger i steget, inte enrichern.** Steget
  (`scoutnet:specialNeeds`) känner en fältnamnskonvention (`dietGluten`,
  `dietOther`, `medicalElectricity`, `absenceForlagerLimited`/
  `absenceForlagerDays` osv – en per lägerperiod) och bygger tre kurerade
  sektioner till skärmen: **Specialkost** (bara ikryssade allergener som en
  lista + ev. fritext), **Medicinskt behov** (el-checkbox), **Frånvaro**
  (en rad per lägerperiod, bara om just den periodens "kan inte delta alla
  dagar"-checkbox är ikryssad, med vilka dagar om angivet). Detta är en
  medveten avvägning: att återanvända samma tre kategorier för ett framtida
  event kräver bara konfigändring (nya fråge-ID:n), men en helt ny kategori
  kräver kodändring i steget. Alternativet (etiketter också i config, helt
  generisk radvis-rendering utan kategorisering) valdes bort – sämre UX för
  detta konkreta, kända frågeset.
- **Checkbox-tolkning är en overifierad heuristik:** `isChecked()` behandlar
  varje värde som inte är `null`/`""`/`"0"`/`"false"` som ikryssad – fail-open
  (visar hellre info än gömmer den) i brist på ett bekräftat exempel på hur
  Scoutnet faktiskt kodar en ikryssad checkbox i `questions`-kartan.
  **Kvarstår:** verifiera mot riktig data och skärp om det behövs.
- **Medveten avvägning kring synlighet:** i on-site-funktionärsflödet är
  personen som checkar in sitt eget subject
  (`base:setActorAsSubject`) – skärmen visar alltså funktionären sina egna
  registrerade uppgifter på kiosken (axelkikning möjlig). Detta matchar det
  ursprungliga Stormöte 6-funkflödet och är den explicit valda designen,
  inte en biverkning. Samma skärm syns även i den manuella
  `/admin/checkin`-vyn (den återanvänder `ScreenRenderer`). Villkorad på
  `dataSource == 'staff'` i `stepConfig.yml`, placerad direkt efter
  `scoutnet:complianceGate` (en blockerad person når den aldrig) och före
  `base:markConfirmedCheckedIn`.
- Medvetet **inte** byggt: hämtning av mänskligt läsbara fråge-*etiketter*
  via `/project/get/questions` + den vilande `keys.questions` – etiketterna
  (svenska namn för alla 21 frågor) är istället hårdkodade i steget, se ovan.

**Omtag samma dag – flyttad till egen `jamboree26`-plugin:** `staff`-
datakällan (`projectId: 52716`) är inte Stormöte 6-testeventet (det är
`stormote6_ordinary`/`stormote6_late`, båda utkommenterade) utan ett separat,
riktigt event. Fråge-ID:na och deras gruppering (13 allergener,
frånvaroperioder, el-behov) är helt specifika för det eventets
anmälningsformulär – att lägga dem i den delade `scoutnet`-pluginet (som är
tänkt att vara händelseagnostiskt, samma princip som
[generisk import-berikning](#generisk-import-berikning-enrichers)) hade
brutit mot samma regel som `stormote6:villageLookup` redan följer. Flyttat i
sin helhet till en ny `plugins/jamboree26/`, med namnrymden bytt från
`scoutnet:specialNeeds` till `jamboree26:specialNeeds` överallt (enricher-
namn, steg-id, skärmnamn). `question-ids.md` flyttad till
`plugins/jamboree26/question-ids.md` som källdokumentation. `scoutnet`-
pluginet återgår till att enbart innehålla `complianceGate` +
`safeFromHarm`/`criminalRecordExtract` (de är genuint händelseagnostiska
svenska scoutkrav, till skillnad från detta).

**Genomfört:**
- `enrichWith` generisk options-utökning (se ovan) i `baseDataSource.ts`,
  `plugin-api/src/backend/index.ts`, `data.service.ts`, `reports.service.ts`.
- Ny plugin `plugins/jamboree26/` (eget `package.json`, `tsconfig(.backend).json`,
  `vitest.config.ts`, registrerad i `plugins.json` samt som
  `workspace:^`-beroende i `packages/backend`/`packages/frontend`).
  `plugins/jamboree26/src/enrichers/specialNeeds.ts` (fullt generisk, se ovan)
  + steg `plugins/jamboree26/src/specialNeeds/{backend,frontend}/` (kurerad
  gruppering i steget; skärm byggd med `@scouterna/ui-react`,
  `ScoutCallout`/`ScoutButton`, samma mönster som
  `ConfirmReCheckinScreen`/`ComplianceGateBlockedScreen`), båda registrerade
  i `plugins/jamboree26/src/backend.ts`/`frontend.tsx`.
- `dataSourceConfig.yml`: `staff.enrichWith.specialNeeds` (objektform,
  `name: jamboree26:specialNeeds`) med alla 21 verkliga fråge-ID:n från
  `plugins/jamboree26/question-ids.md` inlagda direkt (inga platshållare
  kvar – korrigering av den första versionens tre `REPLACE_ME_*`-
  platshållare, som byggde på en felaktig avgränsning av scopet).
  `stepConfig.yml`: `uses: jamboree26:specialNeeds`.
- 24 nya enhetstester (9 för enrichern, 10 för steget, plus de ursprungliga)
  plus verifiering att alla befintliga `enrichWith`-beroende tester
  (`data.service.test.ts`, `reports.service.test.ts`) fortsatt passerar
  oförändrade med den nya sträng|objekt-unionen. Den nya
  `dataSourceConfig.yml`-posten validerad direkt mot `BaseDataSource`-
  arktype-schemat (fristående skript, kringgår en icke-relaterad cirkulär
  import-kedja som gör att modulen inte går att ladda isolerat via `tsx`
  utanför appens vanliga startordning).
- **Kvarstår innan skarpt event:** verifiera `isChecked()`-heuristiken (se
  ovan) och hela vägen end-to-end mot ett riktigt Scoutnet-projekt (via
  `run-scoutin`-skillen) innan detta är produktionsklart.

**Bugg hittad 2026-07-11 vid faktisk användning – alla fält null:** Kår
rapporterade att informationsskärmen aldrig visades trots faktiska svar.
`metadata.specialNeeds` visade sig innehålla samtliga 21 fält som `null` för
den testade personen. Verifierat direkt mot Scoutnets riktiga API (projekt
52716): fråge-ID:na stämde (samtliga 21 finns i det riktiga svaret), men
enricherns `SourceRecord`-schema (`type.Record("string", "string | null")`)
krävde att **varje** värde i `questions`-kartan var en sträng eller null.
Scoutnets flervalsfrågor (t.ex. våra tre "vilka dagar"-fält) returnerar
istället en **array** av valda alternativ-ID:n – och en enda sådan array
någonstans i en persons `questions`-objekt (vilket gäller så gott som alla,
eftersom flervalsfrågor är vanliga i formuläret) gjorde att **hela**
valideringen av objektet misslyckades, vilket tystade alla 21 konfigurerade
fält till `null`. Bekräftat empiriskt: 1678 av 1813 funktionärer (93 %)
träffades av detta. **Fixat:** schemat vidgat till
`"string | string[] | null"` i både enrichern och steget – 0 av 1813 misslyckas
nu. Nya regressionstester i `specialNeeds.test.ts` (enrichern) täcker exakt
detta fall (en obesläktad flervalsfråga på samma person ska inte kunna
nolla ut resten).

**Uppföljning samma dag – visa etiketter, inte rå-ID:n:** efter buggfixen
visade "vilka dagar"-fälten korrekt data, men som råa Scoutnet-alternativ-ID:n
(t.ex. "61762, 61763, ..."), inte läsbara datum. Löst genom att äntligen bygga
den tidigare medvetet uteslutna fråge-*etikett*-hämtningen: ny
`getQuestionChoiceLabels` i `scoutnet.ts` anropar `/project/get/questions`
(samma `keys.questions` som redan låg oanvänd i config) – först utan
`form_id` för att lista projektets formulär, sedan en gång per formulär för
att hämta `questions[id].choices[choiceId].option` (den faktiska texten,
t.ex. "Lördag 11 juli"). Hämtas en gång per importcykel (inte per deltagare)
och trådas igenom som ett nytt **icke-per-entitet** kontext-fält
(`DataSourceImportResult.providerContext` → `ImportEnricherContext.providerContext`,
`packages/plugin-api/src/backend/index.ts`, `data.service.ts`) – skilt från
`sourceRecord`, som är per-entitet. Enrichern (`enrichers/specialNeeds.ts`)
översätter nu varje flervalssvars ID:n till etiketter via detta, med
fallback till rå-ID om `providerContext` saknas/är trasigt eller en specifik
etikett inte hittas (t.ex. data-drift) – aldrig ett tyst tapp av svaret.
Verifierat end-till-ände mot riktig data (medlem 2001798: 10 valda dagar,
alla korrekt översatta till "Lördag 11 juli", "Söndag 12 juli", ...).
Bästa-försök: om `/project/get/questions`-anropet misslyckas loggas en
varning och importen fortsätter ändå (`providerContext: undefined`),
enrichern faller då tillbaka på rå-ID:n istället för att krascha importen.
5 nya enhetstester för översättningen (inkl. fallback-fallen).

**Uppföljning samma dag – dag-för-dag-tabell istället för textlista (kårens
egen begäran):** en sammanhängande textlista med frånvarodagar visade sig
otydlig. Kåren bad om en tabell: en rubrikrad med datum (t.ex. "11/7") och en
rad med kryss/bock som visar närvaro per dag, byggd mot exakta datumintervall
de gav direkt: förläger 11–22 juli, lägerperiod 22 juli–3 augusti, efterläger
3–7 augusti (bekräftat matcha exakt Scoutnets egna alternativ-antal per
fråga). Samtidigt bad kåren om att **alltid** visa alla tre perioder samt
mat/el-sektionerna – oavsett om personen registrerat något – istället för
att villkorat gömma tomma sektioner.

**Design:** rent event-specifikt (datumintervallen, svensk månadsparsing) –
byggt helt i **steget** (`specialNeeds/backend/specialNeeds.ts`), inte
enrichern eller pluginets generiska delar. Enrichern förblir oförändrad och
generisk (skriver fortfarande översatta etiketter som `"Lördag 11 juli"`).
Steget genererar nu, per period, en fullständig dag-lista mellan de
hårdkodade start/slut-datumen (år 2026, direkt angivet – detta plugin
existerar bara för jamboree26), och tolkar tillbaka varje registrerad
frånvaro-etikett till ett dag/månad-par via en svensk månadsnamn-uppslagning
(`SWEDISH_MONTHS`) för att matcha mot dag-listan. **Medvetet val:** matchning
sker mot etikett-texten (dag + svensk månad), inte mot Scoutnets råa,
odokumenterade alternativ-ID:n – mer robust om formuläret någonsin byggs om.
En etikett som inte går att tolka (t.ex. enricherns eget fallback till ett
oöversatt rå-ID om `providerContext` saknades den importcykeln) ignoreras
tyst för just den dagen (dagen visas som närvarande) snarare än att krascha
skärmen.

Eftersom **allt** nu alltid visas togs "hoppa över om inget registrerat"-
logiken bort helt – steget visar alltid skärmen, aldrig `setCompleted()`
utan att visa något (utom vid det faktiska "gå vidare"-anropet från
`confirm`-knappen). Ett tomt läge (inga allergier, inget el-behov, full
närvaro) visas nu explicit ("Inga registrerade" / "Inget registrerat" /
full grön tabell) istället för att hoppas över.

Skärmen (`SpecialNeedsScreen.tsx`) bygger en enkel HTML-tabell per period
(inte `@scouterna/ui-react`-komponenter för själva tabellen, då inget
tabellkomponent finns i biblioteket) inuti en `overflow-x-auto`-behållare
(lägerperiodens 13 dagar kan annars bli bredare än kioskskärmen), grön
bock (✓, `text-green-600`) för närvarande dagar och grå kryss (✗,
`text-neutral-400`) för frånvarande – båda färgerna verifierade mot
`@scouterna/tailwind-theme`s faktiska palett innan de användes (temat
nollställer Tailwinds standardfärger med `--color-*: initial`, så en gissad
klass hade kunnat rendera helt utan färg).

7 av de tidigare testerna skrevs om för att matcha "visa alltid"-beteendet;
2 nya tester lades till (dag-matchning inom en period, oberoende matchning
över flera perioder samtidigt, samt ett fall som verifierar att en
otolkbar etikett inte kraschar utan bara lämnar dagen som närvarande).

**Uppföljning samma dag – hel-period-avstängning via en fjärde fråga:** Kår
identifierade ytterligare en fråga, `90174` ("Perioder du önskar delta"),
en multiselect med tre val – hela perioder, inte enskilda dagar: Förlägret
(`61759`), Lägerperioden (`61760`), Post-camp/Efterläger (`61761`). Om en
period inte är vald där ska hela den periodens tabell visa kryss/❌ på varje
dag, oavsett vad dag-nivå-frågan för samma period säger.

Verifierat direkt mot Scoutnets riktiga API (fråga 90174, projekt 52716)
innan implementation – både de tre val-ID:na och deras exakta etikettext
("Förlägret (före 22 juli)", "Lägerperioden (22 juli - 3 augusti)",
"Post-camp (after August 3)") stämde exakt mot vad kår angav. 1676 av 1813
funktionärer har svarat på frågan (137 har inte svarat alls).

**Design:** ny konfigurerad fältmappning `periodsAttending: "90174"`
(`dataSourceConfig.yml`). I steget (`ABSENCE_PERIODS`) fick varje period en
`attendanceMatchers`-lista med **både** den riktiga Scoutnet-etiketten och
det råa val-ID:t – eftersom enrichern bara översätter ett flervalssvar till
etiketter när dess `providerContext`-uppslagning lyckas den importcykeln,
annars faller den tillbaka på rå-ID:n (samma mekanism som dag-frågorna,
se ovan).

**Omtag samma dag – "obesvarad" var fel default:** frågan `90174` är
faktiskt den **första** frågan i formuläret, och dag-nivå-uppföljningen för
en period ("kan inte delta alla dagar under X") visas i Scoutnets formulär
bara för den som redan svarat ja till just den perioden här. En första
version tolkade "frågan helt obesvarad" som ett tredje, neutralt "okänt"-
läge som inte skulle tvinga fram frånvaro (skilt från "svarade men valde
bort perioden") – men Kår klargjorde att det är fel: eftersom
dag-uppföljningen är betingad av denna fråga betyder "inte vald" och "aldrig
besvarad" exakt samma sak – personen deltar inte i perioden alls, oavsett
anledning. `isAttendingPeriod()` förenklad till att alltid returnera en ren
boolean (inget tredje `null`-läge längre): saknat/obesvarat `periodsAttending`
behandlas identiskt med "svarade men uteslöt perioden". Default när frågan
inte är besvarad alls är alltså numera **frånvaro på alla tre perioder**,
inte närvaro – en fullständig omvändning av den ursprungliga (felaktiga)
defaulten.

7 enhetstester skrevs om för att spegla den nya defaulten (frånvaro istället
för närvaro när `periodsAttending` saknas); nya/kvarvarande tester täcker
hel-period-uteslutning trots dag-svar, oförändrad dag-tabell för en vald
period, matchning via rått ID som fallback, samt att en helt obesvarad
fråga nu tvingar fram frånvaro på alla tre perioderna (inte tvärtom).

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

`[x]` Implementerad 2026-07-10. Källa: Allmänt "Rapporter: vem är incheckad,
vilka saknas, vilka är inkompletta... de som skickats till infotältet."

Fanns inte alls tidigare – ingen rapportfunktion, ingen roster-vy i admin.

**Beslut (via genomgång 2026-07-10):** appens kärna är händelseagnostisk, så
vyn får inte anta en fast kår/funk-uppdelning – grupperingen härleds istället
från datan (en källa med `ParticipantGroup`-rader blir ett gruppträd, en källa
utan blir platt, ev. bucketerad på `subGroup`). Fem statusar redovisas:
incheckad, preliminär, saknas, importfel och avanmäld – de två sista medvetet
synliga för personal trots att kiosken filtrerar bort dem (samma princip som
`getSessionContext`). ["Skickad till infotältet"](#kryssruta-för-skickad-till-infotältet)-flaggan
ingår inte – den är fortfarande uppskjuten som separat policyfråga.

**Omprövning under användning – från fulla tabeller till dashboard + sök:**
Första versionen visade alla deltagare i tabeller (en per grupp/källa),
virtualiserade med `@tanstack/react-table` + `react-virtual`. Två problem
uppstod i praktiken: kolumnbredden hoppade till under scroll (virtualiserade
rader har innehållsberoende bredd, så bredden räknades om när nya rader
scrollades in), och sidan blev trög – i grunden för att *hela* rostret (alla
källor, grupper, deltagare, varje fält) skickades till klienten på en
8-sekunders poll och filtrerades i JS, vilket inte skalar förbi ett par
tusen deltagare (kommande event kan ha ~20 000). **Löst genom att byta
modell helt:** en dashboard med bara räknare per källa (`buildRosterSummary`,
inga grupper/deltagare i svaret) för den återkommande pollningen, och en
sök-på-begäran (`searchRoster`) som filtrerar i databasen med en `LIMIT`
istället för i webbläsaren. Den fulla, ovirtualiserade tabellvyn togs bort
helt – täcks numera bara av CSV-export (som redan fanns) för den som
behöver hela listan.

**Uppföljning samma dag – fuzzy sök:** kår bad om att sökningen ska vara
"fuzzy": accentokänslig (é = e) och toleranta mot enstaka felstavningar
(Malcom = Malcolm). Löst i två separata, additiva steg:
- Accentokänslighet via Postgres `unaccent`-tillägget (ny migration,
  `CREATE EXTENSION IF NOT EXISTS unaccent`) – matchning blev
  `unaccent(kolumn) ILIKE unaccent(mönster)`.
- Felstavningstolerans via `pg_trgm` (ny migration, trigram-likhet) –
  `similarity(unaccent(kolumn), unaccent(ord)) > 0.4` som ytterligare
  `OR`-villkor, aldrig en ersättning av den exakta träffen. Tröskelvärdet
  0.4 är en uppskattning, verifierad mot verkliga namn i dev-databasen
  (bl.a. "Malcom"→"Malcolm", "Andrea"→"Andreas", "Carolin"→"Caroline"; en
  nonsens-sökning gav noll träffar) – inte matematiskt härlett, kan behöva
  justeras.
- Prismas fluent-API kan inte anropa SQL-funktioner i ett `where`-villkor,
  så `searchRoster` byggdes om till en rå, parametriserad fråga
  (`Prisma.sql`/`Prisma.join`, ingen sträng-konkatenering) istället för
  `findMany`.

**Genomfört:**
- Backend (`packages/backend/src/domains/participants/reports.service.ts`):
  `buildRosterSummary` (räknare per källa, minimalt fältval, ingen
  grupp-fråga – kostnaden är oberoende av antal deltagare),
  `searchRoster` (rå SQL, `unaccent` + `pg_trgm`, `take`-cap på 200 träffar),
  samt den ursprungliga `buildRoster`/`rosterToCsv` kvar oförändrade men nu
  enbart använda av CSV-exporten.
  Nya routes i `reports.admin.routes.ts`: `GET /api/admin/reports/roster`
  (dashboard), `GET /api/admin/reports/search?q=` (sök), `GET
  /api/admin/reports/roster.csv` (full export, oförändrad).
- Frontend: ny sida **Rapporter** (`/admin/reports`,
  `components/admin/RosterReport.tsx`), ny post i adminmenyn. Visar en
  rutnätsdashboard med en ruta per källa (räknare), en sökruta (debounce
  300 ms, min 2 tecken) och statusfilter-chips, plus samma
  "Exportera CSV"-knapp.
- Nya migrationer: `enable_unaccent_extension`,
  `enable_pg_trgm_extension` (rena tilläggs-aktiveringar, inga
  modelländringar).
- 42 backend-enhetstester (upp från 32) täcker klassificering, gruppering,
  metadata-uppdelning, CSV-escaping, samt sök-frågans SQL-form (unaccent,
  similarity, LIMIT, källbegränsning).
- Verifierat end-till-ände mot riktig dev-databas via `run-scoutin`-skillen:
  dashboard-räknare stämmer, sökning hittar rätt person över alla källor,
  CSV laddas ner med korrekt BOM/CRLF/svenska tecken.

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
