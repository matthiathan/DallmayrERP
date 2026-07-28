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
