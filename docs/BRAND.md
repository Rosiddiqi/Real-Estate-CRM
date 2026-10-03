# KeyMatch — brand & design system

KeyMatch's look and feel follows the **Soul** reference (a Figma file by
HorizonX): a near-black floor, photography that fades into it, white type in
opacity tiers, Poppins + Inter, generous radii and pill controls. Everything
that floats — the tab bar, buttons, segmented controls, toggles, menus — is
**Liquid Glass**, from HorizonX's Liquid Glass kit. On top of that sits one
accent colour — **Volt**, a neon green-yellow — used sparingly. Texting is the
one exception to the palette: it looks like iPhone Messages.

What we took from the references is their visual language. We did **not**
take their names, logos or photos: KeyMatch keeps its name, has its own mark,
and its imagery is original (`web/src/assets/login.jpg`, `home-hero.jpg`).

---

## 1. Principles

1. **The floor is quiet.** `#0D0D0D`, no textures and no glows. Depth comes
   from light on glass — rims and inner glow — never from coloured light.
2. **Type does the work.** Large, light Poppins for titles and greetings;
   small uppercase tracked labels; Inter for every number.
3. **Monochrome first.** Emphasis is white on dark and ink on light. The
   legacy accent tokens (`--blue`, `--bright`, `--deep`) now *mean emphasis*,
   so anything still using them reads monochrome.
4. **One accent.** Volt marks what is *live, new, active, progressing or
   AI-made*. If a screen has more than a few neon touches, remove some. There
   is no accent picker — Settings › Appearance is just Dark or Light.
5. **Pills and circles.** Primary actions are white pills; secondary actions
   are glass pills; icon controls are 38–40px glass circles.

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

### The accent: Volt

| Token | Dark | Light |
| --- | --- | --- |
| `--hl` | `#D4FF3F` | `#D4FF3F` |
| `--on-hl` (text on a Volt fill) | `#0D0D0D` | `#0D0D0D` |
| `--hl-ink` (small Volt marks on a light surface) | `#D4FF3F` | `#4E6B00` |
| `--hl-soft` (chips, selected rows) | Volt at 14% | Volt at 22% |
| `--hl-line` (hairlines) | Volt at 38% | Volt at 38% |

All of these live in `tokens.css`; `applyTheme()`
(`web/src/hooks/useShellEffects.js`) only switches `data-theme`. Rules:

- Text on a highlight fill is always `--on-hl`.
- Never set small text or thin marks in `--hl` on a light surface — use `--hl-ink`.

### Where Volt goes

The raised Phone button in the nav · the active-tab dot · unread dots and
count badges · the Battle Plan NOW line and pill · today in the calendar ·
switch tracks when on · progress bars and goal rings · the client relationship
arc · the assistant's core · AI sparks · the transcript waveform's playhead ·
the selected filter chip · won / closed states.

**Not** for: primary buttons (white pills), body text, or large fills.

### Status and data colours

`--amber` (warnings, offers, waiting), `--red` (destructive, missed),
`--green` (success — Volt in dark, olive in light), `--cyan` (new
development). Server-provided colours (pipeline stages, listing sources,
campaign accents) go through `tone()` in `web/src/lib/palette.js`, which maps
both the current palette and legacy blue/violet rows onto these tokens. For a
translucent version of any colour use `tint()` / `color-mix()` — never append
hex alpha to a colour string.

### Messaging (iPhone Messages)

| Token | Value | Use |
| --- | --- | --- |
| `--imsg` | `#2E8BFF` | outgoing iMessage bubble, the iMessage send button |
| `--sms` | `#34D15B` | outgoing SMS bubble, the SMS send button |
| `--imsg-text` / `--sms-text` | `#FFFFFF` | text on them |
| `--bubble-in` | `#26262A` dark · `#E9E9EB` light | incoming bubbles |

Bubble text is the system font at 17px (SF Pro on iPhone), like Messages.
These colours belong to texting UI only — bubbles, the send button, channel
dots, message previews (assistant drafts, campaign steps, scheduled sends).
Elsewhere, icons stay monochrome. The assistant's own chat is not texting: its
user bubbles are the white pill colour.

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
| Message bubbles | system font (SF Pro), 17/24px |

Weights stop at 500 (Medium). No bold.

## 4. Shape and material

- Radii: tiles `--r-card` 20px, images `--r-img` 15px, sheets `--r-sheet` 32px, pills 999px.

### Liquid Glass

From the HorizonX Liquid Glass kit: a glass object is almost clear — a whisper
of fill and a frosted backdrop — and light does the work. The recipe is tokens
in `styles/liquid-glass.css`:

| Token | Dark | What it is |
| --- | --- | --- |
| `--lg-tint` | white at 5.5% | the body |
| `--lg-frost` | `blur(18px) saturate(170%) brightness(1.04)` | the backdrop |
| `--lg-spec` | inset crescents: white 62% top-left, 26% bottom-right | the specular rim |
| `--lg-glow` | `inset 0 0 8px` white at 16% | the inner glow |
| `--lg-hairline` | white at 12%, 0.67px | the edge |
| `--lg-fringe` | faint warm/cool inset crescents | where the light bends |
| `--lg-drop` | `0 16px 24px -16px` black at 65% | the lift |

Light theme: white at 55%, a near-white rim, a white inner glow, no fringe and
a softer drop.

- **Floating controls** (`.km-lg`): the full recipe. Variants: `--clear` over
  photos (+ `--dim` for legibility), `--menu` (denser, for popovers), `--light`
  (the call screen's controls), `--solid`.
- **Content tiles** (`.km-tile`, `.km-card`, `Group`, `--tile-shadow`): the same
  rim, softer, with no blur — so long lists scroll smoothly.
- **Sheets**: solid surface with a glass lip (`--shadow-sheet`).
- No colour glows and no saturation-boosted fills.

## 5. Components

- **Nav**: a floating Liquid Glass pill (`--nav-fill`), icon-only, a 4px dot
  under the active tab (Volt in dark, ink in light), Phone in a raised 58px
  Volt lens. Dark glass in dark mode, white glass in light mode.
- **Buttons**: `Button` = white pill (48px), `--ghost` = glass pill,
  `--hl` = Volt pill (for live/positive actions only). Icon buttons are glass circles.
- **Segmented controls** (`PillTabs`, Matchmaker modes): a glass track with
  the selected segment as a glass lens (white glass in light); its label is full-strength text.
- **Header**: `PageHeader` — UPPERCASE tracked title between 40px glass circles.
- **Rows**: bare 22px outline icon (stroke 1.6), Medium label, faint sub, whisper divider.
- **Inputs**: tiny uppercase label, hairline box, Inter Light value; focus ring in Volt.
- **Switch**: a recessed glass track and a glass-lens knob; the track fills
  with Volt when on.
- **Avatars**: monochrome graphite initials with a hairline ring (seeded shade).
- **Home**: a photo hero (window light on plaster) under the greeting; the
  daily quote sits on it with a Volt status dot and burns away on pull.
- **Client card**: Inter Light name, Volt relationship arc, five square glass
  action tiles (Call is the white one).
- **Live call**: laid out like Soul's "Affirmation Voice Notes" screen — the
  grey voice gradient; a top pill with the live dot, timer and caller; the live
  transcript as a focus list (the newest line large and white, earlier lines
  receding at 20% with blur); a waveform with a Volt playhead; Soul's round
  glass mic control with a progress ring ("TAP TO MUTE"); then keypad ·
  speaker · end · add · hold.
- **Call transcripts** (post-call recap, client timeline): the same parts as a
  replay card — the focus follows the recording, or replays the transcript at
  the pace it was spoken; tap a line or the waveform to jump.
- **Settings**: centred portrait, glass rows, "Sign out" as Soul's hairline
  END SESSION box; Appearance is Dark or Light.

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
