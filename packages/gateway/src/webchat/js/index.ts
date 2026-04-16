import { chatBeforeMarkdown, chatBeforeSession, chatAfterSession } from "./chat.js";
import { sessionJS } from "./session.js";
import { markdownJS } from "./markdown.js";

export function buildWebChatJS(sessionUiHelpersScript: string): string {
	return [
		"(function() {",
		'"use strict";',
		"",
		sessionUiHelpersScript,
		"",
		chatBeforeMarkdown,
		markdownJS,
		chatBeforeSession,
		sessionJS,
		chatAfterSession,
		"})();",
	].join("\n");
}
