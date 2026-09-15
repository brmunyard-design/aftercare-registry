interface Env {
  DB: D1Database;
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Content-Type",
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
      ...(init.headers || {}),
    },
  });

const id = () => crypto.randomUUID();
const token = (length = 24) =>
  crypto.randomUUID().replaceAll("-", "").slice(0, length);
const code = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
};

async function body<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

let schemaReady = false;

async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS registries (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      family_name TEXT NOT NULL,
      family_message TEXT DEFAULT '',
      admin_token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      registry_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'Practical help',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (registry_id) REFERENCES registries(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS commitments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      supporter_name TEXT NOT NULL,
      supporter_contact TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'offered',
      availability TEXT DEFAULT '',
      note TEXT DEFAULT '',
      recovery_code TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_tasks_registry ON tasks(registry_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_commitments_task ON commitments(task_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_commitments_code ON commitments(recovery_code)`),
  ]);
  schemaReady = true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-allow-headers": "Content-Type" } });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    try {
      if (path.startsWith("/api/")) {
        await ensureSchema(env.DB);
      }

      if (path === "/api/health" && request.method === "GET") {
        return json({ ok: true, database: "aftercare-registry-live" });
      }

      if (path === "/api/registries" && request.method === "POST") {
        const input = await body<{ familyName: string; message?: string; tasks?: { title: string; description?: string; category?: string }[] }>(request);
        if (!input.familyName?.trim()) return json({ error: "Family name is required." }, { status: 400 });

        const registryId = id();
        const slug = token(14);
        const adminToken = token(32);

        await env.DB.prepare(
          "INSERT INTO registries (id, slug, family_name, family_message, admin_token) VALUES (?, ?, ?, ?, ?)"
        ).bind(registryId, slug, input.familyName.trim(), input.message?.trim() || "", adminToken).run();

        const tasks = input.tasks?.length ? input.tasks : [
          { title: "Meals", description: "A home-cooked meal or a simple meal delivery.", category: "Food" },
          { title: "Groceries", description: "Pick up groceries or everyday essentials.", category: "Errands" },
          { title: "Check-in", description: "A phone call, visit or quiet cup of tea.", category: "Connection" },
          { title: "Lawn & garden", description: "Mowing, watering or a little garden help.", category: "Home" },
          { title: "Bins & household jobs", description: "Take the bins out, bring them in or help with small jobs.", category: "Home" },
          { title: "Something else", description: "Offer another practical way to help.", category: "Other" }
        ];

        for (const task of tasks) {
          await env.DB.prepare(
            "INSERT INTO tasks (id, registry_id, title, description, category) VALUES (?, ?, ?, ?, ?)"
          ).bind(id(), registryId, task.title, task.description || "", task.category || "Practical help").run();
        }

        return json({
          registry: { id: registryId, slug, familyName: input.familyName.trim(), message: input.message?.trim() || "" },
          adminToken
        }, { status: 201 });
      }

      const registryMatch = path.match(/^\/api\/registries\/([^/]+)$/);
      if (registryMatch && request.method === "GET") {
        const slug = registryMatch[1];
        const registry = await env.DB.prepare(
          "SELECT id, slug, family_name AS familyName, family_message AS message, created_at AS createdAt FROM registries WHERE slug = ?"
        ).bind(slug).first();

        if (!registry) return json({ error: "Registry not found." }, { status: 404 });

        const tasks = await env.DB.prepare(
          `SELECT t.id, t.title, t.description, t.category,
            CASE WHEN SUM(CASE WHEN c.status IN ('confirmed','in_progress','completed') THEN 1 ELSE 0 END) > 0
              THEN 'covered' ELSE 'needs_help' END AS publicStatus
           FROM tasks t
           LEFT JOIN commitments c ON c.task_id = t.id
           WHERE t.registry_id = ?
           GROUP BY t.id
           ORDER BY t.created_at`
        ).bind(registry.id).all();

        return json({ registry, tasks: tasks.results });
      }

      const taskMatch = path.match(/^\/api\/registries\/([^/]+)\/tasks$/);
      if (taskMatch && request.method === "POST") {
        const slug = taskMatch[1];
        const registry = await env.DB.prepare("SELECT id FROM registries WHERE slug = ?").bind(slug).first<{ id: string }>();
        if (!registry) return json({ error: "Registry not found." }, { status: 404 });

        const input = await body<{ title: string; description?: string; category?: string }>(request);
        if (!input.title?.trim()) return json({ error: "Task title is required." }, { status: 400 });

        await env.DB.prepare(
          "INSERT INTO tasks (id, registry_id, title, description, category) VALUES (?, ?, ?, ?, ?)"
        ).bind(id(), registry.id, input.title.trim(), input.description?.trim() || "", input.category || "Practical help").run();

        return json({ ok: true }, { status: 201 });
      }

      if (path === "/api/commitments" && request.method === "POST") {
        const input = await body<{ taskId: string; supporterName: string; supporterContact?: string; availability?: string; note?: string }>(request);
        if (!input.taskId || !input.supporterName?.trim()) return json({ error: "Task and supporter name are required." }, { status: 400 });

        const task = await env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(input.taskId).first();
        if (!task) return json({ error: "Task not found." }, { status: 404 });

        const commitmentId = id();
        const recoveryCode = code();

        await env.DB.prepare(
          `INSERT INTO commitments
           (id, task_id, supporter_name, supporter_contact, availability, note, recovery_code)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          commitmentId,
          input.taskId,
          input.supporterName.trim(),
          input.supporterContact?.trim() || "",
          input.availability?.trim() || "",
          input.note?.trim() || "",
          recoveryCode
        ).run();

        return json({ id: commitmentId, recoveryCode }, { status: 201 });
      }

      const commitmentMatch = path.match(/^\/api\/commitments\/([^/]+)$/);
      if (commitmentMatch && request.method === "PATCH") {
        const commitmentId = commitmentMatch[1];
        const input = await body<{ status?: string; availability?: string; note?: string }>(request);
        const allowed = ["offered", "confirmed", "in_progress", "completed", "unable_to_help"];
        if (input.status && !allowed.includes(input.status)) return json({ error: "Invalid status." }, { status: 400 });

        await env.DB.prepare(
          `UPDATE commitments
           SET status = COALESCE(?, status),
               availability = COALESCE(?, availability),
               note = COALESCE(?, note),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(input.status || null, input.availability ?? null, input.note ?? null, commitmentId).run();

        return json({ ok: true });
      }

      if (path === "/api/recover" && request.method === "POST") {
        const input = await body<{ code: string }>(request);
        const result = await env.DB.prepare(
          `SELECT c.id, c.status, c.supporter_name AS supporterName,
                  c.supporter_contact AS supporterContact,
                  c.availability, c.note,
                  t.title AS taskTitle, r.slug, r.family_name AS familyName
           FROM commitments c
           JOIN tasks t ON t.id = c.task_id
           JOIN registries r ON r.id = t.registry_id
           WHERE c.recovery_code = ?`
        ).bind((input.code || "").trim().toUpperCase()).first();

        if (!result) return json({ error: "We couldn't find that recovery code." }, { status: 404 });
        return json({ commitment: result });
      }

      if (path === "/api/admin" && request.method === "GET") {
        const slug = url.searchParams.get("slug") || "";
        const adminToken = url.searchParams.get("token") || "";
        const registry = await env.DB.prepare(
          "SELECT id, slug, family_name AS familyName, family_message AS message FROM registries WHERE slug = ? AND admin_token = ?"
        ).bind(slug, adminToken).first<{ id: string; slug: string; familyName: string; message: string }>();

        if (!registry) return json({ error: "Invalid dashboard link." }, { status: 403 });

        const tasks = await env.DB.prepare(
          `SELECT t.id, t.title, t.description, t.category, t.status AS taskStatus,
                  c.id AS commitmentId, c.supporter_name AS supporterName,
                  c.supporter_contact AS supporterContact, c.status AS commitmentStatus,
                  c.availability, c.note, c.recovery_code AS recoveryCode
           FROM tasks t
           LEFT JOIN commitments c ON c.task_id = t.id
           WHERE t.registry_id = ?
           ORDER BY t.created_at, c.created_at`
        ).bind(registry.id).all();

        return json({ registry, tasks: tasks.results });
      }

      return new Response(null, { status: 404 });
    } catch (error) {
      console.error(error);
      return json({ error: "Something went wrong." }, { status: 500 });
    }
  }
};
