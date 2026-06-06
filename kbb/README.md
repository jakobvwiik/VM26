# Kælles ball og bong ⚽ — utrullingsguide

Et privat VM 2026 tippespill. Venner åpner én URL på telefonen, registrerer seg
og sender inn tips. Alt synkroniseres live. Henrik (admin) legger inn faktiske
resultater, og tabellen oppdateres for alle umiddelbart.

**Gratis å drifte** for en vennegjeng (gratisnivå hos Supabase + Vercel).
**Tid å sette opp:** ~15–20 minutter, ingen koding. Bare opprett to gratiskontoer og lim inn noen verdier.

---

## Hva du ender opp med
- En URL som `kaelles-ball-og-bong.vercel.app`
- Registrering/innlogging med e-post + passord
- Alle 104 VM-kampene forhåndslastet (72 gruppekamper med ekte lag + 32 sluttspillplasser)
- **Sluttspill-tipping:** spillerne velger selv hvilke to lag som møtes (alle 48 lag) + resultat. Poeng: 1 p per riktig lag, +1 riktig utfall, +3 eksakt (maks 6).
- **Tidsstyrt låsing (håndhevet i databasen):** hver kamp låses 3 t før kampstart (norsk tid); bonus låses 11. juni 18:00. Spillere kan ikke endre etter det — admin (Henrik) kan alltid.
- **Sortering** i «Mine tips»: Gruppe (A→L), Dato (tidligst først) eller Land (alfabetisk).
- Påkrevd bekreftelse av **200 NOK innskudd** ved registrering (admin ser betalt/ikke betalt)
- **Bonus-fane** (JA/NEI, VMs topplasseringer, individuelle priser) som teller med i totalen. Admin setter fasit og justerer alle poengregler (kamp + bonus).
- **Admin test-tid:** kun Henrik ser et panel for å simulere klokka og teste låsing i produksjon.
- Tips lagres automatisk; ingen innsending/e-post — alt styres av tid.
- Resultatregistrering kun for admin, CSV-eksport, live tabell.

---

## STEG 1 — Opprett Supabase-prosjektet (databasen)

1. Gå til **https://supabase.com** → registrer deg (gratis) → **New project**.
2. Kall det `kaelles-ball-og-bong`, sett et databasepassord (lagre det et sted), velg en region i nærheten (f.eks. EU North), klikk **Create**.
3. Vent ~2 min til det er ferdig opprettet.

### 1a. Slå AV e-postbekreftelse (så venner kan logge inn med en gang)
- Venstre meny → **Authentication** → **Sign In / Providers** (eller **Providers → Email**).
- Finn **Confirm email** og slå det **AV**. Lagre.
  *(Lar du det stå på, må hver venn klikke en bekreftelseslenke i innboksen før de kan logge inn — også greit, bare litt mer friksjon.)*

### 1b. Kjør databaseoppsettet
- Venstre meny → **SQL Editor** → **New query**.
- Åpne `supabase/schema.sql` fra dette prosjektet, kopier ALT, lim inn, klikk **Run**.
- Ny spørring igjen → åpne `supabase/seed_matches.sql`, kopier alt, lim inn, **Run**.
  Du skal se «Success. 104 rows» (eller lignende).

### 1c. Hent de to nøklene dine
- Venstre meny → **Project Settings** (tannhjul) → **API**.
- Kopier disse to verdiene, du trenger dem i Steg 3:
  - **Project URL** (ser ut som `https://abcd1234.supabase.co`)
  - **anon public**-nøkkelen (en lang streng under «Project API keys»)

> Admin er satt til **henrik.kalv@gmail.com** inne i `schema.sql` (funksjonen `admin_email()`) og i `lib/config.js`. Hvis Henrik skal registrere seg med en annen e-post, endre den BEGGE steder før Steg 1b / 3.

---

## STEG 2 — Legg koden på GitHub

Enkleste vei for Vercel.

1. Gå til **https://github.com** → logg inn → **New repository** → kall det `kaelles-ball-og-bong` → **Create**.
2. På den nye repo-siden, klikk **uploading an existing file**.
3. Dra inn ALLE filer/mapper fra dette prosjektet (`app/`, `lib/`, `supabase/`, `package.json`, `next.config.js`, `.gitignore`, denne README). Commit.

*(Foretrekker du kommandolinjen og har git installert: `git init && git add . && git commit -m "init" && git branch -M main && git remote add origin <din-repo-url> && git push -u origin main`.)*

---

## STEG 3 — Rull ut på Vercel

1. Gå til **https://vercel.com** → registrer deg med GitHub-kontoen din (gratis).
2. **Add New → Project** → **Import** repoet `kaelles-ball-og-bong`.
3. Før du klikker Deploy, utvid **Environment Variables** og legg til de to fra Steg 1c:

   | Navn | Verdi |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | din Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | din anon public-nøkkel |

4. Klikk **Deploy**. Vent ~1–2 min.
5. Du får en URL som `kaelles-ball-og-bong.vercel.app`.
   For å få akkurat det navnet: **Project → Settings → Domains** (prosjektnavnet styrer standard subdomene; gi prosjektet nytt navn om nødvendig).

**Del den URL-en med vennene dine. Ferdig.**

---

## Slik bruker alle den

- **Venner:** åpne URL-en → Registrer (navn, valgfritt kallenavn, e-post, passord, bekreft 200 NOK) → legg inn resultattips (lagres automatisk) → trykk **Send inn alt & e-post til Henrik**. Det låser tipsene og åpner en ferdigutfylt e-post til henrik.kalv@gmail.com.
- **Henrik:** registrer deg med `henrik.kalv@gmail.com` → **Admin**-fanen dukker opp automatisk. Der legger du inn resultater (tabellen oppdateres live), justerer poeng, legger til/endrer kamper, gjenåpner en innsending og eksporterer CSV.

---

## Vanlige spørsmål

**«Må venner installere noe?»** Nei — det er en nettside; den fungerer i alle mobilnettlesere. De kan «Legg til på Hjem-skjerm» hvis de vil ha et app-ikon.

**«Er e-posten automatisk?»** Akkurat nå åpner den en ferdigutfylt e-post de trykker send på (ingen ekstra tjeneste nødvendig). For å sende den helt automatisk, se `OPTIONAL_auto_email.md`.

**«Innskuddet på 200 NOK — håndterer appen penger?»** Nei. Avkrysningen er en tillitsbasert bekreftelse på at de har betalt; appen behandler ikke ekte penger. Henrik ser hvem som har krysset av i Admin-panelet og kan sjekke mot Vipps/bank.

**«Kan noen jukse ved å endre tips etter innsending?»** Nei. Databasen blokkerer endringer når en spiller er låst (håndhevet på serversiden, ikke bare i appen). Bare Henrik kan gjenåpne.

**«Tidene ser feil ut.»** Avsparkstidene er i GMT. Henrik kan endre hvilken som helst kamptid i Admin-fanen, eller be meg flytte alle til norsk tid.

**«Sluttspillkampene heter R32 M1 osv.»** De lagene er ikke kjent før gruppespillet er ferdig. Henrik gir dem nye navn i Admin-fanen etter hvert som lag kvalifiserer seg.
