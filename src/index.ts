import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	Editor,
	type EditorTheme,
	type Focusable,
	type KeybindingsManager,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	buildContent,
	capMessage,
	MAX_MESSAGE_LENGTH,
	sanitizeMultiline,
	sanitizeSingleLine,
	selectedInChoiceOrder,
	visibleItemWindow,
} from "./helpers.ts";

export interface Choice {
	name: string;
	description?: string;
}

export interface ListItem extends Choice {
	index: number;
	isOther?: boolean;
}

interface Pick {
	selected: { index: number; name: string }[];
	message?: string;
}

interface PresentOptionsDetails extends Pick {
	cancelled: boolean;
}

const nonBlank = { minLength: 1, pattern: "\\S" };

export const ChoiceSchema = Type.Object({
	name: Type.String({ ...nonBlank, maxLength: 200 }),
	description: Type.Optional(Type.String({ ...nonBlank, maxLength: 500 })),
});

export const PresentOptionsParams = Type.Object({
	prompt: Type.String({ ...nonBlank, maxLength: 1000 }),
	choices: Type.Array(ChoiceSchema, { minItems: 1, maxItems: 20 }),
	multiple: Type.Optional(Type.Boolean()),
	messageLabel: Type.Optional(Type.String({ ...nonBlank, maxLength: 100 })),
});

function errorResult(message: string): {
	content: { type: "text"; text: string }[];
	details: PresentOptionsDetails;
} {
	return {
		content: [{ type: "text", text: message }],
		details: { selected: [], cancelled: true },
	};
}

function prettyKey(key: string): string {
	return key
		.split("+")
		.map(
			(part) =>
				({ up: "↑", down: "↓", enter: "Enter", escape: "Esc", space: "Space" })[part] ?? part,
		)
		.join("+");
}

function keyName(
	keybindings: KeybindingsManager,
	action: Parameters<KeybindingsManager["getKeys"]>[0],
): string {
	const key = keybindings.getKeys(action)[0];
	return key ? prettyKey(key) : "";
}

function normalizeChoices(choices: Choice[]): Choice[] {
	return choices.map((choice) => ({
		name: sanitizeSingleLine(choice.name),
		description: choice.description
			? sanitizeMultiline(choice.description).trim() || undefined
			: undefined,
	}));
}

function wrapPrefixedText(prefix: string, text: string, width: number): string[] {
	const prefixWidth = visibleWidth(prefix);
	if (width - prefixWidth < 2) return wrapTextWithAnsi(prefix + text, width);

	const wrapped = wrapTextWithAnsi(text, width - prefixWidth);
	const continuationPrefix = " ".repeat(prefixWidth);
	return wrapped.map((line, index) => (index === 0 ? prefix : continuationPrefix) + line);
}

export function createOptionsComponent(options: {
	tui: TUI;
	theme: Theme;
	keybindings: KeybindingsManager;
	prompt: string;
	items: ListItem[];
	multiple: boolean;
	done: (result: Pick | null) => void;
}): Focusable & {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
} {
	const { tui, theme, keybindings, prompt, items, multiple, done } = options;
	let focus = 0;
	let editMode = false;
	let editorError: string | undefined;
	let messageWasCapped = false;
	let enforcingLimit = false;
	let lastVisibleCount = 1;
	let focusedLineOffset = 0;
	let lastFocusedHeight = 1;
	let lastFocusedPageRows = 1;
	const toggled = new Set<number>();
	const otherIndex = items.length - 1;
	let cachedWidth: number | undefined;
	let cachedHeight: number | undefined;
	let cachedLines: string[] | undefined;

	const editorTheme: EditorTheme = {
		borderColor: (text) => theme.fg("accent", text),
		selectList: {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		},
	};
	const editor = new Editor(tui, editorTheme);

	function refresh(): void {
		cachedWidth = undefined;
		cachedHeight = undefined;
		cachedLines = undefined;
		tui.requestRender();
	}

	function finish(message?: string): void {
		done({
			selected: selectedInChoiceOrder(toggled, items, otherIndex),
			message,
		});
	}

	editor.onChange = () => {
		if (enforcingLimit) return;
		const capped = capMessage(editor.getExpandedText());
		if (capped.truncated) {
			enforcingLimit = true;
			editor.setText(capped.value);
			enforcingLimit = false;
			messageWasCapped = true;
			editorError = `Input capped at ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`;
		}
		refresh();
	};

	editor.onSubmit = (value) => {
		if (!editMode) return;
		const safeValue = sanitizeMultiline(capMessage(value).value).trim();
		if (!safeValue) {
			editMode = false;
			editorError = undefined;
			messageWasCapped = false;
			editor.setText("");
			refresh();
			return;
		}
		finish(safeValue);
	};

	function openEditor(): void {
		editMode = true;
		editorError = undefined;
		messageWasCapped = false;
		editor.setText("");
		refresh();
	}

	function handleInput(data: string): void {
		if (editMode) {
			if (keybindings.matches(data, "tui.select.cancel")) {
				editMode = false;
				editorError = undefined;
				messageWasCapped = false;
				editor.setText("");
				refresh();
				return;
			}
			editorError = messageWasCapped
				? `Input capped at ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`
				: undefined;
			editor.handleInput(data);
			refresh();
			return;
		}

		if (keybindings.matches(data, "tui.select.up")) {
			focus = Math.max(0, focus - 1);
			focusedLineOffset = 0;
			refresh();
			return;
		}
		if (keybindings.matches(data, "tui.select.down")) {
			focus = Math.min(items.length - 1, focus + 1);
			focusedLineOffset = 0;
			refresh();
			return;
		}
		if (keybindings.matches(data, "tui.select.pageUp")) {
			if (focusedLineOffset > 0) {
				focusedLineOffset = Math.max(0, focusedLineOffset - lastFocusedPageRows);
			} else {
				focus = Math.max(0, focus - lastVisibleCount);
				focusedLineOffset = 0;
			}
			refresh();
			return;
		}
		if (keybindings.matches(data, "tui.select.pageDown")) {
			if (focusedLineOffset + lastFocusedPageRows < lastFocusedHeight) {
				focusedLineOffset += lastFocusedPageRows;
			} else {
				focus = Math.min(items.length - 1, focus + lastVisibleCount);
				focusedLineOffset = 0;
			}
			refresh();
			return;
		}

		const confirmUsesSpace = keybindings.matches(" ", "tui.select.confirm");
		const togglePressed = confirmUsesSpace
			? data.toLowerCase() === "x"
			: matchesKey(data, Key.space) || data === " ";
		if (multiple && togglePressed) {
			if (toggled.has(focus)) toggled.delete(focus);
			else toggled.add(focus);
			refresh();
			return;
		}

		if (keybindings.matches(data, "tui.select.confirm")) {
			if (multiple && toggled.size > 0) {
				if (toggled.has(otherIndex)) openEditor();
				else finish();
			} else if (items[focus].isOther) {
				openEditor();
			} else {
				done({ selected: [{ index: items[focus].index, name: items[focus].name }] });
			}
			return;
		}

		if (keybindings.matches(data, "tui.select.cancel")) done(null);
	}

	function render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const terminalRows = Math.max(1, tui.terminal.rows || 24);
		const heightBudget = Math.max(1, Math.min(18, terminalRows - 4));
		if (cachedLines && cachedWidth === renderWidth && cachedHeight === heightBudget)
			return cachedLines;

		const border = theme.fg("accent", "─".repeat(renderWidth));
		const promptLine = truncateToWidth(
			` ${theme.fg("text", sanitizeSingleLine(prompt))}`,
			renderWidth,
			"…",
		);
		let lines: string[] = [border, promptLine];

		if (editMode) {
			const submitKey = keyName(keybindings, "tui.input.submit") || "Enter";
			const cancelKey = keyName(keybindings, "tui.select.cancel") || "Esc";
			const count = Array.from(editor.getExpandedText()).length;
			const chrome = heightBudget >= 8;
			if (chrome) lines.push(theme.fg("muted", " Your message:"));
			const reserved = lines.length + 1 + (chrome ? 2 : 0);
			const editorRows = Math.max(1, heightBudget - reserved);
			const renderedEditor = editor.render(Math.max(1, renderWidth - 1));
			const cursorRow = renderedEditor.findIndex((line) => line.includes(CURSOR_MARKER));
			const editorStart =
				cursorRow < 0
					? Math.max(0, renderedEditor.length - editorRows)
					: Math.max(
							0,
							Math.min(cursorRow - Math.floor(editorRows / 2), renderedEditor.length - editorRows),
						);
			for (const line of renderedEditor.slice(editorStart, editorStart + editorRows)) {
				lines.push(` ${line}`);
			}
			if (chrome) {
				const status =
					editorError ??
					`${count.toLocaleString()}/${MAX_MESSAGE_LENGTH.toLocaleString()} characters`;
				lines.push(theme.fg(editorError ? "warning" : "dim", ` ${status}`));
				lines.push(theme.fg("dim", ` ${submitKey} submit • ${cancelKey} go back`));
			}
			lines.push(border);
		} else {
			const up = keyName(keybindings, "tui.select.up");
			const down = keyName(keybindings, "tui.select.down");
			const confirm = keyName(keybindings, "tui.select.confirm");
			const cancel = keyName(keybindings, "tui.select.cancel");
			const pageUp = keyName(keybindings, "tui.select.pageUp") || "PageUp";
			const pageDown = keyName(keybindings, "tui.select.pageDown") || "PageDown";
			const nav = [up, down].filter(Boolean).join("/");
			const toggle = keybindings.matches(" ", "tui.select.confirm") ? "X" : "Space";
			const help = multiple
				? `${nav} navigate • ${toggle} toggle • ${confirm} confirm • ${cancel} cancel`
				: `${nav} navigate • ${confirm} select • ${cancel} cancel`;
			const listRows = Math.max(1, heightBudget - 4);
			const numberWidth = String(items.length).length;
			const renderedItems = items.map((item, index) => {
				const focused = index === focus;
				const selected = multiple && toggled.has(index);
				let prefix = focused ? theme.fg("accent", "> ") : "  ";
				if (multiple) {
					const box = selected ? theme.fg("success", "[x]") : theme.fg("muted", "[ ]");
					prefix += `${box} `;
				}
				const number = `${String(item.index).padStart(numberWidth)}. `;
				const labelPrefix = prefix + theme.fg(focused ? "accent" : "text", number);
				const itemLines = wrapPrefixedText(
					labelPrefix,
					theme.fg(focused ? "accent" : "text", item.name),
					renderWidth,
				);
				if (item.description) {
					const indent = " ".repeat(visibleWidth(labelPrefix));
					itemLines.push(
						...wrapPrefixedText(indent, theme.fg("muted", item.description), renderWidth),
					);
				}
				return itemLines;
			});
			const heights = renderedItems.map((itemLines) => itemLines.length);
			const needsScroll = heights.reduce((sum, height) => sum + height, 0) > listRows;
			const itemRows = Math.max(1, listRows - (needsScroll ? 1 : 0));
			lastFocusedHeight = heights[focus] ?? 1;
			lastFocusedPageRows = Math.min(itemRows, lastFocusedHeight);
			focusedLineOffset = Math.min(focusedLineOffset, Math.max(0, lastFocusedHeight - 1));
			const windowHeights = [...heights];
			windowHeights[focus] = lastFocusedPageRows;
			const [start, end] = visibleItemWindow(windowHeights, focus, itemRows);
			lastVisibleCount = Math.max(1, end - start);

			for (let index = start; index < end; index++) {
				const itemLines = renderedItems[index];
				lines.push(
					...(index === focus
						? itemLines.slice(focusedLineOffset, focusedLineOffset + lastFocusedPageRows)
						: itemLines),
				);
			}
			if (lastFocusedHeight > lastFocusedPageRows) {
				const firstLine = focusedLineOffset + 1;
				const lastLine = Math.min(lastFocusedHeight, focusedLineOffset + lastFocusedPageRows);
				lines.push(
					theme.fg(
						"dim",
						` Option ${focus + 1}, lines ${firstLine}–${lastLine} of ${lastFocusedHeight} • ${pageUp}/${pageDown} for more`,
					),
				);
			} else if (needsScroll) {
				lines.push(theme.fg("dim", ` Showing ${start + 1}–${end} of ${items.length}`));
			}
			lines.push(theme.fg("dim", ` ${help}`));
			lines.push(border);
		}

		lines = lines.slice(0, heightBudget).map((line) => truncateToWidth(line, renderWidth, ""));
		cachedWidth = renderWidth;
		cachedHeight = heightBudget;
		cachedLines = lines;
		return lines;
	}

	return {
		get focused() {
			return editor.focused;
		},
		set focused(value: boolean) {
			editor.focused = value;
		},
		render,
		invalidate() {
			cachedWidth = undefined;
			cachedHeight = undefined;
			cachedLines = undefined;
			editor.invalidate();
		},
		handleInput,
	};
}

export default function presentOptions(pi: ExtensionAPI): void {
	let registered = false;

	pi.on("session_start", (_event, ctx) => {
		if (registered || ctx.mode !== "tui") return;
		registered = true;
		pi.registerTool({
			name: "present_options",
			label: "Present Options",
			description:
				"Ask the user to choose from a numbered list before proceeding. The user can also enter a free-form response of up to 5,000 characters. Set multiple=true to allow multiple choices.",
			parameters: PresentOptionsParams,
			executionMode: "sequential",

			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (ctx.mode !== "tui")
					return errorResult("Error: UI not available (running in non-interactive mode)");
				if (params.choices.length === 0) return errorResult("Error: No choices provided");

				const choices = normalizeChoices(params.choices as Choice[]);
				const prompt = sanitizeMultiline(params.prompt).trim();
				if (!prompt) return errorResult("Error: Prompt is empty after sanitization");
				if (choices.some((choice) => !choice.name)) {
					return errorResult("Error: A choice name is empty after sanitization");
				}
				const multiple = params.multiple === true;
				const messageLabel =
					sanitizeSingleLine(params.messageLabel ?? "Enter a message…") || "Enter a message…";
				const items: ListItem[] = choices.map((choice, index) => ({ ...choice, index: index + 1 }));
				items.push({ name: messageLabel, index: items.length + 1, isOther: true });

				const result = await ctx.ui.custom<Pick | null>((tui, theme, keybindings, done) =>
					createOptionsComponent({ tui, theme, keybindings, prompt, items, multiple, done }),
				);
				const resultInfo: PresentOptionsDetails = {
					cancelled: result === null,
					selected: result?.selected ?? [],
					message: result?.message,
				};
				return {
					content: [{ type: "text", text: buildContent(resultInfo) }],
					details: resultInfo,
				};
			},

			renderCall(args, theme, context) {
				const prompt = sanitizeMultiline(args.prompt).trim();
				const choices = Array.isArray(args.choices)
					? normalizeChoices(args.choices as Choice[])
					: [];
				const messageLabel =
					sanitizeSingleLine(args.messageLabel ?? "Enter a message…") || "Enter a message…";
				let text =
					theme.fg("toolTitle", theme.bold("present_options ")) + theme.fg("muted", prompt);
				if (!context.expanded) {
					const mode = args.multiple === true ? ", multiple" : "";
					text += theme.fg(
						"dim",
						` (${choices.length} choice${choices.length === 1 ? "" : "s"}${mode})`,
					);
					return new Text(text, 0, 0);
				}
				for (let index = 0; index < choices.length; index++) {
					text += `\n${theme.fg("dim", `  ${index + 1}. `)}${theme.fg("text", choices[index].name)}`;
					if (choices[index].description)
						text += `\n${theme.fg("dim", `     ${choices[index].description}`)}`;
				}
				text += `\n${theme.fg("dim", `  ${choices.length + 1}. `)}${theme.fg("text", messageLabel)}`;
				return new Text(text, 0, 0);
			},

			renderResult(result, _options, theme, _context) {
				const details = result.details as PresentOptionsDetails | undefined;
				if (!details) {
					const content = result.content[0];
					return new Text(sanitizeMultiline(content?.type === "text" ? content.text : ""), 0, 0);
				}
				if (details.cancelled) return new Text(theme.fg("warning", "Cancelled"), 0, 0);
				const parts = details.selected.map(
					(selection) =>
						`${theme.fg("success", "✓ ")}${theme.fg("accent", `${selection.index}. ${sanitizeSingleLine(selection.name)}`)}`,
				);
				if (details.message) {
					parts.push(
						`${theme.fg("success", "✓ ")}${theme.fg("muted", "(wrote) ")}${theme.fg("accent", sanitizeMultiline(details.message))}`,
					);
				}
				return new Text(parts.join("\n") || theme.fg("warning", "No selection"), 0, 0);
			},
		});
	});
}
