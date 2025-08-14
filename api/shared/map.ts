// Minimalt skelett: mappa Britpart-produkt → WooCommerce produktpayload
export type BritpartProduct = {
  partNumber: string;
  description: string;
  longDescription?: string;
  price?: number | string;
  stockQty?: number;
  imageUrls?: string[];
  subcategoryIds?: string[];
};

export function toWCProduct(p: BritpartProduct, categoryMap: Record<string, number>) {
  return {
    sku: p.partNumber,
    name: p.description?.slice(0, 180) || p.partNumber,
    description: p.longDescription || p.description,
    regular_price: p.price != null ? String(p.price) : undefined,
    manage_stock: p.stockQty != null,
    stock_quantity: p.stockQty,
    categories: (p.subcategoryIds || [])
      .map((id) => categoryMap[id])
      .filter(Boolean)
      .map((id) => ({ id })),
    images: (p.imageUrls || []).map((u) => ({ src: u })), // Börja med externa länkar
  } as any;
}