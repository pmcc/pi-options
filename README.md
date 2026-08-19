# pi-options

pi extension that adds the `present_options` tool. It presents a numbered list
of choices to the user and waits for a decision before the agent proceeds.

## Behavior

- The tool is only registered in interactive TUI sessions. In print/JSON/RPC
  mode it never enters the system prompt, so the model cannot call it.
- Choices are displayed as a numbered list (`1. Name`). The list always ends
  with an extra free-form message option that opens an inline editor.
- **Single choice** (`multiple: false`, default): focus with Up/Down, confirm
  the focused option with Enter, cancel with Esc.
- **Multiple choice** (`multiple: true`): toggle options individually with
  Space, confirm the toggled set with Enter. If nothing is toggled, Enter
  selects the currently focused option. Esc cancels.
- The message option works in both modes: confirm it (single) or toggle it
  (multi) and press Enter to type a message that is returned as the result.
- The tool result includes only the user's decision; choices already present in
  the tool call are not repeated in model context.
- Calls are limited to 20 choices. Prompts, labels, descriptions, and free-form
  responses have bounded lengths to protect the model context.

## Install

```bash
# As a package
pi install git:gitea.itspm.cc/pmcc/pi-options

# Or quick test without installing
pi -e git:gitea.itspm.cc/pmcc/pi-options

# Or from a local checkout
pi -e ./src/index.ts
```

## Tool parameters

| Parameter     | Type               | Description                                    |
| ------------- | ------------------ | ---------------------------------------------- |
| `prompt`      | string             | Question shown above the list                  |
| `choices`     | { name, description? }[] | Available choices, shown numbered        |
| `multiple`    | boolean?           | Allow toggling several choices (default false) |
| `messageLabel`| string?            | Label of the free-form option (default "Enter a message…") |
