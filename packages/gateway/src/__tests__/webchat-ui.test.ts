import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildWebChatHtml } from "../webchat-ui.js";

function assertInlineScriptsCompile(html: string, label: string): void {
	const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g) ?? [];
	for (const [index, scriptTag] of scriptMatches.entries()) {
		const source = scriptTag
			.replace(/^<script>/, "")
			.replace(/<\/script>$/, "");
		expect(() => new vm.Script(source, { filename: `${label}-${index + 1}.js` })).not.toThrow();
	}
}

describe("buildWebChatHtml", () => {
	it("matches the embedded webchat html snapshot", () => {
		const html = buildWebChatHtml();

		expect(html).toMatchSnapshot();
		assertInlineScriptsCompile(html, "webchat");
	});
});
