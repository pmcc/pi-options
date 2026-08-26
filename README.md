# pi-options

pi extension that adds the `present_options` tool. It presents a numbered list
of choices to the user and waits for a decision before the agent proceeds.

## Behavior

- The tool is registered only in interactive TUI sessions. It is omitted from
  the model prompt in print, JSON, and RPC modes.
- Choices are displayed as a numbered list. The list always ends with a
  free-form message option.
- **Single choice** (`multiple: false`, default): move focus, confirm the
  focused option, or cancel.
- **Multiple choice** (`multiple: true`): toggle options with Space and confirm
  with the configured selection key. If nothing is toggled, confirmation
  selects the focused option. Returned choices are ordered as displayed, not
  by the order in which they were toggled.
- Displayed option labels and descriptions wrap instead of being truncated.
  Options taller than the viewport can be paged through. Long lists use a
  focus-following viewport and support the configured page-up and page-down
  selection keys.
- Selection navigation, confirmation, and cancellation respect pi's
  `keybindings.json`. On-screen hints show the active bindings.
- Free-form responses are capped while typing at 5,000 characters. A live
  counter is displayed in the editor.
- External text is stripped of terminal control sequences before display.
- The collapsed tool call shows only its prompt and choice count. Expand the
  tool row to inspect all choice labels and descriptions.
- Tool content sent back to the model contains only the user's decision;
  choices already present in the call are not repeated.

## Install

```bash
# As a package
pi install git:gitea.itspm.cc/pmcc/pi-options

# Quick test without installing
pi -e git:gitea.itspm.cc/pmcc/pi-options

# Local checkout
pi -e ./src/index.ts
```

Requires Node.js 22.19 or newer and a compatible current pi release.

## Tool parameters

| Parameter | Type | Limit | Description |
| --- | --- | --- | --- |
| `prompt` | string | 1–1,000 characters, nonblank | Question shown above the list |
| `choices` | `{ name, description? }[]` | 1–20 items | Available numbered choices |
| `choices[].name` | string | 1–200 characters, nonblank | Choice label |
| `choices[].description` | string? | 1–500 characters, nonblank | Optional supporting text |
| `multiple` | boolean? | — | Allow several choices; defaults to `false` |
| `messageLabel` | string? | 1–100 characters, nonblank | Free-form option label |

The result details have this shape:

```ts
{
  selected: Array<{ index: number; name: string }>;
  message?: string;
  cancelled: boolean;
}
```

Cancellation returns an empty `selected` array with `cancelled: true`.

## Development

```bash
npm install
npm run check       # lint, type-check, and tests
npm run format
npm run pack:check
```
