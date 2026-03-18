import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createVisionReadTool } from "../vision-read-tool.js";

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=";

async function createTestImage(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "understudy-vision-read-test-"));
	const imagePath = join(dir, "tiny.png");
	await writeFile(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));
	return imagePath;
}

describe("createVisionReadTool", () => {
	it("returns image metadata and an image payload for downstream visual reasoning", async () => {
		const imagePath = await createTestImage();
		const tool = createVisionReadTool();

		const result = await tool.execute("id", {
			image: imagePath,
			focus: "Read the visible text",
		});

		const text = (result.content[0] as any).text as string;
		expect(text).toContain("Understudy vision read");
		expect(text).toContain("Focus: Read the visible text");
		expect(text).toContain("Image payload attached for downstream visual reasoning.");
		expect(result.content[1]).toMatchObject({
			type: "image",
			mimeType: "image/png",
		});
		expect((result.details as any).focus).toBe("Read the visible text");
		expect((result.details as any).imageAttached).toBe(true);
	});

	it("omits the image payload when includeImage is false", async () => {
		const imagePath = await createTestImage();
		const tool = createVisionReadTool();

		const result = await tool.execute("id", {
			image: imagePath,
			includeImage: false,
		});

		const text = (result.content[0] as any).text as string;
		expect(text).toContain("Image payload omitted by request.");
		expect(result.content).toHaveLength(1);
		expect((result.details as any).imageAttached).toBe(false);
	});

	it("returns a readable error for missing images", async () => {
		const tool = createVisionReadTool();
		const result = await tool.execute("id", { image: "/tmp/understudy-does-not-exist.png" });
		expect((result.content[0] as any).text).toContain("Understudy vision read failed");
		expect((result.details as any).error).toBeTruthy();
	});
});
