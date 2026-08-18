/**
 * present-options
 *
 * Interactive tool that presents a numbered list of choices to the user and
 * waits for a decision before proceeding.
 *
 * Behavior:
 * - Choices are displayed as a numbered list ("1. Name"). The list always ends
 *   with an extra free-form message option that opens an inline editor.
 * - Single choice (multiple: false): move focus with Up/Down, confirm the
 *   focused option with Enter, cancel with Esc.
 * - Multiple choice (multiple: true): toggle options individually with Space,
 *   confirm the toggled set with Enter. If nothing is toggled, Enter selects
 *   the currently focused option. Esc cancels.
 * - The message option works in both modes: confirm it (single) or toggle it
 *   (multi) and press Enter to type a message that is returned as the result.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ---- Types ----

interface Choice {
	name: string;
	description?: string;
}

interface ListItem extends Choice {
	index: number;
	isOther?: boolean;
}

interface Pick {
	selected: { index: number; name: string }[];
	message?: string;
}

interface PresentOptionsDetails {
	prompt: string;
	choices: string[];
	multiple: boolean;
	selected: { index: number; name: string }[];
	message?: string;
	cancelled: boolean;
}

// ---- Schemas ----

const ChoiceSchema = Type.Object({
	name: Type.String({ description: "Display name of the choice" }),
	description: Type.Optional(
		Type.String({ description: "Optional description shown below the name" }),
	),
});

const PresentOptionsParams = Type.Object({
	prompt: Type.String({ description: "Question or message shown above the list" }),
	choices: Type.Array(ChoiceSchema, { description: "Available choices, shown numbered" }),
	multiple: Type.Optional(
		Type.Boolean({
			description:
				"Allow toggling several choices with Space (default: false, single choice)",
		}),
	),
	messageLabel: Type.Optional(
		Type.String({
			description: "Label for the extra free-form message option (default: 'Enter a message…')",
		}),
	),
});

// ---- Helpers ----

function baseDetails(params: { prompt: string; choices: Choice[]; multiple?: boolean }): Omit<PresentOptionsDetails, "selected" | "cancelled"> {
	return {
		prompt: params.prompt,
		choices: params.choices.map((c) => c.name),
		multiple: params.multiple === true,
	};
}

function buildContent(
	choices: string[],
	messageLabel: string,
	result: { cancelled: boolean; selected: { index: number; name: string }[]; message?: string },
): string {
	const numbered = [...choices.map((c, i) => `${i + 1}. ${c}`), `${choices.length + 1}. ${messageLabel}`];
	const header = `Available choices:\n${numbered.join("\n")}`;

	if (result.cancelled) {
		return `${header}\n\nUser cancelled`;
	}
	const parts: string[] = [];
	if (result.selected.length > 0) {
		parts.push(`User selected:\n${result.selected.map((s) => `${s.index}. ${s.name}`).join("\n")}`);
	}
	if (result.message) {
		parts.push(`User wrote:\n${result.message}`);
	}
	if (parts.length === 0) {
		return `${header}\n\nUser made no selection`;
	}
	return `${header}\n\n${parts.join("\n\n")}`;
}

function errorResult(
	message: string,
	params: { prompt: string; choices: Choice[]; multiple?: boolean },
): { content: { type: "text"; text: string }[]; details: PresentOptionsDetails } {
	return {
		content: [{ type: "text", text: message }],
		details: { ...baseDetails(params), selected: [], cancelled: true },
	};
}

// ---- Tool ----

export default function presentOptions(pi: ExtensionAPI) {
	let registered = false;

	// The options UI needs a terminal; in print/json/rpc sessions the call can
	// only fail, so the tool is never registered there and stays out of the prompt.
	pi.on("session_start", (_event, ctx) => {
		if (registered || ctx.mode !== "tui") return;
		registered = true;
		pi.registerTool({
			name: "present_options",
			label: "Present Options",
			description:
				"Present a numbered list of choices to the user and wait for their decision. " +
				"Use when the user must pick between alternatives before you proceed. " +
				"The list always includes a final option to type a free-form message instead. " +
				"Set multiple: true when several choices may apply: the user toggles them with Space " +
				"and confirms with Enter; if nothing is toggled, Enter selects the focused option. " +
				"The user can cancel with Esc.",
			parameters: PresentOptionsParams,
			executionMode: "sequential",

			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const choices: Choice[] = params.choices;
				if (ctx.mode !== "tui") {
					return errorResult("Error: UI not available (running in non-interactive mode)", params);
				}
				if (choices.length === 0) {
					return errorResult("Error: No choices provided", params);
				}

				const multiple = params.multiple === true;
				const messageLabel = params.messageLabel || "Enter a message…";

				const result = await ctx.ui.custom<Pick | null>((tui, theme, _kb, done) => {
					let focus = 0;
					let editMode = false;
					const toggled = new Set<number>(); // indexes into items
					let cachedLines: string[] | undefined;

					const items: ListItem[] = choices.map((c, i) => ({ ...c, index: i + 1 }));
					const otherIndex = items.length;
					items.push({ name: messageLabel, index: otherIndex + 1, isOther: true });

					const editorTheme: EditorTheme = {
						borderColor: (s) => theme.fg("accent", s),
						selectList: {
							selectedPrefix: (t) => theme.fg("accent", t),
							selectedText: (t) => theme.fg("accent", t),
							description: (t) => theme.fg("muted", t),
							scrollInfo: (t) => theme.fg("dim", t),
							noMatch: (t) => theme.fg("warning", t),
						},
					};
					const editor = new Editor(tui, editorTheme);

					function refresh() {
						cachedLines = undefined;
						tui.requestRender();
					}

					function finish(message?: string) {
						done({
							selected: [...toggled]
								.filter((i) => i !== otherIndex)
								.map((i) => ({ index: items[i].index, name: items[i].name })),
							message,
						});
					}

					editor.onSubmit = (value) => {
						if (!editMode) return;
						const trimmed = value.trim();
						if (!trimmed) {
							editMode = false;
							editor.setText("");
							refresh();
							return;
						}
						finish(trimmed);
					};

					function handleInput(data: string) {
						// Editor mode: type the message
						if (editMode) {
							if (matchesKey(data, Key.escape)) {
								editMode = false;
								editor.setText("");
								refresh();
								return;
							}
							editor.handleInput(data);
							refresh();
							return;
						}

						// Navigation
						if (matchesKey(data, Key.up)) {
							focus = Math.max(0, focus - 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.down)) {
							focus = Math.min(items.length - 1, focus + 1);
							refresh();
							return;
						}

						// Toggle (multi mode only)
						if (multiple && (matchesKey(data, Key.space) || data === " ")) {
							if (toggled.has(focus)) toggled.delete(focus);
							else toggled.add(focus);
							refresh();
							return;
						}

						// Confirm
						if (matchesKey(data, Key.enter)) {
							if (multiple && toggled.size > 0) {
								// Toggled set wins; open the editor if the message option is toggled
								if (toggled.has(otherIndex)) {
									editMode = true;
									editor.setText("");
									refresh();
								} else {
									finish();
								}
							} else if (items[focus].isOther) {
								// Focused message option: open the editor
								editMode = true;
								editor.setText("");
								refresh();
							} else {
								done({ selected: [{ index: items[focus].index, name: items[focus].name }] });
							}
							return;
						}

						// Cancel
						if (matchesKey(data, Key.escape)) {
							done(null);
						}
					}

					function render(width: number): string[] {
						if (cachedLines) return cachedLines;

						const lines: string[] = [];
						const renderWidth = Math.max(1, width);

						function addWrapped(text: string) {
							lines.push(...wrapTextWithAnsi(text, renderWidth));
						}

						function addWrappedWithPrefix(prefix: string, text: string) {
							const prefixWidth = visibleWidth(prefix);
							if (prefixWidth >= renderWidth) {
								addWrapped(prefix + text);
								return;
							}
							const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
							const continuationPrefix = " ".repeat(prefixWidth);
							for (let i = 0; i < wrapped.length; i++) {
								lines.push(`${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`);
							}
						}

						lines.push(theme.fg("accent", "─".repeat(renderWidth)));
						addWrappedWithPrefix(" ", theme.fg("text", params.prompt));
						lines.push("");

						const numberWidth = String(items.length).length;
						for (let i = 0; i < items.length; i++) {
							const item = items[i];
							const isFocused = i === focus;
							const isToggled = multiple && toggled.has(i);
							const num = `${String(item.index).padStart(numberWidth)}.`;
							const label = `${num} ${item.name}${item.isOther && editMode ? " ✎" : ""}`;
							const color = isFocused ? "accent" : "text";

							let prefix = isFocused ? theme.fg("accent", "> ") : "  ";
							if (multiple) {
								const box = isToggled
									? theme.fg("success", "[x]")
									: theme.fg("muted", "[ ]");
								prefix += box + " ";
							}
							addWrappedWithPrefix(prefix, theme.fg(color, label));
							if (item.description) {
								addWrappedWithPrefix(
									" ".repeat(visibleWidth(prefix)),
									theme.fg("muted", item.description),
								);
							}
						}

						if (editMode) {
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("muted", "Your message:"));
							for (const line of editor.render(Math.max(1, renderWidth - 2))) {
								lines.push(` ${line}`);
							}
						}

						lines.push("");
						if (editMode) {
							addWrappedWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to go back"));
						} else if (multiple) {
							addWrappedWithPrefix(
								" ",
								theme.fg("dim", "↑↓ navigate • Space toggle • Enter confirm • Esc cancel"),
							);
						} else {
							addWrappedWithPrefix(" ", theme.fg("dim", "↑↓ navigate • Enter select • Esc cancel"));
						}
						lines.push(theme.fg("accent", "─".repeat(renderWidth)));

						cachedLines = lines;
						return lines;
					}

					return {
						render,
						invalidate: () => {
							cachedLines = undefined;
						},
						handleInput,
					};
				});

				const resultInfo = {
					cancelled: result === null,
					selected: result?.selected ?? [],
					message: result?.message,
				};

				return {
					content: [
						{
							type: "text",
							text: buildContent(
								choices.map((c) => c.name),
								messageLabel,
								resultInfo,
							),
						},
					],
					details: {
						...baseDetails(params),
						selected: resultInfo.selected,
						message: resultInfo.message,
						cancelled: resultInfo.cancelled,
					} as PresentOptionsDetails,
				};
			},

			renderCall(args, theme, _context) {
				let text =
					theme.fg("toolTitle", theme.bold("present_options ")) +
					theme.fg("muted", args.prompt);
				const cs = Array.isArray(args.choices) ? (args.choices as Choice[]) : [];
				if (cs.length) {
					const numbered = cs.map((c, i) => `${i + 1}. ${c.name}`);
					numbered.push(`${cs.length + 1}. ${args.messageLabel || "Enter a message…"}`);
					text += `\n${theme.fg("dim", "  " + numbered.join(", "))}`;
				}
				return new Text(text, 0, 0);
			},

			renderResult(result, _options, theme, _context) {
				const details = result.details as PresentOptionsDetails | undefined;
				if (!details) {
					const text = result.content[0];
					return new Text(text?.type === "text" ? text.text : "", 0, 0);
				}
				if (details.cancelled) {
					return new Text(theme.fg("warning", "Cancelled"), 0, 0);
				}
				const parts: string[] = [];
				for (const s of details.selected) {
					parts.push(
						`${theme.fg("success", "✓ ")}${theme.fg("accent", `${s.index}. ${s.name}`)}`,
					);
				}
				if (details.message) {
					parts.push(
						`${theme.fg("success", "✓ ")}${theme.fg("muted", "(wrote) ")}${theme.fg("accent", details.message)}`,
					);
				}
				if (parts.length === 0) {
					return new Text(theme.fg("warning", "No selection"), 0, 0);
				}
				return new Text(parts.join("\n"), 0, 0);
			},
		});
	});
}
