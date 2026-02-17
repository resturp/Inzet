import { PrismaClient, TaskStatus, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

type EnsureTaskInput = {
  title: string;
  description: string;
  teamName?: string | null;
  parentId: string | null;
  points: string;
  date: Date;
  startTime?: Date | null;
  endTime: Date;
  location?: string | null;
  templateId?: string | null;
  status: TaskStatus;
};

async function ensureTemplate(input: {
  title: string;
  description: string;
  parentTemplateId: string | null;
  defaultPoints?: string | null;
}) {
  const existing = await prisma.taskTemplate.findFirst({
    where: {
      title: input.title,
      parentTemplateId: input.parentTemplateId
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.taskTemplate.create({
    data: {
      title: input.title,
      description: input.description,
      parentTemplateId: input.parentTemplateId,
      defaultPoints: input.defaultPoints ?? null
    }
  });
}

async function ensureTask(input: EnsureTaskInput) {
  const existingAtParent = await prisma.task.findFirst({
    where: {
      title: input.title,
      parentId: input.parentId
    }
  });

  if (existingAtParent) {
    return prisma.task.update({
      where: { id: existingAtParent.id },
      data: {
        description: input.description,
        teamName: input.teamName ?? null,
        points: input.points,
        date: input.date,
        startTime: input.startTime ?? null,
        endTime: input.endTime,
        location: input.location ?? null,
        templateId: input.templateId ?? null,
        status: input.status
      }
    });
  }

  const sameTitle = await prisma.task.findMany({
    where: { title: input.title },
    orderBy: { createdAt: "asc" },
    take: 2
  });

  if (sameTitle.length === 1) {
    return prisma.task.update({
      where: { id: sameTitle[0].id },
      data: {
        parentId: input.parentId,
        description: input.description,
        teamName: input.teamName ?? null,
        points: input.points,
        date: input.date,
        startTime: input.startTime ?? null,
        endTime: input.endTime,
        location: input.location ?? null,
        templateId: input.templateId ?? null,
        status: input.status
      }
    });
  }

  return prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      teamName: input.teamName ?? null,
      parentId: input.parentId,
      points: input.points,
      date: input.date,
      startTime: input.startTime ?? null,
      endTime: input.endTime,
      location: input.location ?? null,
      templateId: input.templateId ?? null,
      status: input.status
    }
  });
}

async function main() {
  await prisma.openTask.deleteMany();

  await prisma.user.upsert({
    where: { alias: "Bestuur" },
    update: { role: UserRole.BESTUUR },
    create: {
      alias: "Bestuur",
      bondsnummer: "BESTUUR-SEED",
      role: UserRole.BESTUUR,
      isActive: true
    }
  });

  const topTemplate = await ensureTemplate({
    title: "Top level Sjabloon",
    description: "Root sjabloon voor verenigingstaken",
    parentTemplateId: null
  });

  const teamTemplate = await ensureTemplate({
    title: "Coachen team",
    description: "Sjabloon voor taken rond coaching van een team.",
    parentTemplateId: topTemplate.id,
    defaultPoints: "100"
  });

  await ensureTemplate({
    title: "Teamfoto maken",
    description: "Maak en verstuur de teamfoto.",
    parentTemplateId: teamTemplate.id,
    defaultPoints: "30"
  });
  await ensureTemplate({
    title: "Rijden",
    description: "Regel en/of uitvoer van vervoer.",
    parentTemplateId: teamTemplate.id,
    defaultPoints: "20"
  });
  await ensureTemplate({
    title: "Wassen",
    description: "Wasschema beheren en uitvoeren.",
    parentTemplateId: teamTemplate.id,
    defaultPoints: "15"
  });

  const seasonStart = new Date("2025-06-30T22:00:00.000Z");
  const seasonEnd = new Date("2026-06-30T21:59:00.000Z");
  const rootEnd = new Date("2029-12-31T23:00:00.000Z");
  const teamfotoDate = new Date("2026-03-01T09:00:00.000Z");
  const teamfotoEnd = new Date("2026-03-01T12:00:00.000Z");

  const rootTask = await ensureTask({
    title: "Besturen vereniging",
    description: "Root taak voor bestuur",
    parentId: null,
    points: "3000",
    date: seasonStart,
    startTime: seasonStart,
    endTime: rootEnd,
    templateId: topTemplate.id,
    status: TaskStatus.TOEGEWEZEN
  });

  await prisma.taskCoordinator.upsert({
    where: {
      taskId_userAlias: {
        taskId: rootTask.id,
        userAlias: "Bestuur"
      }
    },
    update: {},
    create: {
      taskId: rootTask.id,
      userAlias: "Bestuur"
    }
  });

  const seasonTask = await ensureTask({
    title: "2025-2026",
    description: "Het besturen van de vereniging tijdens seizoen 2025-2026",
    parentId: rootTask.id,
    points: "3000",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.TOEGEWEZEN
  });

  await ensureTask({
    title: "Algemeen bestuurslid",
    description: "Medeverantwoordelijk voor het besturen van de vereniging",
    parentId: seasonTask.id,
    points: "400",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  const penningmeesterTask = await ensureTask({
    title: "Penningmeester",
    description: "Verantwoordelijk voor de penningen van de vereniging",
    parentId: seasonTask.id,
    points: "600",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.TOEGEWEZEN
  });

  const voorzitterTask = await ensureTask({
    title: "Voorzitter",
    description: "Verantwoordelijk voor het voorzitten van het bestuur van de vereniging",
    parentId: seasonTask.id,
    points: "800",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.TOEGEWEZEN
  });

  const secretarisTask = await ensureTask({
    title: "Secretaris",
    description: "Verantwoordelijk voor het secretariaat van de vereniging",
    parentId: seasonTask.id,
    points: "600",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  await ensureTask({
    title: "Communicatie commissie",
    description: "Verantwoordelijk voor het communiceren over activiteiten van de vereniging",
    parentId: secretarisTask.id,
    points: "100",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  await ensureTask({
    title: "Ledenadministratie",
    description: "Verantwoordelijk voor het bijhouden van de ledenadministratie in sportlink",
    parentId: secretarisTask.id,
    points: "100",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  await ensureTask({
    title: "Kascommissie",
    description: "Verantwoordelijk voor de controle van de financiën van de vereniging",
    parentId: penningmeesterTask.id,
    points: "100",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  const technischeCommissie = await ensureTask({
    title: "Technische commissie",
    description: "Verantwoordelijk voor het aansturen van de TC's",
    parentId: voorzitterTask.id,
    points: "300",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  await ensureTask({
    title: "Vrijwilligers commissie",
    description: "Verantwoordelijk voor het coördineren van vrijwilligers",
    parentId: voorzitterTask.id,
    points: "100",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  await ensureTask({
    title: "TC Volleystars",
    description: "Technische commissie van de Vollestars",
    parentId: technischeCommissie.id,
    points: "100",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  await ensureTask({
    title: "TC Dames",
    description: "Technische commissie van de Dames",
    parentId: technischeCommissie.id,
    points: "100",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  const tcMeiden = await ensureTask({
    title: "TC Meiden",
    description: "Technische commissie van de Meiden",
    parentId: technischeCommissie.id,
    points: "100",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  const coachenMeidenA2 = await ensureTask({
    title: "Coachen Meiden A2",
    description: "Coordinatietaak voor team Meiden A2",
    teamName: "Meiden A2",
    parentId: tcMeiden.id,
    points: "40",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    templateId: teamTemplate.id,
    status: TaskStatus.BESCHIKBAAR
  });

  await ensureTask({
    title: "Teamfoto maken",
    description: "Maak en verstuur de teamfoto.",
    teamName: "Meiden A2",
    parentId: coachenMeidenA2.id,
    points: "6",
    date: teamfotoDate,
    startTime: null,
    endTime: teamfotoEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  const rijdenTask = await ensureTask({
    title: "Rijden",
    description: "Iedere uitwedstrijd 2 auto's",
    teamName: "Meiden A2",
    parentId: coachenMeidenA2.id,
    points: "20",
    date: seasonStart,
    startTime: seasonStart,
    endTime: seasonEnd,
    status: TaskStatus.BESCHIKBAAR
  });

  await ensureTask({
    title: "Rijden eerste wedstrijd",
    description: "Uitwedstrijd bij Lemelerveld",
    teamName: "Meiden A2",
    parentId: rijdenTask.id,
    points: "4",
    date: new Date("2025-10-04T07:00:00.000Z"),
    startTime: new Date("2025-10-04T07:00:00.000Z"),
    endTime: new Date("2026-10-04T10:00:00.000Z"),
    status: TaskStatus.BESCHIKBAAR
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
