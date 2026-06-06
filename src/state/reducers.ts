// Shared LangGraph Annotation reducers. Arrays concat, dicts shallow-merge,
// numbers sum, and scalars take the latest write.

export const mergeDicts = (
    left: Record<string, string> | undefined,
    right: Record<string, string> | undefined,
): Record<string, string> => ({ ...(left ?? {}), ...(right ?? {}) });

export const concatArrays = <T>(left: T[] | undefined, right: T[] | undefined): T[] => [
    ...(left ?? []),
    ...(right ?? []),
];

export const sumNumbers = (left: number | undefined, right: number | undefined): number => (left ?? 0) + (right ?? 0);

// Last-write-wins reducer for scalar fields that should not accumulate.
export const lastWriteWins = <T>(_left: T, right: T): T => right;
