import fashionCsv from "../../../fashion.csv?raw";

export type Product = {
  id: string;
  name: string;
  price: number;
  minPrice: number;
  discountPercentage: number;
  category: string;
  subCategory: string;
  productType: string;
  gender: string;
  colour: string;
  usage: string;
  imageURL: string;
  stock: number;
};

type CsvProduct = {
  ProductId: string;
  Gender: string;
  Category: string;
  SubCategory: string;
  ProductType: string;
  Colour: string;
  Usage: string;
  ProductTitle: string;
  Image: string;
  ImageURL: string;
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(source: string): CsvProduct[] {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const [headerLine, ...rows] = lines;
  const headers = parseCsvLine(headerLine);

  return rows.map((row) => {
    const values = parseCsvLine(row);
    return headers.reduce((record, header, idx) => {
      record[header as keyof CsvProduct] = values[idx] ?? "";
      return record;
    }, {} as CsvProduct);
  });
}

function computeBasePrice(seed: number) {
  return 999 + (seed % 25) * 140;
}

export function mapCsvToProduct(product: CsvProduct): Product | null {
  if (!product.ProductId || !product.ProductTitle || !product.ImageURL) return null;
  const id = product.ProductId.trim();
  const seed = Number(id) || id.length;
  const price = computeBasePrice(seed);
  const discountPercentage = 18;
  const minPrice = Math.round(price * (1 - discountPercentage / 100));

  return {
    id,
    name: product.ProductTitle,
    price,
    minPrice,
    discountPercentage,
    category: product.Category || "Unknown",
    subCategory: product.SubCategory || "Unknown",
    productType: product.ProductType || "Unknown",
    gender: product.Gender || "Unisex",
    colour: product.Colour || "Unknown",
    usage: product.Usage || "Casual",
    imageURL: product.ImageURL.replace("http://", "https://"),
    stock: 50,
  };
}

export const CSV_PRODUCTS: Product[] = parseCsv(fashionCsv)
  .map(mapCsvToProduct)
  .filter((entry): entry is Product => Boolean(entry));
