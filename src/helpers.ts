import { stripTerminalSequences } from "@earendil-works/pi-tui";

export const MAX_MESSAGE_LENGTH = 5_000;

const C1_INTRODUCERS: Record<number, string> = {
	144: "P",
	152: "X",
	155: "[",
	157: "]",
	158: "^",
	159: "_",
};

function removeTerminalControls(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (![0x1b, 0x90, 0x98, 0x9b, 0x9d, 0x9e, 0x9f].includes(code)) {
			result += value[index];
			continue;
		}

		const introducer = code === 0x1b ? value[++index] : (C1_INTRODUCERS[code] ?? "");
		if (introducer === "[") {
			while (index + 1 < value.length) {
				const next = value.charCodeAt(++index);
				if (next >= 0x40 && next <= 0x7e) break;
			}
		} else if (introducer === "]") {
			while (index + 1 < value.length) {
				const next = value.charCodeAt(++index);
				if (next === 0x07 || next === 0x9c || (next === 0x1b && value[index + 1] === "\\")) {
					if (next === 0x1b) index++;
					break;
				}
			}
		} else if (
			introducer === "P" ||
			introducer === "X" ||
			introducer === "^" ||
			introducer === "_"
		) {
			while (index + 1 < value.length) {
				const next = value[++index];
				if (next === "\u009c" || (next === "\u001b" && value[index + 1] === "\\")) {
					if (next === "\u001b") index++;
					break;
				}
			}
		}
	}
	return result;
}

/** Remove terminal sequences and control characters while preserving line breaks. */
export function sanitizeMultiline(value: unknown): string {
	if (typeof value !== "string") return "";
	return Array.from(
		removeTerminalControls(stripTerminalSequences(value))
			.replace(/\r\n?/g, "\n")
			.replace(/[\u2028\u2029]/g, "\n"),
	)
		.filter((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code === 9 || code === 10 || code > 159 || (code > 31 && code < 127);
		})
		.join("");
}

/** Sanitize text that must occupy a single logical line. */
export function sanitizeSingleLine(value: unknown): string {
	return sanitizeMultiline(value)
		.replace(/[\n\t]+/g, " ")
		.replace(/ {2,}/g, " ")
		.trim();
}

export function capMessage(value: string): { value: string; truncated: boolean } {
	const characters = Array.from(value);
	if (characters.length <= MAX_MESSAGE_LENGTH) return { value, truncated: false };
	return { value: characters.slice(0, MAX_MESSAGE_LENGTH).join(""), truncated: true };
}

export function selectedInChoiceOrder(
	toggled: Iterable<number>,
	items: ReadonlyArray<{ index: number; name: string }>,
	excludedIndex: number,
): { index: number; name: string }[] {
	return [...toggled]
		.filter((index) => index !== excludedIndex && index >= 0 && index < items.length)
		.sort((a, b) => a - b)
		.map((index) => ({ index: items[index].index, name: items[index].name }));
}

export function buildContent(result: {
	cancelled: boolean;
	selected: { index: number; name: string }[];
	message?: string;
}): string {
	if (result.cancelled) return "User cancelled";

	const parts: string[] = [];
	if (result.selected.length > 0) {
		parts.push(
			`User selected:\n${result.selected.map((selection) => `${selection.index}. ${selection.name}`).join("\n")}`,
		);
	}
	if (result.message) parts.push(`User wrote:\n${result.message}`);
	return parts.join("\n\n") || "User made no selection";
}

/** Return a contiguous item window that includes focus and fits within maxRows. */
export function visibleItemWindow(
	heights: readonly number[],
	focus: number,
	maxRows: number,
): [number, number] {
	if (heights.length === 0 || maxRows <= 0) return [0, 0];
	if (heights.some((height) => height > maxRows)) {
		throw new RangeError("Each item must fit within maxRows");
	}
	const safeFocus = Math.max(0, Math.min(heights.length - 1, focus));
	let start = safeFocus;
	let end = safeFocus + 1;
	let used = heights[safeFocus] ?? 1;

	while (true) {
		let changed = false;
		if (end < heights.length && used + heights[end] <= maxRows) {
			used += heights[end];
			end++;
			changed = true;
		}
		if (start > 0 && used + heights[start - 1] <= maxRows) {
			start--;
			used += heights[start];
			changed = true;
		}
		if (!changed) break;
	}
	return [start, end];
}
