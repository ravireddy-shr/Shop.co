import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import ClientApp from "./apps/client/ClientApp";
import AdminApp from "./apps/admin/AdminApp";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/*" element={<ClientApp />} />
      </Routes>
    </Router>
  );
}
