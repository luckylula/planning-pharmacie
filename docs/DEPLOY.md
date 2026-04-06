# Déploiement GitHub + Vercel (Planning Pharmacie)

## Prérequis

- Compte [GitHub](https://github.com)
- Compte [Vercel](https://vercel.com) (connexion avec GitHub recommandée)
- Une base **PostgreSQL** accessible depuis Internet ([Neon](https://neon.tech), [Supabase](https://supabase.com), [Railway](https://railway.app), Vercel Postgres, etc.)

---

## 1. Pousser le code sur GitHub

Si le dépôt local n’a pas encore de remote :

```bash
cd planning-pharmacie
git add .
git commit -m "Prepare production deploy"
```

Sur GitHub : **New repository** → nommez-le (ex. `planning-pharmacie`), **sans** cocher « Add README » si le dossier existe déjà.

Puis dans le terminal (remplacez `USER` et `REPO`) :

```bash
git remote add origin https://github.com/USER/REPO.git
git branch -M main
git push -u origin main
```

Si `origin` existe déjà : `git remote set-url origin https://github.com/USER/REPO.git` puis `git push -u origin main`.

---

## 2. Créer le projet Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** le dépôt GitHub.
2. **Root Directory** (indispensable si le dépôt n’est pas *uniquement* l’app) : si le repo contient un sous-dossier `planning-pharmacie` (monorepo / dossier parent), indiquez **`planning-pharmacie`** comme racine du projet. Sinon Vercel ne voit pas `next.config.mjs` ni les routes : build incorrect ou site vide → **`404 NOT_FOUND`** sur `*.vercel.app`.
3. **Framework Preset** : Next.js (détecté automatiquement une fois la bonne racine définie).
4. **Build Command** : `npm run build` (défaut).
5. **Install Command** : `npm install` (défaut).

Ne commitez jamais `.env` : les secrets se configurent dans Vercel.

---

## 3. Variables d’environnement (Vercel)

Dans le projet Vercel : **Settings → Environment Variables**, ajoutez pour **Production** (et **Preview** si besoin) :

| Nom | Valeur |
|-----|--------|
| `DATABASE_URL` | URL PostgreSQL (souvent avec `?sslmode=require`) |
| `NEXTAUTH_URL` | URL du déploiement, ex. `https://votre-projet.vercel.app` |
| `NEXTAUTH_SECRET` | Chaîne longue aléatoire (ex. `openssl rand -base64 32`) |

Après le premier déploiement, copiez l’URL réelle (domaine `*.vercel.app` ou domaine custom) et mettez à jour `NEXTAUTH_URL`, puis redéployez.

---

## 4. Base de données en production

Le schéma n’est pas versionné avec des migrations Prisma dans ce repo : on utilise le schéma Prisma tel quel.

**Une fois** `DATABASE_URL` de prod disponible (en local ou CI) :

```bash
set DATABASE_URL=postgresql://...   # PowerShell: $env:DATABASE_URL="..."
npx prisma db push
npx prisma db seed
```

Ou exécutez `node prisma/ensure-norman-admin.cjs` si vous utilisez ce script pour l’admin.

**Important** : la base doit accepter les connexions SSL depuis Vercel (la plupart des hébergeurs cloud le font).

---

## 5. Vérifications après déploiement

- Page d’accueil et `/login`
- Connexion admin
- API `/api/schedule/data` (avec session admin)

---

## Dépannage

- **`404: NOT_FOUND` / `Code: NOT_FOUND` (ID du type `cdg1::…` sur vercel.app)** : presque toujours **mauvaise racine** ou **aucun déploiement valide**.
  1. Vercel → projet → **Settings → General → Root Directory** : doit être **`planning-pharmacie`** si le dépôt Git contient ce dossier au-dessus de l’app. Enregistrer, puis **Redeploy** le dernier commit (Production).
  2. Vérifier **Deployments** : le dernier déploiement **Production** est bien **Ready** (vert), pas **Error** ou **Canceled**.
  3. Ouvrir l’URL affichée sur ce déploiement (lien **Visit**), pas une ancienne URL de preview ou un domaine mal relié.
  4. Si le dépôt Git est *exclusivement* le contenu de `planning-pharmacie` (pas de dossier parent), Root Directory = **`.`** (vide ou racine du repo) est correct.
- **Build échoue sur Prisma** : `postinstall` et `build` exécutent `prisma generate` ; vérifiez que `prisma` est bien en `dependencies` (c’est le cas).
- **Erreur DB** : `DATABASE_URL` incorrecte ou IP non autorisée (autoriser `0.0.0.0/0` ou l’option « serverless » du fournisseur).
- **NextAuth** : `NEXTAUTH_URL` doit correspondre exactement à l’URL publique (https, sans slash final selon les cas).
