import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const replitConfig = readFileSync(
  path.join(repositoryRoot, ".replit"),
  "utf8",
);

describe("Replit deployment configuration", () => {
  it("defines the production build and run commands", () => {
    expect(replitConfig).toMatch(
      /\[deployment\][\s\S]*?build\s*=\s*"pnpm build"/,
    );
    expect(replitConfig).toMatch(
      /\[deployment\][\s\S]*?run\s*=\s*"pnpm start"/,
    );
  });
});
