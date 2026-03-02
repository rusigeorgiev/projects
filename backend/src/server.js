import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { ensureUploadsDir, readProjects, resolveUploadsDir, writeProjects } from "./storage.js";

const app = express();
const port = Number(process.env.PORT || 8080);
const corsOrigin = process.env.CORS_ORIGIN || "*";

app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin }));
app.use(express.json({ limit: "15mb" }));
app.use("/uploads", express.static(resolveUploadsDir()));

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function extensionFromMimeType(mimeType) {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/jpeg":
    default:
      return "jpg";
  }
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Invalid image payload");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function writeImageVariant(projectId, imageId, variant, dataUrl) {
  const uploadsDir = await ensureUploadsDir();
  const { mimeType, buffer } = parseDataUrl(dataUrl);
  const extension = extensionFromMimeType(mimeType);
  const filename = `${projectId}-${imageId}-${variant}.${extension}`;
  const absolutePath = path.join(uploadsDir, filename);
  await fs.writeFile(absolutePath, buffer);
  return `/uploads/${filename}`;
}

function flattenImagePaths(images = []) {
  return images.flatMap((image) => [image.full, image.thumbnail]).filter(Boolean);
}

function isManagedUploadPath(publicPath) {
  return typeof publicPath === "string" && publicPath.startsWith("/uploads/");
}

async function removeManagedImageFiles(pathsToDelete) {
  const uploadsDir = resolveUploadsDir();

  await Promise.all(
    [...new Set(pathsToDelete)]
      .filter(isManagedUploadPath)
      .map(async (publicPath) => {
        const filename = path.basename(publicPath);
        const absolutePath = path.join(uploadsDir, filename);
        try {
          await fs.unlink(absolutePath);
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
      })
  );
}

async function normalizeImages(projectId, inputImages, existingImages = []) {
  if (!Array.isArray(inputImages)) {
    return existingImages;
  }

  const normalizedImages = await Promise.all(
    inputImages
      .filter((image) => image && typeof image === "object")
      .map(async (image, index) => {
        const imageId = typeof image.id === "string" && image.id ? image.id : `image-${Date.now()}-${index}`;
        const full = isDataUrl(image.full)
          ? await writeImageVariant(projectId, imageId, "full", image.full)
          : typeof image.full === "string"
            ? image.full
            : "";
        const thumbnail = isDataUrl(image.thumbnail)
          ? await writeImageVariant(projectId, imageId, "thumb", image.thumbnail)
          : typeof image.thumbnail === "string"
            ? image.thumbnail
            : "";

        return {
          id: imageId,
          name: typeof image.name === "string" ? image.name : `Image ${index + 1}`,
          full,
          thumbnail,
          addedAt: typeof image.addedAt === "string" ? image.addedAt : new Date().toISOString()
        };
      })
  );

  return normalizedImages.filter((image) => image.full && image.thumbnail);
}

async function normalizeProject(input, existing = {}) {
  const projectId = existing.id || input.id || nanoid(10);

  return {
    id: projectId,
    name: input.name?.trim() || existing.name || "Untitled Project",
    goal: input.goal?.trim() || existing.goal || "",
    lastState: input.lastState?.trim() || existing.lastState || "",
    nextAction: input.nextAction?.trim() || existing.nextAction || "",
    startup: input.startup?.trim() || existing.startup || "",
    notes: input.notes?.trim() || existing.notes || "",
    status: input.status || existing.status || "queued",
    priority: input.priority || existing.priority || "medium",
    deadline: typeof input.deadline === "string" ? input.deadline : existing.deadline || "",
    energy: input.energy || existing.energy || "focus",
    context: input.context?.trim() || existing.context || "",
    estimatedMinutes: Number.isFinite(Number(input.estimatedMinutes))
      ? Number(input.estimatedMinutes)
      : existing.estimatedMinutes || 30,
    images: await normalizeImages(projectId, input.images, existing.images || []),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : existing.tags || [],
    deletedAt: input.deletedAt === null ? null : existing.deletedAt || null,
    updatedAt: new Date().toISOString()
  };
}

function daysUntil(dateString) {
  if (!dateString) {
    return null;
  }

  const timestamp = new Date(dateString).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.ceil((timestamp - Date.now()) / (1000 * 60 * 60 * 24));
}

function modePreferences(mode) {
  switch (mode) {
    case "quick":
      return {
        preferredEnergy: ["admin", "shallow", "focus"],
        maxMinutes: 30,
        label: "Quick Win"
      };
    case "admin":
      return {
        preferredEnergy: ["admin", "shallow"],
        maxMinutes: 45,
        label: "Admin"
      };
    case "deep":
    default:
      return {
        preferredEnergy: ["deep", "focus"],
        minMinutes: 45,
        label: "Deep Work"
      };
  }
}

function computeRecommendation(projects, mode = "deep", currentContext = "") {
  const statusWeights = {
    active: 4,
    queued: 3,
    blocked: 1,
    parked: 0,
    done: -5
  };
  const priorityWeights = {
    high: 3,
    medium: 1.5,
    low: 0
  };
  const energyWeights = {
    deep: 2,
    focus: 1.5,
    admin: 1,
    shallow: 0.5
  };
  const preferences = modePreferences(mode);

  const scored = projects.map((project) => {
    const lastUpdated = new Date(project.updatedAt || 0).getTime();
    const daysSinceUpdate = Math.max(0, (Date.now() - lastUpdated) / (1000 * 60 * 60 * 24));
    const deadlineDays = daysUntil(project.deadline);
    const estimatedMinutes = Number(project.estimatedMinutes) || 30;
    const isBlocked = project.status === "blocked";
    const contextMatches =
      currentContext &&
      project.context &&
      project.context.toLowerCase().includes(currentContext.toLowerCase());

    const statusScore = statusWeights[project.status] ?? 2;
    const priorityScore = priorityWeights[project.priority] ?? 1;
    const actionScore = project.nextAction?.trim() ? 2 : -2;
    const startupScore = project.startup?.trim() ? 1 : -1;
    const freshnessPenalty = Math.min(daysSinceUpdate, 14) * 0.15;
    const deadlineScore =
      deadlineDays === null ? 0 : deadlineDays <= 0 ? 4 : deadlineDays <= 3 ? 3 : deadlineDays <= 7 ? 1.5 : 0;
    const energyScore = energyWeights[project.energy] ?? 0.5;
    const modeEnergyScore = preferences.preferredEnergy.includes(project.energy) ? 2 : -1.5;
    const modeTimeScore =
      preferences.maxMinutes && estimatedMinutes <= preferences.maxMinutes
        ? 2
        : preferences.maxMinutes
          ? -1.5
          : preferences.minMinutes && estimatedMinutes >= preferences.minMinutes
            ? 1.5
            : 0;
    const blockedPenalty = isBlocked ? 2 : 0;
    const staleNudge = daysSinceUpdate >= 7 && project.status !== "done" ? 0.75 : 0;
    const contextScore = contextMatches ? 2 : currentContext ? -0.5 : 0;

    const score =
      statusScore +
      priorityScore +
      actionScore +
      startupScore +
      deadlineScore +
      energyScore +
      contextScore +
      modeEnergyScore +
      modeTimeScore +
      staleNudge -
      freshnessPenalty -
      blockedPenalty;

    const reasons = [];
    if (project.priority === "high") reasons.push("High priority");
    if (deadlineDays !== null && deadlineDays <= 3) reasons.push("Deadline is close");
    if (preferences.preferredEnergy.includes(project.energy)) {
      reasons.push(`Matches ${preferences.label.toLowerCase()} mode`);
    }
    if (contextMatches) reasons.push(`Matches your current ${currentContext} context`);
    if (preferences.maxMinutes && estimatedMinutes <= preferences.maxMinutes) {
      reasons.push(`Fits a ${estimatedMinutes}-minute window`);
    }
    if (preferences.minMinutes && estimatedMinutes >= preferences.minMinutes) {
      reasons.push(`Worth a focused ${estimatedMinutes}-minute block`);
    }
    if (project.nextAction?.trim()) reasons.push("Next physical action is already defined");
    if (project.startup?.trim()) reasons.push("Startup steps are ready");
    if (daysSinceUpdate >= 7 && project.status !== "done") reasons.push("Has been idle long enough to revisit");
    if (isBlocked) reasons.push("Still blocked, so it ranks lower");

    return {
      ...project,
      score,
      recommendationReasons: reasons.slice(0, 4),
      recommendationSummary: reasons[0] || "Best current fit based on your selected mode"
    };
  });

  return scored.sort((a, b) => b.score - a.score)[0] || null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/projects", async (req, res, next) => {
  try {
    const mode = typeof req.query.mode === "string" ? req.query.mode : "deep";
    const currentContext = typeof req.query.context === "string" ? req.query.context.trim() : "";
    const projects = await readProjects();
    const activeProjects = projects.filter((project) => !project.deletedAt);
    const deletedProjects = projects
      .filter((project) => project.deletedAt)
      .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    const sorted = [...activeProjects].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json({
      projects: sorted,
      deletedProjects,
      recommendation: computeRecommendation(sorted, mode, currentContext),
      mode,
      context: currentContext
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id", async (req, res, next) => {
  try {
    const projects = await readProjects();
    const project = projects.find((entry) => entry.id === req.params.id);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (req, res, next) => {
  try {
    const projects = await readProjects();
    const project = await normalizeProject({ ...req.body, deletedAt: null });
    const nextProjects = [project, ...projects];
    await writeProjects(nextProjects);
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

app.put("/api/projects/:id", async (req, res, next) => {
  try {
    const projects = await readProjects();
    const index = projects.findIndex((entry) => entry.id === req.params.id);

    if (index === -1) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const existing = projects[index];
    const updated = await normalizeProject(req.body, existing);
    const nextProjects = [...projects];
    nextProjects[index] = updated;
    const removedPaths = flattenImagePaths(existing.images).filter(
      (publicPath) => !flattenImagePaths(updated.images).includes(publicPath)
    );
    await writeProjects(nextProjects);
    await removeManagedImageFiles(removedPaths);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/restore", async (req, res, next) => {
  try {
    const projects = await readProjects();
    const index = projects.findIndex((entry) => entry.id === req.params.id);

    if (index === -1) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const restored = {
      ...projects[index],
      deletedAt: null,
      updatedAt: new Date().toISOString()
    };
    const nextProjects = [...projects];
    nextProjects[index] = restored;
    await writeProjects(nextProjects);
    res.json(restored);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:id", async (req, res, next) => {
  try {
    const projects = await readProjects();
    const index = projects.findIndex((entry) => entry.id === req.params.id);

    if (index === -1) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const nextProjects = [...projects];
    nextProjects[index] = {
      ...projects[index],
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await writeProjects(nextProjects);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Project Switchboard backend listening on ${port}`);
});
