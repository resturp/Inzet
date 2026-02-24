"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPoints, snapNearInteger } from "@/lib/points";

type ApiTask = {
  id: string;
  title: string;
  description: string;
  longDescription: string | null;
  teamName: string | null;
  parentId: string | null;
  parent: { id: string; title: string; teamName: string | null } | null;
  ownCoordinatorAliases: string[];
  coordinatorAliases: string[];
  coordinatorAlias: string | null;
  points: number;
  status: "BESCHIKBAAR" | "TOEGEWEZEN" | "GEREED";
  date: string;
  startTime: string | null;
  endTime: string;
  location: string | null;
  canRead: boolean;
  canOpen: boolean;
  canManage: boolean;
};

type ApiOpenTask = {
  id: string;
  taskId: string;
  taskTitle: string;
  teamName: string | null;
  proposerAlias: string;
  proposedAlias: string | null;
  status: "OPEN" | "AFGEWEZEN";
  canDecide: boolean;
  createdAt: string;
};

type ApiUser = {
  alias: string;
  role: "LID" | "COORDINATOR" | "BESTUUR";
};

type ApiTemplate = {
  id: string;
  title: string;
  description: string;
  parentTemplateId: string | null;
  defaultPoints: number | null;
};

type ApiAccount = {
  alias: string;
  email: string | null;
  role: "LID" | "COORDINATOR" | "BESTUUR";
  aboutMe: string | null;
  profilePhotoData: string | null;
};

type DraftSubtask = {
  title: string;
  description: string;
  teamName: string;
  points: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

type TaskStatusFilter = "BESCHIKBAAR" | "TOEGEWEZEN";
type TaskMenuView = TaskStatusFilter | "OPEN_VOORSTELLEN" | "SJABLONEN";

type TaskEditDraft = {
  title: string;
  description: string;
  longDescription: string;
  points: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
};

type ReleaseDialogTask = {
  id: string;
  title: string;
};

type DeleteDialogTask = {
  id: string;
  title: string;
  message: string;
};

type LongDescriptionDialogTask = {
  id: string;
  title: string;
  longDescription: string;
};

type CopyDateShiftUnit = "hours" | "days" | "weeks" | "months" | "years";
type CopyDateHandlingMode = "KEEP" | "SHIFT";
type CopyDateTimeHandlingPayload =
  | { mode: "KEEP" }
  | { mode: "SHIFT"; amount: number; unit: CopyDateShiftUnit };

type AccountSettingsDraft = {
  email: string;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
};

type ProfileDraft = {
  aboutMe: string;
  profilePhotoData: string | null;
};

const initialSubtask: DraftSubtask = {
  title: "",
  description: "",
  teamName: "",
  points: "10",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: ""
};

const ICON_SAVE = "🖫";
const ICON_OPEN = "✎";
const ICON_EDIT = "✎...";
const ICON_COPY = "⧉";
const ICON_DELETE = "🗑";
const ICON_MOVE = "|--\n|   |--\n|   |--\n|--";
const ICON_REGISTER = "☝︎";
const ICON_PROPOSE = "☞";
const ICON_CANCEL = "✕";
const ICON_ADD = "+";
const ICON_BACK = "↩";
const ICON_ACCEPT = "✓";
const ICON_REJECT = "✕";
const VCZ_LOGO_URL =
  "https://usercontent.one/wp/www.vczwolle.nl/wp-content/uploads/Logo-nieuw-V1-VCZ.png?media=1660898964";
const MAX_PROFILE_FILE_BYTES = 2 * 1024 * 1024;
const MOVE_ICON_STYLE = {
  whiteSpace: "pre",
  fontFamily: "monospace",
  fontSize: "0.55rem",
  lineHeight: "0.3rem",
  display: "inline-block",
  textAlign: "left",
  verticalAlign: "middle"
} as const;
const RELEASE_ICON_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.02rem",
  lineHeight: 1
} as const;
const RELEASE_ICON_LEFT_STYLE = {
  display: "inline-block",
  transform: "rotate(-32deg) translateY(-0.08rem)"
} as const;
const RELEASE_ICON_RIGHT_STYLE = {
  display: "inline-block",
  transform: "rotate(32deg) translateY(-0.08rem)"
} as const;

const COPY_SHIFT_UNITS: Array<{ value: CopyDateShiftUnit; label: string }> = [
  { value: "hours", label: "uren" },
  { value: "days", label: "dagen" },
  { value: "weeks", label: "weken" },
  { value: "months", label: "maanden" },
  { value: "years", label: "jaren" }
];

function labelForStatus(status: ApiTask["status"]): string {
  switch (status) {
    case "BESCHIKBAAR":
      return "beschikbaar";
    case "TOEGEWEZEN":
      return "toegewezen";
    case "GEREED":
      return "gereed";
  }
}

function labelForMenuView(view: TaskMenuView): string {
  switch (view) {
    case "BESCHIKBAAR":
      return "Openstaande taken";
    case "TOEGEWEZEN":
      return "Toegewezen taken";
    case "OPEN_VOORSTELLEN":
      return "Openstaande voorstellen";
    case "SJABLONEN":
      return "Sjablonen";
  }
}

function labelForOpenTaskStatus(status: ApiOpenTask["status"]): string {
  return status === "AFGEWEZEN" ? "afgewezen" : "open";
}

function renderReleaseIcon(isPending: boolean) {
  return (
    <span style={RELEASE_ICON_STYLE}>
      <span style={RELEASE_ICON_LEFT_STYLE}>☞</span>
      <span style={RELEASE_ICON_RIGHT_STYLE}>☜</span>
      {isPending ? "..." : null}
    </span>
  );
}

function isAssignedStatus(status: ApiTask["status"]): boolean {
  return status === "TOEGEWEZEN" || status === "GEREED";
}

function endsInFuture(task: ApiTask): boolean {
  const endMs = new Date(task.endTime).getTime();
  return Number.isFinite(endMs) && endMs > Date.now();
}

function parseTaskPoints(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return snapNearInteger(parsed);
}

function parseNonNegativeIntegerInput(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function uniqueSortedAliases(aliases: readonly string[]): string[] {
  return Array.from(new Set(aliases.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

function getTaskCoordinatorAliases(task: ApiTask): string[] {
  if (task.coordinatorAliases.length > 0) {
    return uniqueSortedAliases(task.coordinatorAliases);
  }
  return task.coordinatorAlias ? [task.coordinatorAlias] : [];
}

function getTaskOwnCoordinatorAliases(task: ApiTask): string[] {
  return uniqueSortedAliases(task.ownCoordinatorAliases);
}

function taskHasCoordinator(task: ApiTask, alias: string): boolean {
  return getTaskCoordinatorAliases(task).includes(alias);
}

function labelForPermission(task: ApiTask): string {
  if (task.canManage) {
    return "beheren";
  }
  if (task.canOpen || task.canRead) {
    return "lezen/openen";
  }
  return "geen";
}

function toDateValue(value: string | null): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const offsetMs = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 10);
}

function toTimeValue(value: string | null): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const offsetMs = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(11, 16);
}

function combineDateAndTime(dateValue: string, timeValue: string): string | null {
  if (!dateValue || !timeValue) {
    return null;
  }
  const parsed = new Date(`${dateValue}T${timeValue}:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function collectDescendantIds(
  rootId: string,
  childrenByParentId: Map<string, ApiTask[]>
): Set<string> {
  const descendants = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId) {
      continue;
    }

    const children = childrenByParentId.get(currentId) ?? [];
    for (const child of children) {
      if (descendants.has(child.id)) {
        continue;
      }
      descendants.add(child.id);
      stack.push(child.id);
    }
  }

  return descendants;
}

function buildTaskPath(task: ApiTask, tasksById: Map<string, ApiTask>): string[] {
  const path = [task.title];
  const visited = new Set<string>([task.id]);
  let parentId = task.parentId;

  while (parentId) {
    if (visited.has(parentId)) {
      break;
    }
    visited.add(parentId);
    const parent = tasksById.get(parentId);
    if (!parent) {
      break;
    }
    path.unshift(parent.title);
    parentId = parent.parentId;
  }

  return path;
}

function buildTaskChain(task: ApiTask, tasksById: Map<string, ApiTask>): ApiTask[] {
  const chain: ApiTask[] = [task];
  const visited = new Set<string>([task.id]);
  let parentId = task.parentId;

  while (parentId) {
    if (visited.has(parentId)) {
      break;
    }
    visited.add(parentId);
    const parent = tasksById.get(parentId);
    if (!parent) {
      break;
    }
    chain.unshift(parent);
    parentId = parent.parentId;
  }

  return chain;
}

function accountSettingsDraftFromAccount(account: ApiAccount): AccountSettingsDraft {
  return {
    email: account.email ?? "",
    currentPassword: "",
    newPassword: "",
    newPasswordConfirm: ""
  };
}

function profileDraftFromAccount(account: ApiAccount): ProfileDraft {
  return {
    aboutMe: account.aboutMe ?? "",
    profilePhotoData: account.profilePhotoData
  };
}

export function TasksClient({ alias }: { alias: string }) {
  const router = useRouter();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [openTasks, setOpenTasks] = useState<ApiOpenTask[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState<DraftSubtask>(initialSubtask);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateParentId, setTemplateParentId] = useState("");
  const [templatePoints, setTemplatePoints] = useState("10");
  const [applyTemplateId, setApplyTemplateId] = useState("");
  const [applyTeamName, setApplyTeamName] = useState("");
  const [applyParentTaskId, setApplyParentTaskId] = useState("");
  const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);
  const [taskMenuView, setTaskMenuView] = useState<TaskMenuView>("BESCHIKBAAR");
  const [didAutoOpenProposals, setDidAutoOpenProposals] = useState(false);
  const [assignedAliasFilter, setAssignedAliasFilter] = useState<string>(alias);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [creatingSubtaskForTaskId, setCreatingSubtaskForTaskId] = useState<string | null>(null);
  const [subtaskFormMode, setSubtaskFormMode] = useState<"new" | "copy">("new");
  const [copySourceTaskId, setCopySourceTaskId] = useState<string | null>(null);
  const [copyDateHandlingMode, setCopyDateHandlingMode] = useState<CopyDateHandlingMode>("KEEP");
  const [copyDateShiftAmount, setCopyDateShiftAmount] = useState("1");
  const [copyDateShiftUnit, setCopyDateShiftUnit] = useState<CopyDateShiftUnit>("days");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TaskEditDraft | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [moveTargetParentId, setMoveTargetParentId] = useState("");
  const [proposeDialogTask, setProposeDialogTask] = useState<{ id: string; title: string } | null>(null);
  const [proposeDialogAlias, setProposeDialogAlias] = useState("");
  const [registerSuccessTaskTitle, setRegisterSuccessTaskTitle] = useState<string | null>(null);
  const [releaseDialogTask, setReleaseDialogTask] = useState<ReleaseDialogTask | null>(null);
  const [deleteDialogTask, setDeleteDialogTask] = useState<DeleteDialogTask | null>(null);
  const [longDescriptionDialogTask, setLongDescriptionDialogTask] =
    useState<LongDescriptionDialogTask | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAccountSettingsDialogOpen, setIsAccountSettingsDialogOpen] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [accountSettingsDraft, setAccountSettingsDraft] = useState<AccountSettingsDraft | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [accountRole, setAccountRole] = useState<ApiAccount["role"] | null>(null);
  const [isAccountLoading, setIsAccountLoading] = useState(false);
  const [isAccountSettingsSaving, setIsAccountSettingsSaving] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [accountSettingsError, setAccountSettingsError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [accountSettingsStatus, setAccountSettingsStatus] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [subtaskPointsDraftById, setSubtaskPointsDraftById] = useState<Record<string, string>>({});
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      ),
    [tasks]
  );

  const myCoordinatedTasks = useMemo(
    () => sortedTasks.filter((task) => task.canManage),
    [sortedTasks]
  );

  const tasksById = useMemo(
    () => new Map(sortedTasks.map((task) => [task.id, task])),
    [sortedTasks]
  );

  const childrenByParentId = useMemo(() => {
    const byParent = new Map<string, ApiTask[]>();
    for (const task of sortedTasks) {
      if (!task.parentId) {
        continue;
      }
      const siblings = byParent.get(task.parentId);
      if (!siblings) {
        byParent.set(task.parentId, [task]);
        continue;
      }
      siblings.push(task);
    }
    for (const children of byParent.values()) {
      children.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    return byParent;
  }, [sortedTasks]);

  const myAssignedRootTaskIds = useMemo(
    () =>
      sortedTasks
        .filter((task) => task.canManage && isAssignedStatus(task.status))
        .map((task) => task.id),
    [sortedTasks]
  );

  const myAssignedSubtreeTaskIds = useMemo(() => {
    const ids = new Set<string>();
    const queue = [...myAssignedRootTaskIds];

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
  }, [childrenByParentId, myAssignedRootTaskIds]);

  const assignedAliasOptions = useMemo(() => {
    const aliases = new Set<string>();

    for (const task of sortedTasks) {
      if (!myAssignedSubtreeTaskIds.has(task.id) || !isAssignedStatus(task.status)) {
        continue;
      }
      const coordinatorAliases = getTaskCoordinatorAliases(task);
      for (const coordinatorAlias of coordinatorAliases) {
        aliases.add(coordinatorAlias);
      }
    }

    aliases.delete(alias);

    return [
      alias,
      ...Array.from(aliases).sort((left, right) => left.localeCompare(right, "nl-NL"))
    ];
  }, [alias, myAssignedSubtreeTaskIds, sortedTasks]);

  const manageableTaskIds = useMemo(() => {
    return new Set(
      sortedTasks
        .filter((task) => task.canManage)
        .map((task) => task.id)
    );
  }, [sortedTasks]);

  const manageableTasks = useMemo(
    () => sortedTasks.filter((task) => manageableTaskIds.has(task.id)),
    [manageableTaskIds, sortedTasks]
  );

  const canManageTemplates = useMemo(
    () =>
      myCoordinatedTasks.some(
        (task) => task.title === "Besturen vereniging" && task.parentId === null
      ),
    [myCoordinatedTasks]
  );

  const menuViews = useMemo(() => {
    const base: TaskMenuView[] = [
      "BESCHIKBAAR",
      "TOEGEWEZEN",
      "OPEN_VOORSTELLEN"
    ];
    if (canManageTemplates) {
      base.push("SJABLONEN");
    }
    return base;
  }, [canManageTemplates]);

  const isTaskListView =
    taskMenuView === "BESCHIKBAAR" ||
    taskMenuView === "TOEGEWEZEN";

  const visibleTasks = useMemo(
    () => {
      if (!isTaskListView) {
        return [];
      }
      return sortedTasks.filter((task) => {
        if (taskMenuView === "TOEGEWEZEN") {
          return (
            isAssignedStatus(task.status) &&
            myAssignedSubtreeTaskIds.has(task.id) &&
            taskHasCoordinator(task, assignedAliasFilter)
          );
        }
        return task.status === taskMenuView && endsInFuture(task);
      });
    },
    [assignedAliasFilter, isTaskListView, myAssignedSubtreeTaskIds, sortedTasks, taskMenuView]
  );

  const otherAliases = useMemo(
    () => users.map((user) => user.alias).filter((candidate) => candidate !== alias),
    [users, alias]
  );

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [tasksRes, openTasksRes, usersRes, templatesRes] = await Promise.all([
        fetch("/api/tasks", { cache: "no-store" }),
        fetch("/api/open-tasks", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/templates", { cache: "no-store" })
      ]);

      if ([tasksRes, openTasksRes, usersRes, templatesRes].some((res) => res.status === 401)) {
        router.replace("/login");
        return;
      }

      const tasksPayload = (await tasksRes.json()) as { data?: ApiTask[]; error?: string };
      const openTasksPayload = (await openTasksRes.json()) as {
        data?: ApiOpenTask[];
        error?: string;
      };
      const usersPayload = (await usersRes.json()) as { data?: ApiUser[]; error?: string };
      const templatesPayload = (await templatesRes.json()) as {
        data?: ApiTemplate[];
        error?: string;
      };

      if (!tasksRes.ok) {
        setError(tasksPayload.error ?? "Taken konden niet worden geladen.");
        return;
      }
      if (!openTasksRes.ok) {
        setError(openTasksPayload.error ?? "Open voorstellen konden niet worden geladen.");
        return;
      }
      if (!usersRes.ok) {
        setError(usersPayload.error ?? "Ledenlijst kon niet worden geladen.");
        return;
      }
      if (!templatesRes.ok) {
        setError(templatesPayload.error ?? "Sjablonen konden niet worden geladen.");
        return;
      }

      setTasks(tasksPayload.data ?? []);
      setOpenTasks(openTasksPayload.data ?? []);
      setUsers(usersPayload.data ?? []);
      setTemplates(templatesPayload.data ?? []);
      setSubtaskPointsDraftById({});
    } catch {
      setError("Netwerkfout bij laden van gegevens.");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setAssignedAliasFilter(alias);
  }, [alias]);

  useEffect(() => {
    if (!assignedAliasOptions.includes(assignedAliasFilter)) {
      setAssignedAliasFilter(alias);
    }
  }, [alias, assignedAliasFilter, assignedAliasOptions]);

  useEffect(() => {
    if (!isUserMenuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (userMenuRef.current?.contains(target)) {
        return;
      }
      setIsUserMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (!proposeDialogTask) {
      return;
    }
    if (otherAliases.length === 0) {
      setProposeDialogTask(null);
      setProposeDialogAlias("");
      return;
    }
    if (!otherAliases.includes(proposeDialogAlias)) {
      setProposeDialogAlias(otherAliases[0]);
    }
  }, [otherAliases, proposeDialogAlias, proposeDialogTask]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (deleteDialogTask) {
        if (activeTaskId !== deleteDialogTask.id) {
          setDeleteDialogTask(null);
        }
        return;
      }

      if (releaseDialogTask) {
        if (activeTaskId !== releaseDialogTask.id) {
          setReleaseDialogTask(null);
        }
        return;
      }

      if (subtaskFormMode === "copy" && creatingSubtaskForTaskId) {
        if (activeTaskId !== creatingSubtaskForTaskId) {
          setCreatingSubtaskForTaskId(null);
          setSubtaskDraft(initialSubtask);
          setSubtaskFormMode("new");
          setCopySourceTaskId(null);
          setCopyDateHandlingMode("KEEP");
          setCopyDateShiftAmount("1");
          setCopyDateShiftUnit("days");
        }
        return;
      }

      if (registerSuccessTaskTitle) {
        setRegisterSuccessTaskTitle(null);
        return;
      }

      if (proposeDialogTask) {
        setProposeDialogTask(null);
        setProposeDialogAlias("");
        return;
      }

      if (isProfileDialogOpen) {
        if (!isProfileSaving) {
          setIsProfileDialogOpen(false);
          setProfileDraft(null);
          setProfileError(null);
          setProfileStatus(null);
        }
        return;
      }

      if (isAccountSettingsDialogOpen) {
        if (!isAccountSettingsSaving) {
          setIsAccountSettingsDialogOpen(false);
          setAccountSettingsDraft(null);
          setAccountSettingsError(null);
          setAccountSettingsStatus(null);
        }
        return;
      }

      if (longDescriptionDialogTask) {
        setLongDescriptionDialogTask(null);
        return;
      }

      if (editingTaskId) {
        if (activeTaskId !== editingTaskId) {
          setEditingTaskId(null);
          setEditDraft(null);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTaskId,
    creatingSubtaskForTaskId,
    deleteDialogTask,
    editingTaskId,
    isAccountSettingsDialogOpen,
    isAccountSettingsSaving,
    isProfileDialogOpen,
    isProfileSaving,
    longDescriptionDialogTask,
    proposeDialogTask,
    registerSuccessTaskTitle,
    releaseDialogTask,
    subtaskFormMode
  ]);

  useEffect(() => {
    if (focusedTaskId && !tasksById.has(focusedTaskId)) {
      setFocusedTaskId(null);
    }
    if (creatingSubtaskForTaskId && !tasksById.has(creatingSubtaskForTaskId)) {
      setCreatingSubtaskForTaskId(null);
      setSubtaskDraft(initialSubtask);
      setSubtaskFormMode("new");
      setCopySourceTaskId(null);
      setCopyDateHandlingMode("KEEP");
      setCopyDateShiftAmount("1");
      setCopyDateShiftUnit("days");
    }
    if (editingTaskId && !tasksById.has(editingTaskId)) {
      setEditingTaskId(null);
      setEditDraft(null);
    }
    if (movingTaskId && !tasksById.has(movingTaskId)) {
      setMovingTaskId(null);
      setMoveTargetParentId("");
    }
  }, [creatingSubtaskForTaskId, editingTaskId, focusedTaskId, movingTaskId, tasksById]);

  useEffect(() => {
    if (taskMenuView === "SJABLONEN" && !canManageTemplates) {
      setTaskMenuView("BESCHIKBAAR");
    }
  }, [canManageTemplates, taskMenuView]);

  useEffect(() => {
    if (isLoading || didAutoOpenProposals) {
      return;
    }
    const hasIncomingProposal = openTasks.some((item) => item.proposedAlias === alias);
    if (hasIncomingProposal) {
      setTaskMenuView("OPEN_VOORSTELLEN");
    }
    setDidAutoOpenProposals(true);
  }, [alias, didAutoOpenProposals, isLoading, openTasks]);

  useEffect(() => {
    if (!isTaskListView && focusedTaskId) {
      setFocusedTaskId(null);
    }
  }, [focusedTaskId, isTaskListView]);

  useEffect(() => {
    if (
      taskMenuView === "TOEGEWEZEN" &&
      isTaskListView &&
      focusedTaskId &&
      !visibleTasks.some((task) => task.id === focusedTaskId)
    ) {
      setFocusedTaskId(null);
    }
  }, [focusedTaskId, isTaskListView, taskMenuView, visibleTasks]);

  function resetCopyDateDialog() {
    setCopyDateHandlingMode("KEEP");
    setCopyDateShiftAmount("1");
    setCopyDateShiftUnit("days");
  }

  async function onRegister(taskId: string) {
    const taskTitle = tasksById.get(taskId)?.title ?? taskId;
    setActiveTaskId(taskId);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Inschrijven is mislukt.");
        return;
      }
      await loadAll();
      setRegisterSuccessTaskTitle(taskTitle);
    } catch {
      setError("Netwerkfout bij inschrijven.");
    } finally {
      setActiveTaskId(null);
    }
  }

  function onRelease(taskId: string) {
    const taskTitle = tasksById.get(taskId)?.title ?? taskId;
    setReleaseDialogTask({ id: taskId, title: taskTitle });
  }

  function onCancelReleaseDialog() {
    setReleaseDialogTask(null);
  }

  async function onConfirmRelease() {
    if (!releaseDialogTask) {
      return;
    }
    const taskId = releaseDialogTask.id;
    setActiveTaskId(taskId);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Taak kon niet worden vrijgegeven.");
        return;
      }
      setReleaseDialogTask(null);
      await loadAll();
    } catch {
      setError("Netwerkfout bij vrijgeven van taak.");
    } finally {
      setActiveTaskId(null);
    }
  }

  function onStartPropose(task: ApiTask) {
    if (otherAliases.length === 0) {
      setError("Geen leden beschikbaar om aan voor te stellen.");
      return;
    }
    setError(null);
    setProposeDialogTask({ id: task.id, title: task.title });
    setProposeDialogAlias(otherAliases[0]);
  }

  function onCancelProposeDialog() {
    setProposeDialogTask(null);
    setProposeDialogAlias("");
  }

  function onCloseRegisterSuccessDialog() {
    setRegisterSuccessTaskTitle(null);
  }

  async function onConfirmPropose() {
    if (!proposeDialogTask) {
      return;
    }
    const proposedAlias = proposeDialogAlias.trim();
    if (!proposedAlias || !otherAliases.includes(proposedAlias)) {
      setError(`Kies een geldig lid uit de lijst: ${otherAliases.join(", ")}`);
      return;
    }

    setActiveTaskId(proposeDialogTask.id);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${proposeDialogTask.id}/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedAlias })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Voorstel doen is mislukt.");
        return;
      }
      setProposeDialogTask(null);
      setProposeDialogAlias("");
      await loadAll();
    } catch {
      setError("Netwerkfout bij voorstel.");
    } finally {
      setActiveTaskId(null);
    }
  }

  async function onOpenTaskDecision(openTaskId: string, action: "accept" | "reject") {
    setActiveTaskId(openTaskId);
    setError(null);
    try {
      const response = await fetch(`/api/open-tasks/${openTaskId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Actie op voorstel mislukt.");
        return;
      }
      await loadAll();
    } catch {
      setError("Netwerkfout bij verwerken van voorstel.");
    } finally {
      setActiveTaskId(null);
    }
  }

  async function onAcknowledgeRejectedOpenTask(openTaskId: string) {
    setActiveTaskId(openTaskId);
    setError(null);
    try {
      const response = await fetch(`/api/open-tasks/${openTaskId}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Melding sluiten mislukt.");
        return;
      }
      await loadAll();
    } catch {
      setError("Netwerkfout bij sluiten van melding.");
    } finally {
      setActiveTaskId(null);
    }
  }

  async function submitSubtask(
    parentTaskId: string,
    copyDateTimeHandling?: CopyDateTimeHandlingPayload
  ) {
    const draftPoints = parseNonNegativeIntegerInput(subtaskDraft.points);
    if (draftPoints === null) {
      setError("Punten moeten een geheel getal van 0 of hoger zijn.");
      return;
    }
    const startAt = combineDateAndTime(subtaskDraft.startDate, subtaskDraft.startTime);
    const endAt = combineDateAndTime(subtaskDraft.endDate, subtaskDraft.endTime);
    if (!startAt || !endAt) {
      setError("Begin- en einddatum/tijd zijn verplicht.");
      return;
    }
    setActiveTaskId(parentTaskId);
    setError(null);
    try {
      const response =
        subtaskFormMode === "copy" && copySourceTaskId
          ? await fetch(`/api/tasks/${copySourceTaskId}/copy`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                targetParentId: parentTaskId,
                dateTimeHandling: copyDateTimeHandling ?? { mode: "KEEP" },
                rootOverride: {
                  title: subtaskDraft.title,
                  description: subtaskDraft.description,
                  teamName: subtaskDraft.teamName || null,
                  points: draftPoints,
                  date: startAt,
                  startTime: startAt,
                  endTime: endAt
                }
              })
            })
          : await fetch("/api/tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: subtaskDraft.title,
                description: subtaskDraft.description,
                teamName: subtaskDraft.teamName || undefined,
                parentId: parentTaskId,
                points: draftPoints,
                date: startAt,
                startTime: startAt,
                endTime: endAt
              })
            });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Subtaak kopieren/aanmaken mislukt.");
        return;
      }
      setSubtaskDraft(initialSubtask);
      setCreatingSubtaskForTaskId(null);
      setSubtaskFormMode("new");
      setCopySourceTaskId(null);
      resetCopyDateDialog();
      await loadAll();
    } catch {
      setError("Netwerkfout bij kopieren/aanmaken subtaak.");
    } finally {
      setActiveTaskId(null);
    }
  }

  function onCreateSubtask(event: FormEvent<HTMLFormElement>, parentTaskId: string) {
    event.preventDefault();
    void submitSubtask(parentTaskId);
  }

  async function onSaveCopiedSubtask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (subtaskFormMode !== "copy" || !copySourceTaskId || !creatingSubtaskForTaskId) {
      return;
    }
    let copyDateTimeHandling: CopyDateTimeHandlingPayload = { mode: "KEEP" };
    if (copyDateHandlingMode === "SHIFT") {
      const amount = Number(copyDateShiftAmount);
      if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
        setError("Verplaatsing moet een geheel getal van 1 of hoger zijn.");
        return;
      }
      copyDateTimeHandling = {
        mode: "SHIFT",
        amount,
        unit: copyDateShiftUnit
      };
    }
    await submitSubtask(creatingSubtaskForTaskId, copyDateTimeHandling);
  }

  async function onCreateTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const defaultPoints = parseNonNegativeIntegerInput(templatePoints);
    if (defaultPoints === null) {
      setError("Standaard punten moeten een geheel getal van 0 of hoger zijn.");
      return;
    }
    setError(null);
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: templateTitle,
          description: templateDescription,
          parentTemplateId: templateParentId || undefined,
          defaultPoints
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Sjabloon aanmaken mislukt.");
        return;
      }
      setTemplateTitle("");
      setTemplateDescription("");
      setTemplateParentId("");
      setTemplatePoints("10");
      await loadAll();
    } catch {
      setError("Netwerkfout bij aanmaken sjabloon.");
    }
  }

  async function onApplyTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!applyTemplateId || !applyTeamName) {
      setError("Kies een sjabloon en teamnaam.");
      return;
    }
    setError(null);
    try {
      const response = await fetch(`/api/templates/${applyTemplateId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: applyTeamName,
          parentTaskId: applyParentTaskId || undefined,
          date: new Date().toISOString()
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Sjabloon toepassen mislukt.");
        return;
      }
      setApplyTeamName("");
      await loadAll();
    } catch {
      setError("Netwerkfout bij toepassen sjabloon.");
    }
  }

  function onOpenTask(taskId: string) {
    setError(null);
    if (taskMenuView === "TOEGEWEZEN") {
      setTaskMenuView("BESCHIKBAAR");
      setIsTaskMenuOpen(false);
    }
    setFocusedTaskId(taskId);
    setEditingTaskId(null);
    setEditDraft(null);
    setMovingTaskId(null);
    setMoveTargetParentId("");
    setCreatingSubtaskForTaskId(null);
    setSubtaskDraft(initialSubtask);
    setSubtaskFormMode("new");
    setCopySourceTaskId(null);
    resetCopyDateDialog();
  }

  function onStartSubtask(task: ApiTask, sourceTask?: ApiTask) {
    setError(null);
    setEditingTaskId(null);
    setEditDraft(null);
    setMovingTaskId(null);
    setMoveTargetParentId("");
    setCreatingSubtaskForTaskId(task.id);
    setSubtaskFormMode(sourceTask ? "copy" : "new");
    setCopySourceTaskId(sourceTask?.id ?? null);
    resetCopyDateDialog();
    if (sourceTask) {
      setSubtaskDraft({
        title: `${sourceTask.title} (kopie)`,
        description: sourceTask.description,
        teamName: sourceTask.teamName ?? task.teamName ?? "",
        points: parseTaskPoints(sourceTask.points).toString(),
        startDate: toDateValue(sourceTask.date),
        startTime: toTimeValue(sourceTask.startTime ?? sourceTask.date),
        endDate: toDateValue(sourceTask.endTime),
        endTime: toTimeValue(sourceTask.endTime)
      });
      return;
    }
    setSubtaskDraft({
      ...initialSubtask,
      teamName: task.teamName ?? "",
      startDate: toDateValue(task.date),
      startTime: toTimeValue(task.startTime ?? task.date),
      endDate: toDateValue(task.endTime),
      endTime: toTimeValue(task.endTime)
    });
  }

  function onCancelSubtask() {
    setCreatingSubtaskForTaskId(null);
    setSubtaskDraft(initialSubtask);
    setSubtaskFormMode("new");
    setCopySourceTaskId(null);
    resetCopyDateDialog();
  }

  function onStartEdit(task: ApiTask) {
    setError(null);
    setCreatingSubtaskForTaskId(null);
    setSubtaskDraft(initialSubtask);
    setSubtaskFormMode("new");
    setCopySourceTaskId(null);
    resetCopyDateDialog();
    setMovingTaskId(null);
    setMoveTargetParentId("");
    setEditingTaskId(task.id);
    setEditDraft({
      title: task.title,
      description: task.description,
      longDescription: task.longDescription ?? "",
      points: parseTaskPoints(task.points).toString(),
      startDate: toDateValue(task.date),
      startTime: toTimeValue(task.startTime ?? task.date),
      endDate: toDateValue(task.endTime),
      endTime: toTimeValue(task.endTime),
      location: task.location ?? ""
    });
  }

  function onCancelEdit() {
    setEditingTaskId(null);
    setEditDraft(null);
  }

  async function onSaveTask(event: FormEvent<HTMLFormElement>, taskId: string) {
    event.preventDefault();
    if (!editDraft) {
      return;
    }

    if (!editDraft.title.trim() || !editDraft.description.trim()) {
      setError("Titel en beschrijving zijn verplicht.");
      return;
    }
    if (!editDraft.startDate || !editDraft.startTime || !editDraft.endDate || !editDraft.endTime) {
      setError("Begindatum/tijd en einddatum/tijd zijn verplicht.");
      return;
    }
    const startAt = combineDateAndTime(editDraft.startDate, editDraft.startTime);
    const endAt = combineDateAndTime(editDraft.endDate, editDraft.endTime);
    if (!startAt || !endAt) {
      setError("Begindatum/tijd en einddatum/tijd zijn ongeldig.");
      return;
    }

    const task = tasksById.get(taskId);
    if (!task) {
      setError("Taak niet gevonden.");
      return;
    }
    const canEditOwnPoints = !task.parentId;

    let points: number | undefined;
    if (canEditOwnPoints) {
      points = Number(editDraft.points);
      if (!Number.isFinite(points) || !Number.isInteger(points) || points < 0) {
        setError("Punten moeten een geheel getal van 0 of hoger zijn.");
        return;
      }
    }

    setActiveTaskId(taskId);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editDraft.title.trim(),
          description: editDraft.description.trim(),
          longDescription: editDraft.longDescription.trim()
            ? editDraft.longDescription
            : null,
          points,
          date: startAt,
          startTime: startAt,
          endTime: endAt,
          location: editDraft.location.trim() ? editDraft.location.trim() : null
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Taak bewerken mislukt.");
        return;
      }
      setEditingTaskId(null);
      setEditDraft(null);
      await loadAll();
    } catch {
      setError("Netwerkfout bij bewerken van taak.");
    } finally {
      setActiveTaskId(null);
    }
  }

  async function onSaveSubtaskPoints(subtaskId: string, value: string, currentPoints: number) {
    const trimmedValue = value.trim();
    if (trimmedValue === "") {
      setSubtaskPointsDraftById((current) => ({
        ...current,
        [subtaskId]: currentPoints.toString()
      }));
      return;
    }

    const points = Number(trimmedValue);
    if (!Number.isFinite(points) || !Number.isInteger(points) || points < 0) {
      setError("Punten moeten een geheel getal van 0 of hoger zijn.");
      return;
    }
    if (points === currentPoints) {
      return;
    }

    setActiveTaskId(subtaskId);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${subtaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points })
      });
      const payload = (await response.json()) as { error?: string; data?: { points?: number } };
      if (!response.ok) {
        setError(payload.error ?? "Punten bijwerken mislukt.");
        return;
      }
      const savedPoints = Number(payload.data?.points);
      const nextPoints = Number.isFinite(savedPoints) ? savedPoints : points;
      setTasks((current) =>
        current.map((task) => (task.id === subtaskId ? { ...task, points: nextPoints } : task))
      );
      setSubtaskPointsDraftById((current) => ({
        ...current,
        [subtaskId]: nextPoints.toString()
      }));
    } catch {
      setError("Netwerkfout bij bijwerken van punten.");
    } finally {
      setActiveTaskId(null);
    }
  }

  function onStartMove(task: ApiTask) {
    setError(null);
    setCreatingSubtaskForTaskId(null);
    setSubtaskDraft(initialSubtask);
    setSubtaskFormMode("new");
    setCopySourceTaskId(null);
    resetCopyDateDialog();
    setEditingTaskId(null);
    setEditDraft(null);
    setMovingTaskId(task.id);

    const descendants = collectDescendantIds(task.id, childrenByParentId);
    const firstCandidate = sortedTasks.find(
      (candidate) =>
        candidate.id !== task.id &&
        !descendants.has(candidate.id) &&
        manageableTaskIds.has(candidate.id) &&
        (candidate.teamName === null || candidate.teamName === task.teamName)
    );
    setMoveTargetParentId(firstCandidate?.id ?? "");
  }

  function onCancelMove() {
    setMovingTaskId(null);
    setMoveTargetParentId("");
  }

  async function onMoveTask(taskId: string) {
    if (!moveTargetParentId) {
      setError("Kies eerst een doel-parent.");
      return;
    }
    setActiveTaskId(taskId);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetParentId: moveTargetParentId })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Taak verplaatsen mislukt.");
        return;
      }
      setMovingTaskId(null);
      setMoveTargetParentId("");
      await loadAll();
    } catch {
      setError("Netwerkfout bij verplaatsen van taak.");
    } finally {
      setActiveTaskId(null);
    }
  }

  function onDeleteTask(task: ApiTask) {
    const descendantCount = collectDescendantIds(task.id, childrenByParentId).size;
    const totalDeleteCount = descendantCount + 1;
    const confirmationText =
      totalDeleteCount > 1
        ? `Je staat op het punt ${totalDeleteCount} (sub)taken te verwijderen. Weet je zeker dat je wilt doorgaan?`
        : "Weet je zeker dat je deze taak wilt verwijderen?";
    setDeleteDialogTask({
      id: task.id,
      title: task.title,
      message: confirmationText
    });
  }

  function onCancelDeleteDialog() {
    setDeleteDialogTask(null);
  }

  async function onConfirmDeleteTask() {
    if (!deleteDialogTask) {
      return;
    }
    const taskId = deleteDialogTask.id;

    setActiveTaskId(taskId);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Taak verwijderen mislukt.");
        return;
      }
      if (focusedTaskId === taskId) {
        setFocusedTaskId(null);
      }
      if (editingTaskId === taskId) {
        setEditingTaskId(null);
        setEditDraft(null);
      }
      if (movingTaskId === taskId) {
        setMovingTaskId(null);
        setMoveTargetParentId("");
      }
      if (creatingSubtaskForTaskId === taskId) {
        setCreatingSubtaskForTaskId(null);
        setSubtaskDraft(initialSubtask);
        setSubtaskFormMode("new");
        setCopySourceTaskId(null);
        resetCopyDateDialog();
      }
      setDeleteDialogTask(null);
      await loadAll();
    } catch {
      setError("Netwerkfout bij verwijderen van taak.");
    } finally {
      setActiveTaskId(null);
    }
  }

  async function onLogout() {
    setIsUserMenuOpen(false);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  async function onOpenAccountSettingsDialog() {
    setIsUserMenuOpen(false);
    setAccountSettingsError(null);
    setAccountSettingsStatus(null);
    setIsAccountLoading(true);

    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const payload = (await response.json()) as { data?: ApiAccount; error?: string };
      if (!response.ok || !payload.data) {
        setAccountSettingsError(payload.error ?? "Account laden mislukt.");
        return;
      }

      setAccountRole(payload.data.role);
      setAccountSettingsDraft(accountSettingsDraftFromAccount(payload.data));
      setIsProfileDialogOpen(false);
      setIsAccountSettingsDialogOpen(true);
    } catch {
      setAccountSettingsError("Netwerkfout bij laden van account.");
    } finally {
      setIsAccountLoading(false);
    }
  }

  async function onOpenProfileDialog() {
    setIsUserMenuOpen(false);
    setProfileError(null);
    setProfileStatus(null);
    setIsAccountLoading(true);

    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const payload = (await response.json()) as { data?: ApiAccount; error?: string };
      if (!response.ok || !payload.data) {
        setProfileError(payload.error ?? "Profiel laden mislukt.");
        return;
      }

      setAccountRole(payload.data.role);
      setProfileDraft(profileDraftFromAccount(payload.data));
      setIsAccountSettingsDialogOpen(false);
      setIsProfileDialogOpen(true);
    } catch {
      setProfileError("Netwerkfout bij laden van profiel.");
    } finally {
      setIsAccountLoading(false);
    }
  }

  function onCloseAccountSettingsDialog() {
    if (isAccountSettingsSaving) {
      return;
    }
    setIsAccountSettingsDialogOpen(false);
    setAccountSettingsDraft(null);
    setAccountSettingsError(null);
    setAccountSettingsStatus(null);
  }

  function onCloseProfileDialog() {
    if (isProfileSaving) {
      return;
    }
    setIsProfileDialogOpen(false);
    setProfileDraft(null);
    setProfileError(null);
    setProfileStatus(null);
  }

  async function onSelectProfilePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !profileDraft) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setProfileError("Kies een afbeeldingbestand.");
      return;
    }
    if (file.size > MAX_PROFILE_FILE_BYTES) {
      setProfileError("Afbeelding is te groot (max 2MB).");
      return;
    }

    setProfileError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        setProfileError("Afbeelding verwerken mislukt.");
        return;
      }
      setProfileDraft((current) => (current ? { ...current, profilePhotoData: result } : current));
    };
    reader.onerror = () => setProfileError("Afbeelding verwerken mislukt.");
    reader.readAsDataURL(file);
  }

  async function onSaveAccountSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountSettingsDraft) {
      return;
    }

    const trimmedEmail = accountSettingsDraft.email.trim().toLowerCase();
    if (!trimmedEmail) {
      setAccountSettingsError("E-mailadres is verplicht.");
      return;
    }
    if (
      accountSettingsDraft.newPassword.length > 0 &&
      accountSettingsDraft.newPassword !== accountSettingsDraft.newPasswordConfirm
    ) {
      setAccountSettingsError("Nieuwe wachtwoorden komen niet overeen.");
      return;
    }
    if (
      accountSettingsDraft.newPassword.length > 0 &&
      accountSettingsDraft.newPassword.length < 8
    ) {
      setAccountSettingsError("Nieuw wachtwoord moet minimaal 8 tekens zijn.");
      return;
    }

    setAccountSettingsError(null);
    setAccountSettingsStatus(null);
    setIsAccountSettingsSaving(true);
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          currentPassword: accountSettingsDraft.currentPassword || undefined,
          newPassword: accountSettingsDraft.newPassword || undefined
        })
      });
      const payload = (await response.json()) as {
        data?: ApiAccount;
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        setAccountSettingsError(payload.error ?? "Opslaan mislukt.");
        return;
      }

      setAccountRole(payload.data.role);
      setAccountSettingsDraft(accountSettingsDraftFromAccount(payload.data));
      setAccountSettingsStatus(payload.message ?? "Account opgeslagen.");
    } catch {
      setAccountSettingsError("Netwerkfout bij opslaan van account.");
    } finally {
      setIsAccountSettingsSaving(false);
    }
  }

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileDraft) {
      return;
    }

    setProfileError(null);
    setProfileStatus(null);
    setIsProfileSaving(true);
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aboutMe: profileDraft.aboutMe.trim() ? profileDraft.aboutMe : null,
          profilePhotoData: profileDraft.profilePhotoData
        })
      });
      const payload = (await response.json()) as {
        data?: ApiAccount;
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        setProfileError(payload.error ?? "Opslaan mislukt.");
        return;
      }

      setAccountRole(payload.data.role);
      setIsProfileDialogOpen(false);
      setProfileDraft(null);
      setProfileError(null);
      setProfileStatus(null);
    } catch {
      setProfileError("Netwerkfout bij opslaan van profiel.");
    } finally {
      setIsProfileSaving(false);
    }
  }

  const focusedTask = focusedTaskId ? tasksById.get(focusedTaskId) ?? null : null;
  const editingTask = editingTaskId ? tasksById.get(editingTaskId) ?? null : null;
  const copySourceTask = copySourceTaskId ? tasksById.get(copySourceTaskId) ?? null : null;
  const copyTargetTask =
    subtaskFormMode === "copy" && creatingSubtaskForTaskId
      ? tasksById.get(creatingSubtaskForTaskId) ?? null
      : null;
  const copySourcePath = copySourceTask
    ? buildTaskPath(copySourceTask, tasksById).join(" > ")
    : "onbekende bron";
  const tasksToRender = focusedTask ? [focusedTask] : visibleTasks;
  const breadcrumbTasks = focusedTask
    ? (() => {
        const chain = buildTaskChain(focusedTask, tasksById);
        const firstOwnIndex = chain.findIndex((node) => manageableTaskIds.has(node.id));
        return firstOwnIndex >= 0 ? chain.slice(firstOwnIndex) : chain;
      })()
    : [];

  return (
    <div className="grid">
      <section className="card grid">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
            position: "relative",
            alignItems: "center",
            minHeight: "46px"
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => setIsTaskMenuOpen((open) => !open)}>
              {isTaskMenuOpen ? "Sluit menu" : "☰ Menu"}
            </button>
            {taskMenuView === "TOEGEWEZEN" ? (
              <p className="muted">Taken, toegewezen aan:</p>
            ) : taskMenuView === "BESCHIKBAAR" ? (
              <p className="muted">Taken, openstaand</p>
            ) : (
              <p className="muted">Weergave: {labelForMenuView(taskMenuView)}</p>
            )}
            {taskMenuView === "TOEGEWEZEN" ? (
              <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "nowrap" }}>
                <select
                  value={assignedAliasFilter}
                  onChange={(event) => {
                    setAssignedAliasFilter(event.target.value);
                    setFocusedTaskId(null);
                    setEditingTaskId(null);
                    setEditDraft(null);
                    setMovingTaskId(null);
                    setMoveTargetParentId("");
                    setCreatingSubtaskForTaskId(null);
                    setSubtaskDraft(initialSubtask);
                    setSubtaskFormMode("new");
                    setCopySourceTaskId(null);
                    resetCopyDateDialog();
                  }}
                >
                  {assignedAliasOptions.map((candidateAlias) => (
                    <option key={candidateAlias} value={candidateAlias}>
                      {candidateAlias === alias ? `${candidateAlias} (ik)` : candidateAlias}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div
            role="img"
            aria-label="VC Zwolle logo"
            style={{
              position: "absolute",
              left: "60%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "120px",
              minWidth: "120px",
              height: "46px",
              backgroundImage: `url(${VCZ_LOGO_URL})`,
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              pointerEvents: "none"
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <div ref={userMenuRef} style={{ position: "relative" }}>
              <button type="button" onClick={() => setIsUserMenuOpen((open) => !open)}>
                {alias} ▾
              </button>
              {isUserMenuOpen ? (
                <div
                  className="card"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 0.4rem)",
                    minWidth: "12rem",
                    zIndex: 40,
                    display: "grid",
                    gap: "0.35rem"
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void onOpenAccountSettingsDialog()}
                    disabled={isAccountLoading}
                  >
                    {isAccountLoading ? "Account laden..." : "Account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onOpenProfileDialog()}
                    disabled={isAccountLoading}
                  >
                    {isAccountLoading ? "Profiel laden..." : "Profiel"}
                  </button>
                  <button type="button" onClick={() => void onLogout()}>
                    Log uit
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {isTaskMenuOpen ? (
          <div className="grid">
            {menuViews.map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => {
                  setTaskMenuView(view);
                  setIsTaskMenuOpen(false);
                  setFocusedTaskId(null);
                  setEditingTaskId(null);
                  setEditDraft(null);
                  setMovingTaskId(null);
                  setMoveTargetParentId("");
                  setCreatingSubtaskForTaskId(null);
                  setSubtaskDraft(initialSubtask);
                  setSubtaskFormMode("new");
                  setCopySourceTaskId(null);
                  resetCopyDateDialog();
                }}
                disabled={taskMenuView === view}
              >
                {labelForMenuView(view)}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {error ? <p className="muted">{error}</p> : null}
      {isLoading ? <p className="muted">Gegevens laden...</p> : null}

      {taskMenuView === "OPEN_VOORSTELLEN" ? (
        <section className="card grid">
          <h2>Openstaande Voorstellen</h2>
          {openTasks.length === 0 ? (
            <p className="muted">Geen openstaande voorstellen.</p>
          ) : (
            openTasks.map((item) => (
              <article key={item.id} className="card">
                <p>
                  <strong>{item.taskTitle}</strong>
                  {item.teamName ? ` (${item.teamName})` : ""}
                </p>
                <p className="muted">
                  Van: {item.proposerAlias} | Aan: {item.proposedAlias ?? "open"} |{" "}
                  Status: {labelForOpenTaskStatus(item.status)} |{" "}
                  {new Date(item.createdAt).toLocaleString("nl-NL")}
                </p>
                {item.status === "AFGEWEZEN" ? (
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                    <p className="muted">Dit voorstel is afgewezen.</p>
                    <button
                      type="button"
                      disabled={activeTaskId === item.id}
                      onClick={() => onAcknowledgeRejectedOpenTask(item.id)}
                      title="Gezien"
                      aria-label="Gezien"
                    >
                      {activeTaskId === item.id ? `${ICON_ACCEPT}...` : ICON_ACCEPT}
                    </button>
                  </div>
                ) : item.canDecide ? (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      disabled={activeTaskId === item.id}
                      onClick={() => onOpenTaskDecision(item.id, "accept")}
                      title="Accepteren"
                      aria-label="Accepteren"
                    >
                      {ICON_ACCEPT}
                    </button>
                    <button
                      type="button"
                      disabled={activeTaskId === item.id}
                      onClick={() => onOpenTaskDecision(item.id, "reject")}
                      title="Afwijzen"
                      aria-label="Afwijzen"
                    >
                      {ICON_REJECT}
                    </button>
                  </div>
                ) : (
                  <p className="muted">Je hebt geen beslisrecht op dit voorstel.</p>
                )}
              </article>
            ))
          )}
        </section>
      ) : null}

      {taskMenuView === "SJABLONEN" && canManageTemplates ? (
        <section className="card grid">
          <h2>Sjablonen</h2>
          <form className="grid" onSubmit={onCreateTemplate}>
            <h3>Nieuw sjabloon</h3>
            <label>
              Titel
              <input
                value={templateTitle}
                onChange={(event) => setTemplateTitle(event.target.value)}
                required
              />
            </label>
            <label>
              Beschrijving
              <input
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
                required
              />
            </label>
            <label>
              Parent-sjabloon (optioneel)
              <select
                value={templateParentId}
                onChange={(event) => setTemplateParentId(event.target.value)}
              >
                <option value="">Geen parent</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Standaard punten
              <input
                type="number"
                min="0"
                step="1"
                value={templatePoints}
                onChange={(event) => setTemplatePoints(event.target.value)}
                required
              />
            </label>
            <button type="submit">Sjabloon opslaan</button>
          </form>

          <form className="grid" onSubmit={onApplyTemplate}>
            <h3>Sjabloon toepassen op team</h3>
            <label>
              Sjabloon
              <select
                value={applyTemplateId}
                onChange={(event) => setApplyTemplateId(event.target.value)}
                required
              >
                <option value="">Kies sjabloon</option>
                {templates
                  .filter((item) => item.parentTemplateId !== null)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Teamnaam
              <input
                value={applyTeamName}
                onChange={(event) => setApplyTeamName(event.target.value)}
                placeholder="bijv. Meiden A2"
                required
              />
            </label>
            <label>
              Parent-taak (optioneel)
              <select
                value={applyParentTaskId}
                onChange={(event) => setApplyParentTaskId(event.target.value)}
              >
                <option value="">Besturen vereniging</option>
                {manageableTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Pas sjabloon toe</button>
          </form>
        </section>
      ) : null}

      {isTaskListView ? (
        <section className="grid">
          {focusedTask ? (
            <section className="card grid">
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setFocusedTaskId(null)}
                  title="Terug naar lijst"
                  aria-label="Terug naar lijst"
                >
                  {ICON_BACK}
                </button>
                <p className="muted">
                  Pad:
                  {" "}
                  {breadcrumbTasks.map((node, index) => (
                    <span key={node.id}>
                      <button
                        type="button"
                        onClick={() => onOpenTask(node.id)}
                        style={{
                          background: "transparent",
                          color: "inherit",
                          padding: 0,
                          borderRadius: 0,
                          textDecoration: "underline"
                        }}
                      >
                        {node.title}
                      </button>
                      {index < breadcrumbTasks.length - 1 ? " > " : ""}
                    </span>
                  ))}
                </p>
              </div>
            </section>
          ) : null}
          {tasksToRender.length === 0 ? (
            <p className="muted">Geen taken in deze weergave.</p>
          ) : null}
          {tasksToRender.map((task) => {
          const canManageTask = manageableTaskIds.has(task.id);
          const canProposeTask =
            canManageTask && (task.status === "TOEGEWEZEN" || task.status === "BESCHIKBAAR");
          const isEditingTask = editingTaskId === task.id;
          const isMovingTask = movingTaskId === task.id;
          const isCreatingSubtask = creatingSubtaskForTaskId === task.id;
          const subtasks = childrenByParentId.get(task.id) ?? [];
          const taskOwnCoordinatorAliases = getTaskOwnCoordinatorAliases(task);
          const taskCoordinatorAliases = getTaskCoordinatorAliases(task);
          const taskPath = buildTaskPath(task, tasksById);
          const taskChain = buildTaskChain(task, tasksById);
          const parentTaskChain = taskChain.slice(0, -1);
          const descendants = isMovingTask
            ? collectDescendantIds(task.id, childrenByParentId)
            : new Set<string>();
          const moveCandidates = isMovingTask
            ? sortedTasks.filter(
                (candidate) =>
                  candidate.id !== task.id &&
                  !descendants.has(candidate.id) &&
                  manageableTaskIds.has(candidate.id) &&
                  (candidate.teamName === null || candidate.teamName === task.teamName)
              )
            : [];
          const selectedMoveParent = isMovingTask
            ? moveCandidates.find((candidate) => candidate.id === moveTargetParentId) ?? null
            : null;
          const nextPath = selectedMoveParent
            ? [...buildTaskPath(selectedMoveParent, tasksById), task.title]
            : [];
          const taskPoints = parseTaskPoints(task.points);
          const totalSubtaskPoints = subtasks.reduce(
            (sum, subtask) => sum + parseTaskPoints(subtask.points),
            0
          );
          const coordinatorSummary =
            taskOwnCoordinatorAliases.length > 0
              ? `Coordinatoren (expliciet): ${taskOwnCoordinatorAliases.join(", ")}`
              : `Coordinatoren (effectief): ${
                  taskCoordinatorAliases.length > 0 ? taskCoordinatorAliases.join(", ") : "-"
                }`;
          const availableTaskPoints = taskPoints - totalSubtaskPoints;
          const pointsPerCoordinator =
            taskCoordinatorAliases.length > 0
              ? availableTaskPoints / taskCoordinatorAliases.length
              : availableTaskPoints;
          const canManageTaskParent = task.parentId ? manageableTaskIds.has(task.parentId) : false;
          const canMoveTask = canManageTaskParent;
          const canDeleteTask = canManageTaskParent;
          const canRegisterTask = task.canOpen && task.status === "BESCHIKBAAR" && !isCreatingSubtask;
          const canReleaseTask = canManageTask && task.status === "TOEGEWEZEN";
          const showInlineTaskActions = canRegisterTask || canReleaseTask || canProposeTask;
          const isOpenTasksListView = taskMenuView === "BESCHIKBAAR" && !focusedTaskId;
          const pointsLines = isOpenTasksListView
            ? [`Aantal punten: ${formatPoints(availableTaskPoints)}`]
            : [
                `Punten (eigen): ${formatPoints(taskPoints)}`,
                `Uitgegeven subtaken: ${formatPoints(totalSubtaskPoints)}`,
                `Beschikbaar: ${formatPoints(availableTaskPoints)}`,
                `Per coordinator: ${formatPoints(pointsPerCoordinator)}`
              ];
          const infoPanelStyle = {
            display: "grid",
            rowGap: "0.15rem",
            background: "#eaf1fb",
            borderRadius: "10px",
            padding: "0.5rem 0.75rem"
          } as const;
          const infoLineStyle = {
            margin: 0,
            minHeight: "2.05rem",
            display: "flex",
            alignItems: "center",
            lineHeight: 1.15
          } as const;

          return (
            <article key={task.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>{task.title}</h2>
                {task.longDescription?.trim() ? (
                  <button
                    type="button"
                    onClick={() =>
                      setLongDescriptionDialogTask({
                        id: task.id,
                        title: task.title,
                        longDescription: task.longDescription ?? ""
                      })
                    }
                    style={{
                      width: "1.8rem",
                      minHeight: "1.8rem",
                      borderRadius: "999px",
                      padding: 0,
                      fontWeight: 700
                    }}
                    title="Lange beschrijving"
                    aria-label="Lange beschrijving"
                  >
                    i
                  </button>
                ) : null}
              </div>
              {parentTaskChain.length > 0 ? (
                <p className="muted" style={{ marginTop: "-0.35rem" }}>
                  {parentTaskChain.map((node, index) => (
                    <span key={node.id}>
                      <button
                        type="button"
                        onClick={() => onOpenTask(node.id)}
                        style={{
                          background: "transparent",
                          color: "inherit",
                          padding: 0,
                          borderRadius: 0,
                          textDecoration: "underline"
                        }}
                      >
                        {node.title}
                      </button>
                      {index < parentTaskChain.length - 1 ? " > " : ""}
                    </span>
                  ))}
                </p>
              ) : null}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.85rem",
                  flexWrap: "wrap"
                }}
              >
                <div style={{ ...infoPanelStyle, minWidth: 0, flex: "1 1 18rem" }}>
                  <p className="muted" style={infoLineStyle}>
                    {task.description}
                  </p>
                  <p className="muted" style={infoLineStyle}>
                    {coordinatorSummary} | Status: {labelForStatus(task.status)}
                  </p>
                  <p className="muted" style={infoLineStyle}>
                    Jouw recht: {labelForPermission(task)}
                  </p>
                  <p className="muted" style={infoLineStyle}>
                    Start: {new Date(task.date).toLocaleString("nl-NL")} | Einde:{" "}
                    {new Date(task.endTime).toLocaleString("nl-NL")}
                  </p>
                </div>
                <div
                  style={{
                    ...infoPanelStyle,
                    marginLeft: "auto",
                    justifyItems: "end",
                    textAlign: "right"
                  }}
                >
                  {pointsLines.map((line) => (
                    <p key={line} className="muted" style={{ ...infoLineStyle, justifyContent: "flex-end" }}>
                      {line}
                    </p>
                  ))}
                </div>
              </div>

              <div
                style={{
                  marginTop: "0.4rem",
                  display: "inline-grid",
                  gridAutoFlow: "column",
                  columnGap: "0.5rem",
                  alignItems: "center",
                  width: "max-content",
                  maxWidth: "100%",
                  overflowX: "auto"
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  disabled={focusedTaskId === task.id || !task.canOpen}
                  style={{ whiteSpace: "nowrap" }}
                  title="Open"
                  aria-label="Open"
                >
                  {ICON_OPEN}
                </button>
                {canManageTask ? (
                  <button
                    type="button"
                    onClick={() => onStartEdit(task)}
                    disabled={activeTaskId === task.id || isEditingTask}
                    style={{ whiteSpace: "nowrap" }}
                    title="Bewerk"
                    aria-label="Bewerk"
                  >
                    {ICON_EDIT}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onStartMove(task)}
                  disabled={activeTaskId === task.id || isMovingTask || !canMoveTask}
                  style={{ whiteSpace: "nowrap" }}
                  title="Verplaats"
                  aria-label="Verplaats"
                >
                  <span style={MOVE_ICON_STYLE}>{ICON_MOVE}</span>
                </button>
                {canDeleteTask ? (
                  <button
                    type="button"
                    onClick={() => onDeleteTask(task)}
                    disabled={activeTaskId === task.id}
                    style={{ whiteSpace: "nowrap" }}
                    title="Verwijder"
                    aria-label="Verwijder"
                  >
                    {activeTaskId === task.id ? `${ICON_DELETE}...` : ICON_DELETE}
                  </button>
                ) : null}
                {isOpenTasksListView && canRegisterTask ? (
                  <button
                    type="button"
                    onClick={() => onRegister(task.id)}
                    disabled={activeTaskId === task.id}
                    style={{ whiteSpace: "nowrap" }}
                    title="Schrijf in"
                    aria-label="Schrijf in"
                  >
                    {activeTaskId === task.id ? `${ICON_REGISTER}...` : ICON_REGISTER}
                  </button>
                ) : null}
                {isOpenTasksListView && canProposeTask ? (
                  <button
                    type="button"
                    onClick={() => onStartPropose(task)}
                    disabled={activeTaskId === task.id}
                    style={{ whiteSpace: "nowrap" }}
                    title="Stel voor"
                    aria-label="Stel voor"
                  >
                    {activeTaskId === task.id ? `${ICON_PROPOSE}...` : ICON_PROPOSE}
                  </button>
                ) : null}
              </div>

              {isMovingTask ? (
                <div className="grid">
                  <h3>Taak verplaatsen</h3>
                  <p className="muted">
                    Alleen parents waarop je beheersrechten hebt en met hetzelfde team of zonder team zijn toegestaan.
                  </p>
                  <p className="muted">Huidige context: {taskPath.join(" > ")}</p>
                  {moveCandidates.length === 0 ? (
                    <p className="muted">
                      Geen geldige parent beschikbaar voor deze taak binnen dezelfde eigenaar/team.
                    </p>
                  ) : (
                    <>
                      <label>
                        Nieuwe parent
                        <select
                          value={moveTargetParentId}
                          onChange={(event) => setMoveTargetParentId(event.target.value)}
                          required
                        >
                          {moveCandidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {buildTaskPath(candidate, tasksById).join(" > ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedMoveParent ? (
                        <p className="muted">Nieuwe context: {nextPath.join(" > ")}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onMoveTask(task.id)}
                        disabled={activeTaskId === task.id || !moveTargetParentId}
                        title="Verplaats"
                        aria-label="Verplaats"
                      >
                        <span style={MOVE_ICON_STYLE}>
                          {activeTaskId === task.id ? `${ICON_MOVE}\n...` : ICON_MOVE}
                        </span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={onCancelMove}
                    disabled={activeTaskId === task.id}
                    title="Sluit verplaatsen"
                    aria-label="Sluit verplaatsen"
                  >
                    {ICON_CANCEL}
                  </button>
                </div>
              ) : null}

              {isMovingTask || isOpenTasksListView ? null : (
                <>
                  <div className="grid" style={{ gap: "0.5rem" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "0.5rem",
                        flexWrap: "wrap"
                      }}
                    >
                      <p className="muted">Subtaken ({subtasks.length})</p>
                      {canManageTask ? (
                        <button
                          type="button"
                          onClick={() =>
                            isCreatingSubtask ? onCancelSubtask() : onStartSubtask(task)
                          }
                          disabled={activeTaskId === task.id}
                          title={isCreatingSubtask ? "Subtaakformulier sluiten" : "Subtaak toevoegen"}
                          aria-label={isCreatingSubtask ? "Subtaakformulier sluiten" : "Subtaak toevoegen"}
                        >
                          {isCreatingSubtask ? ICON_CANCEL : ICON_ADD}
                        </button>
                      ) : null}
                    </div>

                    {subtasks.length === 0 ? (
                      <p className="muted">Nog geen subtaken.</p>
                    ) : (
                      <>
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: 0,
                            listStyle: "none",
                            display: "grid",
                            gap: "0.35rem"
                          }}
                        >
                          {subtasks.map((subtask) => {
                            const canManageSubtaskFromParent = canManageTask;
                            const canDeleteSubtask =
                              canManageSubtaskFromParent && subtask.parentId !== null;
                            const canCopySubtask = canManageSubtaskFromParent;
                            const subtaskCurrentPoints = parseTaskPoints(subtask.points);
                            const subtaskPointsDraft =
                              subtaskPointsDraftById[subtask.id] ??
                              subtaskCurrentPoints.toString();
                            const subtaskOwnCoordinatorAliases = getTaskOwnCoordinatorAliases(subtask);
                            const subtaskCoordinatorLabel =
                              subtaskOwnCoordinatorAliases.length > 0
                                ? subtaskOwnCoordinatorAliases.join(", ")
                                : "-";
                            const subtaskListMiddleLabel =
                              subtask.status === "BESCHIKBAAR"
                                ? labelForStatus(subtask.status)
                                : subtaskCoordinatorLabel;
                            return (
                              <li
                                key={subtask.id}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: "0.75rem",
                                  flexWrap: "wrap"
                                }}
                              >
                                <span>
                                  • {subtask.title} | {subtaskListMiddleLabel} |{" "}
                                  {new Date(subtask.date).toLocaleDateString("nl-NL")}
                                </span>
                                <span
                                  style={{
                                    display: "flex",
                                    gap: "0.35rem",
                                    justifyContent: "flex-end",
                                    flexWrap: "wrap",
                                    alignItems: "center"
                                  }}
                                >
                                  {canManageSubtaskFromParent ? (
                                    <>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        style={{ width: "4.75rem" }}
                                        value={subtaskPointsDraft}
                                        disabled={activeTaskId === subtask.id}
                                        onChange={(event) =>
                                          setSubtaskPointsDraftById((current) => ({
                                            ...current,
                                            [subtask.id]: event.target.value
                                          }))
                                        }
                                        onBlur={(event) =>
                                          void onSaveSubtaskPoints(
                                            subtask.id,
                                            event.currentTarget.value,
                                            subtaskCurrentPoints
                                          )
                                        }
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.preventDefault();
                                            event.currentTarget.blur();
                                          }
                                        }}
                                      />
                                    </>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => onOpenTask(subtask.id)}
                                    disabled={!subtask.canOpen}
                                    title="Open"
                                    aria-label="Open"
                                  >
                                    {ICON_OPEN}
                                  </button>
                                  {canCopySubtask ? (
                                    <button
                                      type="button"
                                      onClick={() => onStartSubtask(task, subtask)}
                                      disabled={activeTaskId === subtask.id}
                                      title="Kopieer"
                                      aria-label="Kopieer"
                                    >
                                      {ICON_COPY}
                                    </button>
                                  ) : null}
                                  {canDeleteSubtask ? (
                                    <button
                                      type="button"
                                      onClick={() => onDeleteTask(subtask)}
                                      disabled={activeTaskId === subtask.id}
                                      title="Verwijder"
                                      aria-label="Verwijder"
                                    >
                                      {activeTaskId === subtask.id
                                        ? `${ICON_DELETE}...`
                                        : ICON_DELETE}
                                    </button>
                                  ) : null}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="muted">
                          Totaal punten subtaken: {formatPoints(totalSubtaskPoints)}
                        </p>
                      </>
                    )}

                    {isCreatingSubtask && subtaskFormMode === "new" ? (
                      <form className="grid" onSubmit={(event) => onCreateSubtask(event, task.id)}>
                        <h3>Nieuwe subtaak</h3>
                        <label>
                          Titel
                          <input
                            value={subtaskDraft.title}
                            onChange={(event) =>
                              setSubtaskDraft((current) => ({
                                ...current,
                                title: event.target.value
                              }))
                            }
                            required
                          />
                        </label>
                        <label>
                          Beschrijving
                          <input
                            value={subtaskDraft.description}
                            onChange={(event) =>
                              setSubtaskDraft((current) => ({
                                ...current,
                                description: event.target.value
                              }))
                            }
                            required
                          />
                        </label>
                        <label>
                          Team (optioneel)
                          <input
                            value={subtaskDraft.teamName}
                            onChange={(event) =>
                              setSubtaskDraft((current) => ({
                                ...current,
                                teamName: event.target.value
                              }))
                            }
                            placeholder="bijv. Meiden A2"
                          />
                        </label>
                        <label>
                          Punten
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={subtaskDraft.points}
                            onChange={(event) =>
                              setSubtaskDraft((current) => ({
                                ...current,
                                points: event.target.value
                              }))
                            }
                            required
                          />
                        </label>
                        <label>
                          Begindatum
                          <input
                            type="date"
                            value={subtaskDraft.startDate}
                            onChange={(event) =>
                              setSubtaskDraft((current) => ({
                                ...current,
                                startDate: event.target.value
                              }))
                            }
                            required
                          />
                        </label>
                        <label>
                          Begintijd
                          <input
                            type="time"
                            value={subtaskDraft.startTime}
                            onChange={(event) =>
                              setSubtaskDraft((current) => ({
                                ...current,
                                startTime: event.target.value
                              }))
                            }
                            required
                          />
                        </label>
                        <label>
                          Einddatum
                          <input
                            type="date"
                            value={subtaskDraft.endDate}
                            onChange={(event) =>
                              setSubtaskDraft((current) => ({
                                ...current,
                                endDate: event.target.value
                              }))
                            }
                            required
                          />
                        </label>
                        <label>
                          Eindtijd
                          <input
                            type="time"
                            value={subtaskDraft.endTime}
                            onChange={(event) =>
                              setSubtaskDraft((current) => ({
                                ...current,
                                endTime: event.target.value
                              }))
                            }
                            required
                          />
                        </label>
                        <div
                          style={{
                            display: "flex",
                            gap: "0.5rem",
                            flexWrap: "nowrap",
                            alignItems: "center"
                          }}
                        >
                          <button
                            type="submit"
                            disabled={activeTaskId === task.id}
                            style={{ whiteSpace: "nowrap" }}
                            title="Opslaan"
                            aria-label="Opslaan"
                          >
                            {activeTaskId === task.id
                              ? `${ICON_SAVE}...`
                              : "Subtaak aanmaken"}
                          </button>
                          <button
                            type="button"
                            onClick={onCancelSubtask}
                            disabled={activeTaskId === task.id}
                            style={{ whiteSpace: "nowrap" }}
                            title="Annuleren"
                            aria-label="Annuleren"
                          >
                            {ICON_CANCEL}
                          </button>
                          {task.status === "BESCHIKBAAR" ? (
                            <button
                              type="button"
                              onClick={() => onRegister(task.id)}
                              disabled={activeTaskId === task.id}
                              style={{ whiteSpace: "nowrap" }}
                              title="Schrijf in"
                              aria-label="Schrijf in"
                            >
                              {activeTaskId === task.id ? `${ICON_REGISTER}...` : ICON_REGISTER}
                            </button>
                          ) : null}
                        </div>
                      </form>
                    ) : null}
                  </div>

                  {!isOpenTasksListView &&
                  showInlineTaskActions &&
                  !(isCreatingSubtask && subtaskFormMode === "copy") ? (
                    <div
                      style={{
                        display: "inline-grid",
                        gridAutoFlow: "column",
                        columnGap: "0.5rem",
                        alignItems: "center",
                        width: "max-content",
                        maxWidth: "100%",
                        overflowX: "auto"
                      }}
                    >
                      {canRegisterTask ? (
                        <button
                          type="button"
                          onClick={() => onRegister(task.id)}
                          disabled={activeTaskId === task.id}
                          style={{ whiteSpace: "nowrap" }}
                          title="Schrijf in"
                          aria-label="Schrijf in"
                        >
                          {activeTaskId === task.id ? `${ICON_REGISTER}...` : ICON_REGISTER}
                        </button>
                      ) : null}

                      {canReleaseTask ? (
                        <button
                          type="button"
                          onClick={() => onRelease(task.id)}
                          disabled={activeTaskId === task.id}
                          style={{ whiteSpace: "nowrap" }}
                          title="Stel beschikbaar"
                          aria-label="Stel beschikbaar"
                        >
                          {renderReleaseIcon(activeTaskId === task.id)}
                        </button>
                      ) : null}

                      {canProposeTask ? (
                        <button
                          type="button"
                          onClick={() => onStartPropose(task)}
                          disabled={activeTaskId === task.id}
                          style={{ whiteSpace: "nowrap" }}
                          title="Stel voor"
                          aria-label="Stel voor"
                        >
                          {activeTaskId === task.id ? `${ICON_PROPOSE}...` : ICON_PROPOSE}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </article>
          );
          })}
        </section>
      ) : null}

      {editingTask && editDraft ? (
        <div
          onClick={activeTaskId === editingTask.id ? undefined : onCancelEdit}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <form
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Taak bewerken"
            onSubmit={(event) => onSaveTask(event, editingTask.id)}
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "38rem", margin: "8vh auto 0 auto" }}
          >
            <h3>Taak bewerken</h3>
            <label>
              Titel
              <input
                value={editDraft.title}
                onChange={(event) =>
                  setEditDraft((current) => (current ? { ...current, title: event.target.value } : current))
                }
                required
              />
            </label>
            <label>
              Beschrijving
              <input
                value={editDraft.description}
                onChange={(event) =>
                  setEditDraft((current) =>
                    current ? { ...current, description: event.target.value } : current
                  )
                }
                required
              />
            </label>
            <label>
              Lange beschrijving
              <textarea
                rows={6}
                value={editDraft.longDescription}
                onChange={(event) =>
                  setEditDraft((current) =>
                    current ? { ...current, longDescription: event.target.value } : current
                  )
                }
                placeholder="Vul uitgebreide informatie in."
                disabled={activeTaskId === editingTask.id}
              />
            </label>
            {!editingTask.parentId ? (
              <label>
                Punten
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={editDraft.points}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current ? { ...current, points: event.target.value } : current
                    )
                  }
                  required
                />
              </label>
            ) : null}
            <div className="grid grid-2">
              <label>
                Begindatum
                <input
                  type="date"
                  value={editDraft.startDate}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current ? { ...current, startDate: event.target.value } : current
                    )
                  }
                  required
                />
              </label>
              <label>
                Begintijd
                <input
                  type="time"
                  value={editDraft.startTime}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current ? { ...current, startTime: event.target.value } : current
                    )
                  }
                  required
                />
              </label>
              <label>
                Einddatum
                <input
                  type="date"
                  value={editDraft.endDate}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current ? { ...current, endDate: event.target.value } : current
                    )
                  }
                  required
                />
              </label>
              <label>
                Eindtijd
                <input
                  type="time"
                  value={editDraft.endTime}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current ? { ...current, endTime: event.target.value } : current
                    )
                  }
                  required
                />
              </label>
            </div>
            <label>
              Locatie (optioneel)
              <input
                value={editDraft.location}
                onChange={(event) =>
                  setEditDraft((current) =>
                    current ? { ...current, location: event.target.value } : current
                  )
                }
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={onCancelEdit}
                disabled={activeTaskId === editingTask.id}
                title="Annuleren"
                aria-label="Annuleren"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={activeTaskId === editingTask.id}
                title="Opslaan"
                aria-label="Opslaan"
              >
                {activeTaskId === editingTask.id ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {longDescriptionDialogTask ? (
        <div
          onClick={() => setLongDescriptionDialogTask(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <div
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Lange beschrijving taak"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "42rem", margin: "8vh auto 0 auto", maxHeight: "80vh", overflowY: "auto" }}
          >
            <h3 style={{ marginBottom: 0 }}>{longDescriptionDialogTask.title}</h3>
            <div className="card" style={{ padding: "0.75rem" }}>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                  lineHeight: 1.4
                }}
              >
                {longDescriptionDialogTask.longDescription}
              </pre>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setLongDescriptionDialogTask(null)}>
                Sluiten
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAccountSettingsDialogOpen && accountSettingsDraft ? (
        <div
          onClick={isAccountSettingsSaving ? undefined : onCloseAccountSettingsDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <form
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Account bewerken"
            onSubmit={(event) => void onSaveAccountSettings(event)}
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "34rem", margin: "8vh auto 0 auto" }}
          >
            <h3>Account</h3>
            <p className="muted" style={{ margin: 0 }}>
              Alias: {alias} | Rol: {accountRole ?? "-"}
            </p>
            {accountSettingsError ? <p className="muted">{accountSettingsError}</p> : null}
            {accountSettingsStatus ? <p className="muted">{accountSettingsStatus}</p> : null}

            <label>
              E-mailadres
              <input
                type="email"
                value={accountSettingsDraft.email}
                onChange={(event) =>
                  setAccountSettingsDraft((current) =>
                    current ? { ...current, email: event.target.value } : current
                  )
                }
                required
              />
            </label>

            <label>
              Huidig wachtwoord (verplicht bij e-mail/wachtwoord wijzigen)
              <input
                type="password"
                value={accountSettingsDraft.currentPassword}
                onChange={(event) =>
                  setAccountSettingsDraft((current) =>
                    current ? { ...current, currentPassword: event.target.value } : current
                  )
                }
              />
            </label>

            <label>
              Nieuw wachtwoord (optioneel)
              <input
                type="password"
                value={accountSettingsDraft.newPassword}
                onChange={(event) =>
                  setAccountSettingsDraft((current) =>
                    current ? { ...current, newPassword: event.target.value } : current
                  )
                }
              />
            </label>

            <label>
              Bevestig nieuw wachtwoord
              <input
                type="password"
                value={accountSettingsDraft.newPasswordConfirm}
                onChange={(event) =>
                  setAccountSettingsDraft((current) =>
                    current ? { ...current, newPasswordConfirm: event.target.value } : current
                  )
                }
              />
            </label>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={onCloseAccountSettingsDialog}
                disabled={isAccountSettingsSaving}
              >
                Annuleren
              </button>
              <button type="submit" disabled={isAccountSettingsSaving}>
                {isAccountSettingsSaving ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isProfileDialogOpen && profileDraft ? (
        <div
          onClick={isProfileSaving ? undefined : onCloseProfileDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <form
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Profiel bewerken"
            onSubmit={(event) => void onSaveProfile(event)}
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "34rem", margin: "8vh auto 0 auto" }}
          >
            <h3>Profiel</h3>
            <p className="muted" style={{ margin: 0 }}>
              Alias: {alias} | Rol: {accountRole ?? "-"}
            </p>
            {profileError ? <p className="muted">{profileError}</p> : null}
            {profileStatus ? <p className="muted">{profileStatus}</p> : null}

            <div className="grid">
              <label>
                Profielfoto uploaden
                <input type="file" accept="image/*" onChange={onSelectProfilePhoto} />
              </label>
              <div className="card" style={{ padding: "0.75rem" }}>
                {profileDraft.profilePhotoData ? (
                  <Image
                    src={profileDraft.profilePhotoData}
                    alt="Profielfoto"
                    width={120}
                    height={120}
                    unoptimized
                    style={{ borderRadius: "12px", objectFit: "cover" }}
                  />
                ) : (
                  <p className="muted">Nog geen profielfoto.</p>
                )}
                {profileDraft.profilePhotoData ? (
                  <div style={{ marginTop: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={() =>
                        setProfileDraft((current) =>
                          current ? { ...current, profilePhotoData: null } : current
                        )
                      }
                      disabled={isProfileSaving}
                    >
                      Verwijder foto
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <label>
              Wie ben ik
              <textarea
                rows={6}
                value={profileDraft.aboutMe}
                onChange={(event) =>
                  setProfileDraft((current) =>
                    current ? { ...current, aboutMe: event.target.value } : current
                  )
                }
                placeholder="Vertel iets over jezelf."
                disabled={isProfileSaving}
              />
            </label>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" onClick={onCloseProfileDialog} disabled={isProfileSaving}>
                Annuleren
              </button>
              <button type="submit" disabled={isProfileSaving}>
                {isProfileSaving ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {proposeDialogTask ? (
        <div
          onClick={onCancelProposeDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <div
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Stel taak voor aan lid"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "34rem", margin: "8vh auto 0 auto" }}
          >
            <h3>Stel taak voor aan lid</h3>
            <p>
              Welk lid wil je voorstellen voor de taak: <strong>{proposeDialogTask.title}</strong>?
            </p>
            <label>
              Lid
              <select
                value={proposeDialogAlias}
                onChange={(event) => setProposeDialogAlias(event.target.value)}
              >
                {otherAliases.map((candidateAlias) => (
                  <option key={candidateAlias} value={candidateAlias}>
                    {candidateAlias}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={onCancelProposeDialog}
                disabled={activeTaskId === proposeDialogTask.id}
                title="Annuleren"
                aria-label="Annuleren"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={onConfirmPropose}
                disabled={activeTaskId === proposeDialogTask.id || !proposeDialogAlias}
                title="OK"
                aria-label="OK"
              >
                {activeTaskId === proposeDialogTask.id ? "OK..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {registerSuccessTaskTitle ? (
        <div
          onClick={onCloseRegisterSuccessDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <div
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Inschrijving ontvangen"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "34rem", margin: "8vh auto 0 auto" }}
          >
            <h3>Inschrijving ontvangen</h3>
            <p>
              Dank voor je inschrijving op de taak: <strong>{registerSuccessTaskTitle}</strong>.
              Zodra een coordinator je inschrijving accepteert kun je aan de slag.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onCloseRegisterSuccessDialog}
                title="Ok"
                aria-label="Ok"
              >
                Ok
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {copyTargetTask && copySourceTask ? (
        <div
          onClick={activeTaskId === copyTargetTask.id ? undefined : onCancelSubtask}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <form
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Taak kopieren"
            onSubmit={(event) => void onSaveCopiedSubtask(event)}
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "36rem", margin: "8vh auto 0 auto" }}
          >
            <h3>Kopieer taak {copySourcePath}</h3>
            <label>
              Titel
              <input
                value={subtaskDraft.title}
                onChange={(event) =>
                  setSubtaskDraft((current) => ({
                    ...current,
                    title: event.target.value
                  }))
                }
                disabled={activeTaskId === copyTargetTask.id}
                required
              />
            </label>
            <label>
              Beschrijving
              <input
                value={subtaskDraft.description}
                onChange={(event) =>
                  setSubtaskDraft((current) => ({
                    ...current,
                    description: event.target.value
                  }))
                }
                disabled={activeTaskId === copyTargetTask.id}
                required
              />
            </label>
            <label>
              Team (optioneel)
              <input
                value={subtaskDraft.teamName}
                onChange={(event) =>
                  setSubtaskDraft((current) => ({
                    ...current,
                    teamName: event.target.value
                  }))
                }
                disabled={activeTaskId === copyTargetTask.id}
                placeholder="bijv. Meiden A2"
              />
            </label>
            <label>
              Punten
              <input
                type="number"
                min="0"
                step="1"
                value={subtaskDraft.points}
                onChange={(event) =>
                  setSubtaskDraft((current) => ({
                    ...current,
                    points: event.target.value
                  }))
                }
                disabled={activeTaskId === copyTargetTask.id}
                required
              />
            </label>
            <label>
              Begin
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="date"
                  value={subtaskDraft.startDate}
                  onChange={(event) =>
                    setSubtaskDraft((current) => ({
                      ...current,
                      startDate: event.target.value
                    }))
                  }
                  disabled={activeTaskId === copyTargetTask.id}
                  required
                />
                <input
                  type="time"
                  value={subtaskDraft.startTime}
                  onChange={(event) =>
                    setSubtaskDraft((current) => ({
                      ...current,
                      startTime: event.target.value
                    }))
                  }
                  disabled={activeTaskId === copyTargetTask.id}
                  required
                />
              </div>
            </label>
            <label>
              Eind
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="date"
                  value={subtaskDraft.endDate}
                  onChange={(event) =>
                    setSubtaskDraft((current) => ({
                      ...current,
                      endDate: event.target.value
                    }))
                  }
                  disabled={activeTaskId === copyTargetTask.id}
                  required
                />
                <input
                  type="time"
                  value={subtaskDraft.endTime}
                  onChange={(event) =>
                    setSubtaskDraft((current) => ({
                      ...current,
                      endTime: event.target.value
                    }))
                  }
                  disabled={activeTaskId === copyTargetTask.id}
                  required
                />
              </div>
            </label>
            <div className="grid" style={{ gap: "0.4rem" }}>
              <p className="muted">Datums/tijden van de kopie:</p>
              <div style={{ display: "flex", gap: "0.85rem", flexWrap: "wrap" }}>
                <label
                  style={{
                    display: "inline-flex",
                    gap: "0.35rem",
                    alignItems: "center",
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  <input
                    type="radio"
                    name="copy-date-handling"
                    checked={copyDateHandlingMode === "KEEP"}
                    onChange={() => setCopyDateHandlingMode("KEEP")}
                    disabled={activeTaskId === copyTargetTask.id}
                    style={{ width: "auto", margin: 0 }}
                  />
                  Laat staan
                </label>
                <label
                  style={{
                    display: "inline-flex",
                    gap: "0.35rem",
                    alignItems: "center",
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  <input
                    type="radio"
                    name="copy-date-handling"
                    checked={copyDateHandlingMode === "SHIFT"}
                    onChange={() => setCopyDateHandlingMode("SHIFT")}
                    disabled={activeTaskId === copyTargetTask.id}
                    style={{ width: "auto", margin: 0 }}
                  />
                  Verplaats
                </label>
              </div>
              {copyDateHandlingMode === "SHIFT" ? (
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    flexWrap: "wrap"
                  }}
                >
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={copyDateShiftAmount}
                    onChange={(event) => setCopyDateShiftAmount(event.target.value)}
                    disabled={activeTaskId === copyTargetTask.id}
                    style={{ width: "6rem" }}
                  />
                  <select
                    value={copyDateShiftUnit}
                    onChange={(event) =>
                      setCopyDateShiftUnit(event.target.value as CopyDateShiftUnit)
                    }
                    disabled={activeTaskId === copyTargetTask.id}
                  >
                    {COPY_SHIFT_UNITS.map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                  <span className="muted">vooruit</span>
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={onCancelSubtask}
                disabled={activeTaskId === copyTargetTask.id}
              >
                Annuleren
              </button>
              <button type="submit" disabled={activeTaskId === copyTargetTask.id}>
                {activeTaskId === copyTargetTask.id ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {releaseDialogTask ? (
        <div
          onClick={activeTaskId === releaseDialogTask.id ? undefined : onCancelReleaseDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <div
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Stel beschikbaar bevestigen"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "34rem", margin: "8vh auto 0 auto" }}
          >
            <h3>Stel beschikbaar</h3>
            <p>
              Weet je zeker dat je wil stoppen met: <strong>{releaseDialogTask.title}</strong>?
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={onCancelReleaseDialog}
                disabled={activeTaskId === releaseDialogTask.id}
                title="Nee"
                aria-label="Nee"
              >
                Nee
              </button>
              <button
                type="button"
                onClick={onConfirmRelease}
                disabled={activeTaskId === releaseDialogTask.id}
                title="Ja"
                aria-label="Ja"
              >
                {activeTaskId === releaseDialogTask.id ? "Ja..." : "Ja"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialogTask ? (
        <div
          onClick={activeTaskId === deleteDialogTask.id ? undefined : onCancelDeleteDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <div
            className="card grid"
            role="dialog"
            aria-modal="true"
            aria-label="Taak verwijderen bevestigen"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "34rem", margin: "8vh auto 0 auto" }}
          >
            <h3>Verwijderen bevestigen</h3>
            <p>
              <strong>{deleteDialogTask.title}</strong>
            </p>
            <p>{deleteDialogTask.message}</p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={onCancelDeleteDialog}
                disabled={activeTaskId === deleteDialogTask.id}
                title="Annuleren"
                aria-label="Annuleren"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={onConfirmDeleteTask}
                disabled={activeTaskId === deleteDialogTask.id}
                title="Verwijder"
                aria-label="Verwijder"
              >
                {activeTaskId === deleteDialogTask.id ? "Verwijderen..." : "Verwijderen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
