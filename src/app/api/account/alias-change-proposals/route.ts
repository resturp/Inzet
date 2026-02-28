import { OpenTaskStatus, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { resolveBestuurAliases } from "@/lib/authorization";
import { notifyAliasChangeDecisionRequired } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const ALIAS_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

const createAliasChangeProposalSchema = z.object({
  requestedAlias: z.string().trim().regex(ALIAS_PATTERN)
});

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const parsed = createAliasChangeProposalSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Alias moet 3-32 tekens zijn en mag alleen letters, cijfers, _ en - bevatten."
      },
      { status: 400 }
    );
  }

  const requestedAlias = parsed.data.requestedAlias.trim();
  if (requestedAlias === sessionUser.alias) {
    return NextResponse.json(
      { error: "Nieuwe alias moet anders zijn dan je huidige alias." },
      { status: 400 }
    );
  }

  const [existingAliasUser, existingOpenProposal, existingOpenForRequestedAlias] = await Promise.all([
    prisma.user.findUnique({
      where: { alias: requestedAlias },
      select: { alias: true }
    }),
    prisma.aliasChangeProposal.findUnique({
      where: {
        requesterAlias_status: {
          requesterAlias: sessionUser.alias,
          status: OpenTaskStatus.OPEN
        }
      },
      select: { id: true }
    }),
    prisma.aliasChangeProposal.findFirst({
      where: {
        requestedAlias,
        status: OpenTaskStatus.OPEN
      },
      select: { id: true }
    })
  ]);

  if (existingAliasUser) {
    return NextResponse.json({ error: "Deze alias is al in gebruik." }, { status: 409 });
  }

  if (existingOpenProposal) {
    return NextResponse.json(
      { error: "Je hebt al een open aliaswijzigingsvoorstel." },
      { status: 409 }
    );
  }

  if (existingOpenForRequestedAlias) {
    return NextResponse.json(
      { error: "Deze alias is al aangevraagd in een open voorstel." },
      { status: 409 }
    );
  }

  let proposal:
    | {
        id: string;
        requesterAlias: string;
        currentAlias: string;
        requestedAlias: string;
        status: OpenTaskStatus;
        createdAt: Date;
      }
    | null = null;
  try {
    proposal = await prisma.aliasChangeProposal.create({
      data: {
        requesterAlias: sessionUser.alias,
        currentAlias: sessionUser.alias,
        requestedAlias,
        status: OpenTaskStatus.OPEN
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Er staat al een open aliaswijzigingsvoorstel voor je klaar." },
        { status: 409 }
      );
    }
    throw error;
  }

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "ALIAS_CHANGE_PROPOSED",
    entityType: "AliasChangeProposal",
    entityId: proposal.id,
    payload: {
      currentAlias: proposal.currentAlias,
      requestedAlias: proposal.requestedAlias
    }
  });

  try {
    const bestuurAliases = await resolveBestuurAliases();
    await notifyAliasChangeDecisionRequired({
      requesterAlias: proposal.requesterAlias,
      requestedAlias: proposal.requestedAlias,
      proposalId: proposal.id,
      decisionAliases: bestuurAliases,
      actorAlias: sessionUser.alias
    });
  } catch (error) {
    console.error("Failed to notify bestuur about alias proposal", {
      proposalId: proposal.id,
      error
    });
  }

  return NextResponse.json(
    {
      data: proposal,
      message: "Aliaswijziging is voorgelegd aan het bestuur."
    },
    { status: 201 }
  );
}
