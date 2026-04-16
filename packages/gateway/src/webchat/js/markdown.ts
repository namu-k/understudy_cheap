export const markdownJS = `/* ── Markdown rendering ── */
function renderMarkdown(text) {
	const src = String(text ?? "");
	if (!src) return "";
	/* code fences */
	const parts = [];
	let cursor = 0;
	const fenceRe = /\`\`\`([a-zA-Z0-9_+\\-]*)\\n?([\\s\\S]*?)\`\`\`/g;
	let m;
	while ((m = fenceRe.exec(src)) !== null) {
		if (m.index > cursor) parts.push({ type: "text", value: src.slice(cursor, m.index) });
		parts.push({ type: "code", lang: m[1], value: m[2].replace(/\\n$/, "") });
		cursor = m.index + m[0].length;
	}
	if (cursor < src.length) parts.push({ type: "text", value: src.slice(cursor) });

	return parts.map(function(p) {
		if (p.type === "code") {
			return '<pre><code>' + esc(p.value) + '</code></pre>';
		}
		/* inline formatting */
		let h = esc(p.value);
		/* inline code */
		h = h.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
		/* bold */
		h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
		/* italic */
		h = h.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
		/* line breaks */
		h = h.replace(/\\n/g, '<br>');
		return '<p>' + h + '</p>';
	}).join("");
}
`;
