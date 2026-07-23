# Elite Pixel Art

Un jeu de fusion mentale en duel : repérez trois cartes, imaginez leurs rotations et retrouvez l'unique superposition qui reproduit le modèle coloré.

## Modes de jeu

### 1v1 local

Deux joueurs partagent le même écran :

- Joueur 1 : `Espace`
- Joueur 2 : `Entrée`

Le mode local est conservé dans `local.html` avec son buzzer et ses chronomètres. Avant la partie, les joueurs choisissent un format FT1, FT2 ou FT3.

### 1v1 online — bêta amicale

Deux joueurs utilisent chacun leur navigateur et rejoignent un salon privé grâce à un code de six caractères. Sur chaque appareil, `Espace` **ou** `Entrée` déclenche le buzzer du joueur.

Supabase synchronise et arbitre :

- les deux participants et leur état « prêt » ;
- l'énigme commune grâce à une graine déterministe ;
- le premier buzzer reçu ;
- les phases et les chronomètres ;
- les manches et le score du format FT1, FT2 ou FT3 choisi par le créateur ;
- une fenêtre de reconnexion de 30 secondes avant toute victoire par forfait ;
- une synchronisation adaptative regroupée, complétée par les événements Realtime.

Une superposition `X + X + Y` est invalide : une couleur majoritaire ne remplace plus la troisième couleur. Après un buzz, le joueur dispose de 15 secondes pour choisir ses cartes ; une erreur accorde 30 secondes exclusives à l'adversaire.

Cette première version reste volontairement amicale, mais les réponses sont désormais arbitrées par Supabase. Le navigateur reçoit les cartes et le modèle sans la solution, envoie les trois cartes choisies, puis le serveur compare lui-même la sélection à une énigme privée vérifiée. La solution et ses rotations ne sont révélées qu’après la manche.

## Historique Brainy Games Hub

Les deux sites utilisent le même domaine GitHub Pages et le même projet
Supabase. Un profil Brainy Games Hub déjà connecté est donc reconnu sans
transmettre de mot de passe ou de jeton dans l’URL.

- Online : Supabase publie automatiquement le résultat FT1, FT2 ou FT3 dans
  l’historique commun. Le navigateur ne peut pas fabriquer ce résultat.
- Local : le joueur connecté indique s’il joue J1 ou J2. La partie est ajoutée
  comme amicale ; hors ligne, elle attend sur l’appareil avant synchronisation.
- Sans profil : tous les modes restent jouables, mais aucun historique personnel
  n’est créé.
- Aucune de ces parties ne modifie l’Elo.

## Structure

- `index.html` : menu des modes ;
- `local.html` et `src/app.js` : duel sur le même écran ;
- `online.html` et `src/online.js` : salons privés en ligne ;
- `src/brainy-history.js` : contrat et file hors ligne des parties locales ;
- `src/engine.js` : génération et résolution des énigmes partagées ;
- `supabase/elite-pixel-online.sql` : schéma, règles de sécurité et fonctions du mode online ;
- `supabase/20260723223000_integrate_brainy_games_history.sql` : publication
  serveur des résultats online vers Brainy Games Hub ;
- `favicon.svg` : modèle pixelisé à atteindre.

Les objets Supabase utilisent exclusivement le préfixe `elite_pixel_` pour rester séparés des autres jeux hébergés dans le même projet. La banque déployée contient 128 énigmes ; leurs identifiants et solutions ne sont pas enregistrés dans le dépôt public. Pour préparer une nouvelle banque privée, exécutez `npm run generate:puzzle-bank -- 128`, puis appliquez le SQL produit dans Supabase.

## Lancer en local

Le projet ne nécessite ni compilation ni dépendance locale. Servez simplement le dossier avec un serveur HTTP statique, puis ouvrez `index.html`.

La version publiée est disponible sur [GitHub Pages](https://seb16120.github.io/Elite-Pixel-Art/).

## Tests automatiques

Avec Node.js installé, lancez simplement :

```powershell
npm test
```

La suite ne demande aucune bibliothèque supplémentaire. Elle vérifie le moteur
(rotations, fusions, règle `X + X + Y` et unicité des énigmes) ainsi que les
contrats essentiels des phases online définies dans le fichier SQL Supabase.
