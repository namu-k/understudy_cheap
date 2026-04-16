/**
 * Embedded WebChat SPA composition.
 * This refactor keeps the page as inline HTML/CSS/JS served by the gateway.
 * Converting it to external static assets remains outside the current scope.
 */

import { buildSessionUiHelpersScript } from "../session-ui-helpers.js";
import { understudyBrandIconDataUrl } from "../ui-brand.js";
import { webChatCSS } from "./css.js";
import { renderWebChatHTML } from "./html.js";
import { buildWebChatJS } from "./js/index.js";

export function buildWebChatHtml(): string {
	const brandIconDataUrl = understudyBrandIconDataUrl();
	const sessionUiHelpersScript = buildSessionUiHelpersScript({ liveChannelId: "web" });
	return renderWebChatHTML(webChatCSS, buildWebChatJS(sessionUiHelpersScript), brandIconDataUrl);
}
