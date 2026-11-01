# 🍲 Cuina Casa

App web familiar per gestionar la cuina i les compres de casa. Funciona al mòbil (instal·lable) i a l'ordinador, i tota la família comparteix les mateixes dades en temps real.

## Què fa

- **Llista de la compra** ordenada per seccions del súper, compartida i en temps real. S'hi escriu en llenguatge natural ("2 l de llet") o s'escaneja el codi de barres. En tornar del súper, el botó **Al rebost** passa el que s'ha comprat a l'inventari.
- **Rebost, nevera i congelador** amb quantitats, dates de caducitat i avís quan en queda poc.
- **Receptes** escrites a mà o **importades des d'un enllaç** de qualsevol web de cuina (llegeix el format estàndard schema.org/Recipe). La preparació és una llista numerada de passos, cada recepta pot ser entrant, primer, segon, plat únic o postres, i es pot **pujar una foto pròpia** des de l'ordinador o el mòbil (es redueix automàticament i es desa a Supabase Storage) o **buscar-ne una** a Internet (Openverse i Wikimedia Commons, amb llicència lliure).
- **Receptes que cal revisar**: al llistat, les receptes amb ingredients sense dades nutricionals, sense ingredients o sense passos queden ressaltades (i hi ha el filtre «Cal revisar»). A la fitxa, l'app busca a Open Food Facts els valors dels ingredients desconeguts i en proposa una mitjana per acceptar-la amb un clic; i les receptes incompletes es poden completar amb una recepta trobada a Internet. Cada targeta del llistat té un botó per editar-la directament.
- **Plats sense recepta**: els plats afegits al menú només amb el nom surten destacats a dalt de Receptes (i marcats al menú) per crear-ne la recepta, que s'enllaça sola als àpats, o enllaçar-los amb una recepta que ja existeixi.
- **Duplicar receptes** per fer-ne variacions: la còpia s'obre a l'editor amb tot el contingut (ingredients, passos, foto i enllaços amb preelaborats) i l'original no es modifica.
- **Traducció automàtica al català**: les receptes en castellà es tradueixen en importar-les (per enllaç o des de la cerca a Internet) amb [Apertium](https://apertium.org), gratuït i sense clau, més un petit glossari de cuina. A la revisió es pot consultar l'original, i les receptes en castellà ja desades tenen un botó «Tradueix al català».
- **Preelaborats enllaçats**: un sofregit, un brou o una salsa poden ser receptes pròpies i fer-se servir com a ingredient d'altres. Si no n'hi ha a casa, la llista de la compra hi afegeix els seus ingredients en la quantitat que cal.
- **Menú setmanal** (esmorzar, dinar i sopar) que **genera la llista de la compra** sumant ingredients, adaptant les racions i restant el que ja hi ha a casa.
- **Valor nutricional aproximat** de cada recepta per ració (kcal, carbohidrats, proteïnes, greixos i fibra), comparació amb el **Plat de Harvard** (½ verdura i fruita, ¼ cereals integrals, ¼ proteïna saludable) amb consells breus, i càlcul recursiu dels preelaborats. Al menú setmanal, totals per dia, mitjana de la setmana, varietat de proteïnes i **propostes compensatòries** per al sopar i el cap de setmana a partir de les receptes guardades. Es basa en una taula de ~200 aliments (valors de referència BEDCA/USDA, editable des de l'app) i aprofita les dades d'Open Food Facts dels productes escanejats. *És una aproximació orientativa, no un consell mèdic.*
- **Cerca de receptes a Internet** dins de webs concretes (Cuines de TV3, Cookpad, Recetas de Rechupete, PequeRecetas i Javirecetas), sense claus ni costos. Des del menú, quan cap recepta guardada no compensa un desequilibri, busca plats que el compensin i els valora segons el Plat de Harvard; també es pot buscar lliurement des de Receptes. Cada resultat es pot importar i afegir al menú amb un botó. La llista de webs és a `src/lib/recipe-sites.ts`: si alguna canvia el disseny i deixa de funcionar, la cerca continua amb les altres.
- **Avisos de caducitat** a la pantalla d'inici i, opcionalment, com a notificació del mòbil.
- **Escaneig de codis de barres** amb la càmera, amb cerca a [Open Food Facts](https://world.openfoodfacts.org) i memòria dels productes de casa.
- **Instal·lable** (PWA) i amb còpia local de la llista i el rebost per consultar-les sense cobertura.

## Tecnologia

| Peça | Ús |
|---|---|
| [Next.js](https://nextjs.org) + React + Tailwind CSS | L'aplicació web |
| [Supabase](https://supabase.com) | Base de dades, inici de sessió amb Google i temps real |
| [Vercel](https://vercel.com) | Publicació automàtica a cada canvi a GitHub |

---

## Posada en marxa

Calen tres coses: un projecte de Supabase, l'inici de sessió de Google i la publicació a Vercel. Uns 20-30 minuts en total.

### 1. Crear el projecte de Supabase

1. Entra a [supabase.com](https://supabase.com) amb el teu compte de GitHub i prem **New project**.
2. Nom: `cuina-casa`. Posa una contrasenya de base de dades (desa-la en lloc segur) i tria una regió d'Europa.
3. Quan estigui creat, ves a **SQL Editor → New query**, enganxa tot el contingut de [`supabase/migrations/0001_esquema_inicial.sql`](supabase/migrations/0001_esquema_inicial.sql) i prem **Run**. Ha de dir *Success*. Repeteix-ho, per ordre, amb cada fitxer següent de la carpeta `supabase/migrations/` (`0002_…`, etc.).
4. Ves a **Project Settings → API** i apunta:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public key** (una clau llarga que comença per `eyJ…`)

### 2. Activar l'inici de sessió amb Google

1. A [Google Cloud Console](https://console.cloud.google.com/), crea un projecte nou (per exemple, `Cuina Casa`).
2. **APIs i serveis → Pantalla de consentiment d'OAuth**: tipus *Extern*, nom de l'app `Cuina Casa` i el teu correu. A *Usuaris de prova* afegeix els correus de Google de la família (o publica l'app perquè hi pugui entrar qualsevol compte).
3. **APIs i serveis → Credencials → Crea credencials → ID de client d'OAuth**:
   - Tipus: *Aplicació web*
   - **URI de redirecció autoritzats**: `https://xxxx.supabase.co/auth/v1/callback` (amb la teva Project URL)
4. Copia l'**ID de client** i el **secret de client**.
5. A Supabase: **Authentication → Sign In / Providers → Google**, activa'l i enganxa-hi l'ID i el secret. Desa.

### 3. Publicar a Vercel

1. Entra a [vercel.com](https://vercel.com) amb GitHub i prem **Add New → Project**.
2. Importa el repositori `xavigaya/cuina-casa`.
3. A **Environment Variables** afegeix:
   - `NEXT_PUBLIC_SUPABASE_URL` → la Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → la clau anon
4. Prem **Deploy**. En acabar tindràs una adreça com `https://cuina-casa.vercel.app`.

### 4. Dir a Supabase quina és l'adreça de l'app

A Supabase: **Authentication → URL Configuration**

- **Site URL**: `https://cuina-casa.vercel.app` (la teva adreça de Vercel)
- **Redirect URLs**: afegeix
  - `https://cuina-casa.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback` (només si vols provar-la a l'ordinador)

Ja està! Obre l'adreça, entra amb Google i crea la llar.

### 5. Convidar la família

A **Ajustos** hi ha un **codi d'invitació**. Cada membre entra amb el seu compte de Google i, la primera vegada, tria *Tinc un codi* i l'escriu. Per instal·lar-la al mòbil: a Android, menú de Chrome → *Instal·la l'aplicació*; a iPhone, Safari → Compartir → *Afegeix a la pantalla d'inici*.

---

## Desenvolupament local

```bash
cp .env.example .env.local   # i omple-hi les dues variables
npm install
npm run dev                  # http://localhost:3000
npm test                     # proves de la lògica (unitats, llista, importació)
```

## Estructura

```
src/
  app/
    (app)/            pàgines amb sessió: inici, llista, rebost, receptes, menu, ajustos
    api/import-recipe servei que llegeix receptes d'una web
    auth/callback     retorn de l'inici de sessió de Google
    login/            pantalla d'entrada
  components/         peces de la interfície (escàner, fulls, formularis…)
  lib/                lògica: seccions, unitats, ingredients, càlcul de la llista
  proxy.ts            protegeix les pàgines i refresca la sessió
supabase/migrations/  esquema de la base de dades amb seguretat per llar
public/sw.js          service worker (instal·lació i ús sense connexió)
```

## Seguretat

Cada taula té *Row Level Security*: una persona només pot llegir i modificar les dades de les llars de les quals és membre. Per entrar en una llar cal el codi d'invitació, que es pot canviar en qualsevol moment des d'Ajustos.

## Actualitzacions de la base de dades

Quan una nova versió afegeix un fitxer a `supabase/migrations/`, cal executar-lo una sola vegada a **Supabase → SQL Editor** (enganxar-lo sencer i prémer **Run**), per ordre de número.

| Fitxer | Què afegeix |
|---|---|
| `0001_esquema_inicial.sql` | Taules, seguretat i temps real |
| `0002_tipus_plat_i_preelaborats.sql` | Tipus de plat, preelaborats i receptes enllaçades |
| `0003_dades_nutricionals.sql` | Taula d'aliments amb valors nutricionals (217 aliments de referència) |
| `0004_fotos_receptes.sql` | Magatzem de fotos per pujar imatges pròpies de les receptes |

La llista d'aliments de referència és a `supabase/data/aliments.tsv`. Si la modifiques, regenera l'SQL amb `python3 scripts/generar-aliments.py` i executa'l a Supabase (es pot repetir: actualitza els aliments existents).
