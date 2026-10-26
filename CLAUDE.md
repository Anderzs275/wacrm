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
  `/var/www/wacrm`, domain `crm.underwearsociety.com` (DNS on BanaHosting,
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

1. Before pushing: `npm run lint`, `npm run typecheck`, `npm test`.
2. Push to `main` on GitHub.
3. On the server: `/var/www/deploy.sh` (git pull, npm ci, build, pm2 restart).

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

## Pending port: tracking / Shopify

An older working copy at `E:\Trabajos\crm\wacrm` (based on upstream
`45e80ad`, uncommitted) contains a tracking + Shopify orders feature not yet
ported here: `src/app/(dashboard)/{tracking,orders}`, `src/app/api/{tracking,shopify}`,
`src/lib/{tracking,shopify}`, `src/components/orders`, settings sections,
role/permission changes, `pdfjs-dist`, and catalogue strings. Its migrations
are numbered `043`–`046`, which collide with upstream — renumber into the
fork's `100+` range when porting. None of them has been applied to the
Supabase project yet (checked 2026-10-26). Port by re-applying the changes onto current code, not by
copying files over (that would revert upstream fixes).

## Upstream updates

```
git remote add upstream https://github.com/ArnasDon/wacrm.git   # once
git fetch upstream && git merge upstream/main
```
