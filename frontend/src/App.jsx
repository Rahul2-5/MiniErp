import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import Login from './pages/Login';
import Enquiries from './pages/Enquiries';
import Quotations from './pages/Quotations';
import SalesOrders from './pages/SalesOrders';

// Not logged in -> go to /login. Logged in -> show the navigation bar and the page.
// This only hides pages (UX). The real protection is the JWT check in the backend.
function ProtectedLayout() {
  const { user, logout } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <header className="topbar">
        <strong>Mini ERP</strong>
        <nav>
          <NavLink to="/enquiries">Enquiries</NavLink>
          <NavLink to="/quotations">Quotations</NavLink>
          <NavLink to="/sales-orders">Sales Orders</NavLink>
        </nav>
        <span className="user">
          {user.name} ({user.role})
          <button onClick={logout}>Logout</button>
        </span>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/enquiries" element={<Enquiries />} />
          <Route path="/quotations" element={<Quotations />} />
          <Route path="/sales-orders" element={<SalesOrders />} />
        </Route>
        <Route path="*" element={<Navigate to="/enquiries" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
