# Account settings, review privacy and resolutions

These features use the same server, frontend and PostgreSQL schema in development
and production. They are not development-only screens.

## Find your settings

Every signed-in account has **Profile & settings** in the main navigation.
**My dashboard** also has a profile card with **Edit profile & settings**,
**My donation settings** and **Themes & appearance**.

Account settings has four tabs:

- **Profile & privacy:** picture, account display name, persistent profile
  pseudonym, default review anonymity and existing notification preferences.
- **Donations:** donation identity, optional profile-pseudonym reuse, receipt
  history, public-credit controls and the option to make all donations anonymous.
- **Themes & appearance:** personal dark/light ruby red preference, follow-site
  default control, and an administrator link to the site-wide theme setting.
- **Security:** password change and signing out other devices.

Administrators also have **Site settings & themes** in the main navigation and
on the administration page. This opens the persistent site-default theme setting.
Personal preferences override the site default for that device; use **Follow site
default** to remove the override. The initial site default remains dark ruby red.

## Profile pictures and identity

The picture picker accepts PNG and JPEG files up to 10 MB. The browser crops and
resizes them before upload. The server accepts at most 2 MB and dimensions up to
2048 × 2048, validates and decodes the picture, and re-encodes it as a 128 × 128 PNG.
Uploaded photo metadata is not retained. SVG and arbitrary external image URLs
are not accepted by this upload endpoint.

Small normalized pictures are stored in PostgreSQL, with at most one per account.
Replacing or removing a picture invalidates its old URL. Database backups include
the pictures; no local upload directory, S3 service, new volume or storage
credentials are needed in either environment. Existing optional object-storage
services remain available for future larger media features.

Profile pseudonyms use 3–40 letters, numbers, spaces, dots, underscores or hyphens.
They are normalized and unique without regard to case; reserved staff/system names
are unavailable. A saved pseudonym remains reserved while the account display name
is selected. Selecting a profile pseudonym updates the identity on previous and
future non-anonymous reviews.

Donation identities remain separately configurable. **Use my profile pseudonym
for donations** copies the current pseudonym into the donation identity form;
save it explicitly. Later profile edits do not silently change that separate
donation preference. Neither setting opts a donation into public credit.

## Anonymous reviews

Select **Post this review anonymously** when submitting or editing a review.
The profile setting **Post new reviews anonymously by default** preselects it
for new reviews. Existing reviews can be changed individually from **My dashboard**
using **Make this review anonymous** or **Show my profile on this review**.
Profile settings also has **Make all my existing reviews anonymous**.

Anonymous public reviews and widgets show **Anonymous reviewer**, without the
account name, pseudonym, picture or a link to the account. Review ratings and
publication status are unchanged. Attribution can be changed even after a
business closes reviews; content and score edits still obey the closure policy.

Platform administrators retain private account attribution for moderation.
Anonymity on this site cannot remove copies that someone already saved elsewhere.
Public review responses and widgets are served without response caching so
updated attribution is available on the next request.

## Business responses and resolution labels

Verified owners and team members use **Manage website → Reviews** to post or
update a **Business response**. They can explain the situation and provide public
support contact information. This does not grant access to the reviewer's private
email or account identity.

After replying, a representative can open **Request a resolution label** and
write a proposed note. The reviewer receives a dashboard notification. The
pending request and note are private to the reviewer, business team and staff.

From **My dashboard**, the reviewer can accept or decline the request. Acceptance
publishes **Resolution confirmed by reviewer** and the accepted note beside the
review. Widgets also display the label. Only the reviewer can accept it.
Businesses and administrators cannot mark their own requests accepted.

Acceptance does not change the score, content or moderation status. The reviewer
may optionally edit their experience and score afterward; those edits return to
independent moderation. If author edits are closed, accepting a label does not
bypass that restriction. The reviewer may later remove the label.

A declined or withdrawn request cannot be repeated for seven days. Moderators can
remove a label or pending request using an explained, audited decision. Resolution
actions use revision checks so stale or repeated requests cannot silently replace
a more recent response.

## Admin user management

Open **Administration → Users** or **Manage users** on the administrator dashboard.
Search by name, email or profile pseudonym, and filter active accounts, suspended
accounts or administrators. Lists are paginated.

Select an account to inspect its identity, sign-in dates, reviews, retained risk
signals, business access, recent donations, active-session dates and recent audit
entries. Review links open the existing moderation and connection-investigation
tools. The displayed risk signals are leads, not proof of a shared identity.
Session tokens, password hashes and raw session IP addresses are not exposed.

Staff can edit display names and profile pseudonyms, remove profile pictures,
change default review anonymity, grant/revoke administrator access, suspend or
restore accounts, and sign out all account sessions. A reason is required.
Suspension blocks new sign-ins and authenticated API use, revokes sessions and
disables API keys. Restoration does not reactivate old keys. Role changes revoke
the affected account's existing sessions.

An administrator cannot remove their own administrative access through these
controls. Role changes are serialized, use current database permissions, and
preserve at least one active administrator. Old browser tabs must reload before
overwriting a newer account revision.

Permanent account deletion requires typing the exact email and an administrative
reason. It removes that account's sessions, profile, picture and authored reviews.
Its business listings remain unclaimed; prior team access and invitations are
revoked and monitoring pauses. Verified donations remain in the ledger without
account attribution. Audit evidence is retained.

## Deploy or update

For local development, pull the changes and run `bun run dev`. The launcher
prepares the new schema automatically.

For production, use the [two-file deployment command](deployment.md). The normal
server entrypoint applies the additive `0010_accounts_and_resolutions` migration
before serving requests. Both production Docker images build these same screens
and handlers. There are no new environment variables or required services.
