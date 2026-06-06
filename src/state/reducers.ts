export const mergeDicts = (
    left: Record<string, string> | undefined,
    right: Record<string, string> | undefined,
): Record<string, string> => ({ ...(left ?? {}), ...(right ?? {}) });

export const concatArrays = <T>(left: T[] | undefined, right: T[] | undefined): T[] => [
    ...(left ?? []),
    ...(right ?? []),
];

export const sumNumbers = (left: number | undefined, right: number | undefined): number => (left ?? 0) + (right ?? 0);

export const lastWriteWins = <T>(_left: T, right: T): T => right;
