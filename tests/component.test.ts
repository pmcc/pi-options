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

function fixture(multiple = false, confirmKey: "l" | "space" = "l") {
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
	const items: ListItem[] = Array.from({ length: 20 }, (_, index) => ({
		index: index + 1,
		name: `Choice ${index + 1}`,
		description: `Description ${index + 1}`,
	}));
	items.push({ index: 21, name: "Message", isOther: true });
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
