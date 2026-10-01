# Architecture — KingJOBS API

## Choix V1 : modular monolith

KingJOBS backend V1 est un **monolithe modulaire NestJS**.

Raisons :

- simplicité opérationnelle ;
- cohérence transactionnelle (missions, paiements, commission) ;
- vitesse de développement ;
- maintenabilité ;
- extraction future possible en services si le volume le justifie.

**Pas de microservices** à ce stade. **Pas** de bus d'événements externe (Kafka/RabbitMQ). **Pas** de Redis dans Backend 01.

## Couches

```
src/
  config/            configuration & validation env
  common/            cross-cutting (filters, interceptors, utils)
  infrastructure/    Prisma et futurs adapters techniques
  modules/           modules métier HTTP (health, puis auth, users…)
```

## Modules futurs (non créés maintenant)

auth, users, clients, jobbers, services, missions, matching,
payments, payouts, documents, reviews, disputes, notifications,
admin, audit, support.

Ils s'ajouteront comme modules Nest sans refactor massif grâce à :

- prefix/versioning global `/api/v1` ;
- ValidationPipe global ;
- PrismaService central ;
- guards/decorators réservés pour auth.

## Prisma

- Un seul `PrismaService` injecté (pas de `new PrismaClient()` dispersé).
- Lifecycle Nest : connect on init, disconnect on destroy.
- Transactions Prisma prévues pour missions/paiements (pas implémentées ici).
- Erreurs Prisma : ne jamais les exposer brutes aux clients (filtre global).

## API versioning

- Prefixe : `API_PREFIX` (défaut `api`)
- Version URI : `API_VERSION` (défaut `1`)
- Résultat : `/api/v1/...`
- Controllers déclarent `version: '1'` (ou version par défaut)

## Erreurs

Format JSON prévisible via `GlobalExceptionFilter` :

- `statusCode`, `error`, `message`, `path`, `timestamp`, `requestId?`
- Production : pas de stack, SQL, credentials

## Sécurité (socle)

- Helmet
- CORS origins configurables (pas `*` avec credentials)
- ValidationPipe (`whitelist`, `forbidNonWhitelisted`, `transform`)
- Rate limiting global (`@nestjs/throttler`) — health skippé
- Request ID (`x-request-id`)
- Logging HTTP sans secrets
- Swagger désactivable (`SWAGGER_ENABLED`)

## Logging

- Logger Nest
- Interceptor HTTP : method, path, status, duration, requestId
- Utilitaire `redact` prêt pour futurs payloads

## Configuration

- `@nestjs/config` + `configuration.ts` + `validateEnv`
- Échec rapide au boot si env critique invalide
- Environnements : `development` | `test` | `production`

## Identifiants futurs

Recommandation : **UUID** (`@default(uuid())` / `gen_random_uuid()`) pour les objets métier publics — déjà le pattern des tables pré-lancement.

## Pagination future

Convention recommandée (non implémentée) :

- listes admin : `page` + `limit` (borné, ex. max 100)
- flux temps réel / feeds : cursor pagination si besoin

## Audit trail

Besoin produit futur (admin, paiements, vérifications, litiges). Non implémenté en Backend 01.

## Adapters externes futurs

FedaPay, Resend, SMS, Storage — à introduire quand le module métier arrive (YAGNI).

## Déploiement

Processus **séparé** du frontend Vercel. Hébergeur backend non choisi dans ce sprint.
