import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { Spin } from "antd";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const AdminHome = lazy(() => import("./pages/AdminHome"));
const SLFPortal = lazy(() => import("./pages/SLFPortal"));
const PortalLogin = lazy(() => import("./pages/PortalLogin"));
const PortalSignup = lazy(() => import("./pages/PortalSignup"));
const PortalForgotPassword = lazy(() => import("./pages/PortalForgotPassword"));
const AdminForgotPassword = lazy(() => import("./pages/AdminForgotPassword"));

const PageLoader = () => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
    <Spin size="large" />
  </div>
);

function App() {
  return (
    <BrowserRouter basename="/eswm-pipeline">
      <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Landing Page */}
        <Route path="/" element={<Landing />} />

        {/* Portal Side */}
        <Route path="/slfportal" element={<SLFPortal />} />
        <Route path="/slfportal/login" element={<PortalLogin />} />
        <Route path="/slfportal/signup" element={<PortalSignup />} />
        <Route path="/slfportal/forgot-password" element={<PortalForgotPassword />} />

        {/* Admin Side */}
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin/signup" element={<Signup />} />
        <Route path="/admin/verify-email" element={<VerifyEmail />} />
        <Route path="/admin/forgot-password" element={<AdminForgotPassword />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/slfportal/login" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
