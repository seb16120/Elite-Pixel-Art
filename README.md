# Elite Pixel Art

Jeu local à deux joueurs de manipulation mentale de cartes en grille 3 × 3.

## Principe

Un modèle coloré est affiché avec neuf cartes candidates. Les joueurs doivent retrouver les trois cartes qui, après une éventuelle rotation par quarts de tour et une superposition mentale, reproduisent exactement le modèle.

- Aucun miroir ni aucune symétrie axiale.
- Les trois cartes se combinent simultanément, case par case.
- Rouge + jaune = orange.
- Rouge + bleu = violet.
- Jaune + bleu = vert.
- Rouge + jaune + bleu = noir.
- Avec trois couleurs dont deux identiques, la couleur majoritaire gagne.
- Les cases vides doivent également correspondre.

Chaque manche est générée puis contrôlée automatiquement parmi les 84 trios et les 64 dispositions de rotations possibles par trio. Une énigme n’est conservée que si elle possède exactement une solution complète.

## Déroulement

- Joueur 1 : `Espace`.
- Joueur 2 : `Entrée`.
- Une minute de réflexion commune.
- Après un buzz : 10 secondes pour sélectionner trois cartes et vérifier.
- En cas d’erreur : 20 secondes exclusives pour l’adversaire.
- Après la riposte, une nouvelle minute commune commence.
- Limite absolue de cinq minutes par manche.
- Premier joueur à trois manches gagnées : FT3.

## Lancer le jeu

Le projet utilise les modules JavaScript natifs. Il faut donc le servir avec un petit serveur local :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Tests

Aucune dépendance n’est nécessaire. Avec Node.js 20 ou plus récent :

```bash
npm test
```

Les tests couvrent les rotations, les règles de fusion, la comparaison des trios et l’unicité des énigmes générées.
