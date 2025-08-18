// map.ts
export type BritpartProduct = {
  partNumber: string;
  description: string;
  longDescription?: string;
  price?: number | string;
  stockQty?: number;
  imageUrls?: string[];
  subcategoryIds?: string[];
};

export function toWCProduct(p: BritpartProduct, categoryId?: number) {
  return {
    sku: p.partNumber,
    name: p.description?.slice(0, 180) || p.partNumber,
    description: p.longDescription || p.description,
    regular_price: p.price != null ? String(p.price) : undefined,
    manage_stock: p.stockQty != null,
    stock_quantity: p.stockQty,
    stock_status: typeof p.stockQty === "number" ? (p.stockQty > 0 ? "instock" : "outofstock") : undefined,
    categories: categoryId ? [{ id: categoryId }] : undefined,
    images: (p.imageUrls || []).map((u) => ({ src: u })),
  } as any;
}
