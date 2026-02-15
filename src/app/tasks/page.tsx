import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { TasksClient } from "@/app/tasks/tasks-client";

export default async function TasksPage() {
  const cookieStore = await cookies();
  const alias = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!alias) {
    redirect("/login");
  }

  return <TasksClient alias={alias} />;
}
