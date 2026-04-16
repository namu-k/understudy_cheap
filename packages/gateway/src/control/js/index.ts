import { getControlHealthJS } from "./health.js";
import { getControlSessionsJS } from "./sessions.js";
import { getControlChartsJS } from "./charts.js";

export function getControlJS(sessionUiHelpersScript: string): string {
	return (
		sessionUiHelpersScript +
		"\n" +
		getControlHealthJS() +
		"\n" +
		getControlSessionsJS() +
		"\n" +
		getControlChartsJS()
	);
}
