# DecisionMaker

A small web app that helps a group make a decision without anyone stepping on anyone's toes.
A host creates an event with options and shares one link.
Participants rank the options, set a private budget limit, and write an opinion.
A language model rewrites every opinion to strip out who wrote it, then produces a report with the best option, runner-up, worst, unexpected option, charts, and anonymized themes.

The design lives in `docs/superpowers/specs/2026-09-17-decision-maker-design.md`.

## Develop

```sh
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

## Check

```sh
npm run lint
npm run check
npm run test:unit -- --run
npm run test:e2e
```

The end-to-end suite builds the app, starts it on port 4173 with a fresh SQLite file under `e2e/.tmp/`, and drives it in a phone-sized Chromium.

## Database

Schema changes go in `src/lib/server/db/schema.ts`, then `npm run db:generate` writes a migration into `drizzle/`.
Migrations run automatically when the server starts.

## Deploy

The app runs at https://decide.acb-apps.com on the hub VM, as one Docker Compose stack behind Podium Chasers' Caddy.
`deploy/README.md` is the runbook: setup, deploy, DNS, verification, backups, and restore.

```sh
ssh f1w-hub 'cd ~/decision-maker && git pull --ff-only && bash deploy/deploy.sh'
curl -s https://decide.acb-apps.com/api/health
```

`fly.toml` is the retired Fly.io deployment, kept in case a managed host is needed again.
