import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import { isRootOwner } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const createTemplateSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().min(2),
  parentTemplateId: z.string().trim().optional(),
  defaultPoints: z.number().nonnegative().optional()
});

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const templates = await prisma.taskTemplate.findMany({
    orderBy: [{ parentTemplateId: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      defaultPoints: true,
      parentTemplateId: true
    }
  });

  return NextResponse.json({ data: templates }, { status: 200 });
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  if (!(await isRootOwner(sessionUser.alias))) {
    return NextResponse.json(
      { error: "Alleen de eigenaar van de root-taak mag sjablonen beheren" },
      { status: 403 }
    );
  }

  const parsed = createTemplateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const template = await prisma.taskTemplate.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      parentTemplateId: parsed.data.parentTemplateId,
      defaultPoints: parsed.data.defaultPoints?.toString()
    }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TEMPLATE_CREATED",
    entityType: "TaskTemplate",
    entityId: template.id
  });

  return NextResponse.json({ data: template }, { status: 201 });
}
