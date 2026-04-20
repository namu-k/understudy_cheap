import { execFileSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

export const BASELINE_WEBCHAT_COMMIT = "202c0bac0ac48bb25d7e556d35edf7705db4e107";
export const BASELINE_WEBCHAT_PATH = "packages/gateway/src/webchat-ui.ts";
export const BASELINE_WEBCHAT_REF = `${BASELINE_WEBCHAT_COMMIT}:${BASELINE_WEBCHAT_PATH}`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function resolveRepoRoot() {
	return repoRoot;
}

export function repoPath(relativePath) {
	return resolve(repoRoot, relativePath);
}

export function repoFileHref(relativePath) {
	return pathToFileURL(repoPath(relativePath)).href;
}

function ensureBaselineCommitAvailable() {
	try {
		execFileSync("git", ["cat-file", "-e", `${BASELINE_WEBCHAT_COMMIT}^{commit}`], {
			cwd: repoRoot,
			stdio: "ignore",
		});
	} catch (error) {
		throw new Error(
			`Unable to read baseline WebChat source from ${BASELINE_WEBCHAT_REF}. ` +
			`This local helper compares against a pre-split WebChat commit, so shallow clones must fetch that commit ` +
			`or more history before rerunning.`,
			{ cause: error },
		);
	}
}

export function readBaselineWebChatSource() {
	ensureBaselineCommitAvailable();

	try {
		return execFileSync("git", ["show", BASELINE_WEBCHAT_REF], {
			cwd: repoRoot,
			encoding: "utf8",
		});
	} catch (error) {
		if (typeof error?.stdout === "string" && error.stdout.length > 0) {
			return error.stdout;
		}
		throw new Error(
			`Unable to read baseline WebChat source from ${BASELINE_WEBCHAT_REF}. ` +
			`Verify that the baseline file still exists at that revision and rerun this local helper.`,
			{ cause: error },
		);
	}
}

export function stripBaselineWebChatTypes(source) {
	const rewritten = source.replace(
		/export function buildWebChatHtml\(\)\s*:\s*string\s*\{/,
		"export function buildWebChatHtml() {",
	);

	if (rewritten === source) {
		throw new Error(`Expected to strip the buildWebChatHtml() return type from ${BASELINE_WEBCHAT_REF}.`);
	}

	return rewritten;
}
