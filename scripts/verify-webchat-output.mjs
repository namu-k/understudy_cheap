import { execFileSync } from "child_process";
import { rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";

const BASELINE_WEBCHAT_COMMIT = "202c0bac0ac48bb25d7e556d35edf7705db4e107";
const BASELINE_WEBCHAT_PATH = "packages/gateway/src/webchat-ui.ts";
const BASELINE_WEBCHAT_REF = `${BASELINE_WEBCHAT_COMMIT}:${BASELINE_WEBCHAT_PATH}`;

function readBaselineWebChatSource() {
  try {
    return execFileSync("git", ["show", BASELINE_WEBCHAT_REF], { encoding: "utf8" });
  } catch (error) {
    if (typeof error?.stdout === "string" && error.stdout.length > 0) {
      return error.stdout;
    }
    throw new Error(
      `Unable to read baseline WebChat source from ${BASELINE_WEBCHAT_REF}. Fetch repo history that includes the pre-split WebChat commit and rerun this script.`,
      { cause: error },
    );
  }
}

function rewriteBaselineImports(source) {
  const replacements = new Map([
    [
      "./ui-brand.js",
      pathToFileURL(resolve("packages/gateway/dist/ui-brand.js")).href,
    ],
    [
      "./session-ui-helpers.js",
      pathToFileURL(resolve("packages/gateway/dist/session-ui-helpers.js")).href,
    ],
  ]);

  let rewritten = source;
  for (const [from, to] of replacements) {
    const importNeedle = `"${from}"`;
    if (!rewritten.includes(importNeedle)) {
      throw new Error(`Missing expected import ${from} in ${BASELINE_WEBCHAT_REF}.`);
    }
    rewritten = rewritten.replaceAll(importNeedle, JSON.stringify(to));
  }
  return rewritten;
}

async function buildBaselineWebChatHtml() {
  const baselineSource = rewriteBaselineImports(readBaselineWebChatSource());
  const tempModulePath = join(tmpdir(), `understudy-webchat-baseline-${process.pid}-${Date.now()}.ts`);
  writeFileSync(tempModulePath, baselineSource);

  try {
    const moduleUrl = `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`;
    const baselineModule = await import(moduleUrl);
    if (typeof baselineModule.buildWebChatHtml !== "function") {
      throw new Error(`Baseline module ${BASELINE_WEBCHAT_REF} did not export buildWebChatHtml().`);
    }
    return baselineModule.buildWebChatHtml();
  } finally {
    rmSync(tempModulePath, { force: true });
  }
}

const { understudyBrandIconDataUrl } = await import("../packages/gateway/dist/ui-brand.js");
const { buildSessionUiHelpersScript } = await import("../packages/gateway/dist/session-ui-helpers.js");
const { webChatCSS } = await import("../packages/gateway/dist/webchat/css.js");
const { renderWebChatHTML } = await import("../packages/gateway/dist/webchat/html.js");
const { buildWebChatJS } = await import("../packages/gateway/dist/webchat/js/index.js");

const brandIconDataUrl = understudyBrandIconDataUrl();
const sessionUiHelpersScript = buildSessionUiHelpersScript({ liveChannelId: "web" });
const newJs = buildWebChatJS(sessionUiHelpersScript);
const newOutput = renderWebChatHTML(webChatCSS, newJs, brandIconDataUrl);
const originalOutput = await buildBaselineWebChatHtml();

writeFileSync("/tmp/original_webchat_output.html", originalOutput);
writeFileSync("/tmp/new_webchat_output.html", newOutput);

console.log("Baseline ref:", BASELINE_WEBCHAT_REF);
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
