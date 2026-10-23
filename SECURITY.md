# Security

This app builds transactions that move real funds, so a bug in a transaction builder can lose money.

Please report a vulnerability privately through GitHub: open the repository's Security tab and choose "Report a
vulnerability". Do not open a public issue for it. Include the page, the chain and wallet involved, and the
transaction or VAA if there is one.

Areas of most interest:

- A transaction that sends funds anywhere other than what the review dialog shows.
- A way for a dependency, a link or a crafted URL parameter to change a transaction before the wallet signs it.
- Gaps in the Content-Security-Policy, defined in `vite.config.ts`, or a live site that differs from its release.

Reports about a self-hosted copy are welcome when the problem is in this code or its recommended configuration.
