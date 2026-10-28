# Donations

The public donation page is `/donate`. It accepts Bitcoin (BTC), Litecoin (LTC),
and Monero (XMR) through receiving addresses configured by a platform administrator.
Payments go directly to those wallets. The site stores addresses and receipts,
not wallet private keys, and does not send funds.

## Set up receiving addresses

1. Sign in as the platform administrator and open `/donations/manage`.
2. Enter each mainnet receiving address from your wallet and enable that currency.
   Address format, network, and checksum are checked before saving.
3. Optionally enable **the public donation leaderboard**. It is off by default;
   donations work with it disabled.

No receiving addresses are preconfigured. A currency stays unavailable until you
enable it with a valid address. BTC supports legacy, SegWit, and Taproot addresses.
LTC supports `L`, `M`, and `ltc1` addresses; deprecated ambiguous Bitcoin-style
`3` addresses are not accepted as Litecoin. Monero supports mainnet standard,
subaddress, and integrated addresses.

Existing prepared receipts keep their original address when you rotate or disable
a wallet. Keep control of old receiving addresses while receipts remain outstanding.
There are no new startup commands, payment processor subscriptions, RPC credentials,
or separate services to configure.

## Donate anonymously

Visitors can copy an enabled address, scan a locally generated QR code, or open
their wallet using its payment URI. No account is required. Administrators can
record these transfers as verified anonymous donations after checking their wallet.

Signed-in users can also prepare a private receipt and leave public credit off.
Those receipts remain associated with their account for administrators, but are
excluded from public rankings. The public API never exposes individual anonymous
receipts, transaction IDs, private notes, emails, or account identifiers.

Anonymous means hidden identity on this site. BTC and LTC transactions still
exist on their public blockchains. XMR receipt amounts must be verified privately
in the receiving wallet; a public block explorer cannot establish their amounts.

## Optional public credit and persistent pseudonyms

When the administrator enables the leaderboard, verified-email donors can choose
their account display name or save a separate **persistent pseudonym**. The saved
identity applies to all of their public contributions, including future donations,
without changing their review display name. Pseudonyms contain 3–40 letters,
numbers, spaces, dots, underscores, or hyphens, and are unique without regard to
letter case. Reserved staff names are unavailable.

Public credit is off by default for every donation. Donors explicitly opt in on
each receipt; saving a pseudonym does not publish anything. They can later hide
one receipt or make all of their donations anonymous. Turning the leaderboard off
hides names and rankings in both the page and the public API. Turning it back on
restores only entries whose donors still allow public credit.

To request credit, prepare a receipt **before sending**, use that receipt's payment
details, then submit the transaction ID from the sending wallet. A transaction ID
is only a reference for verification, not proof of who sent it. Do not submit wallet
private keys or seed phrases. Transfers predating the receipt by more than five
minutes cannot be credited through that receipt; staff can record independently
verified older transfers as anonymous donations.

## Verify received payments

The first version uses **manual admin wallet verification**, as selected for this
site. Nothing becomes confirmed from a donor submission or browser callback.

In `/donations/manage`, check the receiving address, transaction, confirmations,
actual received amount, receipt date, and attribution in your receiving wallet.
Then confirm or reject the receipt with an explanation. Confirm the actual amount
received rather than trusting the donor's declared amount. Direct anonymous
transfers have their own recording form and cannot assign credit to an account.

Concurrent confirmations of the same transaction in the same currency cannot
count it twice. Staff decisions and wallet/leaderboard settings create audit
entries. Incorrect confirmations can be reversed, removing them from totals and
rankings; a corrected record can then be entered. Users cannot grant themselves
confirmation or moderation privileges.

## Rankings and totals

Only confirmed receipts with donor opt-in contribute to a person's ranking.
Anonymous confirmed contributions count toward received totals but never appear
as individual leaderboard entries. Rankings are separate for BTC, LTC, and XMR;
there is no misleading addition of different currencies or live fiat conversion.
All-time and current-month views are available, with monthly boundaries in UTC.

Amounts use integer atomic units and PostgreSQL numeric storage: eight decimal
places for BTC/LTC and twelve for XMR. No monetary amounts are rounded through
floating-point numbers. Public responses are not cached so withdrawn public
credit is excluded on the next request. Deleting an account removes its public
attribution while retaining an anonymous accounting record.

Donations never affect review scores, publication decisions, business ownership,
or staff privileges.

## Deployment

Development startup prepares the new tables automatically. Production uses the
committed additive migrations through the existing server entrypoint. The feature
uses PostgreSQL and the existing app only; Redis and S3 remain optional.

API routes are under `/api/v1/directory/donations`: public configuration and
totals at the root, private receipts at `/me`, donor identity at `/identity`, and
staff settings/verification under `/admin`. Authentication, verified-email checks
for public credit, request limits, and the directory's origin/body-size checks
apply server-side.
