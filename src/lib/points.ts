export function calculateSubtaskPoints(
  parentPoints: number,
  subtaskWeight: number,
  totalSiblingWeight: number
): number {
  if (totalSiblingWeight <= 0) {
    throw new Error("totalSiblingWeight must be greater than zero");
  }
  return parentPoints * (subtaskWeight / totalSiblingWeight);
}

export function snapNearInteger(points: number): number {
  if (!Number.isFinite(points) || points < 0) {
    return 0;
  }
  return Math.round(points);
}

export function formatPoints(points: number): string {
  return snapNearInteger(points).toString();
}
