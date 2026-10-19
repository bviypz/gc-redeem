# gc-redeem

A Tampermonkey userscript that automates redeeming gift-card links from Gmail
([giftcards.com](https://www.giftcards.com) → Visa virtual account registration)
and collects the issued card numbers into a TSV file.

> **Not affiliated with giftcards.com.** Use at your own risk.

## How it works

1. Open the Gmail message containing your "Redeem now" links.
2. Tampermonkey menu → **GC: Settings** — fill in the registration profile once
   (name, address, email…). Stored only in Tampermonkey on your browser.
3. Tampermonkey menu → **GC: Redeem all gift cards** — opens every redeem link,
   fills the email + registration form on each, and stops before the reCAPTCHA
   for you to solve manually.
4. Each issued card number is saved automatically. Tampermonkey menu →
   **GC: View collected cards** to review, or **GC: Download card data (TSV)**
   to export (`order_number, card_number, valid_thru, cvv, redeemed_at,
   collected_at, status`).

Already-redeemed cards are handled: claiming goes straight to the card detail
page and the card is scraped directly. No tab is ever closed automatically;
**GC: Close all gift card tabs** cleans up when you're done.

## Install (first time)

1. Install the **Tampermonkey** browser extension:
   [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) ·
   [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaejbjikekkigoigdjldjjbkj) ·
   [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/).
2. Click this install link (always the latest release):
   `https://github.com/bviypz/gc-redeem/releases/latest/download/gc-redeem.user.js`
3. Tampermonkey opens an install tab — click **Install**.
4. Open your Gmail message with the redeem links, then open the Tampermonkey
   menu (puzzle-piece icon → Tampermonkey) and choose **GC: Settings** to fill
   in your registration profile once.

## Privacy

Everything runs locally in your browser. The script makes **zero** network
requests to any third-party server — it only drives the giftcards.com pages
you already visit. Your profile and collected card data live in Tampermonkey
storage on your machine. Verify with DevTools → Network if you like.

## Updating

Tampermonkey checks for updates automatically (based on your Tampermonkey
update-interval setting). When a new release is published here, you'll get an
update notice in Tampermonkey and can install it from the dashboard.

## For maintainers: making a release

1. Bump `// @version` in `gc-redeem.user.js` (Tampermonkey only notices a
   *higher* version).
2. Commit and push.
3. GitHub → Releases → **Draft a new release**, create tag `vX.Y.Z`, publish.
   The `Attach release assets` workflow automatically adds `gc-redeem.user.js`
   and `gc-redeem.meta.js` to the release — that's what Tampermonkey polls.

## License

MIT — see [LICENSE](LICENSE).
