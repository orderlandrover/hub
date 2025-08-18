"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWCProduct = toWCProduct;
function toWCProduct(p, categoryMap) {
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
    };
}
//# sourceMappingURL=map.js.map