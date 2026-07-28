# User-first interface standards

These standards apply to every DallmayrERP interface change.

## Start with the user’s job

Each page must answer, in this order:

1. Where am I?
2. What needs my attention?
3. What can I do next?
4. What happened after I acted?

Page titles, descriptions, filters and actions must use operational language rather than database names, internal codes or implementation terminology.

## Information hierarchy

- Show the primary task and urgent exceptions before secondary detail.
- Keep one visible page title. Use breadcrumbs for location and the page header for purpose.
- Put the most likely primary action first and make destructive actions visually distinct.
- Hide technical identifiers until they help identify or verify a record.
- Prefer progressive disclosure over large, permanently visible control sets.

## Navigation

- Navigation is role-aware and task-oriented.
- Use plain-language labels and one-sentence descriptions.
- Search must remain available from every authenticated page.
- Do not expose module codes, environment strings or implementation details as primary navigation.
- Mobile navigation must use the same labels and ordering as desktop navigation.

## Interaction and feedback

- All interactive targets must be at least 44 by 44 CSS pixels where practical.
- Every action must provide a loading, success, validation or error state.
- Preserve user-entered data after validation or server errors.
- Confirmation is required for irreversible or high-impact actions.
- Empty states must explain why the area is empty and provide the relevant next step.

## Accessibility

- Every workflow must be usable with a keyboard.
- Focus indicators must remain clearly visible.
- Dialogs and menus must close with Escape and return focus predictably.
- Do not rely on colour alone to communicate status.
- Respect reduced-motion preferences.
- Maintain readable contrast in both light and dark themes.

## Adaptive colour and contrast

- User-selected accent, theme and background colours must never be used directly as text without a contrast calculation.
- Normal text and interactive labels must maintain at least a 4.5:1 contrast ratio against their rendered surface.
- Focus indicators and essential graphical boundaries must maintain at least a 3:1 contrast ratio.
- Text placed on an accent-coloured control must automatically switch between black and white according to the stronger contrast ratio.
- Accent-coloured links must be adjusted toward black or white until they remain readable on the active light or dark surface.
- Form controls and data tables use neutral tone-matched surfaces so arbitrary palette choices cannot reduce legibility.
- Semantic danger, warning, success and information states use fixed accessible colour pairs and must not inherit the decorative accent.
- Colour changes must apply before hydration to avoid a flash of unreadable text.

## Responsive behaviour

- Design for the smallest supported screen first.
- Keep primary actions reachable without horizontal scrolling.
- Tables may scroll horizontally, but critical identity, status and action information must remain understandable.
- Forms should collapse to one column before labels or controls become cramped.

## Review checklist

Before a pull request is approved, verify:

- A new user can identify the page purpose within five seconds.
- The next action is visually obvious.
- Technical codes and database language are not leading the interface.
- Keyboard order follows the visual order.
- Loading, empty, error and success states are present.
- The workflow remains usable at phone, tablet and desktop widths.
- Light and dark themes both remain legible.
- Every accent preset and custom black, white and mid-tone colour keeps buttons, links, focus rings, inputs and table text readable.
