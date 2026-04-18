import { readFileSync, writeFileSync } from "fs";

// Import from built dist/ directories
const { understudyBrandIconDataUrl } = await import("../packages/gateway/dist/ui-brand.js");
const { buildSessionUiHelpersScript } = await import("../packages/gateway/dist/session-ui-helpers.js");

const brandIconDataUrl = understudyBrandIconDataUrl();
const sessionUiHelpersScript = buildSessionUiHelpersScript({ liveChannelId: "web" });

// New modules from dist
const { webChatCSS } = await import("../packages/gateway/dist/webchat/css.js");
const { renderWebChatHTML } = await import("../packages/gateway/dist/webchat/html.js");
const { buildWebChatJS } = await import("../packages/gateway/dist/webchat/js/index.js");

const newJs = buildWebChatJS(sessionUiHelpersScript);
const newOutput = renderWebChatHTML(webChatCSS, newJs, brandIconDataUrl);

// Build original output by reading the git-committed original and extracting the template
// We'll use git show to get the original version
import { execSync } from "child_process";
const originalSrc = execSync("git show HEAD:packages/gateway/src/webchat-ui.ts", { encoding: "utf8" });
const lines = originalSrc.split("\n");

// Extract the original HTML template content (lines 7-3453)
const templateContent = lines.slice(6, 3453).join("\n");
const htmlStart = templateContent.replace(/^return `/, "");
const htmlContent = htmlStart.replace(/`;$/, "");

// Substitute the dynamic values
const originalOutput = htmlContent
	.replace(/\$\{brandIconDataUrl\}/g, brandIconDataUrl)
	.replace(/\$\{sessionUiHelpersScript\}/g, sessionUiHelpersScript);

writeFileSync("/tmp/original_webchat_output.html", originalOutput);
writeFileSync("/tmp/new_webchat_output.html", newOutput);

console.log("Original output:", originalOutput.length, "chars,", originalOutput.split("\n").length, "lines");
console.log("New output:", newOutput.length, "chars,", newOutput.split("\n").length, "lines");

if (originalOutput === newOutput) {
	console.log("\n✓✓✓ OUTPUTS MATCH EXACTLY! Byte-identical!");
} else {
	console.log("\n✗ OUTPUTS DIFFER!");
	for (let i = 0; i < Math.max(originalOutput.length, newOutput.length); i++) {
		if (originalOutput[i] !== newOutput[i]) {
			console.log(`  First diff at char ${i} (line ~${originalOutput.slice(0, i).split("\n").length})`);
			console.log(`  orig: ${JSON.stringify(originalOutput.slice(i, i + 60))}`);
			console.log(`  new:  ${JSON.stringify(newOutput.slice(i, i + 60))}`);
			break;
		}
	}
	process.exit(1);
}
