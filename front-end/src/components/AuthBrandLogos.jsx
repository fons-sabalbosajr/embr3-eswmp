import embLogo from "../assets/emblogo.svg";
import bpLogo from "../assets/bagongpilipinaslogo.png";

/**
 * Paired brand marks shown in the auth-page brand header: EMB Region III
 * alongside the Bagong Pilipinas seal. Reuses the existing `.auth-brand-logo-circle`
 * styling; the `.auth-brand-logos` row lays the two out side by side and keeps
 * them aligned/proportioned and responsive (see Auth.css).
 */
export default function AuthBrandLogos() {
  return (
    <div className="auth-brand-logos">
      <div className="auth-brand-logo-circle">
        <img src={embLogo} alt="Environmental Management Bureau Region III" />
      </div>
      <div className="auth-brand-logo-circle">
        <img src={bpLogo} alt="Bagong Pilipinas" />
      </div>
    </div>
  );
}
