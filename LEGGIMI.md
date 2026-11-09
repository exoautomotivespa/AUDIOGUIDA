# Guida audio per le visite al laboratorio

Gli ospiti inquadrano un QR code, scelgono la lingua e aspettano. Dal tablet premi il numero della tappa e su tutti i telefoni parte l'audio giusto nella lingua scelta. Gli ospiti non installano nulla.

## Cosa serve
- Un PC (anche portatile) collegato al Wi-Fi del laboratorio, con Node.js installato (https://nodejs.org, versione LTS). Nessun'altra installazione.
- Un Wi-Fi a cui possano collegarsi anche gli ospiti, sulla stessa rete del PC.

## Avvio
1. Doppio clic su `AVVIA.bat`. Se Windows chiede il permesso del firewall, consenti l'accesso alle reti private.
2. La finestra mostra due indirizzi:
   - Pagina ospiti, es. `http://192.168.1.50:3000/`: è l'indirizzo da trasformare in QR code (va bene qualsiasi generatore di QR).
   - Telecomando, es. `http://192.168.1.50:3000/regia`: aprilo sul tablet ed entra con la password.
3. Lascia aperta la finestra per tutta la visita.

Consiglio: date al PC un indirizzo IP fisso (chiedete all'IT), così il QR code stampato resta valido.

## Le tracce audio
Una cartella per lingua dentro `audio/`, con il codice della lingua:

    audio/it/01.mp3 ... 21.mp3
    audio/en/01.mp3 ... 21.mp3
    audio/de/...

Il numero all'inizio del nome è la tappa; quello che segue è il titolo. `01.mp3` è la tappa 1 senza titolo, `01 - Accoglienza.mp3` è la tappa 1 con titolo "Accoglienza" (anche `01_accoglienza.mp3` va bene, i trattini bassi diventano spazi).

Ogni lingua ha i suoi titoli: con `audio/it/04 - Banco prova freni.mp3` e `audio/en/04 - Brake test bench.mp3` l'ospite inglese legge "Brake test bench". Sul telecomando compare il titolo della prima lingua dell'elenco che ce l'ha (di solito l'italiano). Rinominare un file aggiorna il titolo entro un paio di secondi, anche a server acceso. Formati accettati: mp3, m4a, aac, ogg, wav. Nuove lingue e nuove tappe compaiono da sole appena copiate i file, senza riavviare.

LE TRACCE ATTUALI IN audio/it E audio/en SONO TONI DI PROVA: cancellatele e mettete le vostre.

Sul telecomando un pallino rosso su un pulsante indica che quella tappa manca in almeno una lingua (tenendo premuto vedi quale).

## Aspetto (logo e colore)
- Il logo è il file `public/logo.svg`. Quello incluso è ricostruito da uno screenshot del sito: appena avete il file ufficiale, sostituitelo con lo stesso nome (va bene anche `logo.png`; in quel caso cancellate `logo.svg`).
- Il colore principale è `colorePrincipale` in config.json (rosso Open Parts `#E4002B`).
- Il carattere Roboto Condensed è incluso nella cartella `public/fonts` (licenza libera), quindi funziona anche senza internet.

## Impostazioni (config.json)
- `passwordRegia`: cambiatela prima del primo uso.
- `titolo`: il nome mostrato in alto.
- `numeroTappe`: lasciatelo su `"auto"`. I pulsanti del telecomando corrispondono al numero di traccia più alto trovato e si aggiornano da soli entro un paio di secondi quando aggiungete un file, anche a server acceso. Se volete bloccare il totale, scrivete un numero (es. `30`).
- `lingue`: il nome da mostrare per ogni codice lingua e l'ordine dei pulsanti.
- `nomiTappe`: facoltativo, serve solo per dare a una tappa un titolo diverso da quello del nome file, es. `"4": "Banco prova"`. Ha la precedenza sul telecomando; sui telefoni vale solo per le lingue in cui il file non ha titolo.

Titolo, colore, nomi delle lingue e `nomiTappe` si aggiornano da soli quando salvate il file. Solo per password e porta bisogna chiudere e riavviare `AVVIA.bat`.

## Da sapere durante la visita
- Schermo acceso: se un telefono va in standby il browser sospende la pagina e la tappa non parte; quando l'ospite lo riaccende, l'audio riprende da solo dal punto in cui è la guida. Ricordatelo a inizio visita.
- Il primo tocco conta: i telefoni permettono l'audio automatico solo dopo un tocco dell'ospite, ed è il tocco sulla lingua a sbloccarlo. Se un telefono lo blocca comunque, compare il pulsante "Tocca per ascoltare".
- Chi arriva in ritardo vede "La visita è alla tappa N" e può ascoltarla dal punto in cui si trova la guida.
- "Pausa" ferma l'audio su tutti i telefoni nel punto in cui si trova; "Riprendi" lo fa ripartire da lì. Chi si collega durante la pausa resta fermo allo stesso punto e riparte con gli altri.
- "Ferma audio" chiude la tappa su tutti i telefoni (alla tappa successiva si riparte dall'inizio).
- Ascolto per la guida: la barra in alto sul tablet mostra a che punto è la traccia (di solito l'italiano, la lingua si cambia dal menu). Il pulsante "Ascolta la traccia" attiva il suono sul tablet: conviene usare un auricolare Bluetooth, così gli ospiti non sentono due audio. Il tablet non viene contato tra gli ospiti.
- Con molti ospiti nella stessa stanza meglio cuffiette o volume medio, altrimenti i telefoni fanno eco tra loro.

## Versione online (facoltativa)
Lo stesso programma gira anche su un hosting Node.js con HTTPS: così gli ospiti possono usare i dati mobili e su Android lo schermo resta acceso da solo. La password si imposta con la variabile d'ambiente `PASSWORD_REGIA`, la porta con `PORT`.
