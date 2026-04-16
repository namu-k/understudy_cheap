/**
 * Embedded Control UI SPA composition.
 * This refactor keeps the page as inline HTML/CSS/JS served by the gateway.
 * Converting it to external static assets remains outside the current scope.
 */

import { buildSessionUiHelpersScript } from "../session-ui-helpers.js";
import { understudyBrandIconDataUrl } from "../ui-brand.js";
import { getControlCSS } from "./css.js";
import { renderControlHTML } from "./html.js";
import { getControlJS } from "./js/index.js";

export interface ControlPageOptions {
	assistantName?: string;
	assistantAvatarUrl?: string;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildControlHtml(options: ControlPageOptions = {}): string {
	const name = escapeHtml(options.assistantName ?? "Understudy");
	const brandIconDataUrl = understudyBrandIconDataUrl();
	const avatarUrl = escapeHtml(options.assistantAvatarUrl ?? brandIconDataUrl);
	const sessionUiHelpersScript = buildSessionUiHelpersScript({ liveChannelId: "web" });
	const css = getControlCSS();
	const js = getControlJS(sessionUiHelpersScript);

	return renderControlHTML(css, js, {
		name,
		brandIconDataUrl,
		avatarUrl,
	});
}
