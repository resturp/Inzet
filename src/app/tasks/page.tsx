import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/api-session";
import { TasksClient } from "@/app/tasks/tasks-client";

export default async function TasksPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <TasksClient alias={user.alias} />;
}
