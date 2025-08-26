Britpart Integration UI — landroverdelar.se

En modern frontend (React + Vite + Tailwind) för att styra integrationen mellan Britpart och WooCommerce för Björklin Motor AB (landroverdelar.se). UI:t körs som Azure Static Web App (SWA) och pratar med backend Azure Functions (serverless API) som i sin tur:

Hämtar produkter/kategorier direkt från Britpart API

Mappar och skriver till WooCommerce REST API (skapa/uppdatera produkter, priser, lager, status)

Exponerar endpoints för torrkörning (dry‑run), import och moderation

Den här README:n är skriven för Windows/VS Code, men kommandon funkar likaså på macOS/Linux (byt \ mot /).

Innehåll

Arkitektur i korthet

Funktioner

Teknikstack

Kom igång lokalt

Tailwind v4 anteckning

Mappstruktur

Konfiguration & hemligheter

Deploy till Azure Static Web Apps

Custom domän

Backend / Azure Functions

Excel‑importformat

Kategori‑mappning (Britpart → WooCommerce)

Säkerhet

Felsökning

Roadmap / TODO

Licens

Arkitektur i korthet

React UI (SWA)  →  Azure Functions (API)  →  Britpart API
                                 ↘         →  WooCommerce REST API

UI visar kategori‑val, dry‑run, import, Excel‑uppladdning, loggar och (senare) moderation av publiceringsstatus.

API hanterar autentisering, batchning, idempotens och schemalagd nattkörning.

Funktioner

Välj Britpart‑underkategorier via ID och importera endast det du vill.

Dry‑run: se vad som kommer skapas/uppdateras/ignoreras innan körning.

Importera till WooCommerce (skapa/uppdatera produkter) i batchar.

Excel‑pris/lagersynk (SKU‑baserad, utan att röra bilder/media).

Nattlig import (Timer Trigger) för nya/ändrade produkter.

Loggar i UI, med stöd för Application Insights i backend.

Teknikstack

Vite + React + TypeScript

Tailwind CSS v4

Azure Static Web Apps (frontend + GitHub Actions CI/CD)

Azure Functions (Node 20, TypeScript)

WooCommerce REST och WordPress Application Passwords

Kom igång lokalt

Förutsättningar: Node 18+ (gärna 20), Git, VS Code.

# Klona projektet
git clone https://github.com/orderlandrover/hub.git
cd hub

# Installera beroenden
npm i

# Starta dev‑servern
npm run dev
# Öppna http://localhost:5173

Byt gärna ut src/App.tsx med dashboard‑koden om du inte redan ser Britpart Integration Dashboard.

Tailwind v4 anteckning

Tailwind v4 använder ett separat PostCSS‑plugin.

npm i -D @tailwindcss/postcss

postcss.config.js

export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

src/index.css (en av två varianter — båda funkar)

@import "tailwindcss";        /* v4-prefererad */
/* eller
@tailwind base;
@tailwind components;
@tailwind utilities;
*/

Mappstruktur

hub/
├─ src/                    # React-kod
│  ├─ App.tsx              # Dashboard UI
│  └─ index.css            # Tailwind import
├─ api/                    # (läggs till) Azure Functions
├─ public/
├─ .github/workflows/      # GitHub Actions för SWA
├─ postcss.config.js
├─ tailwind.config.js
├─ staticwebapp.config.json  # (valfritt) routes, headers, CORS
├─ package.json
└─ vite.config.ts

Konfiguration & hemligheter

Lägg inte nycklar i källkoden. Använd Azure → Static Web App → Configuration → Application settings

Nycklar (exempel):

BRITPART_API_KEY – nyckel till Britpart API

WP_URL – t.ex. https://landroverdelar.se

WC_KEY, WC_SECRET – WooCommerce REST nycklar (Admin → WooCommerce → Settings → Advanced → REST API)

(om WordPress Application Passwords) WP_APP_USER, WP_APP_PASSWORD

Deploy till Azure Static Web Apps

Detta repo är kopplat till Azure via GitHub Actions. Varje push till main bygger och deployar automatiskt.

Kontrollera/justera workflow-filen i .github/workflows/ (namn kan variera):

with:
  app_location: "/"
  output_location: "dist"
  api_location: ""   # sätt till "api" när Functions läggs till

Om du vill deploya via deployment token, lägg tokenen som secret AZURE_STATIC_WEB_APPS_API_TOKEN och använd action Azure/static-web-apps-deploy@v1 (se exempel i issues/wiki).

Custom domän

Azure → din SWA → Anpassade domäner → lägg hub.landroverdelar.se (CNAME till SWA‑defaultdomänen). SSL sköts automatiskt. Markera som standard när klart.

Backend / Azure Functions

Skapa en mapp api/ i repo't. Kör serverless Functions (Node 20/TS). Exempel på endpoints:

1) Lista Britpart‑subkategorier

GET /api/britpart-subcategories

Hämtar och returnerar { items: [{id, name}, ...] }

2) Dry‑run import

POST /api/import/dry-run

{
  "subcategoryIds": ["1001", "1005"]
}

Svar:

{
  "create": [ {"sku":"...","name":"..."} ],
  "update": [ {"sku":"...","diff":{"price":["100","95"]}} ],
  "skip":   [ {"sku":"...","reason":"unchanged"} ]
}

3) Kör import (skarp)

POST /api/import/run

Samma body som dry‑run. Kör batchvis: idempotent per SKU → POST om ny, annars PUT/PATCH i WooCommerce.

Returnerar jobId och summering.

4) Produktlista (moderation)

GET /api/products/list?status=any&page=1&search=&category=

Proxy till WooCommerce REST, paginerad, för UI‑vy av publiceringsstatus.

5) Snabbuppdateringar

POST /api/products/update

{ "ids": [123,124], "status": "publish" }

eller

{ "ids": [123], "price": "1995.00", "stock_quantity": 5 }

Region & runtime: sätt Functions‑region West Europe, Node 20. Lägg App Settings i samma SWA.

Excel‑importformat

Excel (XLSX) med rubriker (rad 1):

SKU, Pris, Lager, Status

SKU (obligatoriskt) – matchar produkten i WC

Pris  – regular_price (SEK)

Lager – stock_quantity (heltal)

Status – publish|draft|pending|private (frivilligt)

Backend läser filen (t.ex. via xlsx/SheetJS), letar produkt via SKU och kör PATCH /wp-json/wc/v3/products/{id}.

Kategori‑mappning (Britpart → WooCommerce)

Skapa en enkel mappningstabell (JSON/Azure Table/Blob):

{
  "1001": 37,
  "1002": 42
}

Nyckel: britpartSubcategoryId (sträng)

Värde: woocommerceCategoryId (nummer)

UI visar underkategorierna och låter dig välja vilka som ska importeras. Backend använder mappningen för att sätta categories[] i WooCommerce‑produkten.

Säkerhet

Hemligheter i Azure (App Settings), inte i källkod.

Server‑to‑server anrop från Functions → WordPress: använd Application Passwords (Basic Auth) till ett konto med begränsade rättigheter.

Aktivera SWA Authentication om du vill skydda UI:t bakom Microsoft/GitHub‑login.

Loggning till Application Insights; exponera endast säkra utdrag i UI.

Felsökning

Vite visar 404 efter deploy → kontrollera output_location: "dist" i workflow.

npx: “could not determine executable to run” på Windows → kör ./node_modules/.bin/tailwindcss init -p (Git Bash) eller .\n  node_modules\.bin\tailwindcss init -p (PowerShell). Eller skapa konfigfilerna manuellt (se ovan).

Tailwind v4 PostCSS‑fel → installera @tailwindcss/postcss och uppdatera postcss.config.js enligt avsnittet ovan.

Git push 403 → fel GitHub‑konto. Rensa Credential Manager eller använd gh auth login, eller byt till SSH‑remote.

CORS mellan SWA och WP → använd Functions som proxy (UI anropar endast /api/*).

Roadmap / TODO



Licens

© Björklin Motor AB. Endast för internt bruk inom landroverdelar.se‑projektet.