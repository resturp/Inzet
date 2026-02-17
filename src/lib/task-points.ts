function normalizePoints(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

export function parseStoredPoints(value: { toString: () => string } | string | number): number {
  const raw = typeof value === "number" ? value : Number(value.toString());
  return normalizePoints(raw);
}

export function pointsToStorage(value: number): string {
  const normalized = normalizePoints(value);
  return normalized.toString();
}

export function sumStoredPoints(values: Iterable<{ toString: () => string } | string | number>): number {
  let total = 0;
  for (const value of values) {
    total += parseStoredPoints(value);
  }
  return total;
}

export function allocatePointsFromParent(params: {
  availablePoints: number;
  requestedPoints: number;
}): {
  availablePointsAfter: number;
  assignedPoints: number;
  zeroed: boolean;
} {
  const availablePoints = normalizePoints(params.availablePoints);
  const requestedPoints = normalizePoints(params.requestedPoints);

  if (requestedPoints <= availablePoints) {
    return {
      availablePointsAfter: availablePoints - requestedPoints,
      assignedPoints: requestedPoints,
      zeroed: false
    };
  }

  return {
    availablePointsAfter: availablePoints,
    assignedPoints: 0,
    zeroed: true
  };
}

export function remainingOwnPoints(params: {
  ownPoints: number;
  issuedToDirectSubtasks: number;
}): number {
  return normalizePoints(params.ownPoints) - normalizePoints(params.issuedToDirectSubtasks);
}
