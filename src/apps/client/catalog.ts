import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { CSV_PRODUCTS, type Product } from "./data";

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  minPrice: number;
  discountPercentage: number;
  imageURL: string;
  quantity: number;
};

export function toCartItem(product: Product): CartItem {
  return {
    productId: product.id,
    name: product.name,
    price: product.price,
    minPrice: product.minPrice,
    discountPercentage: product.discountPercentage,
    imageURL: product.imageURL,
    quantity: 1,
  };
}

export function useProductCatalog() {
  const [products, setProducts] = useState<Product[]>(CSV_PRODUCTS);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "products"), (snapshot) => {
      if (snapshot.empty) return;
      const data = snapshot.docs.map((entry) => entry.data() as Product);
      setProducts(data);
    });
    return () => unsubscribe();
  }, []);

  return useMemo(() => products, [products]);
}

export async function seedProductsIfEmpty() {
  const existing = await getDocs(collection(db, "products"));
  if (!existing.empty) return { seeded: 0, skipped: true };

  const batch = writeBatch(db);
  CSV_PRODUCTS.forEach((product) => {
    const ref = doc(db, "products", product.id);
    batch.set(ref, { ...product, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
  await batch.commit();
  return { seeded: CSV_PRODUCTS.length, skipped: false };
}

export async function saveProduct(product: Product) {
  await setDoc(doc(db, "products", product.id), { ...product, updatedAt: serverTimestamp() }, { merge: true });
}
