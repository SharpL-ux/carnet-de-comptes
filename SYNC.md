# Ajouter des comptes et une synchronisation

Ce document décrit comment passer du carnet local à un carnet synchronisé entre appareils, avec connexion Google ou Apple. **Rien de tout cela n'est implémenté dans l'app actuelle** : le code livré est volontairement 100 % local. Ce fichier existe pour que le travail puisse être repris sans repartir de zéro.

Un avertissement d'abord : cette étape change la nature du produit. Aujourd'hui, « tes données ne quittent pas l'appareil » est vrai, vérifiable et sans engagement. Avec un compte, tes données financières partent chez un hébergeur. Si l'objectif réel est seulement « voir les mêmes chiffres sur l'iPhone et sur le Mac », la sauvegarde `.json` posée dans iCloud Drive répond déjà à 80 % du besoin, sans compte ni dépendance.

---

## 1. Ce qu'il ne faut pas faire

La tentation est de tout basculer en ligne : l'app charge les données au démarrage et écrit dans la base à chaque saisie. C'est simple à coder, et ça détruit ce qui a été construit — dans le métro, dans un parking, l'app devient inutilisable, et le mode hors-ligne du service worker ne sert plus à rien.

L'architecture à viser est **local-first** : `localStorage` reste la source de vérité, l'app fonctionne exactement comme aujourd'hui, et la synchronisation se fait en arrière-plan quand le réseau est disponible.

---

## 2. Hébergeur recommandé : Supabase

Base Postgres managée, authentification intégrée (Google, Apple, lien magique par e-mail), offre gratuite suffisante pour un usage personnel. Son intérêt décisif ici est la **Row Level Security** : la règle « chacun ne voit que ses lignes » est appliquée par la base elle-même, pas par le code du navigateur. Impossible d'oublier un contrôle d'accès côté client.

Firebase conviendrait aussi, mais son modèle non relationnel s'accorde moins bien avec des écritures comptables.

À savoir : un projet Supabase gratuit est mis en pause après une longue période sans activité (il se réveille depuis le tableau de bord).

### Schéma

```sql
-- Réglages généraux (une ligne par utilisateur)
create table public.settings (
  user_id       uuid primary key references auth.users on delete cascade,
  solde_initial numeric(12,2) not null default 0,
  preferences   jsonb         not null default '{}'::jsonb,
  updated_at    timestamptz   not null default now()
);

-- Catégories
create table public.categories (
  id         text        not null,           -- même id que côté client
  user_id    uuid        not null references auth.users on delete cascade,
  name       text        not null,
  type       text        not null check (type in ('entree','sortie')),
  budget     numeric(12,2),
  position   int         not null default 0, -- l'ordre d'affichage compte
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Montants : une ligne par (mois, catégorie)
create table public.entries (
  user_id    uuid        not null references auth.users on delete cascade,
  month      text        not null check (month ~ '^\d{4}-\d{2}$'),
  category_id text       not null,
  raw        text        not null default '',
  val        numeric(12,2) not null default 0,
  done       boolean     not null default false,
  items      jsonb       not null default '[]'::jsonb,  -- détail des dépenses
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, month, category_id)
);

create index entries_sync_idx on public.entries (user_id, updated_at);
create index categories_sync_idx on public.categories (user_id, updated_at);
```

### Sécurité

```sql
alter table public.settings   enable row level security;
alter table public.categories enable row level security;
alter table public.entries    enable row level security;

create policy "chacun ses réglages" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chacun ses catégories" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chacun ses montants" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Ajoute aussi un trigger qui force `updated_at = now()` à chaque `update` : ne jamais faire confiance à l'horloge du client pour dater une modification, elle sert seulement à ordonner les intentions locales.

---

## 3. Stratégie de synchronisation

Le modèle le plus simple qui tienne debout pour un usage personnel sur deux ou trois appareils :

1. **Horodatage par cellule.** Ajouter `updatedAt` (ISO) sur chaque cellule, chaque catégorie et sur les réglages, mis à jour à chaque modification locale.
2. **Résolution par « le plus récent gagne »**, cellule par cellule. La granularité compte : en comparant mois par mois, saisir le loyer sur l'iPhone pendant que le Mac saisit les courses ferait perdre l'une des deux écritures.
3. **Suppressions logiques.** Un enregistrement supprimé est marqué `deleted = true` plutôt que réellement effacé, sinon il réapparaît à la synchronisation suivante depuis l'appareil qui ne l'a pas vu disparaître. Un nettoyage périodique des lignes supprimées depuis plus de 90 jours suffit.
4. **Boucle de synchronisation.** Au démarrage, au retour en ligne (`window.addEventListener('online', …)`) et à intervalle régulier : envoyer les enregistrements locaux plus récents que `lastSyncAt`, récupérer les distants plus récents, fusionner, puis enregistrer le nouveau `lastSyncAt`.

Prévoir un indicateur visible : « synchronisé il y a 2 min », « hors ligne, 3 modifications en attente ». Une synchronisation silencieuse qui échoue est pire que pas de synchronisation du tout.

---

## 4. Connexion

Côté code, le client Supabase (`@supabase/supabase-js`) doit être **copié dans `vendor/`** comme Chart.js, pas chargé depuis un CDN : le reste de l'app fonctionne hors-ligne, une balise `<script>` distante casserait cette propriété.

Points d'attention propres à iOS et macOS :

- Depuis une PWA installée sur iPhone, une connexion Google ouvre Safari puis revient dans l'app : le parcours est heurté. **Sign in with Apple** ou un **lien magique par e-mail** donnent un résultat plus fluide, et Apple est de toute façon le compte que l'utilisateur d'un iPhone a déjà sous la main.
- Sign in with Apple sur le web exige un compte développeur Apple payant. Le lien magique par e-mail ne coûte rien et ne demande aucune configuration OAuth.
- Configurer les URL de redirection autorisées dans Supabase avec l'adresse GitHub Pages exacte, `https://sharpl-ux.github.io/carnet-de-comptes/`, sinon la connexion échoue silencieusement en production alors qu'elle marchait en local.

La clé `anon` de Supabase est publique par conception : elle peut figurer dans le dépôt, c'est la Row Level Security qui protège les données. Ne jamais y mettre la clé `service_role`, qui contourne toutes les règles.

---

## 5. Ordre de travail suggéré

1. Ajouter `updatedAt` partout et les suppressions logiques, **sans aucun serveur**. Cette étape est invisible pour l'utilisateur, ne casse rien, et rend la suite possible.
2. Créer le projet Supabase, les tables, les politiques RLS, et vérifier depuis l'éditeur SQL qu'un utilisateur ne voit bien que ses lignes.
3. Ajouter la connexion seule, avec un écran « connecté en tant que… » et rien d'autre.
4. Ajouter la synchronisation montante (local → serveur), puis descendante, puis la fusion.
5. Tester le cas qui casse tout : modifier la même cellule sur deux appareils hors ligne, puis les remettre en ligne l'un après l'autre.

Garder l'export `.json` en état de marche à chaque étape. C'est le filet de sécurité quand une synchronisation se passe mal.
