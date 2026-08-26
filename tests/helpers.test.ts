import { describe, expect, it } from "vitest";
import {
	buildContent,
	capMessage,
	MAX_MESSAGE_LENGTH,
	sanitizeMultiline,
	sanitizeSingleLine,
	selectedInChoiceOrder,
	visibleItemWindow,
} from "../src/helpers.ts";

describe("terminal text sanitization", () => {
	it("removes CSI, OSC, APC, and unsafe controls", () => {
		const unsafe =
			"before\u001b[31mred\u001b[0m\u001b[2A\u001b]52;c;YQ==\u0007\u001bPpayload\u001b\\\u001b_hidden\u001b\\\u0000after";
		const safe = sanitizeMultiline(unsafe);
		expect(
			[...safe].every((character) => {
				const code = character.codePointAt(0) ?? 0;
				return code !== 0 && code !== 7 && code !== 27;
			}),
		).toBe(true);
		expect(safe).toContain("before");
		expect(safe).toContain("after");
		expect(safe).not.toContain("[2A");
		expect(safe).not.toContain("payload");
	});

	it("normalizes multiline and single-line values", () => {
		expect(sanitizeMultiline("one\r\ntwo\rthree\u2028four")).toBe("one\ntwo\nthree\nfour");
		expect(sanitizeSingleLine("  one\n\ttwo  ")).toBe("one two");
	});
});

describe("message and selection helpers", () => {
	it("caps messages before submission without splitting Unicode characters", () => {
		const result = capMessage(`${"x".repeat(MAX_MESSAGE_LENGTH - 1)}🙂z`);
		expect(result.truncated).toBe(true);
		expect(Array.from(result.value)).toHaveLength(MAX_MESSAGE_LENGTH);
		expect(result.value.endsWith("🙂")).toBe(true);
	});

	it("returns multi-selections in displayed order", () => {
		const items = [
			{ index: 1, name: "one" },
			{ index: 2, name: "two" },
			{ index: 3, name: "message" },
		];
		expect(selectedInChoiceOrder([1, 0, 2], items, 2)).toEqual([
			{ index: 1, name: "one" },
			{ index: 2, name: "two" },
		]);
	});

	it("builds concise model content", () => {
		expect(buildContent({ cancelled: false, selected: [{ index: 2, name: "two" }] })).toBe(
			"User selected:\n2. two",
		);
		expect(buildContent({ cancelled: true, selected: [] })).toBe("User cancelled");
	});
});

describe("list viewport", () => {
	it("always includes focus and respects the row budget", () => {
		const heights = [2, 2, 1, 2, 1, 2];
		for (let focus = 0; focus < heights.length; focus++) {
			const [start, end] = visibleItemWindow(heights, focus, 4);
			expect(start).toBeLessThanOrEqual(focus);
			expect(end).toBeGreaterThan(focus);
			expect(
				heights.slice(start, end).reduce((sum, height) => sum + height, 0),
			).toBeLessThanOrEqual(4);
		}
	});

	it("rejects a focused item that cannot fit in the row budget", () => {
		expect(() => visibleItemWindow([2], 0, 1)).toThrow(RangeError);
	});

	it("ignores an oversized non-focused item until it receives focus", () => {
		expect(visibleItemWindow([1, 5, 1], 0, 2)).toEqual([0, 1]);
	});
});
