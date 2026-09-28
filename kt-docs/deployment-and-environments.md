# Deployment and environments

**Status:** Partial — infrastructure exists as Azure App Service containers + Front Door; treat spike environments as non-production.

## Local development vs deployed spike

| Concern     | Local                         | Deployed (Azure)                                          |
| ----------- | ----------------------------- | --------------------------------------------------------- |
| Entry       | `npm start` / manage watch    | Container image `consultees/web` on **Azure App Service** |
| Public edge | localhost:8090                | **Azure Front Door** → App Service origin                 |
| Auth        | Usually disabled              | Entra settings from Terraform app settings                |
| SQL         | Docker on host port 1434      | Azure SQL (infra modules)                                 |
| Python      | Optional Functions Core Tools | Function App (see `infrastructure/app-function.tf`)       |
| Secrets     | `.env` files (gitignored)     | Key Vault references in app settings                      |

> Naming note: some spike conversations say “Container Apps”. **This repo’s web module is App Service with a container image** (`infrastructure/app-web.tf`). Prefer that wording in Confluence unless infra deliberately moves.

## Configuration boundaries

Safe to use locally / in spike:

- Fixture geometries and sample map polygons
- Docker SA password from compose examples
- Placeholder `SESSION_SECRET`
- Non-production Entra app registrations when provided by the team

Must **not** be used:

- Production CBOS data extracts in git, tickets, or Confluence attachments
- Production connection strings, client secrets, or certificates in `.env` committed to the repo
- Real personal data in Playwright fixtures or screenshots

## Runtime shape (deployed)

```
Browser  --HTTP/2-->  Azure Front Door  --HTTP/1.1-->  App Service (Node origin)
```

- Keep Express `trust proxy` as a **hop count** (currently `1`), not `true`
- Do not add experimental HTTP/3 listeners in Node; enable HTTP/3 at Front Door when available

## What frontend engineers usually change before deploy

- App code under `apps/manage`
- Env var **names** documented in `.env.example` / Terraform `app_settings` (values via platform)
- Static asset build (`npm run build` in manage) as part of image pipeline

Infra-only changes (Front Door rules, SKUs, DNS) go through `infrastructure/` with the usual Terraform review path.

## Related pages

- [Local setup](./local-setup.md)
- [Architecture and tracks](./architecture-and-tracks.md)
- [Decisions and open questions](./decisions-and-open-questions.md)
