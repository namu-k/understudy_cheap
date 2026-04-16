/**
 * Control UI: embedded admin SPA for Understudy.
 * Provides the browser operator surface for gateway health, runtime status,
 * session inspection, and quick interventions.
 */

import { existsSync } from "node:fs";
import type { Express } from "express";
import express from "express";
import { buildSessionUiHelpersScript } from "./session-ui-helpers.js";
import { understudyBrandIconDataUrl } from "./ui-brand.js";
import { getControlCSS } from "./control/css.js";
import { getControlJS } from "./control/js/index.js";
import { renderControlHTML } from "./control/html.js";

export interface ControlUiOptions {
	/** Base URL path (default: "/ui") */
	basePath?: string;
	/** Path to custom static assets (overrides embedded UI) */
	assetRoot?: string;
	/** Assistant name shown in UI */
	assistantName?: string;
	/** Assistant avatar URL */
	assistantAvatarUrl?: string;
	/** Allowed CORS origins */
	allowedOrigins?: string[];
}

/**
 * Mount the control UI on an Express app.
 */
export function mountControlUi(app: Express, options: ControlUiOptions = {}): void {
	const basePath = (options.basePath ?? "/ui").replace(/\/+$/, "");

	// CORS handling for allowedOrigins (must be before static assets)
	if (options.allowedOrigins && options.allowedOrigins.length > 0) {
		const origins = new Set(options.allowedOrigins);
		app.use(basePath, (_req, res, next) => {
			const origin = _req.headers.origin;
			if (origin && origins.has(origin)) {
				res.setHeader("Access-Control-Allow-Origin", origin);
				res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
				res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
			}
			next();
		});
	}

	// If custom asset root exists, serve it
	if (options.assetRoot && existsSync(options.assetRoot)) {
		app.use(basePath, express.static(options.assetRoot));
	}

	// Bootstrap config endpoint
	app.get(`${basePath}/config.json`, (_req, res) => {
		res.json({
			assistantName: options.assistantName ?? "Understudy",
			assistantAvatarUrl: options.assistantAvatarUrl ?? null,
			basePath,
		});
	});

	// Embedded SPA (inline HTML)
	const indexHtml = buildAdminHtml(options);
	app.get(basePath, (_req, res) => {
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.send(indexHtml);
	});

	// SPA fallback — use a middleware to catch remaining routes under basePath
	app.use(basePath, (_req, res, next) => {
		// Only catch GET requests that haven't been handled
		if (_req.method === "GET" && !res.headersSent) {
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.send(indexHtml);
		} else {
			next();
		}
	});
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildAdminHtml(options: ControlUiOptions): string {
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
