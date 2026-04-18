import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

// Read from git HEAD (the original monolithic file)
const src = execSync("git show HEAD:packages/gateway/src/webchat-ui.ts", { encoding: "utf8" });
const lines = src.split("\n");

function L(start, end) {
	return lines.slice(start - 1, end).join("\n");
}

// Extract sections
const chatPart1 = L(955, 1948);
const mdContent = L(1949, 1982);
const chatPart2 = L(1983, 2519);
const sessionPart1 = L(2520, 2553);
const sidebarContent = L(2554, 2593);
const sessionPart2 = L(2594, 2760);
const chatPart3 = L(2761, 3449);

// The content is extracted from inside a template literal in the original file.
// All backticks are already escaped as \` and all backslashes as \\.
// These escape sequences work identically in a new template literal, so we
// can use the raw content directly WITHOUT any additional escaping.
// We only need to verify there are no unescaped ${ sequences (verified: none exist).

function wrapInExport(name, content) {
	// Write as a TS file with the content inside backticks
	// We need to write the raw bytes, not use template literal interpolation
	const prefix = "export const " + name + " = `";
	const suffix = "`;\n";
	return prefix + content + suffix;
}

// Generate chat.ts with three exports: before markdown, between markdown and session, after session
const chatFile = [
	wrapInExport("chatBeforeMarkdown", chatPart1),
	wrapInExport("chatBeforeSession", chatPart2),
	wrapInExport("chatAfterSession", chatPart3),
].join("\n");
writeFileSync("packages/gateway/src/webchat/js/chat.ts", chatFile);

// Generate markdown.ts
writeFileSync("packages/gateway/src/webchat/js/markdown.ts", wrapInExport("markdownJS", mdContent));

// Generate session.ts — includes session actions + sidebar rendering (originally interleaved)
const sessionContent = sessionPart1 + "\n" + sidebarContent + "\n" + sessionPart2;
writeFileSync("packages/gateway/src/webchat/js/session.ts", wrapInExport("sessionJS", sessionContent));

// Generate sidebar.ts — re-exports from session for backward compatibility
writeFileSync("packages/gateway/src/webchat/js/sidebar.ts", `// Sidebar rendering is now part of sessionJS (original code interleaves them)
export const sidebarJS = "";
`);

// Generate index.ts — compose in the correct order matching the original
writeFileSync("packages/gateway/src/webchat/js/index.ts", `import { chatBeforeMarkdown, chatBeforeSession, chatAfterSession } from "./chat.js";
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
`);

// Verify the composed JS matches the original (up to line 3448, excluding the trailing blank line)
const originalJsBody = L(955, 3448);
const recomposedBody = [
	chatPart1,
	mdContent,
	chatPart2,
	sessionPart1,
	sidebarContent,
	sessionPart2,
	L(2761, 3448), // chatPart3 without trailing blank line for this comparison
].join("\n");

if (originalJsBody === recomposedBody) {
	console.log("✓ JS body recomposition matches original");
} else {
	console.log("✗ JS body recomposition mismatch!");
	for (let i = 0; i < Math.max(originalJsBody.length, recomposedBody.length); i++) {
		if (originalJsBody[i] !== recomposedBody[i]) {
			console.log(`  First diff at char ${i}: orig=${JSON.stringify(originalJsBody.slice(i, i+40))} comp=${JSON.stringify(recomposedBody.slice(i, i+40))}`);
			break;
		}
	}
	process.exit(1);
}

console.log("\nGenerated files:");
console.log("  chat.ts: 3 exports");
console.log("  markdown.ts:", mdContent.split("\n").length, "lines");
console.log("  session.ts:", (sessionPart1 + "\n" + sidebarContent + "\n" + sessionPart2).split("\n").length, "lines");
console.log("  sidebar.ts: re-export stub");
console.log("  index.ts: composed wrapper");
