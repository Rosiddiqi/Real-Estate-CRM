# KeyMatch — brand & design system

KeyMatch's look and feel follows the **Soul** reference (a Figma file by
HorizonX): a near-black floor, photography that fades into it, quiet
hairline glass, white type in opacity tiers, Poppins + Inter, generous radii
and pill controls. On top of that sits one highlight colour — **Volt**, a
neon green-yellow — used sparingly.

What we took from the reference is its visual language. We did **not** take
its name, logo or photos: KeyMatch keeps its name, has its own mark, and its
imagery is original (`web/src/assets/login.jpg`, `home-hero.jpg`).

---

## 1. Principles

1. **The floor is quiet.** `#0D0D0D`, no textures and no glows. Depth comes
   from hairlines and a little glass, never from coloured light.
2. **Type does the work.** Large, light Poppins for titles and greetings;
   small uppercase tracked labels; Inter for every number.
3. **Monochrome first.** Emphasis is white on dark and ink on light. The
   legacy accent tokens (`--blue`, `--bright`, `--deep`) now *mean emphasis*,
   so anything still using them reads monochrome.
4. **One highlight.** Volt marks what is *live, new, active, progressing or
   AI-made*. If a screen has more than a few neon touches, remove some.
5. **Pills and circles.** Primary actions are white pills; secondary actions
   are hairline glass pills; icon controls are 38–40px hairline circles.

## 2. Colour

### Dark (default)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0D0D0D` | the floor |
| `--surface` / `--surfaceHi` / `--surfaceTop` | `#151515` / `#1C1C1C` / `#242424` | solid layers (sheets, menus) |
| `--glass-fill` | `rgba(176,176,175,.05)` | tiles, cards, inputs |
| `--glass-line` | `rgba(255,255,255,.10)` at `--hairline` (0.67px) | every tile edge |
| `--text` / `--dim` / `--faint` / `--ghost` | white at 100 / 62 / 46 / 20% | type tiers |
| `--meta` | `#8A8A89` | timestamps, quiet metadata |
| `--bright` + `--on-accent` | `#FFFFFF` + `#0D0D0D` | the white pill (primary) |

### Light

Derived from Soul's misty light screens: `--bg #F2F2F2`, white surfaces, ink
type tiers (`#0D0D0D` at 100 / 72 / 60%), `--bright #0D0D0D` with white text
(primaries become ink pills). Everything is a token, so screens follow the
theme without per-screen rules.

### The highlight (Settings › Accent)

| Choice | `--hl` | Text on it (`--on-hl`) | Small text on light (`--hl-ink`) |
| --- | --- | --- | --- |
| **Volt** (default) | `#D4FF3F` | `#0D0D0D` | `#4E6B00` |
| Amber (Soul's own) | `#FFB440` | `#0D0D0D` | `#A35F00` |
| Mist | white / ink | ink / white | ink |

`applyTheme()` (`web/src/hooks/useShellEffects.js`) writes only the `--hl*`
variables inline; every other colour comes from the theme blocks in
`tokens.css`. Rules:

- Text on a highlight fill is always `--on-hl`.
- Never set small text in `--hl` on a light surface — use `--hl-ink`.
- Use `--hl-soft` (≈14–22% tint) for chips and selected rows, `--hl-line` for hairlines.

### Where Volt goes

The raised Phone button in the nav · unread dots and count badges · the
Battle Plan NOW line and pill · today in the calendar · switch knobs ·
progress bars and goal rings · the client relationship arc · the assistant's
core · AI sparks · the iMessage send button · the selected filter chip ·
won / closed states.

**Not** for: primary buttons (white pills), body text, or large fills.

### Status and data colours

`--amber` (warnings, offers, waiting), `--red` (destructive, missed),
`--green` (success — Volt in dark, olive in light), `--cyan` (new
development). Server-provided colours (pipeline stages, listing sources,
campaign accents) go through `tone()` in `web/src/lib/palette.js`, which maps
both the current palette and legacy blue/violet rows onto these tokens. For a
translucent version of any colour use `tint()` / `color-mix()` — never append
hex alpha to a colour string.

### Messaging

Monochrome bubbles: iMessage out = white with ink text (`--imsg` /
`--imsg-text`), SMS out = graphite (`--sms` / `--sms-text`) with an SMS tag,
incoming = dark glass. Activity pills are tinted with the highlight.

## 3. Type

Both families are self-hosted through `@fontsource` (they work offline in the
iOS app).

| Role | Spec |
| --- | --- |
| Greeting / big titles | Poppins 400, 32–36px, −0.035em |
| Display (login headline, quotes) | Poppins 300–400, 26–36px |
| Page title (header) | Poppins 500, 12px, UPPERCASE, 0.17em tracking, `--faint` |
| Section label | Poppins 500, 12px, UPPERCASE, 0.04em, `--faint` |
| UI / rows | Poppins 500, 14–15px |
| Body | Poppins 400, 13–16px |
| Numbers, money, names on cards, times | Inter 300–400 (`--font-num`, `.km-value`, `.km-num`) |

Weights stop at 500 (Medium). No bold.

## 4. Shape and material

- Radii: tiles `--r-card` 20px, images `--r-img` 15px, sheets `--r-sheet` 32px, pills 999px.
- **Tile** (`.km-tile`, `.km-card`, `Group`): glass fill + hairline, no blur, no shadow.
- **Floating controls** (`.km-lg`): blur 24, hairline, soft drop shadow; over photos use `.km-lg--clear`.
- No specular rims, colour fringes or saturation boosts.

## 5. Components

- **Nav**: Soul's floating grey pill (`--nav-fill`), icon-only, a 4px dot under
  the active tab, Phone in a raised 58px Volt circle. In light mode the pill is ink.
- **Buttons**: `Button` = white pill (48px), `--ghost` = hairline glass pill,
  `--hl` = Volt pill (for live/positive actions only).
- **Header**: `PageHeader` — UPPERCASE tracked title between 40px hairline circles.
- **Rows**: bare 22px outline icon (stroke 1.6), Medium label, faint sub, whisper divider.
- **Inputs**: tiny uppercase label, hairline box, Inter Light value; focus ring in Volt.
- **Switch**: hairline pill track, grey knob → Volt knob when on.
- **Avatars**: monochrome graphite initials with a hairline ring (seeded shade).
- **Home**: a photo hero (window light on plaster) under the greeting; the
  daily quote sits on it with a Volt status dot and burns away on pull.
- **Client card**: Inter Light name, Volt relationship arc, five square glass
  action tiles (Call is the white one).
- **Live call**: Soul's grey voice-screen gradient; the transcript keeps its
  newest lines in focus while earlier ones recede ("karaoke").
- **Settings**: centred portrait, glass rows, "Sign out" as Soul's hairline END SESSION box.

## 6. The mark

An original glyph drawn in Soul's manner: a thin ring, a keyhole at its heart,
and one Volt dot riding the ring at 1:30 (the "match"). The wordmark is
`KEYMATCH` in Poppins Light, wide-tracked (0.34em at small sizes).

- In code: `web/src/components/ui/BrandMark.jsx` (`BrandMark`, `Wordmark`, `BrandLockup`).
- Icons and splash: `node scripts/brand/make-icons.mjs` renders the iOS
  AppIcon (1024, no alpha), the three 2732 splash images, `icon-192/512`,
  `apple-touch-icon` and `favicon.svg`.
- App colours (`manifest.json`, `capacitor.config.ts`, `index.html`, the
  desktop frame) are `#0D0D0D`.

Keep clear space of at least half the ring's radius around the mark. Don't
recolour the ring, add effects, or put the mark on a busy photo without a
dark wash.
