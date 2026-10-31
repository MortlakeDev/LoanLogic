# T05 — Region profiles, presets, URL & local persistence

- **Milestone:** M2 · **Status:** ready (can run in parallel with T04)
- **Depends on:** T03 ✓, T03a ✓ · **Blocks:** T08, T11, T16, T17
- **Branch:** `task/T05-regions-persistence`

## Goal

LoanLogic adapts to where the user is (PLAN H1, I3) and never loses their work: region
profiles set currency, formatting and the headline rate method; each region offers
example presets; the current scenario survives reloads and can be shared as a link that
never touches a server (PLAN §5.5).

## 1. Region profiles (data, `src/app/regions.ts`)

| Id | Name (en) | Currency | Format locale | Headline method | New fees default `inApr` | Affordability defaults (stored for T11) |
|---|---|---|---|---|---|---|
| `US` | United States | USD | en-US | `usRegZApr` (3 dp) | upfront and periodic fees: true; insurance: false | DTI 28 % / 36 % (43 % legacy QM); LTV 80 % mortgage-insurance threshold |
| `UK` | United Kingdom | GBP | en-GB | `ukAprc` (1 dp), labelled APR; APRC for mortgage presets (SPEC §9.3 b) | true | income multiple 4.5× |
| `EU` | Euro area | EUR | de-DE, fr-FR, es-ES, it-IT, nl-NL, pt-PT, fi-FI, el-GR, en-IE (user picks; default from the UI language: en → en-IE, ru/uk/zh → de-DE) | `euAprc` (1 dp) | true | none |
| `CN` | China | CNY | zh-CN | `cnAnnualized` (2 dp) labelled 年化利率（单利）, with `irrEffective` labelled 年化利率（复利，IRR 法） beside it | true | monthly payment ≤ 50 % of income |
| `UA` | Ukraine | UAH | uk-UA | `uaRealAnnual` (2 dp) | true | none |
| `INTL` | International | any (user picks) | any (default: the UI language's locale) | `international` (2 dp) | true | none |

- Default region on first visit, from `navigator.languages`: the first tag with a region
  subtag decides — US → US, GB → UK, CN → CN, UA → UA, a euro-area country (AT, BE, BG,
  CY, DE, EE, ES, FI, FR, GR, HR, IE, IT, LT, LU, LV, MT, NL, PT, SI, SK) → EU, any other
  region → INTL; when no tag has a region subtag, `uk` → UA and `zh` → CN, else INTL.
  So `pt-BR`, `es-MX`, `fr-CA` and `de-CH` give INTL and `ru-UA` gives UA. Never use
  geolocation or a network lookup.
- Switching the region sets the currency, the formatting locale and the headline
  method; the other inputs stay. The Advanced method override (T03) remains possible
  and is part of the scenario.
- The formatting locale can be overridden in the region dialog ("Number and date
  format"); the override is stored with the settings.
- The T03 currency → method mapping is removed; the profile drives it. With INTL and a
  non-euro EU currency (PLN, CZK, HUF, RON, SEK, DKK) the headline method is `euAprc`.
- Before the CN profile ships, re-check the CN method against the 2026 rules named in
  SPEC §9.3 (d) (open item); report the result in the PR.
- Region names are translated in all four languages; no flags.

## 2. Presets (data, `src/app/presets.ts`)

Every preset is labelled **"Example"** with the note "Rates are illustrative, not an
offer — replace them with your own" (translated). Values (rates are examples, not
market data):

| Region | Preset | Amount | Rate | Term | Type | Fees and settings |
|---|---|---|---|---|---|---|
| US | Mortgage, 30-year fixed | 350 000.00 | 6.875 % | 30 y monthly | annuity | origination 1 % upfront, paid, in APR |
| US | Auto loan | 35 000.00 | 7.49 % | 60 payments | annuity | documentation 399.00 upfront, financed, in APR |
| US | Personal loan | 10 000.00 | 12.9 % | 36 payments | annuity | origination 5 % upfront, paid, in APR |
| US | Business term loan | 250 000.00 | 9.5 % | 5 y monthly | annuity | day count ACT/360, nominal basis; packaging 1 % upfront, paid, in APR |
| UK | Mortgage, 25 years | 250 000.00 | 4.79 % | 25 y monthly | annuity | arrangement 999.00 upfront, financed, in APR |
| UK | Personal loan | 10 000.00 | 6.9 % | 5 y monthly | annuity | none |
| UK | Car finance with balloon | 25 000.00 | 8.9 % | 48 payments | balloon 35 % | none |
| EU | Mortgage, 25 years | 300 000.00 | 3.6 % | 25 y monthly | annuity | 1 500.00 upfront, paid, in APR |
| EU | Consumer credit | 15 000.00 | 7.5 % | 48 payments | annuity | admin 150.00 upfront, paid; payment protection insurance 0.07 % of balance per month; both in APR |
| EU | Business loan, quarterly | 500 000.00 | 5.75 % | 5 y quarterly | annuity | none |
| CN | 商业贷款 等额本息 | 1 000 000.00 | 3.10 % | 30 y monthly | annuity | none |
| CN | 商业贷款 等额本金 | 1 000 000.00 | 3.10 % | 30 y monthly | equal principal | none |
| CN | 公积金贷款 | 600 000.00 | 2.60 % | 30 y monthly | annuity | none |
| CN | 消费贷 | 100 000.00 | 3.60 % | 24 payments | annuity | none |
| UA | Іпотека, 20 років | 1 500 000.00 | 7 % | 20 y monthly | annuity | none |
| UA | Споживчий кредит з комісією | 30 000.00 | 0.01 % | 12 payments | annuity | issuance 1.99 % upfront, paid; monthly commission 2.5 % of the amount; both in APR |
| UA | Автокредит | 800 000.00 | 13.9 % | 60 payments | annuity | one-time 1 % upfront, paid, in APR |
| INTL | Annuity loan | 100 000.00 | 8 % | 10 y monthly | annuity | none |
| INTL | Equal-principal loan | 100 000.00 | 8 % | 10 y monthly | equal principal | none |
| INTL | Interest-only loan | 100 000.00 | 8 % | 12 payments | bullet | none |

Preset names and descriptions are translated in all four languages (the CN and UA
names above are the zh-CN and uk texts; translate them for the other languages using
`docs/GLOSSARY.md`). Several presets equal golden vectors (`us-mortgage-30y-origination-fee`,
`cn-mortgage-30y-*`, `eu-consumer-credit-fee-and-insurance`, `annuity-quarterly-eur`,
`ua-consumer-loan-monthly-commission`); e2e tests check their figures. Presets carry no
date (the disbursement date stays as the user set it), and rates measured in days
depend on it, so after choosing such a preset the e2e test sets the vector's
disbursement date: US and CN 2026-11-01, EU consumer credit 2026-05-05, EU quarterly
2026-03-31, UA 2026-02-01 (with 2026-10-19 the UA rate would be 72.31 % instead of the
vector's 73.08 %).

UI: an "Examples" button next to the "Loan" section label opens a list of the current
region's presets showing name, example rate and term. Choosing one replaces the scenario
(with an "Undo" action for 10 seconds).

## 3. Persistence

- **Scenario model** (`src/app/state/scenario.ts`): `{ v: 1, region, input: LoanInput,
  ui: { termMode, feeNames: Record<feeId, string>, drafts: Record<fieldPath, string>,
  … } }` — the engine input of SPEC §15 plus UI-only fields: the names users give their
  fees and the text of fields that do not parse yet. Explicit versioned migrations
  (`migrate(v → v + 1)`) with tests; unknown future versions are rejected with a
  message, not guessed.
- **Local:** settings (`loanlogic:settings:v1`: region, formatting-locale override) and
  the current scenario (`loanlogic:scenario:v1`, saved 500 ms after the last change)
  through `storage.ts`. Restored on load; corrupt data falls back to defaults with a
  notice.
- **Link:** the scenario in the URL fragment `#s=` + base64url(deflate-raw(JSON)) using
  `CompressionStream` / `DecompressionStream` (without `for await` over streams, DESIGN
  §12). The fragment is written only by "Copy link" — never while editing, so loan data
  does not pile up in the browser history — and is cleared with `history.replaceState`
  right after it has been read on load.
- Opening a link loads its scenario but keeps the user's own saved scenario: a notice
  offers "Restore mine" until the user edits the shared one, and autosave does not
  overwrite the saved scenario before that.
- Limits: fragments over 4 096 characters or inflating to more than 64 KiB are rejected
  (stop decompressing at the limit: decompression-bomb guard); malformed or tampered
  fragments are validated (schema + engine validation) and rejected with a notice;
  nothing is executed or rendered as HTML. A typical scenario encodes to under 500
  characters (test it).
- Privacy note in the region dialog / About: a copied link carries the loan data in its
  fragment, which browsers do not send to servers; LoanLogic itself sends nothing
  anywhere.

## 4. Header

The region pill of DESIGN §7.1 (globe icon, "United States · USD"); on mobile in the
header next to the menu button (DESIGN §7.2). It opens a dialog (desktop) or sheet
(mobile) with the profiles, the currency (INTL) and the formatting locale.

## Tests

- Unit: region detection from language tags (including `pt-BR`, `es-MX`, `fr-CA`,
  `de-CH`, `ru-UA`, bare `uk` and `zh`); profile application; preset data passes engine
  validation; scenario migrations; fragment encode/decode round trip, rejection of
  malformed input (bad base64, bad deflate, wrong schema, over 4 096 characters, over
  64 KiB inflated).
- e2e: choosing each region updates the currency, the headline method label and the
  number format; each preset that equals a golden vector shows the vector's payment and
  headline rate (with the vector's disbursement date, §2); reload keeps the scenario;
  opening a copied link in a new context restores it, clears the fragment and offers
  "Restore mine"; clearing storage shows defaults; all with axe in both themes.

## Acceptance criteria

- [ ] Six profiles with the data above; region names and presets in four languages.
- [ ] Presets labelled as examples; their figures match the golden vectors where
      applicable.
- [ ] Reload and link restore the exact scenario; malformed data never crashes.
- [ ] No network requests; storage access only through `storage.ts`.

## Notes

- Preset rates are labelled examples, never market data; nothing is looked up over the
  network (rates, regions or locations).
- The check of the CN method against the 2026 rules (SPEC §9.3 d) belongs to this task;
  report its result in the PR.
- Storage keys and the scenario model are versioned: a breaking change ships with a
  migration and its tests.

## Completion notes

_(to be filled by the implementer)_
