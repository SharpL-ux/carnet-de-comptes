# Carnet de comptes

Suivi mensuel des entrées et sorties, avec budgets, détail des dépenses et graphiques. Application web autonome : **aucun compte, aucun serveur, aucun traqueur**. Les données restent dans le navigateur de l'appareil.

S'installe comme une vraie application sur iPhone, iPad et Mac.

---

## 1. Mettre le site en ligne

### Option A — sans ligne de commande

1. <https://github.com/new>, connecté au compte **SharpL-ux**.
2. **Repository name** : `carnet-de-comptes`, visibilité **Public**, ne rien cocher d'autre → *Create repository*.
3. Sur la page du dépôt vide : **uploading an existing file**.
4. Glisse **tout le contenu** de ce dossier — y compris les sous-dossiers `css/`, `js/`, `vendor/` — puis *Commit changes*.
5. **Settings** → **Pages** → *Source* : **Deploy from a branch**, *Branch* : **`main`** / **`/ (root)`** → *Save*.
6. Après 1 à 2 minutes : **https://sharpl-ux.github.io/carnet-de-comptes/**

### Option B — en ligne de commande

```bash
cd carnet-de-comptes
git init
git add -A
git commit -m "Carnet de comptes v5"
git branch -M main
git remote add origin https://github.com/SharpL-ux/carnet-de-comptes.git
git push -u origin main
```

Le dépôt doit exister sur GitHub **avant** le `push` : Git ne le crée pas tout seul. Active ensuite Pages (étape 5).

Aucun chemin absolu n'est codé en dur : le dépôt peut porter un autre nom, l'URL suivra.

---

## 2. Installer l'app

**iPhone / iPad** — ouvre l'adresse **dans Safari** (obligatoire : iOS n'autorise l'installation que depuis Safari), bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.

**Mac** — Safari 17 ou plus récent : menu **Fichier** → **Ajouter au Dock…**. Avec Chrome ou Edge : icône d'installation dans la barre d'adresse.

Une fois installée, l'app s'ouvre en plein écran et fonctionne **entièrement sans connexion**. Le menu **⋮ → Installer sur cet appareil** rappelle la marche à suivre selon l'appareil.

---

## 3. Ce que fait l'application

**Saisie du mois.** Une ligne par catégorie, entrées et sorties séparées. Le champ montant accepte un calcul : `40+12,50-3` est évalué à la validation et l'expression reste modifiable ensuite (une petite icône signale les lignes calculées). La coche marque ce qui est réellement reçu ou payé, ce qui alimente le « reste à payer ».

**Détail des dépenses.** L'icône de ticket sur chaque ligne ouvre une feuille où consigner chaque achat (`Carrefour 52,40`, `Boulangerie 6,20`…). Le montant de la ligne devient la somme du détail et se verrouille. C'est la réponse à « où sont passés mes 410 € de courses ». Le premier montant déjà saisi est repris comme première entrée du détail.

**Budgets.** Un budget mensuel facultatif par catégorie. La saisie affiche un rappel sous la ligne, une carte « Suivi des budgets » montre les jauges, et l'accueil résume la consommation globale avec alerte en cas de dépassement.

**Comparaison automatique.** Chaque ligne indique son écart avec le mois précédent, coloré selon que la variation joue en ta faveur ou non (désactivable dans les options).

**Bilan.** Totaux, épargne nette, moyenne mensuelle, meilleur mois et mois le plus tendu, sur les mois que tu sélectionnes. Graphiques : solde cumulé, entrées/sorties, répartition des sorties.

**Annulation.** Le bouton en haut à gauche annule la dernière action — suppression de catégorie, réinitialisation d'un mois, duplication comprises. 25 niveaux, aussi accessible par **⌘Z**.

**Thème clair / sombre**, automatique selon le réglage du système ou forcé.

**Reprise et duplication.** « Reprendre le mois précédent » remplit les lignes encore vides à partir du mois d'avant. « Dupliquer ce mois vers… » copie vers plusieurs mois d'un coup, avec ou sans écrasement.

**Recherche** dans les lignes, utile dès que les catégories sont nombreuses.

---

## 4. Tes données

Stockées dans le navigateur, **séparément sur chaque appareil**. L'iPhone et le Mac ne se synchronisent pas entre eux : c'est le prix d'une app sans compte ni serveur. Voir `SYNC.md` pour ajouter une synchronisation en ligne.

- **⋮ → Sauvegarde complète (.json)** : tout, y compris le détail des dépenses et les budgets.
- **⋮ → Restaurer une sauvegarde** : sur l'autre appareil, via AirDrop ou iCloud Drive.
- **⋮ → Exporter en CSV** : pour Excel ou Numbers.
- **⋮ → À propos** : nombre de mois renseignés, date de la dernière sauvegarde, espace occupé.

L'app demande au navigateur un stockage persistant et rappelle de sauvegarder au bout d'un mois sans export. Effacer les données de site dans Safari efface quand même le carnet : fais des sauvegardes.

Les données d'une version précédente sont reprises automatiquement au premier lancement, y compris les coches et le solde de départ.

---

## 5. Mettre à jour plus tard

Après toute modification, **incrémente `VERSION` en haut de `sw.js`** (`"v5.0"` → `"v5.1"`) avant de pousser. Sans cela, les appareils qui ont déjà installé l'app continuent de servir l'ancienne version depuis leur cache.

Au lancement suivant, l'app détecte la nouvelle version et propose un bouton **« Mettre à jour »** — jamais au milieu d'une saisie.

---

## 6. Organisation du code

| Chemin | Rôle |
| --- | --- |
| `index.html` | Structure : écrans et feuilles modales |
| `css/app.css` | Styles, thèmes clair/sombre, mise en page mobile et grand écran |
| `css/icons.css` | Icônes en masques SVG, générées localement — aucun appel réseau |
| `js/app.js` | Toute la logique : état, calculs, rendu, sauvegardes |
| `vendor/chart.umd.js` | Chart.js 4.4.1, copie locale (MIT, voir `vendor/chart.js-LICENSE.md`) |
| `sw.js` | Service worker : cache hors-ligne, mises à jour contrôlées |
| `manifest.json` | Nom, icônes, plein écran, raccourcis d'app |
| `SYNC.md` | Dossier technique : ajouter comptes et synchronisation |

Le format de stockage est un objet JSON unique sous la clé `carnetComptes_v5` :

```jsonc
{
  "version": 5,
  "soldeInitial": 1200.5,
  "settings": { "theme": "auto", "showDelta": true, "lastBackup": "..." },
  "categories": [ { "id": "loyer", "name": "Loyer", "type": "sortie", "budget": 900 } ],
  "entries": {
    "2026-09": {
      "loyer": { "raw": "860", "val": 860, "done": true, "items": [] },
      "marche": { "raw": "", "val": 76.6, "done": false,
                  "items": [ { "id": "i1", "label": "Carrefour", "amount": 52.4 } ] }
    }
  }
}
```

Quand `items` n'est pas vide, le montant de la ligne est la somme des `items` et `raw` est ignoré.

---

## 7. Raccourcis clavier (Mac)

| Touche | Action |
| --- | --- |
| `1` … `4` | Accueil / Saisie / Catégorie / Bilan |
| `←` `→` | Mois précédent / suivant |
| `⌘Z` | Annuler la dernière action |
| `Échap` | Fermer la feuille ouverte |
| `Entrée` | Valider un montant ou une fenêtre |
