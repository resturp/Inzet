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
  const nearestInteger = Math.round(points);
  if (Math.abs(points - nearestInteger) <= 0.05) {
    return nearestInteger;
  }
  return points;
}

export function formatPoints(points: number): string {
  return snapNearInteger(points).toFixed(2);
}
