import { renderWebChatHTML } from "./webchat/html.js";
import { webChatCSS } from "./webchat/css.js";
import { buildWebChatJS } from "./webchat/js/index.js";
import { understudyBrandIconDataUrl } from "./ui-brand.js";
import { buildSessionUiHelpersScript } from "./session-ui-helpers.js";

export function buildWebChatHtml(): string {
	const brandIconDataUrl = understudyBrandIconDataUrl();
	const sessionUiHelpersScript = buildSessionUiHelpersScript({ liveChannelId: "web" });
	return renderWebChatHTML(webChatCSS, buildWebChatJS(sessionUiHelpersScript), brandIconDataUrl);
}
