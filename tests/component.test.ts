import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	KeybindingsManager,
	TUI_KEYBINDINGS,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { Check } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { createOptionsComponent, PresentOptionsParams, type ListItem } from "../src/index.ts";

function fixture(multiple = false, confirmKey: "l" | "space" = "l", customItems?: ListItem[]) {
	const done = vi.fn();
	const terminal = { rows: 16, columns: 80 };
	const tui = {
		terminal,
		requestRender: vi.fn(),
	} as unknown as TUI;
	const theme = {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	} as unknown as Theme;
	const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
		"tui.select.up": "k",
		"tui.select.down": "j",
		"tui.select.pageUp": "u",
		"tui.select.pageDown": "d",
		"tui.select.confirm": confirmKey,
		"tui.select.cancel": "h",
	});
	const items: ListItem[] =
		customItems ??
		Array.from({ length: 20 }, (_, index) => ({
			index: index + 1,
			name: `Choice ${index + 1}`,
			description: `Description ${index + 1}`,
		}));
	if (!customItems) items.push({ index: 21, name: "Message", isOther: true });
	return {
		terminal,
		component: createOptionsComponent({
			tui,
			theme,
			keybindings,
			prompt: "Pick one",
			items,
			multiple,
			done,
		}),
		done,
	};
}

describe("parameter schema", () => {
	const valid = { prompt: "Pick", choices: [{ name: "One" }] };

	it("accepts valid bounds and rejects blank or oversized input", () => {
		expect(Check(PresentOptionsParams, valid)).toBe(true);
		expect(Check(PresentOptionsParams, { ...valid, prompt: "   " })).toBe(false);
		expect(Check(PresentOptionsParams, { ...valid, choices: [{ name: " " }] })).toBe(false);
		expect(
			Check(PresentOptionsParams, {
				...valid,
				choices: Array.from({ length: 21 }, () => ({ name: "Choice" })),
			}),
		).toBe(false);
	});
});

describe("options component", () => {
	it("keeps output within width and height while making the last item reachable", () => {
		const { component } = fixture();
		for (let index = 0; index < 20; index++) component.handleInput("j");
		const lines = component.render(24);
		expect(lines.length).toBeLessThanOrEqual(12);
		expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
		expect(lines.join("\n")).toContain("21. Message");
		expect(lines.join("\n")).toContain("j navigate");
	});

	it("wraps complete option labels and descriptions instead of cutting them", () => {
		const name = "A deliberately long option label that must remain fully visible";
		const description = "Supporting text also wraps onto as many lines as it needs";
		const { component, terminal } = fixture(false, "l", [
			{ index: 1, name, description },
			{ index: 2, name: "Message", isOther: true },
		]);
		terminal.rows = 30;

		const lines = component.render(24);
		const compactOutput = lines.join("").replace(/\s/g, "");
		expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
		expect(compactOutput).toContain(name.replace(/\s/g, ""));
		expect(compactOutput).toContain(description.replace(/\s/g, ""));
		expect(lines.join("\n")).not.toContain("…");
	});

	it("pages through an option taller than the viewport without cutting its text", () => {
		const name = "x".repeat(200);
		const { component } = fixture(false, "l", [
			{ index: 1, name },
			{ index: 2, name: "Message", isOther: true },
		]);
		let displayedName = "";

		for (let page = 0; displayedName.length < name.length && page < 10; page++) {
			const lines = component.render(12);
			displayedName += lines.join("").replace(/[^x]/g, "");
			expect(lines.length).toBeLessThanOrEqual(12);
			expect(lines.every((line) => visibleWidth(line) <= 12)).toBe(true);
			component.handleInput("d");
		}

		expect(displayedName).toBe(name);
	});

	it("keeps descriptions reachable in a short terminal", () => {
		const { component, terminal } = fixture(false, "l", [
			{ index: 1, name: "Choice", description: "Still visible" },
			{ index: 2, name: "Message", isOther: true },
		]);
		terminal.rows = 8;

		component.render(40);
		component.handleInput("d");
		expect(component.render(40).join("\n")).toContain("Still visible");
	});

	it("preserves wide Unicode when the label starts near the right edge", () => {
		const { component } = fixture(false, "l", [
			{ index: 1, name: "界" },
			{ index: 2, name: "Message", isOther: true },
		]);

		const lines = component.render(6);
		expect(lines.join("\n")).toContain("界");
		expect(lines.every((line) => visibleWidth(line) <= 6)).toBe(true);
	});

	it("does not crash when a non-focused option wraps beyond the viewport", () => {
		const { component } = fixture(false, "l", [
			{ index: 1, name: "Short" },
			{ index: 2, name: "x".repeat(200) },
			{ index: 3, name: "Message", isOther: true },
		]);

		expect(() => component.render(12)).not.toThrow();
		expect(component.render(12).join("\n")).toContain("1. Short");
	});

	it("uses remapped keys rather than hard-coded defaults", () => {
		const { component, done } = fixture();
		component.handleInput("\u001b[B");
		component.handleInput("l");
		expect(done).toHaveBeenCalledWith({ selected: [{ index: 1, name: "Choice 1" }] });
	});

	it("returns multi-selections in displayed order", () => {
		const { component, done } = fixture(true);
		component.handleInput("j");
		component.handleInput(" ");
		component.handleInput("k");
		component.handleInput(" ");
		component.handleInput("l");
		expect(done).toHaveBeenCalledWith({
			selected: [
				{ index: 1, name: "Choice 1" },
				{ index: 2, name: "Choice 2" },
			],
			message: undefined,
		});
	});

	it("keeps toggle and confirm distinct when confirm is bound to Space", () => {
		const { component, done } = fixture(true, "space");
		component.handleInput("x");
		component.handleInput(" ");
		expect(done).toHaveBeenCalledWith({
			selected: [{ index: 1, name: "Choice 1" }],
			message: undefined,
		});
		expect(component.render(40).join("\n")).toContain("X toggle");
	});

	it("does not exceed the terminal-derived height budget", () => {
		const { component, terminal } = fixture();
		terminal.rows = 8;
		expect(component.render(40).length).toBeLessThanOrEqual(4);
	});
});
