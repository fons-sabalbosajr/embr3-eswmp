import { useEffect, useState } from "react";
import { Card, Typography, Spin, Result, Button } from "antd";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../api";

const { Title } = Typography;

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setMessage("Invalid verification link.");
      return;
    }

    api
      .get(`/auth/verify-email?token=${token}`)
      .then(({ data }) => {
        setStatus("success");
        setMessage(data.message);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.response?.data?.message || "Verification failed.");
      });
  }, [searchParams]);

  return (
    <div style={styles.container}>
      <Card style={styles.card}>
        {status === "loading" && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin size="large" />
            <Title level={4} style={{ marginTop: 24, color: "#1a3353" }}>
              Verifying your email...
            </Title>
          </div>
        )}
        {status === "success" && (
          <Result
            status="success"
            title="Email Verified!"
            subTitle={message}
            extra={
              <Button
                type="primary"
                onClick={() => navigate("/login")}
                style={styles.btn}
              >
                Go to Login
              </Button>
            }
          />
        )}
        {status === "error" && (
          <Result
            status="error"
            title="Verification Failed"
            subTitle={message}
            extra={
              <Button
                type="primary"
                onClick={() => navigate("/signup")}
                style={styles.btn}
              >
                Sign Up Again
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0f2f5",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 500,
    borderRadius: 12,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  },
  btn: {
    background: "#1a3353",
    borderColor: "#1a3353",
    borderRadius: 8,
    fontWeight: 600,
  },
};
