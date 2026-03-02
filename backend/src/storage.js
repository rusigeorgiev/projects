import fs from "fs/promises";
import path from "path";

const DEFAULT_DATA_FILE = path.resolve(process.cwd(), "data/projects.json");

export function resolveDataFile() {
  return process.env.DATA_FILE || DEFAULT_DATA_FILE;
}

export function resolveUploadsDir() {
  return path.join(path.dirname(resolveDataFile()), "uploads");
}

async function ensureDataFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "[]", "utf8");
  }
}

export async function readProjects() {
  const filePath = resolveDataFile();
  await ensureDataFile(filePath);
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents);
}

export async function writeProjects(projects) {
  const filePath = resolveDataFile();
  await ensureDataFile(filePath);
  await fs.writeFile(filePath, JSON.stringify(projects, null, 2), "utf8");
}

export async function ensureUploadsDir() {
  const uploadsDir = resolveUploadsDir();
  await fs.mkdir(uploadsDir, { recursive: true });
  return uploadsDir;
}
