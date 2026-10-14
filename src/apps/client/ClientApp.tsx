import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signInWithEmailAndPassword, GoogleAuthProvider, signOut } from "firebase/auth";
import { addDoc, collection, doc, getDoc, increment, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { toCartItem, useProductCatalog, type CartItem } from "./catalog";
import type { Product } from "./data";

function inr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function sessionId() {
  const key = "negocart-session-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, created);
  return created;
}

async function logBehavior(payload: Record<string, unknown>) {
  try {
    await setDoc(
      doc(db, "behaviorLogs", sessionId()),
      {
        sessionId: sessionId(),
        ...payload,
        lastActiveTime: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.debug("logBehavior non-blocking error:", err);
  }
}

function scoreHesitation(input: {
  timeOnProductPage: number;
  timeOnPricePage: number;
  scrollDepth: number;
  reviewScrollDepth: number;
  comparePageVisits: number;
  returnVisitCount: number;
  checkoutVisitCount: number;
  cartAddCount: number;
  cartRemoveCount: number;
}): { hesitationType: "price" | "product" | "trust" | "unknown"; hesitationScore: { price: number; product: number; trust: number } } {
  const ratio = input.cartRemoveCount > 0 ? input.cartAddCount / input.cartRemoveCount : input.cartAddCount;
  const price =
    (input.timeOnPricePage > 120 ? 0.3 : 0) +
    (input.checkoutVisitCount >= 3 ? 0.25 : 0) +
    (ratio > 1 ? 0.2 : 0) +
    (input.returnVisitCount >= 2 ? 0.15 : 0) +
    (input.scrollDepth < 0.4 ? 0.1 : 0);
  const product =
    (input.reviewScrollDepth > 0.7 ? 0.35 : 0) +
    (input.comparePageVisits >= 2 ? 0.3 : 0) +
    (input.timeOnProductPage > 240 ? 0.25 : 0) +
    (input.returnVisitCount >= 2 ? 0.1 : 0);
  const trust = (input.returnVisitCount >= 3 ? 0.3 : 0) + (input.checkoutVisitCount > 0 && input.timeOnPricePage > 180 ? 0.3 : 0);
  const max = Math.max(price, product, trust);
  const hesitationType = max === 0 ? "unknown" : max === price ? "price" : max === product ? "product" : "trust";
  return { hesitationType, hesitationScore: { price, product, trust } };
}

function useAuthUser() {
  const [user, setUser] = useState<any>(null);
  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (!u) return;
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            uid: u.uid,
            email: u.email,
            displayName: u.displayName ?? "",
            role: "customer",
            createdAt: serverTimestamp(),
          });
        }
      }),
    [],
  );
  return user;
}

function Layout({ children, cartCount }: { children: React.ReactNode; cartCount: number }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="noise-overlay" />
      <header className="sticky top-0 z-40 border-b border-black/10 bg-[var(--bg)]/95 px-4 py-3 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between">
          <Link to="/" className="font-display text-2xl font-black uppercase tracking-wider">
            SHOP.CO
          </Link>
          <div className="flex items-center gap-4 text-xs uppercase">
            <Link to="/products">Products</Link>
            <Link to="/orders">Orders</Link>
            <Link to="/profile">Profile</Link>
            <Link to="/login">Login</Link>
            <Link to="/cart">Cart ({cartCount})</Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] rounded bg-[var(--ink)] px-4 py-2 text-sm text-[var(--bg)] shadow-lg">
      {message}
    </div>
  );
}

export default function ClientApp() {
  const user = useAuthUser();
  const products = useProductCatalog();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (user) return;
    const stored = localStorage.getItem("negocart-local-cart");
    if (!stored) return;
    try {
      setCart(JSON.parse(stored));
    } catch {
      setCart([]);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "carts", user.uid), (snap) => setCart(snap.exists() ? snap.data().items || [] : []));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const stored = localStorage.getItem("negocart-local-cart");
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as CartItem[];
      if (parsed.length > 0) {
        void setDoc(doc(db, "carts", user.uid), { uid: user.uid, items: parsed, updatedAt: serverTimestamp() }, { merge: true });
      }
    } finally {
      localStorage.removeItem("negocart-local-cart");
    }
  }, [user]);

  const cartCount = cart.reduce((a, b) => a + b.quantity, 0);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  }

  async function saveCart(next: CartItem[]) {
    if (!user) {
      setCart(next);
      localStorage.setItem("negocart-local-cart", JSON.stringify(next));
      return;
    }
    await setDoc(doc(db, "carts", user.uid), { uid: user.uid, items: next, updatedAt: serverTimestamp() }, { merge: true });
  }

  async function addToCart(product: Product) {
    const found = cart.find((item) => item.productId === product.id);
    const next = found
      ? cart.map((item) => (item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item))
      : [...cart, toCartItem(product)];
    await saveCart(next);
    await logBehavior({ uid: user?.uid ?? null, productId: product.id, cartAddCount: increment(1), sessionStartTime: serverTimestamp() });
    showToast("Saved to cart");
  }

  return (
    <Layout cartCount={cartCount}>
      <Routes>
        <Route path="/" element={<Home products={products} addToCart={addToCart} />} />
        <Route path="/products" element={<Products products={products} addToCart={addToCart} />} />
        <Route path="/products/:id" element={<ProductDetail products={products} addToCart={addToCart} />} />
        <Route path="/cart" element={<CartPage cart={cart} saveCart={saveCart} user={user} showToast={showToast} />} />
        <Route path="/checkout" element={<Checkout cart={cart} user={user} saveCart={saveCart} showToast={showToast} />} />
        <Route path="/orders" element={<Orders user={user} />} />
        <Route path="/login" element={<Login user={user} showToast={showToast} />} />
        <Route path="/profile" element={<Profile user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toast message={toast} />
    </Layout>
  );
}

function Home({ products, addToCart }: { products: Product[]; addToCart: (p: Product) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const trending = useMemo(() => [...products].sort(() => Math.random() - 0.5).slice(0, 12), [products]);
  const filtered = products.filter((p) => {
    const searchMatch = [p.name, p.colour, p.category, p.subCategory].join(" ").toLowerCase().includes(q.toLowerCase());
    if (!searchMatch) return false;
    if (activeCategory === "All") return true;
    return p.category.toLowerCase().includes(activeCategory.toLowerCase()) || p.subCategory.toLowerCase().includes(activeCategory.toLowerCase());
  });

  return (
    <section className="space-y-8">
      <div className="rounded-2xl bg-[var(--ink)] p-8 text-[var(--bg)] shadow-md">
        <h1 className="font-display text-5xl uppercase font-extrabold tracking-tight">SHOP.CO</h1>
        <p className="mt-2 text-xs uppercase tracking-wider text-white/70">Find clothes that match your style • Discover quality apparel & footwear</p>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, colour, category"
        className="w-full rounded border border-black/20 bg-white px-4 py-3"
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {["All", "Topwear", "Bottomwear", "Footwear", "Accessories"].map((c) => (
          <button
            key={c}
            onClick={() => setActiveCategory(c)}
            className={`rounded border p-4 text-left font-display uppercase ${activeCategory === c ? "border-[var(--accent)] bg-[#fff3ef]" : "border-black/10 bg-white"}`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="text-xs uppercase">Showing {filtered.length} products in {activeCategory}</div>
      <h2 className="font-display text-3xl uppercase">Trending</h2>
      <div className="flex gap-4 overflow-auto pb-2">
        {trending.map((p) => (
          <div key={p.id} className="min-w-56 rounded border border-black/10 bg-white p-3">
            <img src={p.imageURL} className="h-52 w-full object-cover" />
            <div className="mt-2 text-sm font-bold">{p.name}</div>
            <div className="text-xs">{inr(p.price)}</div>
            <button onClick={() => void addToCart(p)} className="mt-2 rounded bg-[var(--ink)] px-3 py-2 text-xs text-white">
              Add to Cart
            </button>
          </div>
        ))}
      </div>
      <h2 className="font-display text-3xl uppercase">Products</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {filtered.slice(0, 12).map((p) => (
          <Link key={p.id} to={`/products/${p.id}`} className="rounded border border-black/10 bg-white p-3">
            <img src={p.imageURL} className="h-56 w-full object-cover" />
            <div className="mt-2 line-clamp-2 font-semibold">{p.name}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Products({ products, addToCart }: { products: Product[]; addToCart: (p: Product) => Promise<void> }) {
  const [filters, setFilters] = useState({ category: "", subCategory: "", gender: "", colour: "", usage: "" });
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(100000);
  const location = useLocation();

  useEffect(() => {
    const started = Date.now();
    void logBehavior({ productId: "listing", sessionStartTime: serverTimestamp() });
    return () => {
      void logBehavior({ productId: "listing", timeOnProductPage: Math.round((Date.now() - started) / 1000), lastRoute: location.pathname });
    };
  }, [location.pathname]);

  const data = products.filter(
    (p) =>
      (!filters.category || p.category === filters.category) &&
      (!filters.subCategory || p.subCategory === filters.subCategory) &&
      (!filters.gender || p.gender === filters.gender) &&
      (!filters.colour || p.colour === filters.colour) &&
      (!filters.usage || p.usage === filters.usage) &&
      p.price >= minPrice &&
      p.price <= maxPrice,
  );

  return (
    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
      <aside className="space-y-2 rounded border border-black/10 bg-white p-4">
        {["category", "subCategory", "gender", "colour", "usage"].map((key) => (
          <input key={key} placeholder={key} className="w-full rounded border border-black/10 px-3 py-2 text-sm" onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} />
        ))}
        <input type="number" placeholder="Min price" className="w-full rounded border border-black/10 px-3 py-2 text-sm" onChange={(e) => setMinPrice(Number(e.target.value) || 0)} />
        <input type="number" placeholder="Max price" className="w-full rounded border border-black/10 px-3 py-2 text-sm" onChange={(e) => setMaxPrice(Number(e.target.value) || 100000)} />
      </aside>
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {data.map((p) => (
          <div key={p.id} className="rounded border border-black/10 bg-white p-3">
            <Link to={`/products/${p.id}`}>
              <img src={p.imageURL} className="h-60 w-full object-cover" />
              <div className="mt-2 line-clamp-2 font-semibold">{p.name}</div>
            </Link>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-sm">{inr(p.price)}</span>
              <span className="rounded bg-[var(--neon)] px-2 py-1 text-[10px] font-bold">{p.discountPercentage}%</span>
            </div>
            <button onClick={() => addToCart(p)} className="mt-2 w-full rounded bg-[var(--ink)] px-3 py-2 text-xs text-white">
              Add to Cart
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function ProductDetail({ products, addToCart }: { products: Product[]; addToCart: (p: Product) => Promise<void> }) {
  const { id } = useParams();
  const nav = useNavigate();
  const product = products.find((p) => p.id === id);
  const [reviewDepth, setReviewDepth] = useState(0);

  useEffect(() => {
    if (!product) return;
    const started = Date.now();
    const key = `visit_${product.id}`;
    const rv = Number(localStorage.getItem(key) ?? "0") + 1;
    localStorage.setItem(key, String(rv));

    const onScroll = () => {
      const d = document.documentElement;
      const depth = d.scrollTop / Math.max(d.scrollHeight - d.clientHeight, 1);
      setReviewDepth((prev) => Math.max(prev, depth));
    };

    window.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      const scores = scoreHesitation({
        timeOnProductPage: Math.round((Date.now() - started) / 1000),
        timeOnPricePage: 0,
        scrollDepth: reviewDepth,
        reviewScrollDepth: reviewDepth,
        comparePageVisits: 0,
        returnVisitCount: rv,
        checkoutVisitCount: 0,
        cartAddCount: 0,
        cartRemoveCount: 0,
      });
      void logBehavior({ productId: product.id, ...scores, reviewScrollDepth: reviewDepth, returnVisitCount: rv });
    };
  }, [product, reviewDepth]);

  if (!product) return <div>Product not found</div>;
  const stars = Number((4.2 + ((Number(product.id) || 1) % 8) * 0.1).toFixed(1));
  const related = products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <img src={product.imageURL} className="w-full rounded border border-black/10" />
      <div>
        <h1 className="font-display text-4xl uppercase">{product.name}</h1>
        <p className="mt-2 text-sm">
          {product.gender} | {product.productType} | {product.colour}
        </p>
        <div className="mt-4 text-2xl font-bold">
          {product.discountPercentage > 0 ? (
            <>
              <span className="mr-3 text-sm text-black/50 line-through">{inr(product.price)}</span>
              {inr(Math.round(product.price * (1 - product.discountPercentage / 100)))}
            </>
          ) : (
            inr(product.price)
          )}
        </div>
        <p className="mt-4 text-sm">
          Designed for {product.usage}. Category: {product.category}/{product.subCategory}.
        </p>
        <div className="mt-4 flex gap-3">
          <button onClick={() => addToCart(product)} className="rounded bg-[var(--ink)] px-4 py-2 text-sm text-white">
            Add to Cart
          </button>
          <button
            onClick={() => {
              void addToCart(product);
              nav("/cart?negotiate=true");
            }}
            className="rounded border border-[var(--ink)] px-4 py-2 text-sm"
          >
            Negotiate Price
          </button>
        </div>
        <div className="mt-8 rounded border border-black/10 p-4">
          <div className="font-semibold">Reviews</div>
          <div className="text-sm">{stars} stars (seeded by productId)</div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {related.map((r) => (
            <Link key={r.id} to={`/products/${r.id}`} className="rounded border border-black/10 p-2 text-sm">
              {r.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function CartPage({ cart, saveCart, user, showToast }: { cart: CartItem[]; saveCart: (items: CartItem[]) => Promise<void>; user: any; showToast: (message: string) => void }) {
  const [offer, setOffer] = useState("");
  const [attempt, setAttempt] = useState(1);
  const [messages, setMessages] = useState<{ role: "ai" | "user"; text: string }[]>([]);
  const [isFinal, setIsFinal] = useState(false);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [isNegotiateModalOpen, setIsNegotiateModalOpen] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [currentAiPrice, setCurrentAiPrice] = useState<number | null>(null);
  const [appliedDeal, setAppliedDeal] = useState<number | null>(() => {
    const saved = sessionStorage.getItem("negocart-negotiated-total");
    return saved ? Number(saved) : null;
  });

  const nav = useNavigate();
  const location = useLocation();
  const total = cart.reduce((a, b) => a + b.price * b.quantity, 0);
  const minPrice = cart.reduce((a, b) => a + b.minPrice * b.quantity, 0);

  // Check URL query param to auto-open negotiation modal (e.g., from product page)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("negotiate") === "true") {
      setIsNegotiateModalOpen(true);
    }
  }, [location.search]);

  // Reset applied deal if cart total changes or empty
  useEffect(() => {
    if (appliedDeal && appliedDeal >= total) {
      setAppliedDeal(null);
      sessionStorage.removeItem("negocart-negotiated-total");
    }
  }, [total, appliedDeal]);

  useEffect(() => {
    const started = Date.now();

    const onMouseMove = async (e: MouseEvent) => {
      if (e.clientY > 24) return;
      const scores = scoreHesitation({
        timeOnProductPage: 0,
        timeOnPricePage: Math.round((Date.now() - started) / 1000),
        scrollDepth: 0.5,
        reviewScrollDepth: 0.4,
        comparePageVisits: 0,
        returnVisitCount: 1,
        checkoutVisitCount: 0,
        cartAddCount: 2,
        cartRemoveCount: 2,
      });
      if (scores.hesitationScore.price > 0.65) setOverlay("Here is 8% off - next 15 minutes only");
      else if (scores.hesitationScore.product > 0.65) setOverlay("4.8 stars - 2,400 customers love this");
      else if (scores.hesitationScore.trust > 0.65) setOverlay("Free returns within 30 days, no questions");
      await logBehavior({ uid: user?.uid ?? null, exitIntentDetected: true, ...scores, aiActionTaken: "overlay_nudge" });
    };

    window.addEventListener("mousemove", onMouseMove);
    const abandonTimer = setTimeout(async () => {
      const sref = doc(db, "behaviorLogs", sessionId());
      const snap = await getDoc(sref);
      if (!snap.exists()) return;
      if (snap.data().outcome) return;
      const h = snap.data().hesitationType || "price";
      const message =
        h === "product"
          ? "Still thinking? 2,400 people love this - here's what they say"
          : h === "trust"
            ? "Shop worry-free - free returns within 30 days, guaranteed"
            : "You left something behind - here's a limited discount just for you";
      await addDoc(collection(db, "notifications"), {
        uid: user?.uid ?? "",
        sessionId: sessionId(),
        productId: cart[0]?.productId ?? "",
        hesitationType: h,
        message,
        channel: "push",
        sentAt: serverTimestamp(),
        openedAt: null,
        clickedAt: null,
        convertedAt: null,
        outcome: "pending",
      });
    }, 5 * 60 * 1000);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      clearTimeout(abandonTimer);
      void logBehavior({ timeOnPricePage: Math.round((Date.now() - started) / 1000) });
    };
  }, [cart, user]);

  async function negotiate() {
    const trimmed = offer.trim();
    if (!trimmed || isAiThinking) return;

    // Extract any number from the user message if present
    const match = trimmed.match(/\d[\d,]*/);
    const userOffer = match ? Number(match[0].replace(/,/g, "")) : null;

    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setIsAiThinking(true);
    setOffer("");

    try {
      const res = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalPrice: total,
          minPrice,
          userOffer,
          userMessage: trimmed,
          attempt,
          cartItems: cart,
          chatHistory: messages,
        }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "ai", text: data.message }]);
      setAttempt((v) => v + 1);
      setIsFinal(Boolean(data.final));

      if (data.responsePrice) {
        setCurrentAiPrice(data.responsePrice);
        // If the AI explicitly accepts the user's offer or counters with their offer
        if (data.final && userOffer && userOffer >= data.responsePrice) {
          applyNegotiatedDeal(userOffer);
        }
      }
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "I couldn't process that offer right now. Please try again! 😊" }]);
    } finally {
      setIsAiThinking(false);
    }
  }

  function applyNegotiatedDeal(price: number) {
    setAppliedDeal(price);
    sessionStorage.setItem("negocart-negotiated-total", String(price));
    showToast(`🎉 Deal locked at ${inr(price)}!`);
    setIsNegotiateModalOpen(false);
  }

  function removeNegotiatedDeal() {
    setAppliedDeal(null);
    sessionStorage.removeItem("negocart-negotiated-total");
    showToast("Negotiated deal removed.");
  }

  const finalCartPrice = appliedDeal && appliedDeal < total ? appliedDeal : total;
  const savings = total - finalCartPrice;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl uppercase">Cart</h1>
        {cart.length > 0 && (
          <span className="text-xs uppercase tracking-wider text-black/60 font-semibold">
            {cart.reduce((a, b) => a + b.quantity, 0)} {cart.reduce((a, b) => a + b.quantity, 0) === 1 ? "item" : "items"}
          </span>
        )}
      </div>

      {overlay && <div className="rounded border border-[var(--accent)] bg-white p-3 text-sm">{overlay}</div>}

      {cart.length === 0 ? (
        <div className="rounded-xl border border-black/10 bg-white p-12 text-center space-y-4">
          <p className="text-lg text-black/60">Your cart is empty.</p>
          <Link
            to="/products"
            className="inline-block rounded bg-[var(--ink)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition"
          >
            Explore Products
          </Link>
        </div>
      ) : (
        <>
          {/* Cart Products List */}
          <div className="space-y-2">
            {cart.map((c) => (
              <div
                key={c.productId}
                className="flex items-center justify-between gap-4 rounded-lg border border-black/10 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  {c.imageURL && (
                    <img
                      src={c.imageURL}
                      alt={c.name}
                      className="h-14 w-14 rounded-md object-cover border border-black/10 shrink-0"
                    />
                  )}
                  <div>
                    <div className="font-semibold text-sm">{c.name}</div>
                    <div className="text-xs text-black/50">Unit Price: {inr(c.price)}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="font-semibold text-sm">{inr(c.price * c.quantity)}</span>
                  <div className="flex items-center border border-black/15 rounded-md overflow-hidden bg-black/5">
                    <button
                      className="px-2.5 py-1 text-sm font-bold hover:bg-black/10 transition"
                      onClick={async () => {
                        const next = cart
                          .map((i) => (i.productId === c.productId ? { ...i, quantity: Math.max(0, i.quantity - 1) } : i))
                          .filter((i) => i.quantity > 0);
                        if (appliedDeal) {
                          setAppliedDeal(null);
                          sessionStorage.removeItem("negocart-negotiated-total");
                          showToast("Cart updated - negotiated deal reset");
                        } else {
                          showToast("Cart updated");
                        }
                        await saveCart(next);
                        await logBehavior({ cartRemoveCount: increment(1), productId: c.productId });
                      }}
                    >
                      -
                    </button>
                    <span className="px-3 text-xs font-semibold">{c.quantity}</span>
                    <button
                      className="px-2.5 py-1 text-sm font-bold hover:bg-black/10 transition"
                      onClick={async () => {
                        const next = cart.map((i) => (i.productId === c.productId ? { ...i, quantity: i.quantity + 1 } : i));
                        if (appliedDeal) {
                          setAppliedDeal(null);
                          sessionStorage.removeItem("negocart-negotiated-total");
                          showToast("Cart updated - negotiated deal reset");
                        } else {
                          showToast("Cart updated");
                        }
                        await saveCart(next);
                        await logBehavior({ cartAddCount: increment(1), productId: c.productId });
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Cart Pricing Summary */}
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-black/60">Original listed total:</span>
              <span className={appliedDeal && appliedDeal < total ? "line-through text-black/40 font-medium" : "font-semibold"}>
                {inr(total)}
              </span>
            </div>

            {appliedDeal && appliedDeal < total && (
              <>
                <div className="flex justify-between items-center text-sm font-semibold text-emerald-700">
                  <span>AI Negotiated total:</span>
                  <span className="text-base font-bold">{inr(appliedDeal)}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-1 border-t border-black/5 text-emerald-800">
                  <span className="inline-flex items-center gap-1 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    🎉 Deal Locked • You save {inr(savings)}
                  </span>
                  <button
                    onClick={removeNegotiatedDeal}
                    className="text-xs text-black/40 underline hover:text-black/70"
                  >
                    Reset to original
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Checkout & Negotiate Action Buttons (Side by Side) */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              to="/checkout"
              onClick={() => {
                void logBehavior({ checkoutVisitCount: increment(1) });
              }}
              className="rounded-lg bg-[var(--accent)] hover:opacity-90 transition px-6 py-3 font-semibold text-white shadow-md text-sm flex items-center justify-center gap-2 min-w-[170px]"
            >
              <span>Go to Checkout</span>
              <span className="opacity-80">({inr(finalCartPrice)})</span>
            </Link>

            <button
              onClick={() => {
                setIsNegotiateModalOpen(true);
                void logBehavior({ negotiationOpened: true });
              }}
              className="rounded-lg border-2 border-[var(--ink)] bg-white hover:bg-[var(--ink)] hover:text-white transition px-5 py-3 font-semibold text-[var(--ink)] shadow-sm text-sm flex items-center justify-center gap-2 min-w-[170px]"
            >
              <span>🤖</span>
              <span>{appliedDeal && appliedDeal < total ? "Re-negotiate Price" : "Negotiate Price"}</span>
            </button>
          </div>
        </>
      )}

      {/* --- Separate Negotiation AI Modal / Tab --- */}
      {isNegotiateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-[#faf9f6] border border-black/15 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/10 bg-white">
              <div className="flex items-center gap-2">
                <span className="text-xl">🤖</span>
                <div>
                  <h3 className="font-semibold text-sm leading-tight">Shop.CO AI Assistant</h3>
                  <p className="text-[11px] text-black/50">Real-time bundle price negotiation</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-black/5 text-black/70">
                  {isFinal ? "Final Round" : `Round ${attempt} of 3`}
                </span>
                <button
                  onClick={() => setIsNegotiateModalOpen(false)}
                  className="h-7 w-7 rounded-full flex items-center justify-center text-black/50 hover:bg-black/5 hover:text-black transition text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Cart Price Banner inside Modal */}
            <div className="px-5 py-2.5 bg-black/5 border-b border-black/10 flex items-center justify-between text-xs">
              <div className="text-black/70">
                Cart Total: <span className="font-bold text-black">{inr(total)}</span> ({cart.reduce((a, b) => a + b.quantity, 0)} {cart.reduce((a, b) => a + b.quantity, 0) === 1 ? "item" : "items"})
              </div>
              <div className="text-[11px] text-black/50 font-medium">
                Live AI Negotiation
              </div>
            </div>

            {/* Negotiation Chat Body */}
            <div className="p-4 space-y-3 flex-1 overflow-y-auto min-h-[220px]">
              {/* Initial Bot Greeting */}
              <div className="flex gap-2.5 max-w-[88%]">
                <div className="h-7 w-7 rounded-full bg-[var(--ink)] text-white flex items-center justify-center text-xs shrink-0 mt-0.5">
                  🤖
                </div>
                <div className="rounded-2xl rounded-tl-xs bg-white border border-black/10 p-3 text-xs shadow-xs text-black/90 leading-relaxed">
                  Welcome to Shop.CO! ✨ The listed total for your {cart.reduce((a, b) => a + b.quantity, 0)}-item order is <b>{inr(total)}</b>. What offer or discount would you like to request today?
                </div>
              </div>

              {/* Chat Message History */}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start max-w-[88%]"}`}
                >
                  {m.role === "ai" && (
                    <div className="h-7 w-7 rounded-full bg-[var(--ink)] text-white flex items-center justify-center text-xs shrink-0 mt-0.5">
                      🤖
                    </div>
                  )}
                  <div
                    className={`rounded-2xl p-3 text-xs leading-relaxed shadow-xs ${
                      m.role === "user"
                        ? "bg-[var(--ink)] text-white rounded-tr-xs ml-auto max-w-[82%]"
                        : "bg-white border border-black/10 text-black/90 rounded-tl-xs"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}

              {/* AI Thinking Animation */}
              {isAiThinking && (
                <div className="flex gap-2.5 max-w-[88%] animate-pulse">
                  <div className="h-7 w-7 rounded-full bg-[var(--ink)] text-white flex items-center justify-center text-xs shrink-0">
                    🤖
                  </div>
                  <div className="rounded-2xl rounded-tl-xs bg-white border border-black/10 px-3 py-2 text-xs text-black/50 italic">
                    Shop.CO AI is analyzing your offer...
                  </div>
                </div>
              )}

              {/* Action Banner if AI offered a discounted price */}
              {currentAiPrice && currentAiPrice < total && (
                <div className="my-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-2">
                  <div className="text-xs">
                    <p className="font-semibold text-emerald-900">Special counter-offer: {inr(currentAiPrice)}</p>
                    <p className="text-[11px] text-emerald-700">Lock in {inr(total - currentAiPrice)} discount right now</p>
                  </div>
                  <button
                    onClick={() => applyNegotiatedDeal(currentAiPrice)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition shadow-xs shrink-0"
                  >
                    Accept & Apply Deal
                  </button>
                </div>
              )}
            </div>

            {/* Modal Input & Actions Footer */}
            <div className="p-3 bg-white border-t border-black/10 space-y-2">
              {isFinal ? (
                <div className="text-center py-1">
                  <p className="text-xs font-semibold text-[var(--accent)]">
                    Final round reached.
                  </p>
                  {currentAiPrice && currentAiPrice < total ? (
                    <button
                      onClick={() => applyNegotiatedDeal(currentAiPrice)}
                      className="mt-2 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition"
                    >
                      Accept Best Offer ({inr(currentAiPrice)}) & Apply to Cart
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsNegotiateModalOpen(false)}
                      className="mt-2 text-xs underline text-black/60 hover:text-black"
                    >
                      Close and keep original price
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={offer}
                    onChange={(e) => setOffer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void negotiate();
                      }
                    }}
                    type="text"
                    disabled={isAiThinking}
                    className="w-full rounded-lg border border-black/15 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-black bg-black/2"
                    placeholder="Type your message or offer (e.g. Can you do ₹3,200?)..."
                  />
                  <button
                    onClick={negotiate}
                    disabled={isAiThinking || !offer.trim()}
                    className="rounded-lg bg-[var(--ink)] hover:opacity-90 disabled:opacity-40 transition px-4 py-2 text-xs font-semibold text-white shrink-0"
                  >
                    {isAiThinking ? "Sending..." : "Send Offer"}
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center text-[11px] text-black/40 px-1 pt-0.5">
                <span>The AI will counter or accept depending on inventory limits.</span>
                <button
                  onClick={() => setIsNegotiateModalOpen(false)}
                  className="hover:text-black transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Checkout({ cart, user, saveCart, showToast }: { cart: CartItem[]; user: any; saveCart: (items: CartItem[]) => Promise<void>; showToast: (message: string) => void }) {
  const nav = useNavigate();
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash on Delivery (COD)");
  const [isPlacing, setIsPlacing] = useState(false);

  const total = cart.reduce((a, b) => a + b.price * b.quantity, 0);
  const negotiatedTotal = sessionStorage.getItem("negocart-negotiated-total");
  const appliedDeal = negotiatedTotal ? Number(negotiatedTotal) : null;
  const finalTotal = appliedDeal && appliedDeal < total ? appliedDeal : total;
  const savings = Math.max(0, total - finalTotal);

  async function placeOrder() {
    if (cart.length === 0) {
      showToast("Your cart is empty");
      return nav("/products");
    }

    setIsPlacing(true);

    try {
      const orderId = `ORD-${Date.now()}`;
      const guestId = localStorage.getItem("shopco-session-id") || sessionId();
      const orderUid = user ? user.uid : guestId;

      const orderData = {
        orderId,
        uid: orderUid,
        customerName: user?.displayName || (user?.email ? user.email.split("@")[0] : "Guest Customer"),
        customerEmail: user?.email || "guest@shop.co",
        deliveryAddress: address ? `${address}${city ? ", " + city : ""}` : "Express Home Delivery",
        items: cart,
        originalTotal: total,
        finalTotal,
        negotiationSavings: savings,
        status: "Confirmed",
        paymentMethod,
        createdAt: new Date().toISOString(),
      };

      // Save to Firestore if possible
      try {
        await addDoc(collection(db, "orders"), {
          ...orderData,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn("Firestore order write skipped, saving locally:", err);
      }

      // Also save to localStorage so the Orders screen always displays it
      try {
        const localOrders = JSON.parse(localStorage.getItem("shopco-local-orders") || "[]");
        localStorage.setItem("shopco-local-orders", JSON.stringify([orderData, ...localOrders]));
      } catch (e) {
        console.error(e);
      }

      await logBehavior({ uid: orderUid, outcome: "purchased", outcomeAt: serverTimestamp() });
      await updatePatternMemory("price", "checkout_completed", "push", true);

      // Clean up cart and negotiated price
      sessionStorage.removeItem("negocart-negotiated-total");
      await saveCart([]);

      showToast("🎉 Order placed successfully!");
      nav("/orders");
    } catch (err) {
      console.error(err);
      showToast("Could not place order. Please try again.");
    } finally {
      setIsPlacing(false);
    }
  }

  return (
    <section className="space-y-6 max-w-2xl mx-auto py-2">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl uppercase">Checkout</h1>
        <span className="text-xs uppercase font-semibold px-2.5 py-1 bg-black/5 rounded">
          {user ? `Logged in: ${user.email}` : "Guest Checkout"}
        </span>
      </div>

      {cart.length === 0 ? (
        <div className="rounded-xl border border-black/10 bg-white p-8 text-center space-y-3">
          <p className="text-black/60">Your cart is empty.</p>
          <button
            onClick={() => nav("/products")}
            className="rounded bg-[var(--ink)] px-5 py-2 text-xs text-white font-semibold"
          >
            Explore Products
          </button>
        </div>
      ) : (
        <>
          {/* Delivery & Payment Form */}
          <div className="rounded-xl border border-black/10 bg-white p-5 space-y-4 shadow-xs">
            <h2 className="text-xs font-bold uppercase tracking-wider text-black/60 border-b border-black/5 pb-2">
              1. Delivery Information
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="rounded-lg border border-black/15 bg-white px-3.5 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-black"
                placeholder="Street Address / Flat / Building"
              />
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="rounded-lg border border-black/15 bg-white px-3.5 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-black"
                placeholder="City & PIN Code"
              />
            </div>

            <h2 className="text-xs font-bold uppercase tracking-wider text-black/60 border-b border-black/5 pb-2 pt-2">
              2. Payment Method
            </h2>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full rounded-lg border border-black/15 bg-white px-3.5 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-black"
            >
              <option>Cash on Delivery (COD)</option>
              <option>UPI (Google Pay / PhonePe / Paytm)</option>
              <option>Credit / Debit Card</option>
              <option>Net Banking</option>
            </select>
          </div>

          {/* Order Summary with Negotiated Discount breakdown */}
          <div className="rounded-xl border border-black/10 bg-white p-5 space-y-3 shadow-xs">
            <h2 className="text-xs font-bold uppercase tracking-wider text-black/60 border-b border-black/5 pb-2">
              3. Order Summary ({cart.reduce((a, b) => a + b.quantity, 0)} Items)
            </h2>

            <div className="space-y-1.5 text-xs">
              {cart.map((item) => (
                <div key={item.productId} className="flex justify-between text-black/70 py-0.5">
                  <span>{item.name} x {item.quantity}</span>
                  <span className="font-medium text-black">{inr(item.price * item.quantity)}</span>
                </div>
              ))}

              <div className="border-t border-black/5 pt-2 mt-2 space-y-1">
                <div className="flex justify-between text-black/60">
                  <span>Cart Subtotal:</span>
                  <span className={savings > 0 ? "line-through text-black/40" : "font-semibold text-black"}>{inr(total)}</span>
                </div>
                {savings > 0 && (
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>AI Negotiation Discount:</span>
                    <span>- {inr(savings)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold pt-2 border-t border-black/10 text-black">
                  <span>Total Amount to Pay:</span>
                  <span className="text-base text-black font-extrabold">{inr(finalTotal)}</span>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={placeOrder}
            disabled={isPlacing}
            className="w-full rounded-lg bg-[var(--ink)] hover:opacity-90 disabled:opacity-50 transition px-4 py-3.5 text-sm font-semibold text-white shadow-md flex items-center justify-center gap-2"
          >
            <span>{isPlacing ? "Placing Order..." : `Confirm & Place Order (${inr(finalTotal)})`}</span>
          </button>
        </>
      )}
    </section>
  );
}

async function updatePatternMemory(hesitationType: string, actionTaken: string, channel: string, success: boolean) {
  const patternId = `${hesitationType}_${actionTaken}_${channel}`;
  const ref = doc(db, "patternMemory", patternId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      patternId,
      hesitationType,
      priceScoreRange: [0.7, 0.9],
      deviceType: "all",
      timeOfDay: "evening",
      actionTaken,
      channel,
      successCount: success ? 1 : 0,
      failureCount: success ? 0 : 1,
      successRate: success ? 1 : 0,
      lastUpdatedAt: serverTimestamp(),
    });
    return;
  }
  const data = snap.data();
  const successCount = (data.successCount || 0) + (success ? 1 : 0);
  const failureCount = (data.failureCount || 0) + (success ? 0 : 1);
  const successRate = successCount / (successCount + failureCount);
  await updateDoc(ref, { successCount, failureCount, successRate, lastUpdatedAt: serverTimestamp() });
}

function Orders({ user }: { user: any }) {
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    // Read local guest orders
    const local = JSON.parse(localStorage.getItem("shopco-local-orders") || "[]");

    if (!user) {
      setOrders(local);
      return;
    }

    const q = query(collection(db, "orders"), where("uid", "==", user.uid), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const remote = snap.docs.map((d) => d.data());
      // Combine remote and local orders avoiding duplicates
      const map = new Map();
      [...remote, ...local].forEach((o) => {
        if (o.orderId && !map.has(o.orderId)) map.set(o.orderId, o);
      });
      setOrders(Array.from(map.values()));
    });
    return () => unsub();
  }, [user]);

  return (
    <section className="space-y-4 max-w-3xl mx-auto py-2">
      <h1 className="font-display text-4xl uppercase">My Orders</h1>
      {orders.length === 0 ? (
        <div className="rounded-xl border border-black/10 bg-white p-12 text-center text-black/60 space-y-3">
          <p className="text-base">No orders placed yet.</p>
          <Link to="/products" className="inline-block rounded bg-[var(--ink)] px-5 py-2 text-xs font-semibold text-white">
            Start Shopping
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.orderId} className="rounded-xl border border-black/10 bg-white p-5 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-2.5">
                <div>
                  <span className="font-mono text-xs font-bold text-black">{o.orderId}</span>
                  <p className="text-[11px] text-black/50">{o.deliveryAddress || "Standard Delivery"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    {o.status || "Confirmed"}
                  </span>
                  <span className="text-[11px] text-black/50 font-medium">{o.paymentMethod || "COD"}</span>
                </div>
              </div>

              <div className="text-xs text-black/70 space-y-1">
                {o.items?.map((it: any, idx: number) => (
                  <div key={idx} className="flex justify-between">
                    <span>{it.name} x {it.quantity}</span>
                    <span className="font-medium text-black">{inr((it.price || 0) * (it.quantity || 1))}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center text-sm font-bold border-t border-black/5 pt-2">
                <span className="text-xs text-black/60">
                  {o.negotiationSavings > 0 ? `Saved ${inr(o.negotiationSavings)} with AI Deal` : "Total Paid:"}
                </span>
                <span className="text-base text-black font-extrabold">{inr(o.finalTotal)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Login({ user, showToast }: { user: any; showToast: (message: string) => void }) {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  if (user) return <Navigate to="/profile" replace />;

  async function handleGoogleLogin() {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      nav("/");
    } catch (error: any) {
      const code = error?.code ?? "";
      if (code.includes("popup-blocked") || code.includes("popup-closed-by-user")) {
        showToast("Popup blocked. Trying redirect sign-in...");
        await signInWithRedirect(auth, new GoogleAuthProvider());
        return;
      }

      if (code.includes("unauthorized-domain")) {
        showToast("Domain not authorized in Firebase Auth.");
        return;
      }

      showToast("Sign-in failed. Please try again.");
    }
  }

  return (
    <section>
      <h1 className="font-display text-4xl uppercase">Login</h1>
      <div className="mt-4 max-w-sm space-y-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded border border-black/20 bg-white px-3 py-2" />
        <input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded border border-black/20 bg-white px-3 py-2" />
        <button
          onClick={async () => {
            try {
              await signInWithEmailAndPassword(auth, email, password);
              showToast("Login successful");
              nav("/");
            } catch {
              showToast("Email login failed. Check credentials.");
            }
          }}
          className="w-full rounded border border-[var(--ink)] px-4 py-2"
        >
          Sign in with Email
        </button>
      </div>
      <button onClick={handleGoogleLogin} className="mt-4 rounded bg-[var(--ink)] px-4 py-2 text-white">
        Sign in with Google
      </button>
    </section>
  );
}

function Profile({ user }: { user: any }) {
  if (!user) return <Navigate to="/login" replace />;
  return (
    <section>
      <h1 className="font-display text-4xl uppercase">Profile</h1>
      <div className="mt-4 rounded border border-black/10 bg-white p-4 text-sm">{user.email}</div>
      <button onClick={() => signOut(auth)} className="mt-3 rounded border border-black/20 px-3 py-2">
        Logout
      </button>
    </section>
  );
}
