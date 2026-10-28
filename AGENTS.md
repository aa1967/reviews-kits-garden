# Requirements for this fork

- Keep features working in both development and production. Use the same
  application code, include additive database migrations, and check container
  packaging when a runtime change needs it. The user currently tests locally;
  do not assume a production instance has been deployed.
- Every user-facing feature and configurable setting needs a working, discoverable
  frontend control. Link account settings from My dashboard, and put platform
  administration and site-wide themes in the administrator interface.
- Preserve independent platform moderation. Businesses may respond and request
  resolution labels, but only the reviewer can accept a resolution or change
  their rating. Public anonymity must hide identity while staff retain private
  attribution for moderation.
- Use Bun and keep the ordinary development launch simple. This is a small
  self-hosted service; keep extra storage/cache services optional.
