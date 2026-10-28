# Business administration and site themes

Sign in with a platform administrator account. Use **Administration → Businesses**
to search every listing, including hidden businesses. Search results are paginated;
older businesses remain accessible.

## Edit and manage businesses

Expand a business to change its name, description, category, or public listing
status. Enter a reason and choose **Save business**. The domain stays fixed because
ownership verification and review attribution belong to that exact hostname.

- **Show in the public directory:** hide or restore a listing. Hiding also pauses
  uptime monitoring and makes its public page, score API and widgets unavailable.
- **Permanently closed:** keep the listing and published reviews visible with a
  closure notice. This also closes review submissions and author edits, cancels
  pending ownership claims, and pauses monitoring.
- **Close reviews for this business:** stop new reviews and author edits while
  retaining published reviews and their contribution to the overall score.
  Reports, appeals, business responses and staff moderation continue to work.

An administrator can correct a mistaken closure. Reopening a business does not
automatically reopen reviews; uncheck **Close reviews for this business** to do so.
Monitoring stays paused after restoration or reopening until an authorized owner
or administrator explicitly enables it. Existing monitoring observations remain;
an incident ended administratively is labeled accordingly, without claiming a
successful recovery check.

**Transfer business ownership** retains the existing staff-reviewed transfer
workflow. The recipient must have a verified account. Previous team memberships
and unused invitations are revoked. New ownership claims are blocked while a
listing is hidden or permanently closed.

## Delete a business

Expand **Permanently delete this business**, enter an administrative reason above,
and type the exact domain to enable deletion. This permanently removes the listing,
all of its reviews and reports, ownership claims, team access and invitations,
and monitoring history. The administrative audit record remains, including the
domain, business name, review count, actor and reason.

Use hiding when you need a reversible action. Deletion does not delete user
accounts, donations, or unrelated businesses. A deleted domain can be added as a
new listing; hiding keeps the existing listing and prevents public re-creation.

All administrative business changes require the current database-backed platform
administrator role. Business ownership alone does not grant these controls.
Updates and deletion check the business revision so an old browser tab cannot
silently overwrite a newer change. Reload businesses if a conflict is reported.

## Ruby red appearance

Open **Site settings** in the navigation to choose **Dark ruby red** or
**Light ruby red**, then select **Save site theme**. Dark ruby red is the initial
default on both new installations and upgrades.

The site default is stored in PostgreSQL and applies to the public directory,
authentication pages, dashboards, donations and account settings. Existing visitors
receive changes on reload or when returning to the tab. The navigation's sun/moon
button chooses a personal preference for the current device. Personal preferences
persist across reloads and take precedence over the site default.

Account **Settings → Appearance** provides the same personal choice and an option
to follow the site default again. If an administrator has a personal override,
the site-settings page shows **Use the site default on this device**. Existing
saved light/dark preferences map to the corresponding ruby theme.

Public widgets use the same ruby palette with the light/dark setting selected in
their embed code, independently of the host website's theme.

## Updating an existing installation

Pull the update and restart with `bun run dev`. Development startup adds the new
columns and settings table while preserving existing accounts and reviews.
Production uses the included additive `0009_administration` migration through the
normal server entrypoint. No additional service or environment variable is needed.
