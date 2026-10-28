@AGENTS.md

# Fork: Unno Underwear CRM

Fork of `ArnasDon/wacrm` at `github.com/Anderzs275/wacrm`, customised for
Unno Underwear. Keep fork-specific notes in this file (not in AGENTS.md,
which comes from upstream) so upstream merges stay conflict-free.

## Environments

- **Local (Windows):** `E:\wacrm`. `npm run dev` → http://localhost:3000.
  `.env.local` is git-ignored; it holds the same keys as the server except
  `NEXT_PUBLIC_SITE_URL=http://localhost:3000` and
  `WHATSAPP_TEMPLATES_DRY_RUN=true`.
- **Production:** Hostinger VPS (Ubuntu, Node 22, PM2, Nginx) at
  `/var/www/wacrm`, domain `crm.theunderwearsociety.com` (DNS on BanaHosting,
  TLS via certbot).
- **Database:** one hosted Supabase project, shared by local and prod unless
  a separate dev project is set up. Local work touches real data.
  `ENCRYPTION_KEY` must be identical in both `.env.local` files, otherwise
  stored WhatsApp tokens cannot be decrypted.
- Meta webhooks only reach production; inbound messages never arrive locally.
- **Public sign-up is disabled** in Supabase (Authentication → Sign In /
  Providers → "Allow new users to sign up" off). In the app, `/signup`
  redirects to `/login` (`redirects()` in `next.config.ts`) and the login and
  `/join/<token>` pages offer only "Sign in".
  To add a teammate: Supabase → Authentication → Users → Add user (auto
  confirm), then send a CRM invitation (Settings → Team); they open the link
  and use **Sign in**, not Create account.

## Deploy

Work happens on feature branches (`feat/...`); `main` is what production runs.

1. Before merging: `npm run lint`, `npm run typecheck`, `npm test`.
2. Merge the branch into `main` and push `main` to GitHub.
3. If the change adds a migration, apply it to Supabase (see below) before
   deploying the code that uses it.
4. On the server: `/var/www/deploy.sh` (git pull, npm ci, build,
   `pm2 restart all`).

`NEXT_PUBLIC_*` vars are inlined at build time — changing one on the server
needs a rebuild, not just a restart.

## Database changes

- Schema lives in `supabase/migrations/NNN_*.sql`. Upstream numbers are
  sparse (up to `059` so far, with gaps it may fill later), so fork
  migrations use their own range starting at `100` and never reuse a number.
  When an upstream merge brings a migration numbered below the fork's latest,
  apply it with `npx supabase db push --include-all`.
- Apply with the Supabase CLI: `npx supabase link --project-ref <ref>` once,
  then `npx supabase db push`.
- Never edit an already-applied migration; add a new one.

## Customisation map

| What | Where |
| --- | --- |
| Brand colour (default accent "ocean", `#1378aa`) | `src/app/globals.css` accent blocks + `src/lib/themes.ts` |
| Logo (white-only art, `light:invert` in light mode) | `public/logo.avif`, used by `src/components/layout/sidebar.tsx` and `src/app/(auth)/login/page.tsx` |
| Browser tab title | `src/app/layout.tsx` |
| UI copy | `messages/*.json` (add every key to all four catalogues) |
| Chart axis label colour | `--chart-axis` token in `globals.css` |
| Sidebar menu | `navItems` in `src/components/layout/sidebar.tsx` |

New top-level dashboard routes must also be added to `protectedPaths` in
`src/middleware.ts` (`middleware.test.ts` enforces this).

## Fork features

**Olva tracking ("Envíos", `/tracking`)** — upload an Olva Courier label PDF
(read in the browser with `pdfjs-dist`, never uploaded), review the parsed
rows, send each customer an approved two-variable WhatsApp template
(`{{1}}` first name, `{{2}}` tracking number without the `-YY` year, since
Olva's tracker at tracking.olvaexpress.pe takes the year separately). An
optional COPY_CODE button gets the same number per row
(`src/lib/tracking/tracking-code.ts`). Code: `src/lib/tracking/`,
`src/app/(dashboard)/tracking/`, `src/app/api/tracking/send/`; schema:
`supabase/migrations/100_tracking_shipments.sql`. Delete is admin-only
(`canPurgeData` / `useCan('purge-data')`).

Migration 100 also redefines `redeem_invitation` so accepting an invite
refuses to delete an old account holding `tracking_shipments` rows. Any new
account-scoped table needs the same treatment
(`redeem-invitation-migration.test.ts` enforces it), and if an upstream
migration redefines `redeem_invitation`, re-add the fork's tables in a new
fork migration.

**Equipo (`/team`)** — internal team page (roadmap next: CSV import of
the marketing Excel, admin activity log, AI "what's planned today").
Shows a strip with today's next meeting, the content calendar, who is
connected (reuses `member_presence`) and team labels (admin-only).
Meetings live on the calendar as (repeating) `calendar_events`; the
`team_meetings` table from 101 is no longer used by the UI.
**Last-connection time is admin-only** everywhere: `presenceLabel(...,
showLastSeen)` hides it in the Members tab and inbox assign menu too.
This is a UI rule — RLS still lets members read `last_seen_at`, since
the dot is derived from it. Code: `src/components/team/`,
`src/lib/team/`, `src/app/(dashboard)/team/`; schema:
`supabase/migrations/101_team_space.sql`.

**Content calendar (on `/team`)** — replaces the marketing team's monthly
Excel: one `content_posts` row per planned post (date, category, brand,
format, product, idea, caption, status) plus `content_post_assignees`.
Category/format/status are closed lists (CHECK in migration 104 +
`src/lib/calendar/content-meta.ts`, change both); brands are a managed
list (`content_brands`, admin adds them inline in the post form; seeded
only into multi-member accounts so solo accounts stay mergeable).
`calendar_events` holds dated meetings (day + Lima time + link) and the
team's own key dates; one row per series, `repeat` weekly / biweekly /
weekdays until `repeat_until` (105), expanded in the app by
`src/lib/calendar/recurrence.ts` — editing edits the whole series. A
key date can instead span days (`end_date`, never with a repeat) and
have `priority` normal/high (106); spans draw as one bar. Peruvian holidays and retail dates are computed,
not stored (`src/lib/calendar/peru-dates.ts`; update it if the feriado
law changes). The `team` role can create and edit posts and events;
deleting a post is admin+, an event its creator or an admin. Code: `src/components/calendar/`, `src/lib/calendar/`; schema:
`supabase/migrations/104_content_calendar.sql`.

**Equipo tabs** — `/team` has three tabs: Calendario (month / list /
Trello-style board of posts), Colecciones (`collections` +
`collection_tasks` checklist, board by stage) and Colaboraciones
(`collaborations`, influencer deals with PEN amounts, board by
status), all migration 108. Stages/statuses are closed lists (CHECK +
`src/lib/team/work-meta.ts`). Launch and collab-publish dates show on
the calendar as milestones. The three boards share
`src/components/kanban/kanban-board.tsx` (same @dnd-kit setup as the
deals board). `team` role may create/edit; delete is admin+.

**Role `team` ("Equipo")** — for designers: only `/team` and personal
settings (profile, security, appearance), no customer data. Rank 0,
below viewer. Contained in three layers: RLS (`is_account_member` maps
it to 0 and every existing policy keeps the default min `viewer`;
`103_team_role_access.sql` opens only accounts, profiles, presence and
the team tables via `is_account_member(..., 'team')`),
`getCurrentAccount()` refusing it unless a route passes
`{ allowTeamRole: true }` (only `GET /api/account/members` does), and
the UI (`src/lib/team/team-role.ts`: sidebar filter, shell redirect,
settings rail). A new screen for this role needs all three. Migration
102 only adds the enum value and must be run before 103 (Postgres can't
use a new enum value in the same transaction).

**Not ported:** the Shopify orders integration in the older working copy at
`E:\Trabajos\crm\wacrm` (based on upstream `45e80ad`, uncommitted):
`src/app/(dashboard)/orders`, `src/app/api/shopify`, `src/lib/shopify`,
`src/components/orders`, Shopify settings, and its migrations `044`–`046`
(renumber into `100+` if ever ported). Port by re-applying onto current
code, not by copying files over (that would revert upstream fixes).

## Upstream updates

```
git remote add upstream https://github.com/ArnasDon/wacrm.git   # once
git fetch upstream && git merge upstream/main
```
