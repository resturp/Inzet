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

export function formatPoints(points: number): string {
  return points.toFixed(2);
}
