import { writeFileSync } from "fs";
import {
	BASELINE_WEBCHAT_REF,
	readBaselineWebChatSource,
} from "./webchat-baseline-utils.mjs";

const src = readBaselineWebChatSource();
const lines = src.split("\n");

function L(start, end) {
	return lines.slice(start - 1, end).join("\n");
}

const chatPart1 = L(955, 1948);
const mdContent = L(1949, 1982);
const chatPart2 = L(1983, 2519);
const sessionPart1 = L(2520, 2553);
const sidebarContent = L(2554, 2593);
const sessionPart2 = L(2594, 2760);
const chatPart3 = L(2761, 3449);

function wrapInExport(name, content) {
	const prefix = "export const " + name + " = `";
	const suffix = "`;\n";
	return prefix + content + suffix;
}

const chatFile = [
	wrapInExport("chatBeforeMarkdown", chatPart1),
	wrapInExport("chatBeforeSession", chatPart2),
	wrapInExport("chatAfterSession", chatPart3),
].join("\n");
writeFileSync("packages/gateway/src/webchat/js/chat.ts", chatFile);

writeFileSync("packages/gateway/src/webchat/js/markdown.ts", wrapInExport("markdownJS", mdContent));

const sessionContent = sessionPart1 + "\n" + sidebarContent + "\n" + sessionPart2;
writeFileSync("packages/gateway/src/webchat/js/session.ts", wrapInExport("sessionJS", sessionContent));

writeFileSync(
	"packages/gateway/src/webchat/js/index.ts",
	`import { chatBeforeMarkdown, chatBeforeSession, chatAfterSession } from "./chat.js";
import { sessionJS } from "./session.js";
import { markdownJS } from "./markdown.js";

export function buildWebChatJS(sessionUiHelpersScript: string): string {
\treturn [
\t\t"(function() {",
\t\t'"use strict";',
\t\t"",
\t\tsessionUiHelpersScript,
\t\t"",
\t\tchatBeforeMarkdown,
\t\tmarkdownJS,
\t\tchatBeforeSession,
\t\tsessionJS,
\t\tchatAfterSession,
\t\t"})();",
\t].join("\\n");
}
`,
);

const originalJsBody = L(955, 3448);
const recomposedBody = [
	chatPart1,
	mdContent,
	chatPart2,
	sessionPart1,
	sidebarContent,
	sessionPart2,
	L(2761, 3448),
].join("\n");

if (originalJsBody === recomposedBody) {
	console.log("✓ JS body recomposition matches original");
} else {
	console.log("✗ JS body recomposition mismatch!");
	for (let i = 0; i < Math.max(originalJsBody.length, recomposedBody.length); i++) {
		if (originalJsBody[i] !== recomposedBody[i]) {
			console.log(`  First diff at char ${i}: orig=${JSON.stringify(originalJsBody.slice(i, i + 40))} comp=${JSON.stringify(recomposedBody.slice(i, i + 40))}`);
			break;
		}
	}
	process.exit(1);
}

console.log("\nGenerated files from baseline:", BASELINE_WEBCHAT_REF);
console.log("  chat.ts: 3 exports");
console.log("  markdown.ts:", mdContent.split("\n").length, "lines");
console.log("  session.ts:", sessionContent.split("\n").length, "lines");
console.log("  index.ts: composed wrapper");
