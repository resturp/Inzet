import { readFile } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CHECK_PASSWORD = process.env.CHECK_PASSWORD ?? "CheckPass123!";
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

const MEMBER_BONDS_CANDIDATES = [
  "CQS3S1J",
  "CQS5Y3F",
  "SN-1178",
  "KT-1156",
  "CFQ7N6U",
  "CGQ2N6G",
  "CPH5C2U",
  "SX-1090"
];

function isAssignedStatus(status) {
  return status === "TOEGEWEZEN" || status === "GEREED";
}

function getTaskCoordinatorAliases(task) {
  if (Array.isArray(task.coordinatorAliases) && task.coordinatorAliases.length > 0) {
    return task.coordinatorAliases;
  }
  return task.coordinatorAlias ? [task.coordinatorAlias] : [];
}

function taskHasCoordinator(task, alias) {
  return getTaskCoordinatorAliases(task).includes(alias);
}

function assertOrThrow(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cookieFromSetCookieHeader(setCookie) {
  if (!setCookie) {
    return null;
  }
  return setCookie.split(";")[0] ?? null;
}

function buildHeaders({ cookie, withJson } = {}) {
  const headers = {};
  if (withJson) {
    headers["content-type"] = "application/json";
  }
  if (cookie) {
    headers.cookie = cookie;
  }
  return headers;
}

async function apiRequest(path, { method = "GET", cookie, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: buildHeaders({ cookie, withJson: body !== undefined }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { response, payload };
}

function formatApiError(context, result) {
  const details =
    result.payload && typeof result.payload === "object"
      ? JSON.stringify(result.payload)
      : String(result.payload);
  return `${context} (${result.response.status}): ${details}`;
}

async function requestMagicLink({ bondsnummer, email, alias }) {
  return apiRequest("/api/auth/request-magic-link", {
    method: "POST",
    body: { bondsnummer, email, alias }
  });
}

async function loginByMagicLink({ bondsnummer, email }) {
  const requestResult = await requestMagicLink({ bondsnummer, email });
  assertOrThrow(
    requestResult.response.ok,
    formatApiError(`Magic-link aanvraag mislukt voor bondsnummer ${bondsnummer}`, requestResult)
  );
  return verifyFromMagicLinkRequest(requestResult);
}

function makeAlias(prefix, index) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}${index}${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
}

async function verifyFromMagicLinkRequest(requestResult) {
  const alias = requestResult.payload?.debugAlias;
  const token = requestResult.payload?.debugToken;
  assertOrThrow(alias, "Debug alias ontbreekt bij magic-link aanvraag.");
  assertOrThrow(token, "Debug token ontbreekt bij magic-link aanvraag.");

  const verifyResult = await apiRequest("/api/auth/verify-magic-link", {
    method: "POST",
    body: {
      alias,
      token,
      setPassword: CHECK_PASSWORD
    }
  });
  assertOrThrow(
    verifyResult.response.ok,
    formatApiError(`Magic-link verificatie mislukt voor alias ${alias}`, verifyResult)
  );

  const cookie = cookieFromSetCookieHeader(verifyResult.response.headers.get("set-cookie"));
  assertOrThrow(cookie, "Sessiecookie ontbreekt na verificatie.");

  return { alias, cookie };
}

async function ensureGovernanceSession() {
  try {
    return await loginByMagicLink({
      bondsnummer: "BESTUUR-SEED",
      email: `bestuur-check-${RUN_ID}@example.com`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("404")) {
      throw error;
    }
  }

  for (const bondsnummer of MEMBER_BONDS_CANDIDATES) {
    const email = `bootstrap-bestuur-${RUN_ID}@example.com`;
    const existingResult = await requestMagicLink({ bondsnummer, email });

    if (existingResult.response.ok) {
      return verifyFromMagicLinkRequest(existingResult);
    }

    const existingError = String(existingResult.payload?.error ?? "");
    if (
      existingResult.response.status === 400 &&
      existingError.toLowerCase().includes("alias is verplicht")
    ) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const aliasCandidate = makeAlias("ChkBestuur", attempt);
        const createResult = await requestMagicLink({
          bondsnummer,
          email,
          alias: aliasCandidate
        });

        if (createResult.response.ok) {
          return verifyFromMagicLinkRequest(createResult);
        }

        if (createResult.response.status === 409) {
          continue;
        }

        if (createResult.response.status === 404) {
          break;
        }

        throw new Error(
          formatApiError(
            `Bestuur-bootstrap mislukt voor bondsnummer ${bondsnummer}`,
            createResult
          )
        );
      }
      continue;
    }

    if (existingResult.response.status === 404) {
      continue;
    }

    throw new Error(
      formatApiError(`Bestuur-bootstrap aanvraag mislukt voor ${bondsnummer}`, existingResult)
    );
  }

  throw new Error("Kon geen bestuurssessie opzetten voor de check.");
}

async function ensureMemberAlias(prefix, excludeAliases = new Set()) {
  for (const bondsnummer of MEMBER_BONDS_CANDIDATES) {
    const emailBase = `${prefix.toLowerCase()}-${RUN_ID}@example.com`;
    const existingResult = await requestMagicLink({
      bondsnummer,
      email: emailBase
    });

    if (existingResult.response.ok) {
      const alias = existingResult.payload?.debugAlias;
      if (alias && !excludeAliases.has(alias)) {
        return alias;
      }
      continue;
    }

    const existingError = String(existingResult.payload?.error ?? "");
    if (
      existingResult.response.status === 400 &&
      existingError.toLowerCase().includes("alias is verplicht")
    ) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const aliasCandidate = makeAlias(prefix, attempt);
        const createResult = await requestMagicLink({
          bondsnummer,
          email: emailBase,
          alias: aliasCandidate
        });

        if (createResult.response.ok) {
          const resolved = createResult.payload?.debugAlias ?? aliasCandidate;
          if (!excludeAliases.has(resolved)) {
            return resolved;
          }
          continue;
        }

        if (createResult.response.status === 409) {
          continue;
        }

        if (createResult.response.status === 404) {
          break;
        }

        throw new Error(
          formatApiError(
            `Testlid aanmaken mislukt voor bondsnummer ${bondsnummer}`,
            createResult
          )
        );
      }
      continue;
    }

    if (existingResult.response.status === 404) {
      continue;
    }

    throw new Error(
      formatApiError(`Magic-link aanvraag mislukt voor bondsnummer ${bondsnummer}`, existingResult)
    );
  }

  throw new Error(`Kon geen testlid-setup afronden voor prefix ${prefix}.`);
}

async function loadAllowlistBondsnummers() {
  const path = new URL("../data/bondsnummers.json", import.meta.url);
  const contents = await readFile(path, "utf8");
  const parsed = JSON.parse(contents);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((value) => typeof value === "string");
}

async function loginAsKnownAliasViaBondsProbe(targetAlias, bondsnummers) {
  for (const bondsnummer of bondsnummers) {
    const requestResult = await requestMagicLink({
      bondsnummer,
      email: `probe-${targetAlias.toLowerCase()}-${RUN_ID}@example.com`
    });

    if (requestResult.response.ok) {
      if (requestResult.payload?.debugAlias === targetAlias) {
        return verifyFromMagicLinkRequest(requestResult);
      }
      continue;
    }

    if (requestResult.response.status === 400 || requestResult.response.status === 404) {
      continue;
    }

    throw new Error(
      formatApiError(
        `Bondsnummer-probe gaf onverwachte fout voor alias ${targetAlias}`,
        requestResult
      )
    );
  }

  throw new Error(`Kon geen bondsnummer vinden voor alias ${targetAlias}.`);
}

async function createTask(cookie, input) {
  const result = await apiRequest("/api/tasks", {
    method: "POST",
    cookie,
    body: input
  });

  assertOrThrow(result.response.status === 201, formatApiError("Taak aanmaken mislukt", result));
  assertOrThrow(result.payload?.data?.id, "Aangemaakte taak heeft geen id.");
  return result.payload.data;
}

async function proposeTask(cookie, taskId, proposedAlias) {
  const result = await apiRequest(`/api/tasks/${taskId}/propose`, {
    method: "POST",
    cookie,
    body: { proposedAlias }
  });
  assertOrThrow(result.response.status === 201, formatApiError("Taak voorstellen mislukt", result));
}

async function findOpenTask(cookie, { taskId, proposedAlias }) {
  const result = await apiRequest("/api/open-tasks", { cookie });
  assertOrThrow(
    result.response.ok,
    formatApiError("Open taken ophalen mislukt tijdens check", result)
  );
  const items = Array.isArray(result.payload?.data) ? result.payload.data : [];
  return (
    items.find((item) => item.taskId === taskId && item.proposedAlias === proposedAlias) ?? null
  );
}

async function acceptOpenTask(cookie, openTaskId) {
  const result = await apiRequest(`/api/open-tasks/${openTaskId}/accept`, {
    method: "POST",
    cookie,
    body: {}
  });
  assertOrThrow(result.response.ok, formatApiError("Open taak accepteren mislukt", result));
}

async function proposeAndAccept(cookie, taskId, proposedAlias) {
  await proposeTask(cookie, taskId, proposedAlias);
  const openTask = await findOpenTask(cookie, { taskId, proposedAlias });
  assertOrThrow(
    openTask?.id,
    `Open voorstel niet gevonden voor task ${taskId} en alias ${proposedAlias}.`
  );
  await acceptOpenTask(cookie, openTask.id);
}

function collectSubtreeTaskIds(rootIds, childrenByParentId) {
  const ids = new Set();
  const queue = [...rootIds];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || ids.has(currentId)) {
      continue;
    }
    ids.add(currentId);
    const children = childrenByParentId.get(currentId) ?? [];
    for (const child of children) {
      queue.push(child.id);
    }
  }

  return ids;
}

function buildChildrenByParentId(tasks) {
  const byParent = new Map();
  for (const task of tasks) {
    if (!task.parentId) {
      continue;
    }
    const children = byParent.get(task.parentId) ?? [];
    children.push(task);
    byParent.set(task.parentId, children);
  }
  return byParent;
}

function computeAssignedFilterView({ tasks, ownAlias, selectedAlias }) {
  const childrenByParentId = buildChildrenByParentId(tasks);
  const myAssignedRootTaskIds = tasks
    .filter((task) => taskHasCoordinator(task, ownAlias) && isAssignedStatus(task.status))
    .map((task) => task.id);

  const subtreeTaskIds = collectSubtreeTaskIds(myAssignedRootTaskIds, childrenByParentId);

  const otherAliases = new Set();
  for (const task of tasks) {
    if (!subtreeTaskIds.has(task.id)) {
      continue;
    }
    if (!isAssignedStatus(task.status)) {
      continue;
    }
    for (const coordinatorAlias of getTaskCoordinatorAliases(task)) {
      otherAliases.add(coordinatorAlias);
    }
  }

  otherAliases.delete(ownAlias);
  const aliasOptions = [
    ownAlias,
    ...Array.from(otherAliases).sort((left, right) => left.localeCompare(right, "nl-NL"))
  ];

  const visibleTasks = tasks.filter(
    (task) =>
      isAssignedStatus(task.status) &&
      subtreeTaskIds.has(task.id) &&
      taskHasCoordinator(task, selectedAlias)
  );

  return { aliasOptions, visibleTasks, subtreeTaskIds };
}

async function getTasks(cookie) {
  const result = await apiRequest("/api/tasks", { cookie });
  assertOrThrow(result.response.ok, formatApiError("Taken ophalen mislukt", result));
  return Array.isArray(result.payload?.data) ? result.payload.data : [];
}

async function deleteTask(cookie, taskId) {
  const result = await apiRequest(`/api/tasks/${taskId}`, {
    method: "DELETE",
    cookie,
    body: {}
  });
  assertOrThrow(result.response.ok, formatApiError("Cleanup: taak verwijderen mislukt", result));
}

function futureIso(minutesFromNow) {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

async function main() {
  console.log(`Start check via ${BASE_URL}`);

  let bestuur = await ensureGovernanceSession();
  console.log(`Ingelogd als ${bestuur.alias}`);

  let tasksForBestuur = await getTasks(bestuur.cookie);
  if (!tasksForBestuur.some((task) => taskHasCoordinator(task, bestuur.alias) && isAssignedStatus(task.status))) {
    const usersResult = await apiRequest("/api/users", { cookie: bestuur.cookie });
    assertOrThrow(usersResult.response.ok, formatApiError("Gebruikers ophalen mislukt", usersResult));
    const users = Array.isArray(usersResult.payload?.data) ? usersResult.payload.data : [];
    const bestuurAliases = users
      .filter((user) => user.role === "BESTUUR")
      .map((user) => user.alias)
      .filter((candidate) => candidate !== bestuur.alias);

    if (bestuurAliases.length > 0) {
      const allowlist = await loadAllowlistBondsnummers();
      const probeBonds = ["BESTUUR-SEED", ...allowlist];
      for (const alias of bestuurAliases) {
        try {
          bestuur = await loginAsKnownAliasViaBondsProbe(alias, probeBonds);
          tasksForBestuur = await getTasks(bestuur.cookie);
          if (
            tasksForBestuur.some(
              (task) => taskHasCoordinator(task, bestuur.alias) && isAssignedStatus(task.status)
            )
          ) {
            console.log(`Overgeschakeld naar bestuurssessie: ${bestuur.alias}`);
            break;
          }
        } catch {
          continue;
        }
      }
    }
  }

  assertOrThrow(
    tasksForBestuur.some((task) => taskHasCoordinator(task, bestuur.alias) && isAssignedStatus(task.status)),
    "Geen toegewezen taak gevonden voor een bruikbare bestuurssessie."
  );

  const usersResult = await apiRequest("/api/users", { cookie: bestuur.cookie });
  assertOrThrow(usersResult.response.ok, formatApiError("Gebruikers ophalen mislukt", usersResult));
  const users = Array.isArray(usersResult.payload?.data) ? usersResult.payload.data : [];

  const existingNonBestuur = users
    .map((user) => user.alias)
    .filter((candidate) => candidate !== bestuur.alias);

  const aliasA =
    existingNonBestuur[0] ??
    (await ensureMemberAlias("ChkA", new Set([bestuur.alias])));
  const aliasB =
    existingNonBestuur.find((candidate) => candidate !== aliasA) ??
    (await ensureMemberAlias("ChkB", new Set([bestuur.alias, aliasA])));

  assertOrThrow(aliasA !== aliasB, "Testaliases moeten verschillend zijn.");
  console.log(`Gebruik testleden: ${aliasA} en ${aliasB}`);

  let containerTaskId = null;

  try {
    const tasksBefore = tasksForBestuur;
    const parentTask = tasksBefore.find(
      (task) => taskHasCoordinator(task, bestuur.alias) && isAssignedStatus(task.status)
    );
    assertOrThrow(
      parentTask?.id,
      "Geen toegewezen taak gevonden voor de ingelogde gebruiker om de check onder te hangen."
    );

    const container = await createTask(bestuur.cookie, {
      title: `CHECK Assigned Filter ${RUN_ID}`,
      description: "Tijdelijke taak voor functionele filtercheck",
      teamName: "CHECK",
      parentId: parentTask.id,
      points: 10,
      date: futureIso(15),
      startTime: futureIso(15),
      endTime: futureIso(90)
    });
    containerTaskId = container.id;
    console.log(`Container-taak aangemaakt: ${container.title}`);

    const childA = await createTask(bestuur.cookie, {
      title: `CHECK Child A ${RUN_ID}`,
      description: "Wordt toegewezen aan testlid A",
      teamName: "CHECK",
      parentId: containerTaskId,
      points: 10,
      date: futureIso(20),
      startTime: futureIso(20),
      endTime: futureIso(95)
    });

    const childB = await createTask(bestuur.cookie, {
      title: `CHECK Child B ${RUN_ID}`,
      description: "Wordt toegewezen aan testlid B",
      teamName: "CHECK",
      parentId: containerTaskId,
      points: 10,
      date: futureIso(25),
      startTime: futureIso(25),
      endTime: futureIso(100)
    });

    await proposeAndAccept(bestuur.cookie, childA.id, aliasA);
    await proposeAndAccept(bestuur.cookie, childB.id, aliasB);
    console.log("Toewijzingen aangemaakt en geaccepteerd.");

    const tasksAfter = await getTasks(bestuur.cookie);

    const forAliasA = computeAssignedFilterView({
      tasks: tasksAfter,
      ownAlias: bestuur.alias,
      selectedAlias: aliasA
    });
    const forAliasB = computeAssignedFilterView({
      tasks: tasksAfter,
      ownAlias: bestuur.alias,
      selectedAlias: aliasB
    });

    assertOrThrow(forAliasA.aliasOptions[0] === bestuur.alias, "Default aliasoptie is niet de eigen alias.");
    assertOrThrow(
      forAliasA.aliasOptions.includes(aliasA),
      `Alias ${aliasA} ontbreekt in de filteropties.`
    );
    assertOrThrow(
      forAliasA.aliasOptions.includes(aliasB),
      `Alias ${aliasB} ontbreekt in de filteropties.`
    );

    assertOrThrow(
      forAliasA.visibleTasks.some((task) => task.id === childA.id),
      "Filter op alias A toont toegewezen taak A niet."
    );
    assertOrThrow(
      !forAliasA.visibleTasks.some((task) => task.id === childB.id),
      "Filter op alias A toont onterecht taak B."
    );

    assertOrThrow(
      forAliasB.visibleTasks.some((task) => task.id === childB.id),
      "Filter op alias B toont toegewezen taak B niet."
    );
    assertOrThrow(
      !forAliasB.visibleTasks.some((task) => task.id === childA.id),
      "Filter op alias B toont onterecht taak A."
    );

    assertOrThrow(
      forAliasA.visibleTasks.every(
        (task) =>
          isAssignedStatus(task.status) &&
          taskHasCoordinator(task, aliasA) &&
          forAliasA.subtreeTaskIds.has(task.id)
      ),
      "Resultaatset voor alias A bevat taken buiten de verwachte subtree/filter."
    );

    console.log("CHECK OK: toegewezen-taken aliasfilter werkt volgens API/UI-flow.");
  } finally {
    if (containerTaskId) {
      try {
        await deleteTask(bestuur.cookie, containerTaskId);
        console.log("Cleanup OK: tijdelijke check-subtree verwijderd.");
      } catch (cleanupError) {
        console.error(cleanupError);
        throw cleanupError;
      }
    }
  }
}

main().catch((error) => {
  console.error("CHECK FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
