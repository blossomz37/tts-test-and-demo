# Reader visual design brief: Quiet Manuscript

Date: 2026-10-04

Status: proposed design direction; no application changes made in this pass.

Scope: the recorded chapter reader in `reader/`.

## Purpose

Create a personal editorial workspace that feels inviting at the beginning of a chapter and remains comfortable after sustained reading, listening, and commenting. The desired qualities are composed, readable, dependable, and easy to return to. The manuscript should carry the emotional atmosphere of the session.

The recommended direction is **Quiet Manuscript**: warm paper, deep ink, restrained green playback cues, and small plum editorial marks. The name describes the design direction; it does not need to become visible product branding.

The author's discomfort with the existing Electric Creative theme motivates this exploration. Functional polish and personal comfort are separate acceptance criteria. This brief proposes a change in visual character while preserving the established reading and editorial workflow.

## Independent blind inquiry

Three fresh-context agents received this common product description and question:

> We are designing a personal local web app for novelists. The user reads a chapter while recorded narration plays; synchronized text highlighting follows the audio. They can pause, select a passage, write or dictate editorial comments/instructions, and resume listening. Sessions can be lengthy and repeated. Desktop is primary, with narrow-screen use also supported. The app needs comfortable reading, clear playback orientation, and easy transitions into and out of editorial work. What colors and visual effects would work well for this app, and how should they be used effectively?

They were assigned the perspectives of a personal web app designer, a novelist, and a color psychology theorist. They were instructed not to inspect screenshots, source, memory, previous reviews, or other agents' responses. They were not told the existing theme, its colors, or the author's objections to it. The psychology adviser was asked to distinguish research from aesthetic hypotheses.

| Perspective | Distinct contribution | How it shapes this brief |
|---|---|---|
| Personal web app designer | Stable visual roles, modest surface treatment, and different shapes for playback, selection, and comments | Use a small semantic palette and predictable state precedence |
| Novelist | Make revision feel ordinary; preserve the passage and listening position through interruptions | Keep prose central, surrounding context readable, and Save distinct from Resume |
| Color psychology theorist | Contrast and consistent signals are defensible; exact emotional effects of a palette require testing | Verify contrast, retain user choice, and treat comfort as an individual outcome |

All three independently proposed warm neutral surfaces, dark ink, green or teal playback cues, restrained motion, and underlines or margin marks for annotations. Two preferred plum/violet editorial marks; one preferred amber. This synthesis selects muted plum, reserving warm warning colors for messages that actually require caution. This is a design decision, not evidence that plum improves editing.

The agents described sentence-level playback treatment. The actual reader already supports word synchronization. This brief retains that precision and adapts their hierarchy to a current-word highlight with a stable sentence-position cue.

## Visual character

Let the reading surface occupy most of the screen. Use generous space, a clear chapter heading, and strong body-text contrast. Keep the surrounding canvas slightly darker than the page. Reading and comment-entry surfaces should stay close in brightness so opening the editor does not introduce a startling block of light or darkness.

Use accent colors in small areas: a playback control, the spoken word, an annotation underline, and focus indicators. Keep persistent toolbars and navigation mostly neutral. Give the active task the strongest control emphasis: Play or Resume during listening, Save comment during editing.

Favor flat surfaces, subtle separators, and modest 6px control corners. Reserve a shallow shadow for an overlapping menu or editor. Keep active controls at least 44px tall. Avoid oversized display typography, repeated heavy outlines, and large saturated panels. These are proposed treatments to test, not measurements of the current app.

## Proposed palette

Colors below are opaque sRGB starting tokens. Use each role consistently; do not freely substitute accents between meanings.

| Role | Light | Dark | Intended use |
|---|---|---|---|
| Surrounding canvas | `#F4F1EA` | `#181C1A` | App background |
| Reading/editing surface | `#FFFCF5` | `#222824` | Manuscript and composer |
| Main ink | `#292D2B` | `#EEEFE7` | Prose and essential labels |
| Secondary ink | `#5D655F` | `#B1BCAF` | Time, supporting text, metadata |
| Primary action | `#2F665B` | `#8CC5AB` | Active task button and progress |
| Text on primary action | `#FFFFFF` | `#16231C` | Button label and icon |
| Playback wash | `#DDECE4` | `#294338` | Current spoken word |
| Playback marker | `#367264` | `#9BCDB2` | Word edge and sentence-position marker |
| Editorial plum | `#754B68` | `#C7A6C0` | Saved-comment underline and marker |
| Selection wash | `#CCE0F2` | `#304E6D` | Exact selected passage |
| Focus indicator | `#275DA8` | `#95BEF8` | External focus outline |
| Required control boundary | `#78817F` | `#7A878A` | Inputs and boundaries needed to recognize controls |
| Error | `#A52B35` | `#FF99A4` | Error icon and explicit message |

The palette uses a warm neutral foundation and a green leaning slightly toward teal. The intended effect is a composed personal workspace. Warmth is an aesthetic reference to paper, not a health or fatigue claim. Plum appears in fine editorial marks rather than broad branded surfaces.

Choose light or dark deliberately and remember the author's choice. Keep it stable through playback and editing. When there is no saved choice, following the system preference is a reasonable starting behavior.

## A visual grammar for listening and editing

| State | Appearance | Meaning and behavior |
|---|---|---|
| Spoken word | Pale green wash with a small, contrasting green edge; ordinary text metrics | Follows existing audio timing immediately. No enlargement, bounce, or delayed fade |
| Current sentence | Slim green gutter marker | Gives a stable place to return to as individual words advance |
| Paused playback | Retained position cue plus visible Paused/Resume wording | The listening location remains clear while another passage is considered |
| Selected passage | Blue fill over the exact selected characters | Selection owns the fill when states overlap; playback location remains marked separately |
| Saved comment | Plum underline and comment marker/count | Persists without filling whole paragraphs with color |
| Open comment | Stronger anchor underline and matching editor edge | Connects the quoted passage with the active editor |
| Draft | Explicit Draft label and separate local-save status | Shows the difference between recoverable work and accepted comment content |
| Dictation | Steady microphone indicator and Listening label | Makes capture status explicit without a pulsing visual effect |

Keep manuscript ink unchanged across highlights. Preserve saved-comment underlines during selection. Do not combine translucent fills into a third, unexplained color. During overlap, selection takes precedence, comments retain their underline, and the playback position remains separately visible.

The pale washes provide atmosphere and grouping; the contrasting marks carry important position information. Check that the moving word cue remains distinguishable without relying on hue alone. Labels, shapes, and placement supplement color throughout. [W3C: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

On desktop, opening the composer should preserve the manuscript's line wrapping where space permits. On narrow screens, retain the selected quotation and an obvious route back to the listening position. Saving and resuming remain distinct actions. Preserve the existing source anchors, draft recovery, and playback behavior.

## Typography and effects

Prototype a sturdy serif for the manuscript, starting with Georgia at about 20px, 1.6 line height, and a desktop measure around 65 characters. Keep an equally considered sans-serif option. These are adjustable starting values, not universal readability rules. Preserve the manuscript's dialogue and paragraph structure.

Use the existing Hanken face for controls and comment entry, around 15–16px where practical. Give the chapter title a clear but restrained scale. The text, punctuation, and controls should remain easy to inspect at increased text sizes. Fine display serifs and faint secondary labels do not serve this direction.

Use movement only to explain a transition. An editor may appear with a brief 120–180ms transition; audio position updates remain immediate. Keep surrounding prose fully readable. Avoid pulsing playback, glowing words, animated gradients, textured paper, translucent controls over prose, and decorative waveforms.

Respect reduced-motion preferences and remove nonessential transitions. Follow scrolling should preserve orientation and yield to selection or editing. W3C's interaction-animation guidance supports making unnecessary motion avoidable; the proposed durations are design starting points. [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

## Evidence and contrast checks

Color-emotion research supports both shared associations and contextual variation. Jonauskaite and colleagues studied 4,598 people across 30 nations using color terms and emotion concepts. That work does not establish that a particular green interface produces calm or improves novel revision. The present palette remains a hypothesis for this author and task. [Jonauskaite et al., 2020](https://pubmed.ncbi.nlm.nih.gov/32900287/)

A laboratory study found better proofreading performance with dark text on a light display than with the reverse polarity. Its results support taking light-mode readability seriously; they do not settle individual preference or comfort during lengthy reading-and-listening sessions. [Piepenbrock, Mayr, and Buchner, 2014](https://pubmed.ncbi.nlm.nih.gov/25135324/)

The proposed opaque pairs were calculated using the WCAG sRGB relative-luminance formula. Ratios below are rounded for reporting:

| Pair | Light | Dark |
|---|---|---|
| Manuscript ink / reading surface | 13.62:1 | 12.98:1 |
| Secondary ink / reading surface | 5.87:1 | 7.65:1 |
| Manuscript ink / playback wash | 11.43:1 | 9.28:1 |
| Manuscript ink / selection wash | 10.31:1 | 7.44:1 |
| Primary button label / fill | 6.62:1 | 8.28:1 |
| Comment underline / selection wash | 5.24:1 | 3.96:1 |
| Playback marker / playback wash | 4.59:1 | 6.02:1 |
| Required boundary / reading surface | 3.91:1 | 4.05:1 |

Maintain at least 4.5:1 for ordinary text and 3:1 for required non-text indicators against adjacent colors. A soft visual style still needs legible controls. [W3C: Text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

Use the blue focus outline outside the control, separated by a surface-colored gap. Blue directly against the green primary-button fill is only about 1:1 in these palettes. The gap lets the indicator contrast with the surrounding surface instead. Recheck all rendered combinations, including hover, selection overlap, disabled controls, errors, and zoom. These token calculations are not a complete accessibility audit or evidence of comfort.

## Validation and next design step

The next step is a disposable visual prototype of this direction in three states: listening, commenting, and a densely annotated passage, with light, dark, desktop, and narrow presentations. Use the same workflow and text when comparing appearance so functionality does not confound the preference check.

Then conduct a 25–30-minute personal session: listen continuously, pause three times, comment on an earlier passage, overlap a selection with a saved comment, and resume each time. Dictation tests should use controlled events unless microphone testing is explicitly requested. Record initial appeal and end-of-session comfort separately. Check whether the author loses position, mistakes a state, strains to read, or wants the interface to become less visible. Repeat in the author's usual daytime and evening conditions, alternating comparison order when practical.

Success means the author wants to continue working, can relocate playback promptly, understands every mark, and can revise without disrupting the reading context. Contrast and reduced-motion checks are necessary constraints; personal sustained comfort decides whether this visual direction is right.

This design brief is complete. Theme implementation, new appearance settings, and interaction changes are subsequent work. The application's current theme and behavior remain unchanged by this pass.
