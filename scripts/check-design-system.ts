import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  designSystemGuardrailScopes,
  findForbiddenColorLiterals,
} from "../src/lib/design-system";

const root = process.cwd();
const allowedExtensions = new Set([".css", ".tsx", ".ts"]);

async function walk(targetPath: string): Promise<string[]> {
  const absoluteTarget = path.join(root, targetPath);
  const dirEntries = await readdir(absoluteTarget, { withFileTypes: true });
  const nested = await Promise.all(
    dirEntries.map(async (entry) => {
      const relativePath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        return walk(relativePath);
      }
      return allowedExtensions.has(path.extname(relativePath)) ? [relativePath] : [];
    })
  );
  return nested.flat();
}

async function main() {
  const sourceFiles = await walk("src/components");
  const files = sourceFiles.filter((filePath) =>
    designSystemGuardrailScopes.some((scope) => filePath.startsWith(scope))
  );
  const violations: Array<{ filePath: string; literals: string[] }> = [];

  for (const filePath of files) {
    const content = await readFile(path.join(root, filePath), "utf8");
    const literals = [...new Set(findForbiddenColorLiterals(content))];

    if (literals.length > 0) {
      violations.push({ filePath, literals });
    }
  }

  if (violations.length > 0) {
    const message = violations
      .map(({ filePath, literals }) => `${filePath}\n  ${literals.join(", ")}`)
      .join("\n");
    throw new Error(`Found raw color literals in design-system-managed files:\n${message}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
