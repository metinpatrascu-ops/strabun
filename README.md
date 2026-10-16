# Expeditor

Interfața web compune și previzualizează e-mailuri. Funcția Firebase trimite mesajele prin Resend, cu un expeditor verificat configurat pe server. Numele afișat, subiectul și mesajul sunt validate și escapate; cheia Resend nu ajunge în browser. Pentru protecție, endpointul cere autentificare anonimă Firebase și un token Firebase App Check și limitează fiecare utilizator la 5 mesaje într-un interval de 24 de ore.

## Configurare

1. Cumpără un domeniu propriu și adaugă-l în Resend. Publică în DNS înregistrările cerute de Resend și așteaptă verificarea domeniului. În conturile Resend neverificate, trimiterea poate fi limitată la adrese de test.
2. Creează un proiect Firebase și o aplicație web. Activează planul Blaze pentru Cloud Functions, creează baza de date Firestore și activează autentificarea anonimă în **Authentication → Sign-in method**.
3. În **App Check**, înregistrează aplicația web cu providerul reCAPTCHA v3 și copiază cheia site (publică) în `/home/runner/work/strabun/strabun/firebase-config.js`. Completează acolo și `apiKey`, `authDomain`, `projectId` și `appId` din setările aplicației web Firebase. Acest fișier conține doar configurație destinată browserului, nu chei secrete.
4. Configurează în Resend o adresă de expeditor de pe domeniul verificat. Din directorul proiectului, autentifică Firebase CLI, selectează proiectul, instalează dependențele funcției și salvează cheia API Resend ca secret:

   ```sh
   npx firebase-tools login
   npx firebase-tools use --add
   npm --prefix functions install
   npx firebase-tools functions:secrets:set RESEND_API_KEY
   ```

   Introdu cheia numai în promptul securizat al CLI-ului; nu o pune în cod sau în `firebase-config.js`.
5. Publică funcția și site-ul:

   ```sh
   npx firebase-tools deploy
   ```

   La prima publicare, CLI-ul va solicita valoarea parametrului `RESEND_FROM_EMAIL`. Introdu adresa exactă verificată în Resend, de exemplu `mesaje@domeniul-tau.ro`.

## Verificare și limite

- Formularul cere adresa destinatarului, numele afișat, subiectul și mesajul. Numele ales apare înaintea adresei verificate a expeditorului; utilizatorul nu poate seta domeniul din care se trimite.
- Fundalurile, ștampila și sigla sunt incluse în mesajul HTML. Sigla trebuie să fie PNG, JPEG sau WebP și mai mică de 300 KB. Unele aplicații de e-mail pot reda diferit fundalurile și imaginile inline.
- Funcția necesită Firebase Authentication, App Check, Firestore și cheia API Resend. Firestore stochează doar limita de trimitere per utilizator anonim; mesajele nu sunt păstrate de aplicație.
- Planul Blaze cere asocierea unei metode de facturare. Configurează alerte de buget și verifică separat prețurile Firebase și limitele planului Resend înainte de lansare.
