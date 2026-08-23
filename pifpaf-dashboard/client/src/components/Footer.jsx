export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand">
            <span className="pf">PifPaf</span>
            <span className="ai">AI</span>
            <span className="dash">—</span>
            <span className="tagline">фотосессия в 1 клик</span>
          </div>
        </div>

        <div className="footer-links">
          <a href="/">Главная</a>
          <a href="/tariffs">Тарифы</a>
          <a href="/privacy">Политика конфиденциальности</a>
          <a href="/terms">Условия использования</a>
          <a href="/offer">Публичная оферта</a>
        </div>

        <div className="footer-bottom">
          <div className="footer-legal">
            <span>ИП Золотых Сергей Сергеевич</span>
            <span className="divider">·</span>
            <span>ОГРНИП 324265100131172</span>
            <span className="divider">·</span>
            <span>ИНН 263119797456</span>
          </div>
          <div className="footer-copy">
            <span>Сервис доступен лицам старше 18 лет</span>
            <span className="divider">·</span>
            <span>© {year} PifPaf AI · фотосессия в 1 клик</span>
          </div>
        </div>
      </div>
    </footer>
  );
}