import { Logo } from "./Logo";

export default function Header() {
  return (
    <header className="header">
      <div className="header-logo">
        <Logo className="header-logo-svg" color="#3b5eff" />
        <div className="header-title">
          <span className="pifpaf">PifPaf</span>
          <span className="ai">AI</span>
        </div>
      </div>


    </header>
  );
}