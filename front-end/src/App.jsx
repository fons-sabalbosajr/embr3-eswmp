import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import VerifyEmail from "./pages/VerifyEmail";
import AdminHome from "./pages/AdminHome";
import SLFPortal from "./pages/SLFPortal";
import PortalLogin from "./pages/PortalLogin";
import PortalSignup from "./pages/PortalSignup";
import PortalForgotPassword from "./pages/PortalForgotPassword";
import PortalResetPassword from "./pages/PortalResetPassword";
import AdminForgotPassword from "./pages/AdminForgotPassword";
import AdminResetPassword from "./pages/AdminResetPassword";

function App() {
  return (
    <BrowserRouter basename="/eswm-pipeline">
      <Routes>
        {/* Portal Side */}
        <Route path="/" element={<Navigate to="/slfportal/login" replace />} />
        <Route path="/slfportal" element={<SLFPortal />} />
        <Route path="/slfportal/login" element={<PortalLogin />} />
        <Route path="/slfportal/signup" element={<PortalSignup />} />
        <Route path="/slfportal/forgot-password" element={<PortalForgotPassword />} />
        <Route path="/slfportal/reset-password" element={<PortalResetPassword />} />

        {/* Admin Side */}
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin/signup" element={<Signup />} />
        <Route path="/admin/verify-email" element={<VerifyEmail />} />
        <Route path="/admin/forgot-password" element={<AdminForgotPassword />} />
        <Route path="/admin/reset-password" element={<AdminResetPassword />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/slfportal/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
