import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.isDirectory() &&
      ["dist", "node_modules", "coverage"].includes(entry.name)
    )
      return [];
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    if (entry.name.startsWith("migration") || entry.name.includes(".sql"))
      return [];
    return /\.(?:ts|tsx|mjs|js|json|css)$/.test(entry.name) ? [filePath] : [];
  });
}

const activeFiles = [
  path.join(repositoryRoot, "package.json"),
  path.join(repositoryRoot, "pnpm-workspace.yaml"),
  ...sourceFiles(path.join(repositoryRoot, "apps")),
].filter((filePath): filePath is string => existsSync(filePath));

const forbiddenCapabilities = [
  /(?:openai|anthropic|ai[ _-]?advice|AIアドバイス)/i,
  /(?:nutrition[ _-]?advice|栄養(?:アドバイス|指導))/i,
  /(?:nodemailer|send(?:ing)?Email|emailAddress|メール(?:アドレス|送信))/i,
  /(?:password[_-]?reset|reset[-_]?token|password_resets|パスワード再設定)/i,
  /(?:\b(?:organization|guardian|coach|team|invitation|invite)(?:s|ing)?\b|組織|保護者|コーチ|チーム|招待)/i,
];

describe("active source boundary", () => {
  it("does not retain removed advice, messaging, reset, or group capabilities", () => {
    for (const filePath of activeFiles) {
      const source = readFileSync(filePath, "utf8");
      for (const forbidden of forbiddenCapabilities) {
        expect(source, path.relative(repositoryRoot, filePath)).not.toMatch(
          forbidden,
        );
      }
    }
  });
});
