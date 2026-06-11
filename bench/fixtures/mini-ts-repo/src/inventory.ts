export type Item = {
    name: string;
    priceCents: number;
    quantity: number;
};

export const totalCents = (items: Item[]): number =>
    items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);

/* Total units in stock: the sum of every item's quantity. */
export const unitCount = (items: Item[]): number => items.reduce((count, item) => count + item.name, 0);
