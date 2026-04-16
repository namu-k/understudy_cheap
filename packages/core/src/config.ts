/**
 * Configuration management for Understudy.
 * Loads from $UNDERSTUDY_HOME/config.json5 (default: ~/.understudy/config.json5)
 * with environment variable overrides.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import JSON5 from "json5";
import { DEFAULT_CONFIG, type UnderstudyConfig } from "@understudy/types";
import { resolveUnderstudyHomeDir } from "./runtime-paths.js";
import { validateUnderstudyConfig } from "./config-schema.js";
import { applyEnvOverrides, loadDotenvFiles, deepMerge } from "./config-overrides.js";

const CONFIG_FILE_NAME = "config.json5";

export class ConfigManager {
	private config: UnderstudyConfig;
	private configPath: string;

	private constructor(config: UnderstudyConfig, configPath: string) {
		this.config = config;
		this.configPath = configPath;
	}

	/** Load config from file with env overrides */
	static async load(configPath?: string): Promise<ConfigManager> {
		const resolvedPath = configPath ?? getDefaultConfigPath();
		loadDotenvFiles(resolvedPath);

		let fileConfig: Partial<UnderstudyConfig> = {};
		if (existsSync(resolvedPath)) {
			const raw = readFileSync(resolvedPath, "utf-8");
			fileConfig = JSON5.parse(raw) as Partial<UnderstudyConfig>;
		}

		const merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, fileConfig as unknown as Record<string, unknown>) as unknown as UnderstudyConfig;
		const withEnv = applyEnvOverrides(merged);
		const validated = validateUnderstudyConfig(withEnv);

		return new ConfigManager(validated, resolvedPath);
	}

	/** Create an in-memory config (for testing) */
	static inMemory(overrides: Partial<UnderstudyConfig> = {}): ConfigManager {
		const config = validateUnderstudyConfig(
			deepMerge(
				DEFAULT_CONFIG as unknown as Record<string, unknown>,
				overrides as unknown as Record<string, unknown>,
			),
		);
		return new ConfigManager(config, ":memory:");
	}

	get(): UnderstudyConfig {
		return this.config;
	}

	getPath(): string {
		return this.configPath;
	}

	/** Save current config to disk */
	save(): void {
		if (this.configPath === ":memory:") return;
		const dir = dirname(this.configPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(this.configPath, JSON5.stringify(this.config, null, "\t"), "utf-8");
	}

	/** Update config with partial overrides */
	update(overrides: Partial<UnderstudyConfig>): void {
		this.config = validateUnderstudyConfig(
			deepMerge(
				this.config as unknown as Record<string, unknown>,
				overrides as unknown as Record<string, unknown>,
			),
		);
	}
}

export function getConfigDir(): string {
	return resolveUnderstudyHomeDir();
}

export function getDefaultConfigPath(): string {
	return join(getConfigDir(), CONFIG_FILE_NAME);
}
