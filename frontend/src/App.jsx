import { startTransition, useDeferredValue, useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const emptyProject = {
  id: "",
  name: "",
  goal: "",
  lastState: "",
  nextAction: "",
  startup: "",
  notes: "",
  status: "queued",
  priority: "medium",
  deadline: "",
  energy: "focus",
  context: "",
  estimatedMinutes: 30,
  images: [],
  tags: []
};

const modeLabels = {
  deep: "Deep Work",
  quick: "Quick Win",
  admin: "Admin"
};

function normalizeTags(rawTags) {
  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function statusLabel(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function priorityLabel(priority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function energyLabel(energy) {
  return energy.charAt(0).toUpperCase() + energy.slice(1);
}

function imageId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image"));
    image.src = dataUrl;
  });
}

async function createThumbnail(dataUrl, maxSize = 220) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [deletedProjects, setDeletedProjects] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(emptyProject);
  const [isDetailsOpen, setIsDetailsOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [mode, setMode] = useState("deep");
  const [currentContext, setCurrentContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [imageViewer, setImageViewer] = useState(null);

  const deferredSearch = useDeferredValue(search);

  async function loadProjects(selectedProjectId, nextMode = mode, keepSelection = true) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ mode: nextMode });
      if (currentContext.trim()) {
        params.set("context", currentContext.trim());
      }
      const data = await request(`/api/projects?${params.toString()}`);
      setProjects(data.projects);
      setDeletedProjects(data.deletedProjects || []);
      setRecommendation(data.recommendation);

      const preferredId = keepSelection ? selectedProjectId || selectedId || data.projects[0]?.id || null : null;
      const selected = data.projects.find((project) => project.id === preferredId) || null;

      startTransition(() => {
        setSelectedId(selected?.id || null);
        setImageViewer(null);
        setIsDetailsOpen(keepSelection && Boolean(selected));
        setDraft(
          selected
            ? { ...emptyProject, ...selected, tags: selected.tags || [], images: selected.images || [] }
            : { ...emptyProject }
        );
      });
    } catch {
      setError("Unable to load projects. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects(null, mode);
  }, [mode, currentContext]);

  const query = deferredSearch.trim().toLowerCase();
  const filteredProjects = projects.filter((project) => {
    const matchesFilter = filter === "all" || project.status === filter;
    const haystack = [
      project.name,
      project.goal,
      project.nextAction,
      project.context,
      project.priority,
      ...(project.tags || [])
    ]
      .join(" ")
      .toLowerCase();

    return matchesFilter && (!query || haystack.includes(query));
  });

  function selectProject(project) {
    startTransition(() => {
      setSelectedId(project.id);
      setImageViewer(null);
      setIsDetailsOpen(true);
      setDraft({ ...emptyProject, ...project, tags: project.tags || [], images: project.images || [] });
    });
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function hasProjectContent(project) {
    return Boolean(
      project.id ||
        project.name.trim() ||
        project.goal.trim() ||
        project.lastState.trim() ||
        project.nextAction.trim() ||
        project.startup.trim() ||
        project.notes.trim() ||
        project.context.trim() ||
        (project.tags || []).length ||
        (project.images || []).length
    );
  }

  async function saveDraft() {
    const payload = {
      ...draft,
      estimatedMinutes: Number(draft.estimatedMinutes) || 0,
      tags: Array.isArray(draft.tags) ? draft.tags : normalizeTags(draft.tags)
    };

    if (!payload.id && !payload.name.trim()) {
      return null;
    }

    if (payload.id) {
      return request(`/api/projects/${payload.id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    }

    return request("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function closeDetails() {
    if (saving) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (hasProjectContent(draft)) {
        await saveDraft();
      }

      setSelectedId(null);
      setImageViewer(null);
      setIsDetailsOpen(false);
      setDraft({ ...emptyProject });
      await loadProjects(null, mode, false);
    } catch {
      setError("Close failed because the project could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const updated = await saveDraft();
      if (updated) {
        await loadProjects(updated.id, mode);
      }
    } catch {
      setError("Save failed. Try again once the backend is reachable.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) {
      setImageViewer(null);
      setDraft({ ...emptyProject });
      return;
    }

    setSaving(true);
    setError("");

    try {
      await request(`/api/projects/${draft.id}`, {
        method: "DELETE"
      });
      setImageViewer(null);
      setSelectedId(null);
      setIsDetailsOpen(false);
      setDraft({ ...emptyProject });
      await loadProjects(null, mode, false);
    } catch {
      setError("Delete failed. Try again once the backend is reachable.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(projectId) {
    setSaving(true);
    setError("");

    try {
      await request(`/api/projects/${projectId}/restore`, {
        method: "POST"
      });
      await loadProjects(projectId, mode, false);
    } catch {
      setError("Restore failed. Try again once the backend is reachable.");
    } finally {
      setSaving(false);
    }
  }

  async function handleImageUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }

    try {
      const uploadedImages = await Promise.all(
        files.map(async (file) => {
          const full = await readFileAsDataUrl(file);
          const thumbnail = await createThumbnail(full);

          return {
            id: imageId(),
            name: file.name,
            full,
            thumbnail,
            addedAt: new Date().toISOString()
          };
        })
      );

      setDraft((current) => ({
        ...current,
        images: [...(current.images || []), ...uploadedImages]
      }));
    } catch {
      setError("Image upload failed. Try a smaller or different image.");
    } finally {
      event.target.value = "";
    }
  }

  function removeImage(imageIdToRemove) {
    setDraft((current) => ({
      ...current,
      images: (current.images || []).filter((image) => image.id !== imageIdToRemove)
    }));

    if (imageViewer?.id === imageIdToRemove) {
      setImageViewer(null);
    }
  }

  function renderProjectTiles(className = "") {
    return (
      <div className={`tile-grid ${className}`.trim()}>
        <button
          className={`project-tile add-tile ${!selectedId && !draft.id && isDetailsOpen ? "selected" : ""}`}
          type="button"
          onClick={() => {
            setSelectedId(null);
            setImageViewer(null);
            setIsDetailsOpen(true);
            setDraft({ ...emptyProject });
          }}
        >
          <span className="plus-mark">+</span>
          <span>New Project</span>
        </button>

        {filteredProjects.map((project) => (
          <button
            key={project.id}
            className={`project-tile ${selectedId === project.id ? "selected" : ""}`}
            type="button"
            onClick={() => selectProject(project)}
          >
            <div className="tile-topline">
              <span className={`status-dot status-${project.status}`} />
              <span className="tile-status">{statusLabel(project.status)}</span>
            </div>
            <h3>{project.name}</h3>
            <p>{project.nextAction || project.goal}</p>
            <div className="tile-detail-row">
              <span>{priorityLabel(project.priority)}</span>
              <span>{project.estimatedMinutes} min</span>
            </div>
            <div className="tag-row">
              {(project.tags || []).slice(0, 2).map((tag) => (
                <span className="tag-chip" key={tag}>
                  {tag}
                </span>
              ))}
              {project.context ? <span className="tag-chip">{project.context}</span> : null}
            </div>
          </button>
        ))}
      </div>
    );
  }

  function renderTrash() {
    if (!deletedProjects.length) {
      return null;
    }

    return (
      <section className="trash-card">
        <div className="trash-header">
          <div>
            <p className="eyebrow">Trash</p>
            <h3>Recently Deleted</h3>
          </div>
          <span className="tag-chip">{deletedProjects.length}</span>
        </div>

        <div className="trash-list">
          {deletedProjects.map((project) => (
            <article className="trash-item" key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <p>{project.goal || project.nextAction || "No summary saved."}</p>
              </div>
              <button
                className="ghost-button"
                type="button"
                disabled={saving}
                onClick={() => handleRestore(project.id)}
              >
                Restore
              </button>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-card">
          <p className="eyebrow">Project Switchboard</p>
          <h1>Resume the right work in seconds.</h1>
          <p className="lede">
            Keep every project ready to restart with one click, not ten minutes of context hunting.
          </p>
        </div>

        <div className="assistant-card">
          <div className="assistant-header">
            <span className="eyebrow">Task Switch Assistant</span>
            <span className={`status-pill status-${recommendation?.status || "queued"}`}>
              {recommendation ? statusLabel(recommendation.status) : "No projects"}
            </span>
          </div>

          <div className="mode-row">
            {Object.entries(modeLabels).map(([value, label]) => (
              <button
                key={value}
                className={`mode-chip ${mode === value ? "selected" : ""}`}
                type="button"
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {recommendation ? (
            <>
              <h2>{recommendation.name}</h2>
              <p>{recommendation.nextAction || "Add a next action so this project becomes easier to resume."}</p>
              <div className="recommendation-meta">
                <span className="tag-chip">{priorityLabel(recommendation.priority)} priority</span>
                <span className="tag-chip">{energyLabel(recommendation.energy)} energy</span>
                <span className="tag-chip">{recommendation.estimatedMinutes} min</span>
              </div>
              <div className="why-card">
                <p className="eyebrow">Why This Now?</p>
                <p className="why-summary">{recommendation.recommendationSummary}</p>
                <ul className="reason-list">
                  {(recommendation.recommendationReasons || []).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() => selectProject(recommendation)}
              >
                Resume This Project
              </button>
            </>
          ) : (
            <p>Add your first project to start getting recommendations.</p>
          )}
        </div>

        <div className="toolbar">
          <input
            aria-label="Search projects"
            className="search-input"
            placeholder="Search name, goal, next action, tags"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            aria-label="Filter projects"
            className="filter-select"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="queued">Queued</option>
            <option value="blocked">Blocked</option>
            <option value="parked">Parked</option>
            <option value="done">Done</option>
          </select>

          <input
            aria-label="Current context"
            className="search-input"
            placeholder="Current context: computer, office, phone"
            value={currentContext}
            onChange={(event) => setCurrentContext(event.target.value)}
          />
        </div>

        {renderTrash()}
        {isDetailsOpen ? renderProjectTiles() : null}
      </aside>

      <main className="detail-panel">
        {isDetailsOpen ? (
          <>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Project Details</p>
                <h2>{draft.id ? draft.name || "Untitled Project" : "Create a new project"}</h2>
              </div>
              <div className="panel-actions">
                <button className="ghost-button" type="button" onClick={closeDetails} disabled={saving}>
                  {saving ? "Closing..." : "Close"}
                </button>
                <button className="primary-button" type="submit" form="project-form" disabled={saving}>
                  {saving ? "Saving..." : "Save Project"}
                </button>
              </div>
            </div>

            {error ? <div className="notice error-notice">{error}</div> : null}
            {loading ? <div className="notice">Loading projects...</div> : null}

            <form id="project-form" className="project-form" onSubmit={handleSave}>
              <label>
                <span>Name</span>
                <input
                  required
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                  placeholder="Project name"
                />
              </label>

              <div className="form-row form-row-3">
                <label>
                  <span>Status</span>
                  <select
                    value={draft.status}
                    onChange={(event) => updateDraft("status", event.target.value)}
                  >
                    <option value="active">Active</option>
                    <option value="queued">Queued</option>
                    <option value="blocked">Blocked</option>
                    <option value="parked">Parked</option>
                    <option value="done">Done</option>
                  </select>
                </label>

                <label>
                  <span>Priority</span>
                  <select
                    value={draft.priority}
                    onChange={(event) => updateDraft("priority", event.target.value)}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>

                <label>
                  <span>Energy</span>
                  <select
                    value={draft.energy}
                    onChange={(event) => updateDraft("energy", event.target.value)}
                  >
                    <option value="deep">Deep</option>
                    <option value="focus">Focus</option>
                    <option value="admin">Admin</option>
                    <option value="shallow">Shallow</option>
                  </select>
                </label>
              </div>

              <div className="form-row form-row-3">
                <label>
                  <span>Context</span>
                  <input
                    value={draft.context}
                    onChange={(event) => updateDraft("context", event.target.value)}
                    placeholder="computer, office, phone, online"
                  />
                </label>

                <label>
                  <span>Deadline</span>
                  <input
                    type="date"
                    value={draft.deadline}
                    onChange={(event) => updateDraft("deadline", event.target.value)}
                  />
                </label>

                <label>
                  <span>Estimated Minutes</span>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={draft.estimatedMinutes}
                    onChange={(event) => updateDraft("estimatedMinutes", event.target.value)}
                    placeholder="30"
                  />
                </label>
              </div>

              <label>
                <span>Tags</span>
                <input
                  value={Array.isArray(draft.tags) ? draft.tags.join(", ") : draft.tags}
                  onChange={(event) => updateDraft("tags", normalizeTags(event.target.value))}
                  placeholder="frontend, client, automation"
                />
              </label>

              <section className="image-section">
                <div className="section-head">
                  <div>
                    <span>Project Photos</span>
                    <p className="section-copy">Add visual context. Thumbnails stay compact; click to inspect full size.</p>
                  </div>
                  <label className="upload-button">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                    />
                    Upload Photos
                  </label>
                </div>

                {(draft.images || []).length ? (
                  <div className="image-grid">
                    {draft.images.map((image) => (
                      <article className="image-card" key={image.id}>
                        <button
                          className="thumbnail-button"
                          type="button"
                          onClick={() => setImageViewer(image)}
                        >
                          <img alt={image.name} src={image.thumbnail} />
                        </button>
                        <div className="image-card-meta">
                          <span className="image-name" title={image.name}>{image.name}</span>
                          <button
                            className="ghost-button image-remove-button"
                            type="button"
                            onClick={() => removeImage(image.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-gallery">No photos yet.</div>
                )}
              </section>

              <label>
                <span>What am I trying to do?</span>
                <textarea
                  rows="4"
                  value={draft.goal}
                  onChange={(event) => updateDraft("goal", event.target.value)}
                  placeholder="Describe the outcome this project should create."
                />
              </label>

              <label>
                <span>What was done? Where did I stop?</span>
                <textarea
                  rows="5"
                  value={draft.lastState}
                  onChange={(event) => updateDraft("lastState", event.target.value)}
                  placeholder="Capture the latest state so you can re-enter instantly."
                />
              </label>

              <label>
                <span>The very next physical action</span>
                <textarea
                  rows="4"
                  value={draft.nextAction}
                  onChange={(event) => updateDraft("nextAction", event.target.value)}
                  placeholder="What exactly should happen next?"
                />
              </label>

              <label>
                <span>How to start: commands, links, materials, logins</span>
                <textarea
                  rows="5"
                  value={draft.startup}
                  onChange={(event) => updateDraft("startup", event.target.value)}
                  placeholder="Paste launch commands, references, URLs, credentials reminders, or folders."
                />
              </label>

              <label>
                <span>Notes: gotchas, decisions, reminders to self</span>
                <textarea
                  rows="5"
                  value={draft.notes}
                  onChange={(event) => updateDraft("notes", event.target.value)}
                  placeholder="Record sharp edges, context, and decisions you do not want to rediscover."
                />
              </label>

              {draft.id ? (
                <section className="danger-zone">
                  <div>
                    <p className="eyebrow">Danger Zone</p>
                    <p className="danger-copy">
                      Delete moves this project to Trash so it can be restored later.
                    </p>
                  </div>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                  >
                    Delete Project
                  </button>
                </section>
              ) : null}
            </form>
          </>
        ) : (
          <section className="project-browser">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Choose Next Project</p>
                <h2>All Projects</h2>
              </div>
            </div>

            {error ? <div className="notice error-notice">{error}</div> : null}
            {loading ? <div className="notice">Loading projects...</div> : null}
            {renderProjectTiles("browser-grid")}
          </section>
        )}
      </main>

      {imageViewer ? (
        <div
          className="image-modal"
          role="dialog"
          aria-modal="true"
          aria-label={imageViewer.name}
          onClick={() => setImageViewer(null)}
        >
          <div className="image-modal-content" onClick={(event) => event.stopPropagation()}>
            <button className="image-modal-close" type="button" onClick={() => setImageViewer(null)}>
              Close
            </button>
            <img alt={imageViewer.name} src={imageViewer.full} />
            <p>{imageViewer.name}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
