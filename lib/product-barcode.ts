const JsBarcode = require("jsbarcode") as {
  getModule(name: "CODE128"): new (value: string, options: Record<string, unknown>) => {
    valid(): boolean;
    encode(): { data: string };
  };
};

export interface ProductBarcode {
  pattern: string;
}

export function createProductBarcode(productCode: string): ProductBarcode | null {
  const value = productCode.trim();
  if (!value) return null;
  const Code128 = JsBarcode.getModule("CODE128");
  const encoder = new Code128(value, {});
  if (!encoder.valid()) return null;
  return { pattern: encoder.encode().data };
}
