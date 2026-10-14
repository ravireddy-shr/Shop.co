import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { auth, db } from "../../firebase";
import { seedProductsIfEmpty, useProductCatalog } from "../client/catalog";
import type { Product } from "../client/data";

function inr(v: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

function useAdminUser() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    if (!u) { setUser(null); setReady(true); return; }
    const snap = await getDoc(doc(db, "users", u.uid));
    if (!snap.exists() || snap.data().role !== "admin") { setUser(null); await signOut(auth); setReady(true); return; }
    setUser(u);
    setReady(true);
  }), []);
  return { user, ready };
}

function Shell({ user, children }: { user: any; children: React.ReactNode }) {
  const nav = useNavigate();
  return <div className="min-h-screen bg-[var(--bg)] p-4"><div className="mx-auto max-w-7xl"><header className="mb-6 flex items-center justify-between rounded border border-black/10 bg-white px-4 py-3"><div className="font-display text-2xl uppercase">Admin Portal</div><nav className="flex gap-3 text-xs uppercase"><Link to="/admin/dashboard">Dashboard</Link><Link to="/admin/products">Products</Link><Link to="/admin/ai">AI</Link><Link to="/admin/orders">Orders</Link><Link to="/admin/notifications">Notifications</Link></nav><div className="flex items-center gap-2"><span className="text-xs">{user?.email}</span><button onClick={async () => { await signOut(auth); nav("/admin/login"); }} className="rounded border border-black/10 px-2 py-1 text-xs">Logout</button></div></header>{children}</div></div>;
}

export default function AdminApp() {
  const { user, ready } = useAdminUser();
  if (!ready) return <div className="p-6">Loading...</div>;
  return <Routes><Route path="/login" element={<AdminLogin />} /><Route path="/*" element={user ? <Shell user={user}><AdminRoutes /></Shell> : <Navigate to="/admin/login" replace />} /></Routes>;
}

function AdminRoutes() {
  return <Routes><Route path="dashboard" element={<Dashboard />} /><Route path="products" element={<ProductsAdmin />} /><Route path="products/new" element={<EditProduct isNew />} /><Route path="products/:id" element={<EditProduct />} /><Route path="ai" element={<AiDashboard />} /><Route path="orders" element={<OrdersAdmin />} /><Route path="notifications" element={<NotificationsAdmin />} /><Route path="*" element={<Navigate to="dashboard" replace />} /></Routes>;
}

function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return <div className="mx-auto mt-20 max-w-md rounded border border-black/10 bg-white p-6"><h1 className="font-display text-3xl uppercase">Admin Login</h1><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="mt-4 w-full rounded border border-black/10 px-3 py-2" /><input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="mt-2 w-full rounded border border-black/10 px-3 py-2" /><button onClick={async () => { try { await signInWithEmailAndPassword(auth, email, password); nav("/admin/dashboard"); } catch { setError("Invalid credentials or not an admin."); } }} className="mt-4 w-full rounded bg-[var(--ink)] px-4 py-2 text-white">Login</button>{error && <p className="mt-2 text-sm text-red-600">{error}</p>}</div>;
}

function Dashboard() {
  const [orders, setOrders] = useState<any[]>([]);
  const [behaviors, setBehaviors] = useState<any[]>([]);
  const [notifs, setNotifs] = useState<any[]>([]);
  useEffect(() => onSnapshot(collection(db, "orders"), (s) => setOrders(s.docs.map((d) => d.data()))), []);
  useEffect(() => onSnapshot(collection(db, "behaviorLogs"), (s) => setBehaviors(s.docs.map((d) => d.data()))), []);
  useEffect(() => onSnapshot(collection(db, "notifications"), (s) => setNotifs(s.docs.map((d) => d.data()))), []);
  const revenue = orders.reduce((a, b) => a + (b.finalTotal || 0), 0);
  const conversion = behaviors.length ? (orders.length / new Set(behaviors.map((b) => b.sessionId)).size) * 100 : 0;
  const avgSavings = orders.length ? orders.reduce((a, b) => a + (b.negotiationSavings || 0), 0) / orders.length : 0;
  const abandonRate = behaviors.length ? (behaviors.filter((b) => b.exitIntentDetected).length / behaviors.length) * 100 : 0;
  const recovery = notifs.length ? (notifs.filter((n) => n.outcome === "converted").length / notifs.length) * 100 : 0;
  const daily = orders.slice(0, 30).map((o, i) => ({ name: `D${i + 1}`, revenue: o.finalTotal || 0, orders: 1, recovered: o.negotiationSavings || 0 }));
  const hMap = { price: 0, product: 0, trust: 0 } as any;
  behaviors.forEach((b) => { if (hMap[b.hesitationType] !== undefined) hMap[b.hesitationType] += 1; });
  const pie = Object.entries(hMap).map(([name, value]) => ({ name, value }));
  return <section className="space-y-6"><div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">{[
    ["Total Revenue", inr(revenue)],
    ["Total Orders", String(orders.length)],
    ["Conversion Rate", `${conversion.toFixed(1)}%`],
    ["Avg Savings", inr(avgSavings)],
    ["Abandon Rate", `${abandonRate.toFixed(1)}%`],
    ["Recovery Rate", `${recovery.toFixed(1)}%`],
  ].map(([k, v]) => <div key={k as string} className="rounded border border-black/10 bg-white p-3"><div className="text-[10px] uppercase">{k}</div><div className="font-display text-2xl">{v}</div></div>)}</div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded border border-black/10 bg-white p-4"><h3 className="mb-2 text-sm font-bold uppercase">Sales (30 days)</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={daily}><XAxis dataKey="name" /><YAxis /><Tooltip /><Line dataKey="revenue" stroke="#C72A09" /></LineChart></ResponsiveContainer></div></div><div className="rounded border border-black/10 bg-white p-4"><h3 className="mb-2 text-sm font-bold uppercase">AI Hesitation Breakdown</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pie} dataKey="value" nameKey="name" outerRadius={90}>{pie.map((_, i) => <Cell key={i} fill={["#C72A09", "#31EF07", "#1B0E0D"][i % 3]} />)}</Pie></PieChart></ResponsiveContainer></div></div></div><div className="rounded border border-black/10 bg-white p-4"><h3 className="mb-2 text-sm font-bold uppercase">Live Activity</h3><div className="space-y-2 text-sm">{behaviors.slice(-20).reverse().map((b, i) => <div key={i}>Customer viewed {b.productId || "product"} for {b.timeOnProductPage || 0}s - {b.hesitationType || "unknown"} hesitation detected</div>)}</div></div></section>;
}

function ProductsAdmin() {
  const products = useProductCatalog();
  const nav = useNavigate();
  return <section className="space-y-4"><div className="flex justify-between"><h2 className="font-display text-3xl uppercase">Products</h2><div className="flex gap-2"><button onClick={async () => { await seedProductsIfEmpty(); }} className="rounded border border-black/10 px-3 py-2 text-xs">Seed Products</button><button onClick={() => nav("/admin/products/new")} className="rounded bg-[var(--ink)] px-3 py-2 text-xs text-white">Add Product</button></div></div><div className="overflow-auto rounded border border-black/10 bg-white"><table className="w-full text-left text-sm"><thead><tr className="border-b border-black/10 text-xs uppercase"><th className="p-2">Image</th><th className="p-2">Name</th><th className="p-2">Category</th><th className="p-2">Gender</th><th className="p-2">Price</th><th className="p-2">Discount %</th><th className="p-2">Min Price</th><th className="p-2">Stock</th><th className="p-2">Actions</th></tr></thead><tbody>{products.map((p) => <tr key={p.id} className="border-b border-black/5"><td className="p-2"><img src={p.imageURL} className="h-10 w-10 object-cover" /></td><td className="p-2">{p.name}</td><td className="p-2">{p.category}</td><td className="p-2">{p.gender}</td><td className="p-2">{inr(p.price)}</td><td className="p-2">{p.discountPercentage}</td><td className="p-2">{inr(p.minPrice)}</td><td className="p-2">{p.stock}</td><td className="p-2"><button onClick={() => nav(`/admin/products/${p.id}`)} className="mr-2 text-xs">Edit</button><button onClick={async () => deleteDoc(doc(db, "products", p.id))} className="text-xs text-red-600">Delete</button></td></tr>)}</tbody></table></div></section>;
}

function EditProduct({ isNew }: { isNew?: boolean }) {
  const nav = useNavigate();
  const products = useProductCatalog();
  const id = window.location.pathname.split("/").pop() || "";
  const found = products.find((p) => p.id === id);
  const [form, setForm] = useState<Product>(found || {
    id: `P-${Date.now()}`,
    name: "",
    price: 1500,
    minPrice: 1230,
    discountPercentage: 18,
    category: "Fashion",
    subCategory: "Topwear",
    productType: "Tshirt",
    gender: "Unisex",
    colour: "Black",
    usage: "Casual",
    imageURL: "",
    stock: 10,
  });
  useEffect(() => {
    const minPrice = Math.round(form.price * (1 - form.discountPercentage / 100));
    setForm((f) => ({ ...f, minPrice }));
  }, [form.price, form.discountPercentage]);
  return <section className="space-y-3 rounded border border-black/10 bg-white p-4"><h2 className="font-display text-3xl uppercase">{isNew ? "Add Product" : "Edit Product"}</h2>{Object.entries(form).map(([k, v]) => <label key={k} className="block text-sm"><span className="text-xs uppercase">{k}</span><input disabled={k === "minPrice"} value={String(v)} onChange={(e) => setForm((f) => ({ ...f, [k]: ["price", "discountPercentage", "stock"].includes(k) ? Number(e.target.value) : e.target.value }))} className="mt-1 w-full rounded border border-black/10 px-3 py-2" /></label>)}<button onClick={async () => { await setDoc(doc(db, "products", form.id), { ...form, updatedAt: serverTimestamp(), createdAt: found ? found : serverTimestamp() }, { merge: true }); nav("/admin/products"); }} className="rounded bg-[var(--ink)] px-4 py-2 text-white">Save</button></section>;
}

function AiDashboard() {
  const [logs, setLogs] = useState<any[]>([]);
  const [patterns, setPatterns] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({ exitIntentEnabled: true, notificationsEnabled: true, notificationDelay: 5, maxNotificationsPerUserPerDay: 2, overlayThreshold: 0.65, preferredChannel: "auto", learningMode: "active" });
  useEffect(() => onSnapshot(collection(db, "behaviorLogs"), (s) => setLogs(s.docs.map((d) => d.data()))), []);
  useEffect(() => onSnapshot(collection(db, "patternMemory"), (s) => setPatterns(s.docs.map((d) => d.data()))), []);
  const started = logs.filter((l) => l.aiActionTaken).length;
  const successful = logs.filter((l) => l.outcome === "purchased").length;
  const avgAttempts = logs.length ? logs.reduce((a, b) => a + (b.checkoutVisitCount || 0), 0) / logs.length : 0;
  return <section className="space-y-4"><h2 className="font-display text-3xl uppercase">NegoCart AI Dashboard</h2><div className="grid gap-4 md:grid-cols-5">{[["Negotiations", started], ["Successful", successful], ["Avg Attempts", avgAttempts.toFixed(1)], ["Push conv", "-"], ["Email conv", "-"]].map(([k, v]) => <div key={k as string} className="rounded border border-black/10 bg-white p-3"><div className="text-[10px] uppercase">{k}</div><div className="text-2xl">{v}</div></div>)}</div><div className="rounded border border-black/10 bg-white p-4"><h3 className="mb-2 text-sm font-bold uppercase">Pattern Memory</h3><table className="w-full text-left text-sm"><thead><tr className="text-xs uppercase"><th>Hesitation</th><th>Action</th><th>Channel</th><th>Success Rate</th><th>Sample</th><th>Updated</th></tr></thead><tbody>{patterns.map((p) => <tr key={p.patternId}><td>{p.hesitationType}</td><td>{p.actionTaken}</td><td>{p.channel}</td><td>{((p.successRate || 0) * 100).toFixed(1)}%</td><td>{(p.successCount || 0) + (p.failureCount || 0)}</td><td>{String(p.lastUpdatedAt?.toDate?.() || "-")}</td></tr>)}</tbody></table></div><div className="rounded border border-black/10 bg-white p-4"><h3 className="mb-2 text-sm font-bold uppercase">AI Behavior Settings</h3>{Object.entries(settings).map(([k, v]) => <label key={k} className="mb-2 block text-sm"><span className="text-xs uppercase">{k}</span><input value={String(v)} onChange={(e) => setSettings((s: any) => ({ ...s, [k]: e.target.value }))} className="mt-1 w-full rounded border border-black/10 px-3 py-2" /></label>)}<div className="flex gap-2"><button onClick={async () => setDoc(doc(db, "aiSettings", "main"), settings, { merge: true })} className="rounded bg-[var(--ink)] px-3 py-2 text-xs text-white">Save Settings</button><button onClick={async () => { for (const p of patterns) { await updateDoc(doc(db, "patternMemory", p.patternId), { successCount: 0, failureCount: 0, successRate: 0, lastUpdatedAt: serverTimestamp() }); } }} className="rounded border border-black/10 px-3 py-2 text-xs">Reset Pattern Memory</button><button onClick={() => { const rows = logs.map((l) => JSON.stringify(l)).join("\n"); const blob = new Blob([rows], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "behaviorLogs.csv"; a.click(); URL.revokeObjectURL(url); }} className="rounded border border-black/10 px-3 py-2 text-xs">Export Behavior Data</button></div></div></section>;
}

function OrdersAdmin() {
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc")), (s) => setOrders(s.docs.map((d) => ({ id: d.id, ...d.data() })))), []);
  return <section className="space-y-4"><h2 className="font-display text-3xl uppercase">Orders</h2><div className="space-y-2">{orders.map((o) => <div key={o.id} className="flex flex-wrap items-center justify-between rounded border border-black/10 bg-white p-3 text-sm"><div>{o.orderId} - {o.uid}</div><div>{inr(o.originalTotal)} {' to '} {inr(o.finalTotal)} (save {inr(o.negotiationSavings)})</div><select value={o.status} onChange={async (e) => updateDoc(doc(db, "orders", o.id), { status: e.target.value })} className="rounded border border-black/10 px-2 py-1"><option>pending</option><option>confirmed</option><option>shipped</option><option>delivered</option><option>cancelled</option></select></div>)}</div></section>;
}

function NotificationsAdmin() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => onSnapshot(collection(db, "notifications"), (s) => setRows(s.docs.map((d) => d.data()))), []);
  const perf = useMemo(() => {
    const map: Record<string, { converted: number; total: number }> = {};
    rows.forEach((r) => {
      const key = `${r.hesitationType}:${r.channel}`;
      map[key] = map[key] || { converted: 0, total: 0 };
      map[key].total += 1;
      if (r.outcome === "converted") map[key].converted += 1;
    });
    return Object.entries(map);
  }, [rows]);
  return <section className="space-y-4"><h2 className="font-display text-3xl uppercase">Notifications</h2><div className="overflow-auto rounded border border-black/10 bg-white"><table className="w-full text-left text-sm"><thead><tr className="text-xs uppercase"><th className="p-2">Channel</th><th className="p-2">Hesitation</th><th className="p-2">Message</th><th className="p-2">Sent</th><th className="p-2">Opened</th><th className="p-2">Clicked</th><th className="p-2">Converted</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td className="p-2">{r.channel}</td><td className="p-2">{r.hesitationType}</td><td className="p-2">{r.message}</td><td className="p-2">{String(r.sentAt?.toDate?.() || "-")}</td><td className="p-2">{r.openedAt ? "Yes" : "No"}</td><td className="p-2">{r.clickedAt ? "Yes" : "No"}</td><td className="p-2">{r.convertedAt ? "Yes" : "No"}</td></tr>)}</tbody></table></div><div className="rounded border border-black/10 bg-white p-4"><h3 className="mb-2 text-sm font-bold uppercase">Performance by Type & Channel</h3>{perf.map(([k, v]) => <div key={k} className="text-sm">{k}: {v.total ? ((v.converted / v.total) * 100).toFixed(1) : 0}%</div>)}</div></section>;
}
