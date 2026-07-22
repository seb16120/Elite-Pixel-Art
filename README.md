# Elite Pixel Art

Un jeu de fusion mentale en duel : repérez trois cartes, imaginez leurs rotations et retrouvez l'unique superposition qui reproduit le modèle coloré.

## Modes de jeu

### 1v1 local

Deux joueurs partagent le même écran :

- Joueur 1 : `Espace`
- Joueur 2 : `Entrée`

Le jeu local historique est conservé dans `local.html` avec ses manches en FT3, son buzzer et ses chronomètres.

### 1v1 online — bêta amicale

Deux joueurs utilisent chacun leur navigateur et rejoignent un salon privé grâce à un code de six caractères. Sur chaque appareil, `Espace` **ou** `Entrée` déclenche le buzzer du joueur.

Supabase synchronise et arbitre :

- les deux participants et leur état « prêt » ;
- l'énigme commune grâce à une graine déterministe ;
- le premier buzzer reçu ;
- les phases et les chronomètres ;
- les manches et le score du FT3 ;
- une fenêtre de reconnexion de 30 secondes avant toute victoire par forfait.

Une superposition `X + X + Y` est invalide : une couleur majoritaire ne remplace plus la troisième couleur. Après un buzz, le joueur dispose de 15 secondes pour choisir ses cartes ; une erreur accorde 30 secondes exclusives à l'adversaire.

Cette première version est volontairement amicale. La sélection gagnante est vérifiée dans le navigateur puis déclarée au serveur. Avant d'ajouter un classement ou de l'Elo, la validation complète de la solution devra être déplacée côté serveur afin d'empêcher un navigateur modifié de déclarer une fausse victoire.

## Structure

- `index.html` : menu des modes ;
- `local.html` et `src/app.js` : duel sur le même écran ;
- `online.html` et `src/online.js` : salons privés en ligne ;
- `src/engine.js` : génération et résolution des énigmes partagées ;
- `supabase/elite-pixel-online.sql` : schéma, règles de sécurité et fonctions du mode online ;
- `favicon.svg` : modèle pixelisé à atteindre.

Les objets Supabase utilisent exclusivement le préfixe `elite_pixel_` pour rester séparés des autres jeux hébergés dans le même projet.

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
