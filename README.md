# pi-options

pi extension that adds the `present_options` tool. It presents a numbered list
of choices to the user and waits for a decision before the agent proceeds.

## Behavior

- Choices are displayed as a numbered list (`1. Name`). The list always ends
  with an extra free-form message option that opens an inline editor.
- **Single choice** (`multiple: false`, default): focus with Up/Down, confirm
  the focused option with Enter, cancel with Esc.
- **Multiple choice** (`multiple: true`): toggle options individually with
  Space, confirm the toggled set with Enter. If nothing is toggled, Enter
  selects the currently focused option. Esc cancels.
- The message option works in both modes: confirm it (single) or toggle it
  (multi) and press Enter to type a message that is returned as the result.
- The tool result includes the full numbered list of available choices plus
  the user's selection.

## Install

```bash
# As a package (from GitHub)
pi install git:github.com/pmcc/pi-options@v0.1.0

# Or quick test without installing
pi -e git:github.com/pmcc/pi-options

# Or from a local checkout
pi -e ./index.ts
```

## Tool parameters

| Parameter     | Type               | Description                                    |
| ------------- | ------------------ | ---------------------------------------------- |
| `prompt`      | string             | Question shown above the list                  |
| `choices`     | { name, description? }[] | Available choices, shown numbered        |
| `multiple`    | boolean?           | Allow toggling several choices (default false) |
| `messageLabel`| string?            | Label of the free-form option (default "Enter a message…") |
