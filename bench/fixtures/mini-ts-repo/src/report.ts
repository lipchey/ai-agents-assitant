import type { Item } from "./inventory";
import { totalCents, unitCount } from "./inventory";

export const inventoryReport = (items: Item[]): string =>
    [`items: ${items.length}`, `units: ${unitCount(items)}`, `total cents: ${totalCents(items)}`].join("\n");
